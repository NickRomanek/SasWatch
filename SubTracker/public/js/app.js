// SubTracker - Simple Usage Monitor
let autoRefreshInterval = null;
let isAutoRefresh = false;
let currentSourceFilter = 'all';
let cachedActivityData = null;

// Theme management
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
}

// Load data on page load
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    refreshData();
});

async function refreshData() {
    try {
        // Fetch stats and recent activity
        const [statsRes, recentRes] = await Promise.all([
            fetch('/api/stats'),
            fetch('/api/usage/recent?limit=100')
        ]);

        const stats = await statsRes.json();
        const recent = await recentRes.json();

        // Update stats cards
        updateStats(stats, recent);

        // Update activity lists
        updateActivityLists(recent);

        console.log('Data refreshed:', { stats, recent });
    } catch (error) {
        console.error('Error fetching data:', error);
        showError('Failed to load data');
    }
}

function updateStats(stats, recent) {
    // Adobe stats
    document.getElementById('adobe-total').textContent = stats.adobe.total;
    document.getElementById('adobe-today').textContent = `${stats.adobe.today} today`;

    // Wrapper stats
    document.getElementById('wrapper-total').textContent = stats.wrapper.total;
    document.getElementById('wrapper-today').textContent = `${stats.wrapper.today} today`;

    // Combined stats
    const weekTotal = stats.adobe.thisWeek + stats.wrapper.thisWeek;
    const uniqueClients = stats.adobe.uniqueClients + stats.wrapper.uniqueClients;
    
    document.getElementById('week-total').textContent = weekTotal;
    document.getElementById('unique-clients').textContent = `${uniqueClients} unique clients`;
}

function updateActivityLists(data) {
    // Combine and sort all recent activity
    const combined = [
        ...data.adobe.map(item => ({ ...item, source: 'adobe' })),
        ...data.wrapper.map(item => ({ ...item, source: 'wrapper' }))
    ].sort((a, b) => {
        const timeA = new Date(a.receivedAt || a.when);
        const timeB = new Date(b.receivedAt || b.when);
        return timeB - timeA;
    });

    // Cache the data
    cachedActivityData = {
        all: combined,
        adobe: data.adobe.map(item => ({ ...item, source: 'adobe' })),
        wrapper: data.wrapper.map(item => ({ ...item, source: 'wrapper' }))
    };

    // Apply current filter
    applySourceFilter();
}

function filterBySource(source) {
    currentSourceFilter = source;
    applySourceFilter();
}

function applySourceFilter() {
    if (!cachedActivityData) return;

    let filteredData;
    switch (currentSourceFilter) {
        case 'adobe':
            filteredData = cachedActivityData.adobe;
            break;
        case 'wrapper':
            filteredData = cachedActivityData.wrapper;
            break;
        case 'all':
        default:
            filteredData = cachedActivityData.all;
            break;
    }

    // Update the activity list
    updateActivityList('recent-activity', filteredData.slice(0, 50));
}

function updateActivityList(elementId, items) {
    const container = document.getElementById(elementId);

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <h3>No Activity Yet</h3>
                <p>No activity has been recorded yet. Start using Adobe applications to see data here.</p>
            </div>
        `;
        return;
    }

    // Create table structure
    container.innerHTML = `
        <div class="activity-table">
            <table>
                <thead>
                    <tr>
                        <th>TIMESTAMP</th>
                        <th>APPLICATION</th>
                        <th>SOURCE</th>
                        <th>COMPUTER</th>
                        <th>WINDOWS USER</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => createActivityRow(item)).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function createActivityRow(item) {
    const time = new Date(item.receivedAt || item.when);
    const timeStr = formatTimeDetailed(time);
    const timeOnly = time.toLocaleTimeString();
    const sourceLabel = item.source === 'adobe' ? '🌐 Web' : '💻 Desktop';
    const sourceClass = item.source === 'adobe' ? 'source-adobe' : 'source-wrapper';

    // Get application name
    const appName = item.url || item.event || 'Unknown';
    const detectedBy = item.why ? `<div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">${escapeHtml(item.why)}</div>` : '';

    // Computer info
    const computerName = item.computerName || 'N/A';
    const domain = item.userDomain ? `<div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">${escapeHtml(item.userDomain)}</div>` : '';

    // Windows user
    const windowsUser = item.windowsUser || 'N/A';

    return `
        <tr>
            <td>
                <div>${timeStr}</div>
                <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">${timeOnly}</div>
            </td>
            <td>
                <div class="app-name">${escapeHtml(appName)}</div>
                ${detectedBy}
            </td>
            <td>
                <span class="source-badge ${sourceClass}">${sourceLabel}</span>
            </td>
            <td>
                <div class="computer-info">${escapeHtml(computerName)}</div>
                ${domain}
            </td>
            <td>
                <span class="username-badge">${escapeHtml(windowsUser)}</span>
            </td>
        </tr>
    `;
}

function formatTimeDetailed(date) {
    return date.toLocaleString();
}

function formatTime(date) {
    const now = new Date();
    const diff = now - date;
    
    // Less than 1 minute
    if (diff < 60000) {
        return 'Just now';
    }
    
    // Less than 1 hour
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    }
    
    // Less than 24 hours
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    }
    
    // Format as date/time
    return date.toLocaleString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function toggleAutoRefresh() {
    isAutoRefresh = !isAutoRefresh;
    const btn = document.getElementById('auto-refresh-text');
    
    if (isAutoRefresh) {
        btn.textContent = 'Disable Auto-Refresh';
        autoRefreshInterval = setInterval(refreshData, 5000); // Refresh every 5 seconds
        console.log('Auto-refresh enabled (5s interval)');
    } else {
        btn.textContent = 'Enable Auto-Refresh';
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
        console.log('Auto-refresh disabled');
    }
}

async function clearData() {
    const confirmed = await ConfirmModal.show({
        title: 'Clear All Activity Data?',
        message: 'This will permanently delete all tracked usage events. This action cannot be undone.',
        confirmText: 'Clear All Data',
        cancelText: 'Cancel',
        type: 'danger'
    });

    if (!confirmed) return;

    const button = event.target;
    addButtonSpinner(button, button.innerHTML);

    try {
        const response = await fetch('/api/usage', {
            method: 'DELETE'
        });

        if (response.ok) {
            Toast.success('All activity data cleared successfully');
            refreshData();
        } else {
            throw new Error('Failed to clear data');
        }
    } catch (error) {
        console.error('Error clearing data:', error);
        Toast.error('Failed to clear data: ' + error.message);
    } finally {
        removeButtonSpinner(button);
    }
}

function showError(message) {
    console.error(message);
    Toast.error(message);
}

// Expose functions globally for inline onclick handlers
window.refreshData = refreshData;
window.filterBySource = filterBySource;
window.toggleAutoRefresh = toggleAutoRefresh;
window.clearData = clearData;
window.toggleTheme = toggleTheme;
