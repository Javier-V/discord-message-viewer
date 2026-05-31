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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    applySavedTheme();

    // Load messages initially
    loadStatus();
    loadMessages();
    
    // Set up event listeners
    searchInput.addEventListener('input', handleSearch);
    sortBy.addEventListener('change', handleSort);
    pageSize.addEventListener('change', handlePageSize);
    refreshBtn.addEventListener('click', refreshMessages);
    themeToggle.addEventListener('click', toggleTheme);
    previousPage.addEventListener('click', goToPreviousPage);
    nextPage.addEventListener('click', goToNextPage);
    
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
});

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
