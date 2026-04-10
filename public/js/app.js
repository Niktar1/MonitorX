// public/js/app.js
const API_BASE = '/api';

// DOM Elements
const statusIndicator = document.getElementById('status-indicator');
const loginBtn = document.getElementById('login-btn');
const loginStatus = document.getElementById('login-status');
const watchUrlInput = document.getElementById('watch-url');
const addWatchBtn = document.getElementById('add-watch-btn');
const webhookNameInput = document.getElementById('webhook-name');
const webhookUrlInput = document.getElementById('webhook-url');
const addWebhookBtn = document.getElementById('add-webhook-btn');
const webhookSelect = document.getElementById('webhook-select');
const startBtn = document.getElementById('start-monitor-btn');
const stopBtn = document.getElementById('stop-monitor-btn');
const watchesList = document.getElementById('watches-list');
const webhooksList = document.getElementById('webhooks-list');

// State
let defaultWebhooks = [
    { name: 'Alerts Channel', url: '' }, // Will be populated from config or user
    { name: 'Debug Channel', url: '' }
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkStatus();
    loadWatches();
    loadWebhooks();
    populateWebhookSelect();
    
    // Event listeners
    loginBtn.addEventListener('click', handleLogin);
    addWatchBtn.addEventListener('click', handleAddWatch);
    addWebhookBtn.addEventListener('click', handleAddWebhook);
    startBtn.addEventListener('click', handleStart);
    stopBtn.addEventListener('click', handleStop);
});

// ----- API Calls -----
async function checkStatus() {
    try {
        const res = await fetch(`${API_BASE}/status`);
        const data = await res.json();
        statusIndicator.textContent = '● Online';
        statusIndicator.className = 'status online';
        startBtn.disabled = true;
        stopBtn.disabled = false;
    } catch (error) {
        statusIndicator.textContent = '● Offline';
        statusIndicator.className = 'status offline';
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
}

async function loadWatches() {
    try {
        const res = await fetch(`${API_BASE}/watches`);
        const watches = await res.json();
        renderWatches(watches);
    } catch (error) {
        console.error('Failed to load watches:', error);
    }
}

async function loadWebhooks() {
    try {
        const res = await fetch(`${API_BASE}/webhooks`);
        const webhooks = await res.json();
        renderWebhooks(webhooks);
        populateWebhookSelect(webhooks);
    } catch (error) {
        console.error('Failed to load webhooks:', error);
    }
}

// ----- Handlers -----
async function handleLogin() {
    loginBtn.disabled = true;
    loginStatus.textContent = 'Opening browser...';
    try {
        const res = await fetch(`${API_BASE}/auth/login`, { method: 'POST' });
        const data = await res.json();
        loginStatus.textContent = data.message;
        // Re-enable after a delay
        setTimeout(() => {
            loginBtn.disabled = false;
            loginStatus.textContent = '';
        }, 5000);
    } catch (error) {
        loginStatus.textContent = 'Error: ' + error.message;
        loginBtn.disabled = false;
    }
}

async function handleAddWatch() {
    const url = watchUrlInput.value.trim();
    if (!url) {
        alert('Please enter a Facebook group URL');
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/watches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error);
        }
        watchUrlInput.value = '';
        await loadWatches();
    } catch (error) {
        alert('Failed to add watch: ' + error.message);
    }
}

async function handleAddWebhook() {
    const name = webhookNameInput.value.trim() || 'Unnamed';
    const url = webhookUrlInput.value.trim();
    if (!url) {
        alert('Please enter a Discord webhook URL');
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/webhooks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, url })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Failed to add webhook');
        }
        webhookNameInput.value = '';
        webhookUrlInput.value = '';
        await loadWebhooks();
    } catch (error) {
        alert('Failed to add webhook: ' + error.message);
    }
}

async function handleDeleteWatch(id) {
    if (!confirm('Remove this watch?')) return;
    try {
        await fetch(`${API_BASE}/watches/${id}`, { method: 'DELETE' });
        await loadWatches();
    } catch (error) {
        alert('Failed to delete watch');
    }
}

async function handleDeleteWebhook(id) {
    if (!confirm('Disable this webhook?')) return;
    try {
        await fetch(`${API_BASE}/webhooks/${id}`, { method: 'DELETE' });
        await loadWebhooks();
    } catch (error) {
        alert('Failed to delete webhook');
    }
}

function handleStart() {
    fetch(`${API_BASE}/scan/start`, { method: 'POST' })
        .then(() => {
            startBtn.disabled = true;
            stopBtn.disabled = false;
        })
        .catch(err => alert('Failed to start monitor'));
}

function handleStop() {
    fetch(`${API_BASE}/scan/stop`, { method: 'POST' })
        .then(() => {
            startBtn.disabled = false;
            stopBtn.disabled = true;
        })
        .catch(err => alert('Failed to stop monitor'));
}

// ----- Rendering -----
function renderWatches(watches) {
    if (!watches || watches.length === 0) {
        watchesList.innerHTML = '<p class="empty-message">No groups monitored yet.</p>';
        return;
    }
    const activeWatches = watches.filter(w => w.active);
    if (activeWatches.length === 0) {
        watchesList.innerHTML = '<p class="empty-message">No active watches.</p>';
        return;
    }
    watchesList.innerHTML = activeWatches.map(watch => `
        <div class="list-item">
            <div>
                <strong>${truncateUrl(watch.url)}</strong>
                <div style="font-size:12px; color:#666;">
                    Last scan: ${watch.last_scan || 'Never'} | Last Post: ${watch.last_post_id || 'None'}
                </div>
            </div>
            <div class="actions">
                <button class="icon-btn" onclick="handleDeleteWatch(${watch.id})" title="Remove">🗑️</button>
            </div>
        </div>
    `).join('');
}

function renderWebhooks(webhooks) {
    if (!webhooks || webhooks.length === 0) {
        webhooksList.innerHTML = '<p class="empty-message">No webhooks configured.</p>';
        return;
    }
    const enabledWebhooks = webhooks.filter(w => w.enabled);
    if (enabledWebhooks.length === 0) {
        webhooksList.innerHTML = '<p class="empty-message">No enabled webhooks.</p>';
        return;
    }
    webhooksList.innerHTML = enabledWebhooks.map(wh => `
        <div class="list-item">
            <div>
                <strong>${wh.name}</strong>
                <div style="font-size:12px; color:#666; word-break:break-all;">${wh.url}</div>
            </div>
            <div class="actions">
                <button class="icon-btn" onclick="handleDeleteWebhook(${wh.id})" title="Disable">🗑️</button>
            </div>
        </div>
    `).join('');
}

function populateWebhookSelect(webhooks = []) {
    // Clear existing options except first
    webhookSelect.innerHTML = '<option value="">-- Choose default --</option>';
    
    // Add default presets
    defaultWebhooks.forEach((wh, index) => {
        if (wh.url) {
            const option = document.createElement('option');
            option.value = wh.url;
            option.textContent = wh.name;
            webhookSelect.appendChild(option);
        }
    });
    
    // Add user webhooks
    webhooks.filter(w => w.enabled).forEach(wh => {
        const option = document.createElement('option');
        option.value = wh.url;
        option.textContent = wh.name;
        webhookSelect.appendChild(option);
    });
    
    webhookSelect.addEventListener('change', (e) => {
        if (e.target.value) {
            webhookUrlInput.value = e.target.value;
        }
    });
}

function truncateUrl(url, maxLength = 40) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
}

// Make delete functions global for inline onclick
window.handleDeleteWatch = handleDeleteWatch;
window.handleDeleteWebhook = handleDeleteWebhook;