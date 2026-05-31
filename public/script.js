const socket = io();
const WAIFU_AVATAR_SRC = 'assets/otaku-waifu-icon.png';
const ORIGINAL_AVATAR_AUTHORS = new Set(['javiere']);
let messages = [];
let currentSearch = '';
let currentSort = 'date';
let currentPage = 1;
let currentPageSize = '100';
let currentPagination = {
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false
};
let searchTimer;

// DOM Elements
const messagesContainer = document.getElementById('messagesContainer');
const searchInput = document.getElementById('searchInput');
const sortBy = document.getElementById('sortBy');
const pageSize = document.getElementById('pageSize');
const refreshBtn = document.getElementById('refreshBtn');
const statusBar = document.getElementById('statusBar');
const themeToggle = document.getElementById('themeToggle');
const channelName = document.getElementById('channelName');
const messageCount = document.getElementById('messageCount');
const visibleCount = document.getElementById('visibleCount');
const previousPage = document.getElementById('previousPage');
const nextPage = document.getElementById('nextPage');
const viewLinks = document.querySelectorAll('[data-view-link]');
const appViews = {
    tsukamonda: document.getElementById('tsukamondaView'),
    dashboard: document.getElementById('dashboardView')
};
const dashboardRange = document.getElementById('dashboardRange');
const dashboardChannel = document.getElementById('dashboardChannel');
const dashboardUser = document.getElementById('dashboardUser');
const dashboardWarnings = document.getElementById('dashboardWarnings');
const dashboardGeneratedAt = document.getElementById('dashboardGeneratedAt');
const dashboardTabs = document.querySelectorAll('[data-dashboard-tab]');
const dashboardPanels = document.querySelectorAll('[data-dashboard-panel]');
const kpiTotalMessages = document.getElementById('kpiTotalMessages');
const kpiTextUsers = document.getElementById('kpiTextUsers');
const kpiTopTextChannel = document.getElementById('kpiTopTextChannel');
const kpiVoiceTime = document.getElementById('kpiVoiceTime');
const kpiVoiceUsers = document.getElementById('kpiVoiceUsers');
let currentDashboardTab = 'summary';
let summaryChart;
let textChart;
let voiceChart;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    applySavedTheme();
    handleRoute();

    // Load messages initially
    loadStatus();
    loadMessages();
    loadDashboardChannels();
    
    // Set up event listeners
    searchInput.addEventListener('input', handleSearch);
    sortBy.addEventListener('change', handleSort);
    pageSize.addEventListener('change', handlePageSize);
    refreshBtn.addEventListener('click', refreshMessages);
    themeToggle.addEventListener('click', toggleTheme);
    previousPage.addEventListener('click', goToPreviousPage);
    nextPage.addEventListener('click', goToNextPage);
    dashboardRange.addEventListener('change', loadDashboard);
    dashboardChannel.addEventListener('change', loadDashboard);
    dashboardUser.addEventListener('change', loadDashboard);
    window.addEventListener('hashchange', handleRoute);

    dashboardTabs.forEach(button => {
        button.addEventListener('click', () => {
            currentDashboardTab = button.dataset.dashboardTab;
            setDashboardTab(currentDashboardTab);
            loadDashboard();
        });
    });
    
    // Set up socket listeners
    socket.on('connect', () => {
        console.log('Connected to server');
    });
    
    socket.on('initialMessages', (data) => {
        messages = data;
        loadMessages();
    });
    
    socket.on('messageUpdate', (data) => {
        // Add or update message in our local array
        const existingIndex = messages.findIndex(msg => msg.id === data.id);
        if (existingIndex !== -1) {
            // Update existing message
            messages[existingIndex] = data;
        } else {
            // Add new message
            messages.unshift(data);
        }
        
        // Keep only the latest 500 messages
        if (messages.length > 500) {
            messages = messages.slice(0, 500);
        }
        
        loadMessages();
    });

    socket.on('statusUpdate', updateStatus);
    socket.on('dashboardUpdate', () => {
        if (getCurrentView() === 'dashboard') {
            loadDashboard();
        }
    });
});

