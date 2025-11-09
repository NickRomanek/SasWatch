// SubTracker - Simple Usage Monitor
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
    const activityContainer = document.getElementById('recent-activity');
    if (activityContainer) {
        activityContainer.innerHTML = '<div class="loading">Loading...</div>';
    }

    try {
        const [statsRes, recentRes, devRes] = await Promise.all([
            fetch('/api/stats'),
            fetch('/api/usage/recent?limit=100'),
            fetch('/api/dev/graph/activity?limit=25')
        ]);

        const stats = statsRes.ok ? await statsRes.json() : {};
        const recent = recentRes.ok ? await recentRes.json() : { adobe: [], wrapper: [], entra: [] };

        let devEvents = [];
        if (devRes.ok) {
            const devPayload = await devRes.json();
            if (devPayload.success && Array.isArray(devPayload.data)) {
                devEvents = normalizeGraphActivity(devPayload.data);
            }
        }

        if (devEvents.length > 0) {
            const existingEntra = Array.isArray(recent.entra) ? recent.entra : [];
            const combined = new Map();

            existingEntra.forEach(event => {
                const key = event.id || `${event.createdDateTime || event.receivedAt}-${event.userPrincipalName || ''}-${event.appDisplayName || ''}`;
                combined.set(key, {
                    ...event,
                    source: event.source || event.sourceChannel || classifySignInSource(event.clientAppUsed)
                });
            });

            devEvents.forEach(event => {
                const key = event.id || `${event.createdDateTime || event.receivedAt}-${event.userPrincipalName || ''}-${event.appDisplayName || ''}`;
                if (!combined.has(key)) {
                    combined.set(key, event);
                }
            });

            recent.entra = Array.from(combined.values());
        }

        updateStats(stats || {}, recent);
        updateActivityLists(recent);
    } catch (error) {
        console.error('Error fetching data:', error);
        showError('Failed to load data');
    }
}

function updateStats(stats = {}, recent = {}) {
    const adobeStats = stats.adobe || { total: 0, today: 0, thisWeek: 0, uniqueClients: 0 };
    const wrapperStats = stats.wrapper || { total: 0, today: 0, thisWeek: 0, uniqueClients: 0 };
    const entraStats = stats.entra || { total: 0, today: 0, thisWeek: 0, uniqueClients: 0 };

    document.getElementById('adobe-total').textContent = adobeStats.total || 0;
    document.getElementById('adobe-today').textContent = `${adobeStats.today || 0} today`;

    document.getElementById('wrapper-total').textContent = wrapperStats.total || 0;
    document.getElementById('wrapper-today').textContent = `${wrapperStats.today || 0} today`;

    const weekTotal = (adobeStats.thisWeek || 0) + (wrapperStats.thisWeek || 0) + (entraStats.thisWeek || 0);
    const uniqueClients = (adobeStats.uniqueClients || 0) + (wrapperStats.uniqueClients || 0) + (entraStats.uniqueClients || 0);
    
    document.getElementById('week-total').textContent = weekTotal;
    document.getElementById('unique-clients').textContent = `${uniqueClients} unique clients`;
}

function updateActivityLists(data) {
    const adobeEvents = Array.isArray(data.adobe)
        ? data.adobe.map(item => ({ ...item, source: 'adobe' }))
        : [];
    const wrapperEvents = Array.isArray(data.wrapper)
        ? data.wrapper.map(item => ({ ...item, source: 'wrapper' }))
        : [];
    const entraEvents = Array.isArray(data.entra)
        ? data.entra.map(item => ({
            ...item,
            source: item.source || item.sourceChannel || classifySignInSource(item.clientAppUsed)
        }))
        : [];

    const combined = [
        ...adobeEvents,
        ...wrapperEvents,
        ...entraEvents
    ].sort((a, b) => {
        const timeA = new Date(a.receivedAt || a.when || a.createdDateTime || 0);
        const timeB = new Date(b.receivedAt || b.when || b.createdDateTime || 0);
        
        // Handle invalid dates
        const timeAValue = timeA.getTime();
        const timeBValue = timeB.getTime();
        
        if (isNaN(timeAValue)) return 1;  // Push invalid dates to end
        if (isNaN(timeBValue)) return -1; // Push invalid dates to end
        
        return timeBValue - timeAValue; // Descending order (newest first)
    });

    cachedActivityData = {
        all: combined,
        adobe: adobeEvents,
        wrapper: wrapperEvents,
        entra: entraEvents
    };

    applySourceFilter();
}

function filterBySource(source) {
    currentSourceFilter = source;
    applySourceFilter();
}

