// SubTracker - Simple Usage Monitor
let autoRefreshInterval = null;
let isAutoRefresh = false;

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

    // Update recent activity tab (combined)
    updateActivityList('recent-activity', combined.slice(0, 50));

    // Update Adobe tab
    updateActivityList('adobe-activity', data.adobe.map(item => ({ ...item, source: 'adobe' })));

    // Update Wrapper tab
    updateActivityList('wrapper-activity', data.wrapper.map(item => ({ ...item, source: 'wrapper' })));
}

function updateActivityList(elementId, items) {
    const container = document.getElementById(elementId);
    
    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-text">No activity recorded yet</div>
            </div>
        `;
            return;
        }
        
    container.innerHTML = items.map(item => createActivityItem(item)).join('');
}

function createActivityItem(item) {
    const time = new Date(item.receivedAt || item.when);
    const timeStr = formatTime(time);
    const sourceClass = item.source === 'adobe' ? 'adobe-item' : 'wrapper-item';
    const sourceLabel = item.source === 'adobe' ? '🌐 Adobe' : '🔧 Wrapper';
    
    // Format the item details based on what data we have
    let details = '';
    if (item.event) {
        details += `<div class="activity-details">Event: ${item.event}</div>`;
    }
    if (item.url) {
        details += `<div class="activity-url">${escapeHtml(item.url)}</div>`;
    }
    if (item.clientId) {
        details += `<div class="activity-details">Client: ${item.clientId.substring(0, 8)}...</div>`;
    }
    if (item.why) {
        details += `<div class="activity-details">Detected by: ${item.why}</div>`;
    }
    
    // Add any additional fields
    const additionalFields = Object.keys(item).filter(key => 
        !['receivedAt', 'when', 'event', 'url', 'clientId', 'why', 'source', 'tabId'].includes(key)
    );
    
    if (additionalFields.length > 0) {
        const extraData = additionalFields.map(key => 
            `${key}: ${JSON.stringify(item[key])}`
        ).join(', ');
        details += `<div class="activity-details">${escapeHtml(extraData)}</div>`;
    }
        
        return `
        <div class="activity-item ${sourceClass}">
            <div class="activity-header">
                <div class="activity-type">${sourceLabel}</div>
                <div class="activity-time">${timeStr}</div>
                        </div>
            ${details}
                    </div>
    `;
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

function switchTab(tabName) {
    // Remove active class from all tabs and content
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Add active class to selected tab
    event.target.classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
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
    if (!confirm('Are you sure you want to clear all tracked data? This cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch('/api/usage', {
            method: 'DELETE'
        });
        
        if (response.ok) {
            alert('Data cleared successfully');
            refreshData();
        } else {
            throw new Error('Failed to clear data');
        }
    } catch (error) {
        console.error('Error clearing data:', error);
        alert('Failed to clear data');
    }
}

function showError(message) {
    // Simple error display - could be enhanced with a toast notification
    console.error(message);
        alert(message);
}

// Expose functions globally for inline onclick handlers
window.refreshData = refreshData;
window.switchTab = switchTab;
window.toggleAutoRefresh = toggleAutoRefresh;
window.clearData = clearData;
window.toggleTheme = toggleTheme;