function getCurrentView() {
    const view = window.location.hash.replace('#', '');
    return appViews[view] ? view : 'tsukamonda';
}

function handleRoute() {
    const activeView = getCurrentView();

    Object.entries(appViews).forEach(([name, element]) => {
        element.classList.toggle('active', name === activeView);
    });

    viewLinks.forEach(link => {
        link.classList.toggle('active', link.dataset.viewLink === activeView);
    });

    if (activeView === 'dashboard') {
        loadDashboard();
    }
}

// Load messages from API
function loadMessages() {
    showLoading();
    
    const params = new URLSearchParams({
        sortBy: currentSort,
        limit: currentPageSize,
        page: String(currentPage),
        includeMeta: '1'
    });

    if (currentSearch) {
        params.set('search', currentSearch);
    }

    return fetch(`/api/messages?${params.toString()}`)
        .then(response => response.json())
        .then(payload => {
            messages = payload.messages || [];
            currentPagination = payload.pagination || currentPagination;
            currentPage = currentPagination.page || currentPage;
            renderMessages(messages);
        })
        .catch(error => {
            console.error('Error loading messages:', error);
            messagesContainer.innerHTML = '<div class="empty-state">No se pudieron cargar los mensajes.</div>';
            updateVisibleCount(0);
        });
}

function loadDashboardChannels() {
    return fetch('/api/dashboard/channels')
        .then(response => response.json())
        .then(data => {
            const options = ['<option value="">Todos</option>'];

            if (data.text?.length) {
                options.push('<option disabled>Texto</option>');
                options.push(...data.text.map(channel => `<option value="${escapeAttribute(channel.id)}">${escapeHtml(channel.name)}</option>`));
            }

            if (data.voice?.length) {
                options.push('<option disabled>Voz</option>');
                options.push(...data.voice.map(channel => `<option value="${escapeAttribute(channel.id)}">${escapeHtml(channel.name)}</option>`));
            }

            dashboardChannel.innerHTML = options.join('');
            renderWarnings(data.warnings || []);
        })
        .catch(error => {
            console.error('Error loading dashboard channels:', error);
            renderWarnings(['No se pudieron cargar los canales del dashboard']);
        });
}

function loadDashboard() {
    const params = new URLSearchParams({
        range: dashboardRange.value,
        channelId: dashboardChannel.value,
        userId: dashboardUser.value
    });

    return Promise.all([
        fetch(`/api/dashboard/summary?${params}`).then(response => response.json()),
        fetch(`/api/dashboard/text?${params}`).then(response => response.json()),
        fetch(`/api/dashboard/voice?${params}`).then(response => response.json())
    ])
        .then(([summary, text, voice]) => {
            renderDashboardSummary(summary);
            renderDashboardText(text);
            renderDashboardVoice(voice);
            renderWarnings(summary.warnings || []);
            syncDashboardUsers(summary, text, voice);
        })
        .catch(error => {
            console.error('Error loading dashboard:', error);
            renderWarnings(['No se pudo cargar el dashboard']);
        });
}

