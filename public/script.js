const socket = io();
let messages = [];
let currentSearch = '';
let currentSort = 'date';

// DOM Elements
const messagesContainer = document.getElementById('messagesContainer');
const searchInput = document.getElementById('searchInput');
const sortBy = document.getElementById('sortBy');
const refreshBtn = document.getElementById('refreshBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Load messages initially
    loadMessages();
    
    // Set up event listeners
    searchInput.addEventListener('input', handleSearch);
    sortBy.addEventListener('change', handleSort);
    refreshBtn.addEventListener('click', loadMessages);
    
    // Set up socket listeners
    socket.on('connect', () => {
        console.log('Connected to server');
    });
    
    socket.on('initialMessages', (data) => {
        messages = data;
        renderMessages(messages);
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
        
        renderMessages(messages);
    });
});

// Load messages from API
function loadMessages() {
    showLoading();
    
    fetch('/api/messages')
        .then(response => response.json())
        .then(data => {
            messages = data;
            renderMessages(messages);
        })
        .catch(error => {
            console.error('Error loading messages:', error);
            messagesContainer.innerHTML = '<div class="no-results">Error loading messages. Please try again.</div>';
        });
}

// Handle search
function handleSearch() {
    currentSearch = searchInput.value.toLowerCase();
    applyFilters();
}

// Handle sorting
function handleSort() {
    currentSort = sortBy.value;
    applyFilters();
}

// Apply filters and sorting
function applyFilters() {
    let filtered = [...messages];
    
    // Apply search filter
    if (currentSearch) {
        filtered = filtered.filter(msg => 
            msg.content.toLowerCase().includes(currentSearch) ||
            msg.author.username.toLowerCase().includes(currentSearch)
        );
    }
    
    // Apply sorting
    if (currentSort === 'author') {
        filtered.sort((a, b) => a.author.username.localeCompare(b.author.username));
    } else {
        // Sort by date (newest first)
        filtered.sort((a, b) => b.timestamp - a.timestamp);
    }
    
    renderMessages(filtered);
}

// Render messages to the DOM
function renderMessages(messagesToRender) {
    if (messagesToRender.length === 0) {
        messagesContainer.innerHTML = '<div class="no-results">No messages found.</div>';
        return;
    }
    
    const messagesHtml = messagesToRender.map(msg => `
        <div class="message-card">
            <div class="message-header">
                <img src="${msg.author.avatar}" alt="${msg.author.username}" class="avatar" onerror="this.src='/avatar-placeholder.png'">
                <div class="author">${msg.author.username}</div>
                <div class="date">${new Date(msg.createdAt).toLocaleString()}</div>
            </div>
            <div class="message-content">${escapeHtml(msg.content)}</div>
        </div>
    `).join('');
    
    messagesContainer.innerHTML = messagesHtml;
}

// Show loading state
function showLoading() {
    messagesContainer.innerHTML = '<div class="loading">Loading messages...</div>';
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}