function normalizeGraphActivity(events = []) {
    return events
        .filter(event => event && event.createdDateTime)
        .map(event => {
            const created = event.createdDateTime;
            return {
                id: event.id || event.correlationId || `${created}-${event.userPrincipalName || event.userId || Math.random()}`,
                createdDateTime: created,
                receivedAt: created,
                when: created,
                appDisplayName: event.appDisplayName || event.resourceDisplayName || 'Unknown',
                resourceDisplayName: event.resourceDisplayName || null,
                clientAppUsed: event.clientAppUsed || null,
                ipAddress: event.ipAddress || null,
                deviceDisplayName: event.deviceDetail?.displayName || null,
                operatingSystem: event.deviceDetail?.operatingSystem || null,
                browser: event.deviceDetail?.browser || null,
                locationCity: event.location?.city || null,
                locationCountryOrRegion: event.location?.countryOrRegion || null,
                userPrincipalName: event.userPrincipalName || null,
                userDisplayName: event.userDisplayName || null,
                source: classifySignInSource(event.clientAppUsed)
            };
        });
}

function classifySignInSource(clientAppUsed = '') {
    const value = String(clientAppUsed || '').toLowerCase();
    if (!value) {
        return 'entra-other';
    }

    if (value.includes('browser') || value.includes('web') || value.includes('edge') || value.includes('chrome') || value.includes('firefox') || value.includes('safari')) {
        return 'entra-web';
    }

    if (value.includes('desktop') || value.includes('client') || value.includes('microsoft') || value.includes('office') || value.includes('windows')) {
        return 'entra-desktop';
    }

    return 'entra-other';
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
        case 'entra':
            filteredData = cachedActivityData.entra;
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
    if (!container) return;

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
    const { label: sourceLabel, className: sourceClass } = getSourceMeta(item);

    const appName = item.appDisplayName || item.event || item.url || 'Unknown';
    const detailSegments = [];
    if (item.why) {
        detailSegments.push(escapeHtml(item.why));
    } else if (item.clientAppUsed) {
        detailSegments.push(`Client: ${escapeHtml(item.clientAppUsed)}`);
    }
    if (item.ipAddress) {
        detailSegments.push(`IP: ${escapeHtml(item.ipAddress)}`);
    }
    const detectedBy = detailSegments.length > 0
        ? `<div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">${detailSegments.join('<br>')}</div>`
        : '';

    const computerNameRaw = item.computerName || item.deviceDisplayName;
    const computerName = computerNameRaw ? escapeHtml(computerNameRaw) : 'N/A';
    const computerExtras = [];
    if (item.operatingSystem) {
        computerExtras.push(escapeHtml(item.operatingSystem));
    }
    if (item.locationCity || item.locationCountryOrRegion) {
        const locationParts = [item.locationCity, item.locationCountryOrRegion].filter(Boolean).map(escapeHtml);
        computerExtras.push(locationParts.join(', '));
    }
    const computerDetail = computerExtras.length > 0
        ? `<div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">${computerExtras.join(' • ')}</div>`
        : '';

    const primaryUser = item.windowsUser || item.userPrincipalName || 'N/A';
    const secondaryUser = item.userDisplayName && item.userDisplayName !== primaryUser
        ? `<div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">${escapeHtml(item.userDisplayName)}</div>`
        : '';

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
                <div class="computer-info">${computerName}</div>
                ${computerDetail}
            </td>
            <td>
                <span class="username-badge">${escapeHtml(primaryUser)}</span>
                ${secondaryUser}
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
    if (text === null || text === undefined) {
        return '';
    }
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getSourceMeta(item = {}) {
    const source = (item.source || '').toLowerCase();

    if (source === 'adobe') {
        return { label: '🌐 Web', className: 'source-adobe' };
    }

    if (source === 'wrapper') {
        return { label: '💻 Desktop', className: 'source-wrapper' };
    }

    if (source === 'entra-web') {
        return { label: '☁️ Sign-in (Web)', className: 'source-entra-web' };
    }

    if (source === 'entra-desktop') {
        return { label: '☁️ Sign-in (Desktop)', className: 'source-entra-desktop' };
    }

    if (source.startsWith('entra')) {
        return { label: '☁️ Sign-in', className: 'source-entra-other' };
    }

    return { label: '🔍 Unknown', className: 'source-unknown' };
}

async function clearData(event) {
    const confirmed = await ConfirmModal.show({
        title: 'Clear All Activity Data?',
        message: 'This will permanently delete all tracked usage events. This action cannot be undone.',
        confirmText: 'Clear All Data',
        cancelText: 'Cancel',
        type: 'danger'
    });

    if (!confirmed) return;

    const button = event?.target || document.querySelector('.btn-danger');
    const originalText = button.innerHTML;
    addButtonSpinner(button, originalText);

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
window.clearData = clearData;
window.toggleTheme = toggleTheme;