function renderDashboardSummary(summary) {
    const kpis = summary.kpis || {};

    kpiTotalMessages.textContent = formatNumber(kpis.totalMessages);
    kpiTextUsers.textContent = formatNumber(kpis.activeTextUsers);
    kpiTopTextChannel.textContent = kpis.mostActiveTextChannel?.label || 'Sin datos';
    kpiVoiceTime.textContent = formatDuration(kpis.totalVoiceDurationMs || 0);
    kpiVoiceUsers.textContent = formatNumber(kpis.activeVoiceUsers);
    dashboardGeneratedAt.textContent = summary.generatedAt ? `Actualizado ${formatDate(summary.generatedAt)}` : 'Pendiente';

    renderChart('summaryChart', summaryChart, chart => summaryChart = chart, {
        labels: (summary.activitySeries || []).map(item => shortDate(item.bucket)),
        datasets: [
            { label: 'Mensajes', data: (summary.activitySeries || []).map(item => item.messages || 0), borderColor: '#5b8def', backgroundColor: 'rgba(91, 141, 239, 0.24)' },
            { label: 'Minutos voz', data: (summary.activitySeries || []).map(item => item.voiceMinutes || 0), borderColor: '#00d6d6', backgroundColor: 'rgba(0, 214, 214, 0.18)' }
        ]
    });
    renderRankList('combinedUsers', 'Actividad combinada', summary.topCombinedUsers || [], item => `${item.label} - ${formatNumber(item.score)} pts - ${formatNumber(item.messages)} msg - ${formatDuration(item.voiceDurationMs)}`);
}

function renderDashboardText(text) {
    renderChart('textChart', textChart, chart => textChart = chart, {
        labels: (text.messageSeries || []).map(item => shortDate(item.bucket)),
        datasets: [{ label: 'Mensajes', data: (text.messageSeries || []).map(item => item.messages || 0), borderColor: '#5b8def', backgroundColor: 'rgba(91, 141, 239, 0.24)' }]
    });
    renderRankList('textUsers', 'Top usuarios texto', text.topTextUsers || [], item => `${item.label} - ${formatNumber(item.count)} mensajes`);
    renderRankList('textChannels', 'Top canales texto', text.topTextChannels || [], item => `${item.label} - ${formatNumber(item.count)} mensajes`);
    renderRankList('frequentWords', 'Palabras frecuentes', text.frequentWords || [], item => `${item.word} - ${formatNumber(item.count)}`);
}

function renderDashboardVoice(voice) {
    renderChart('voiceChart', voiceChart, chart => voiceChart = chart, {
        labels: (voice.voiceMinutesSeries || []).map(item => shortDate(item.bucket)),
        datasets: [{ label: 'Minutos voz', data: (voice.voiceMinutesSeries || []).map(item => item.voiceMinutes || 0), borderColor: '#00d6d6', backgroundColor: 'rgba(0, 214, 214, 0.18)' }]
    });
    renderRankList('voiceUsers', 'Top usuarios voz', voice.topVoiceUsers || [], item => `${item.label} - ${formatDuration(item.durationMs)}`);
    renderRankList('voiceChannels', 'Top canales voz', voice.topVoiceChannels || [], item => `${item.label} - ${formatDuration(item.durationMs)}`);
    renderRankList('recentVoiceSessions', 'Sesiones recientes', voice.recentVoiceSessions || [], item => `${item.user?.displayName || item.user?.username || item.userId} - ${item.channel?.name || item.channelId} - ${formatDuration(item.durationMs || 0)}`);
}

function renderChart(canvasId, currentChart, assignChart, data) {
    if (!window.Chart) return;

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (currentChart) currentChart.destroy();

    assignChart(new Chart(canvas, {
        type: 'line',
        data,
        options: {
            responsive: true,
            plugins: { legend: { labels: { color: '#9aa8bc' } } },
            scales: {
                x: { ticks: { color: '#9aa8bc' }, grid: { color: 'rgba(154, 168, 188, 0.12)' } },
                y: { ticks: { color: '#9aa8bc' }, grid: { color: 'rgba(154, 168, 188, 0.12)' } }
            }
        }
    }));
}

function renderRankList(elementId, title, items, formatItem) {
    const element = document.getElementById(elementId);
    const rows = items.length
        ? items.map((item, index) => `<li><span>${index + 1}</span><strong>${escapeHtml(formatItem(item))}</strong></li>`).join('')
        : '<li><span>-</span><strong>Sin datos</strong></li>';

    element.innerHTML = `<h3>${escapeHtml(title)}</h3><ol>${rows}</ol>`;
}

function renderWarnings(warnings) {
    dashboardWarnings.hidden = warnings.length === 0;
    dashboardWarnings.innerHTML = warnings.map(warning => `<div>${escapeHtml(warning)}</div>`).join('');
}

function syncDashboardUsers(summary, text, voice) {
    const selected = dashboardUser.value;
    const users = new Map();

    for (const item of [...(summary.topCombinedUsers || []), ...(text.topTextUsers || []), ...(voice.topVoiceUsers || [])]) {
        const id = item.id || item.item?.id;
        const label = item.label || item.item?.displayName || item.item?.username;
        if (id && label) users.set(id, label);
    }

    dashboardUser.innerHTML = '<option value="">Todos</option>' +
        [...users.entries()].map(([id, label]) => `<option value="${escapeAttribute(id)}">${escapeHtml(label)}</option>`).join('');

    if (selected && users.has(selected)) {
        dashboardUser.value = selected;
    }
}

function setDashboardTab(tabName) {
    dashboardTabs.forEach(button => button.classList.toggle('active', button.dataset.dashboardTab === tabName));
    dashboardPanels.forEach(panel => {
        panel.hidden = panel.dataset.dashboardPanel !== tabName;
    });
}

// Handle search
function handleSearch() {
    currentSearch = searchInput.value.toLowerCase();
    currentPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadMessages, 250);
}

// Handle sorting
function handleSort() {
    currentSort = sortBy.value;
    currentPage = 1;
    loadMessages();
}

function handlePageSize() {
    currentPageSize = pageSize.value;
    currentPage = 1;
    loadMessages();
}

function goToPreviousPage() {
    if (!currentPagination.hasPreviousPage) return;

    currentPage -= 1;
    loadMessages();
}

function goToNextPage() {
    if (!currentPagination.hasNextPage) return;

    currentPage += 1;
    loadMessages();
}

// Render messages to the DOM
function renderMessages(messagesToRender) {
    if (messagesToRender.length === 0) {
        messagesContainer.innerHTML = '<div class="empty-state">No hay mensajes para mostrar.</div>';
        updateVisibleCount(0);
        return;
    }
    
    const messagesHtml = messagesToRender.map(msg => {
        const authorName = getAuthorName(msg);
        const avatar = getAvatarForMessage(msg);
        const isWaifuAvatar = avatar === WAIFU_AVATAR_SRC;
        const waifuClass = isWaifuAvatar ? ` waifu-avatar waifu-avatar-${getWaifuVariant(msg)}` : '';
        const date = msg.createdAt || msg.timestamp;

        return `
        <div class="message-card">
            <div class="message-header">
                ${avatar ? `<img src="${escapeAttribute(avatar)}" alt="${escapeAttribute(authorName)}" class="avatar${waifuClass}">` : `<div class="avatar avatar-fallback">${escapeHtml(authorName.slice(0, 1).toUpperCase())}</div>`}
                <div class="message-meta">
                    <div class="author">${escapeHtml(authorName)}</div>
                    <div class="date">${formatDate(date)}</div>
                </div>
            </div>
            <div class="message-content">${escapeHtml(msg.content)}</div>
        </div>
    `;
    }).join('');
    
    messagesContainer.innerHTML = messagesHtml;
    updateVisibleCount(messagesToRender.length);
}

// Show loading state
function showLoading() {
    messagesContainer.innerHTML = '<div class="loading">Cargando mensajes...</div>';
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text || '');
    return div.innerHTML;
}

function escapeAttribute(text) {
    return escapeHtml(text).replace(/"/g, '&quot;');
}

function getAuthorName(message) {
    return message.author?.displayName || message.author?.username || message.author?.tag || 'Unknown user';
}

function getAvatarForMessage(message) {
    if (isOtakuTheme() && !shouldKeepOriginalAvatar(message)) {
        return WAIFU_AVATAR_SRC;
    }

    return message.author?.avatar || null;
}

function shouldKeepOriginalAvatar(message) {
    const authorParts = [
        message.author?.displayName,
        message.author?.username,
        message.author?.tag?.split('#')[0],
    ];

    return authorParts.some(part => ORIGINAL_AVATAR_AUTHORS.has(String(part || '').trim().toLowerCase()));
}

function getWaifuVariant(message) {
    const seed = String(message.author?.id || message.id || getAuthorName(message));
    let hash = 0;

    for (const char of seed) {
        hash = (hash + char.charCodeAt(0)) % 4;
    }

    return hash + 1;
}

function refreshMessages() {
    showLoading();

    fetch('/api/refresh', { method: 'POST' })
        .then(response => response.json())
        .then(result => {
            if (!result.ok) {
                throw new Error(result.error || 'Refresh failed');
            }

            loadStatus();
            return loadMessages();
        })
        .catch(error => {
            console.error('Error refreshing messages:', error);
            messagesContainer.innerHTML = '<div class="empty-state">No se pudieron actualizar los mensajes.</div>';
            updateVisibleCount(0);
        });
}

function loadStatus() {
    return fetch('/api/status')
        .then(response => response.json())
        .then(updateStatus)
        .catch(error => {
            console.error('Error loading status:', error);
            statusBar.textContent = 'Estado no disponible';
            statusBar.classList.add('status-error');
        });
}

function updateStatus(status) {
    statusBar.classList.toggle('status-error', Boolean(status.error));

    if (status.error) {
        statusBar.textContent = status.error;
        channelName.textContent = status.configuredChannelId || 'Sin canal';
        messageCount.textContent = '0';
        return;
    }

    if (status.channelName) {
        channelName.textContent = `#${status.channelName}`;
        messageCount.textContent = formatNumber(status.messageCount);
        statusBar.textContent = status.lastFetchAt
            ? `Ultima lectura ${formatDate(status.lastFetchAt)}`
            : 'Discord conectado';
        return;
    }

    channelName.textContent = status.configuredChannelId || 'Conectando';
    messageCount.textContent = formatNumber(status.messageCount || messages.length);
    statusBar.textContent = status.ready ? 'Discord conectado' : 'Conectando a Discord...';
}

function applySavedTheme() {
    const savedTheme = localStorage.getItem('messageViewerTheme') || 'normal';
    setTheme(savedTheme === 'otaku' ? 'otaku' : 'normal');
}

function toggleTheme() {
    const nextTheme = document.body.dataset.theme === 'otaku' ? 'normal' : 'otaku';
    setTheme(nextTheme);
}

function setTheme(theme) {
    document.body.dataset.theme = theme;
    localStorage.setItem('messageViewerTheme', theme);
    themeToggle.textContent = theme === 'otaku' ? 'Modo normal' : 'Modo otaku';

    if (messages.length > 0) {
        renderMessages(messages);
    }
}

function isOtakuTheme() {
    return document.body.dataset.theme === 'otaku';
}

function updateVisibleCount(count) {
    const pagination = currentPagination;
    const total = formatNumber(pagination.total);

    if (pagination.pageSize === 'all') {
        visibleCount.textContent = `${formatNumber(count)} de ${total}`;
    } else {
        visibleCount.textContent = `Pagina ${pagination.page} de ${pagination.totalPages} - ${formatNumber(count)} de ${total}`;
    }

    previousPage.disabled = !pagination.hasPreviousPage;
    nextPage.disabled = !pagination.hasNextPage;
}

function formatDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Fecha desconocida';
    }

    return date.toLocaleString();
}

function formatNumber(value) {
    return new Intl.NumberFormat().format(Number(value) || 0);
}

function formatDuration(ms) {
    const minutes = Math.floor((Number(ms) || 0) / 60000);
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;

    if (hours === 0) {
        return `${restMinutes}m`;
    }

    return `${hours}h ${restMinutes}m`;
}

function shortDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'N/A';
    }

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
