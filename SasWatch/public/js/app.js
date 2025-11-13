// SubTracker - Simple Usage Monitor
let currentSourceFilter = 'all';
let cachedActivityData = null;

const REFRESH_TIMEOUT_MS = 60000;
let syncStatusPoller = null;

const notifier = {
    info(message, duration) {
        if (window.Toast?.info) {
            return window.Toast.info(message, duration);
        }
        console.info('[info]', message);
        return null;
    },
    success(message, duration) {
        if (window.Toast?.success) {
            return window.Toast.success(message, duration);
        }
        console.info('[success]', message);
        return null;
    },
    warning(message, duration) {
        if (window.Toast?.warning) {
            return window.Toast.warning(message, duration);
        }
        console.warn('[warning]', message);
        return null;
    },
    error(message, duration) {
        if (window.Toast?.error) {
            return window.Toast.error(message, duration);
        }
        console.error('[error]', message);
        return null;
    }
};

function getSyncLogElement() {
    return document.getElementById('sync-log-output');
}

function appendSyncLog(message, { allowDuplicate = false } = {}) {
    if (!message) return;
    if (!allowDuplicate && appendSyncLog.lastMessage === message) {
        return;
    }
    appendSyncLog.lastMessage = message;

    const logEl = getSyncLogElement();
    if (!logEl) return;

    const timestamp = new Date().toLocaleTimeString();
    const line = `[${timestamp}] ${message}`;
    logEl.textContent = logEl.textContent
        ? `${logEl.textContent}\n${line}`
        : line;
    logEl.scrollTop = logEl.scrollHeight;
}
appendSyncLog.lastMessage = null;

function resetSyncLog(initialMessage) {
    appendSyncLog.lastMessage = null;
    const logEl = getSyncLogElement();
    if (logEl) {
        logEl.textContent = '';
    }
    if (initialMessage) {
        appendSyncLog(initialMessage, { allowDuplicate: true });
    }
}

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
    refreshData({ silent: true, awaitSync: false });
});

async function fetchJson(url, { timeout = REFRESH_TIMEOUT_MS, ...options } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || payload.success === false) {
            const message = payload.error || `Request failed with status ${response.status}`;
            throw new Error(message);
        }

        return payload;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`Request timed out after ${Math.round(timeout / 1000)} seconds`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function normalizeUsagePayload(payload = {}) {
    return {
        adobe: Array.isArray(payload.adobe) ? payload.adobe : [],
        wrapper: Array.isArray(payload.wrapper) ? payload.wrapper : [],
        entra: Array.isArray(payload.entra) ? payload.entra : [],
        meta: payload.meta || null
    };
}

function calculateEventTotals(data = {}) {
    const adobeCount = Array.isArray(data.adobe) ? data.adobe.length : 0;
    const wrapperCount = Array.isArray(data.wrapper) ? data.wrapper.length : 0;
    const entraCount = Array.isArray(data.entra) ? data.entra.length : 0;
    return {
        adobe: adobeCount,
        wrapper: wrapperCount,
        entra: entraCount,
        all: adobeCount + wrapperCount + entraCount
    };
}

function collectSyncWarnings(...syncResults) {
    const messages = [];
    syncResults
        .filter(Boolean)
        .forEach(result => {
            if (result.reason === 'timeout') {
                messages.push(`Microsoft Graph timed out after ${Math.round(REFRESH_TIMEOUT_MS / 1000)} seconds. Showing cached data.`);
            } else if (result.reason === 'graph-throttled') {
                messages.push('Microsoft Graph throttled requests (HTTP 429). Using cached/partial data.');
            } else if (result.error) {
                messages.push(result.message || 'Activity refreshed with warnings from Microsoft Graph.');
            } else if (result.reason === 'not-configured') {
                messages.push('Microsoft Entra integration is not configured yet. Showing local activity data only.');
            } else if (result.reason === 'throttled') {
                messages.push('Microsoft Graph throttled the sync. Using cached data.');
            }
        });

    return [...new Set(messages)];
}

function startSyncStatusPolling() {
    if (syncStatusPoller) {
        clearInterval(syncStatusPoller);
    }

    console.log('[SYNC-DEBUG] Starting status polling');
    let pollCount = 0;

    syncStatusPoller = setInterval(async () => {
        try {
            pollCount++;
            console.log(`[SYNC-DEBUG] Poll #${pollCount} - requesting status`);
            const status = await fetchJson('/api/sync/status');

            console.log(`[SYNC-DEBUG] Poll #${pollCount} - received status:`, {
                active: status.active,
                message: status.message,
                progress: status.progress
            });

            if (status.active) {
                updateSyncProgress(status);
            } else if (status.message && status.lastUpdate) {
                // Clear the poller after receiving final status
                console.log(`[SYNC-DEBUG] Poll #${pollCount} - sync completed, stopping polling`);
                clearInterval(syncStatusPoller);
                syncStatusPoller = null;

                appendSyncLog(status.message, { allowDuplicate: true });
                if (status.result && status.result.count > 0) {
                    notifier.success(status.message);
                } else if (status.error) {
                    const errorToast = notifier.error(status.message);
                    appendSyncLog(status.error.message || status.message, { allowDuplicate: true });
                    // Show help text if available
                    if (status.error.helpText) {
                        setTimeout(() => {
                            notifier.info(status.error.helpText, 8000);
                        }, 3000);
                        appendSyncLog(status.error.helpText, { allowDuplicate: true });
                    }
                } else {
                    notifier.info(status.message);
                }
            } else {
                console.log(`[SYNC-DEBUG] Poll #${pollCount} - no status change`);
            }
        } catch (error) {
            console.warn(`[SYNC-DEBUG] Poll #${pollCount} - polling error:`, error);
            // Silently handle polling errors
        }

        // Safety timeout - stop polling after 5 minutes
        if (pollCount > 150) { // 150 * 2 seconds = 5 minutes
            console.log('[SYNC-DEBUG] Safety timeout reached, stopping polling');
            clearInterval(syncStatusPoller);
            syncStatusPoller = null;
            notifier.warning('Sync monitoring timed out - refresh the page to check status');
            appendSyncLog('Sync monitoring timed out - refresh the page to check status', { allowDuplicate: true });
        }
    }, 2000); // Poll every 2 seconds
}

function stopSyncStatusPolling() {
    if (syncStatusPoller) {
        clearInterval(syncStatusPoller);
        syncStatusPoller = null;
    }
}

async function cancelSync() {
    try {
        console.log('[SYNC-DEBUG] Attempting to cancel sync');
        const response = await fetch('/api/sync/cancel', { method: 'POST' });
        const result = await response.json();

        if (result.success) {
            notifier.info('Sync cancelled');
            stopSyncStatusPolling();
            // Clear any active sync toast
            const activeToast = document.querySelector('.sync-progress-toast');
            if (activeToast) activeToast.remove();
        } else {
            notifier.warning(result.message);
        }
    } catch (error) {
        console.error('Cancel sync error:', error);
        notifier.error('Failed to cancel sync');
    }
}

function updateSyncProgress(status) {
    const existingToast = document.querySelector('.sync-progress-toast');
    const text = `${status.message} (${status.progress}%)`;
    appendSyncLog(text);
    if (existingToast) {
        // Update in place to avoid popping effect
        existingToast.textContent = text;
        return;
    }
    const toast = notifier.info(text, 0);
    if (toast && toast.classList) {
        toast.classList.add('sync-progress-toast');
    }
}

async function refreshData(options = {}) {
    const { silent = false, allowBackfill = true, awaitSync = false, force = false, preservePolling = false } = options;
    console.log('[SYNC-DEBUG] refreshData called with options:', options);
    
    const activityContainer = document.getElementById('recent-activity');
    if (activityContainer) {
        activityContainer.innerHTML = '<div class="loading">Loading...</div>';
    }

    const startTime = performance.now();
    if (!silent && awaitSync) {
        console.log('[SYNC-DEBUG] Starting sync with await');
        notifier.info('Microsoft Graph sync may take up to 3 minutes. Please wait…', 10000);
        startSyncStatusPolling();
    }
    const loaderToast = silent || !awaitSync ? null : notifier.info('Refreshing activity… this may take up to 3 minutes.', 0);

    try {
        const params = new URLSearchParams({ limit: '100' });
        if (awaitSync) params.set('awaitSync', 'true');
        if (force) params.set('force', 'true');

        const usageUrl = `/api/usage/recent?${params.toString()}`;
        console.log('[SYNC-DEBUG] Fetching from:', usageUrl);
        
        const [statsPayload, usagePayload] = await Promise.all([
            fetchJson('/api/stats'),
            fetchJson(usageUrl)
        ]);
        
        console.log('[SYNC-DEBUG] Received payloads:', {
            stats: statsPayload,
            usage: usagePayload
        });

        let usageData = normalizeUsagePayload(usagePayload);
        let statsMeta = statsPayload?.meta || null;
        updateStats(statsPayload || {}, usageData);
        updateActivityLists(usageData);

        let totals = calculateEventTotals(usageData);
        let finalMeta = usageData.meta || {};
        let usedBackfill = false;

        const initialSyncProblem = finalMeta?.sync?.reason === 'timeout' || finalMeta?.sync?.error === true || finalMeta?.sync?.reason === 'graph-throttled';
        const looksIncomplete = totals.all === 0 || totals.entra === 0; // handle cases where only 1 local event exists

        if ((looksIncomplete || initialSyncProblem) && allowBackfill) {
            const backfillToast = silent ? null : notifier.info('No recent events found — fetching last 24 hours…', 0);
            try {
                const backfillParams = new URLSearchParams({
                    limit: '100',
                    forceBackfill: 'true',
                    backfillHours: '24',
                    awaitSync: 'true'
                });
                if (force) backfillParams.set('force', 'true');

                usageData = normalizeUsagePayload(
                    await fetchJson(`/api/usage/recent?${backfillParams.toString()}`)
                );
                totals = calculateEventTotals(usageData);
                finalMeta = usageData.meta || {};
                updateActivityLists(usageData);
                const forcedStats = await fetchJson('/api/stats');
                updateStats(forcedStats || {}, usageData);
                statsMeta = forcedStats?.meta || statsMeta;
                usedBackfill = true;

                if (!silent && totals.all === 0) {
                    notifier.warning('No activity detected in the last 24 hours.');
                }
            } finally {
                if (backfillToast?.remove) {
                    backfillToast.remove();
                } else if (backfillToast && backfillToast.parentElement) {
                    backfillToast.parentElement.removeChild(backfillToast);
                }
            }
        }

        const durationSeconds = ((performance.now() - startTime) / 1000).toFixed(1);
        const warnings = collectSyncWarnings(finalMeta.sync, statsMeta?.sync);

        if (!silent) {
            warnings.forEach(message => notifier.warning(message));

            if (totals.all > 0) {
                const message = usedBackfill
                    ? `Activity backfilled (${totals.all} events) in ${durationSeconds}s.`
                    : `Activity updated (${totals.all} events) in ${durationSeconds}s.`;
                notifier.success(message);
            } else {
                const message = finalMeta.sync?.triggered
                    ? 'Sync completed - no new activity found in the last 24 hours.'
                    : 'No activity found for the requested timeframe.';
                notifier.info(message);
            }

            // Show help text for sync errors if available
            if (finalMeta.sync?.error && finalMeta.sync?.helpText) {
                setTimeout(() => {
                    notifier.info(finalMeta.sync.helpText, 8000);
                }, 3000);
            }
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        if (!silent) {
            notifier.error(error.message || 'Failed to load data');
            // Show help text if available
            if (error.helpText) {
                setTimeout(() => {
                    notifier.info(error.helpText, 8000);
                }, 3000);
            }
        }
    } finally {
        if (loaderToast?.remove) {
            loaderToast.remove();
        } else if (loaderToast && loaderToast.parentElement) {
            loaderToast.parentElement.removeChild(loaderToast);
        }
        if (!preservePolling) {
            stopSyncStatusPolling();
        }
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
    const confirmed = await (window.ConfirmModal?.show
        ? window.ConfirmModal.show({
            title: 'Clear All Activity Data?',
            message: 'This will permanently delete all tracked usage events. This action cannot be undone.',
            confirmText: 'Clear All Data',
            cancelText: 'Cancel',
            type: 'danger'
        })
        : Promise.resolve(window.confirm('Clear all activity data?')));

    if (!confirmed) return;

    const button = event?.target || document.querySelector('.btn-danger');
    const originalText = button.innerHTML;
    addButtonSpinner(button, originalText);

    try {
        const response = await fetch('/api/usage?resetCursor=true&cursorHours=24', {
            method: 'DELETE'
        });

        if (response.ok) {
            notifier.success('All activity data cleared successfully');
            // Stop any existing polling first
            stopSyncStatusPolling();
            // Clear cached data and update UI to show empty state (no sync)
            cachedActivityData = { adobe: [], wrapper: [], entra: [] };
            updateActivityList('recent-activity', []);
            appendSyncLog('Data cleared. UI reset to empty state.');
        } else {
            throw new Error('Failed to clear data');
        }
    } catch (error) {
        console.error('Error clearing data:', error);
        notifier.error('Failed to clear data: ' + error.message);
    } finally {
        removeButtonSpinner(button);
    }
}

function showError(message) {
    console.error(message);
    notifier.error(message);
}

// Helper to await background sync completion with polling (separate from UI poller)
async function waitForSyncCompletion(maxMs = 5 * 60 * 1000) {
    appendSyncLog('Waiting for background sync to finish…');
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        try {
            const status = await fetchJson('/api/sync/status');
            if (!status.active && status.lastUpdate) {
                const finalMessage = status.message || 'Background sync finished.';
                appendSyncLog(finalMessage, { allowDuplicate: true });
                if (status.error?.message) {
                    appendSyncLog(`Error: ${status.error.message}`, { allowDuplicate: true });
                }
                return status;
            }
        } catch (e) {
            // ignore transient errors
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    appendSyncLog('Sync wait timeout', { allowDuplicate: true });
    return { active: false, message: 'Sync wait timeout' };
}

// Expose functions globally for inline onclick handlers
async function startManualSync() {
    console.log('[SYNC-DEBUG] startManualSync called');
    
    const button = document.querySelector('.dashboard-controls .btn.btn-primary') || document.querySelector('.btn.btn-primary');
    const original = button ? button.innerHTML : null;
    console.log('[SYNC-DEBUG] Button found:', !!button);

    resetSyncLog('Manual sync requested');
    appendSyncLog('> GET /api/dev/graph/activity?limit=10&hours=24&force=false', { allowDuplicate: true });

    if (button) {
        addButtonSpinner(button, original || '🔄 Sync');
    }

    try {
        // EXACTLY what the dev tab does - fetch directly from Graph and display
        console.log('[SYNC-DEBUG] Fetching directly from Graph API');
        const syncResp = await fetch('/api/dev/graph/activity?limit=10&hours=24&force=false');
        
        if (!syncResp.ok) {
            let errorMsg = `HTTP ${syncResp.status}`;
            try {
                const errorData = await syncResp.json();
                if (errorData.error) {
                    errorMsg = errorData.error;
                    appendSyncLog(`Fetch failed: ${errorMsg}`, { allowDuplicate: true });
                    if (errorData.details) {
                        appendSyncLog(`Details: ${JSON.stringify(errorData.details)}`, { allowDuplicate: true });
                    }
                }
            } catch {
                const text = await syncResp.text().catch(() => '');
                errorMsg = text || 'Failed to fetch activity';
                appendSyncLog(`Fetch failed: ${errorMsg}`, { allowDuplicate: true });
            }
            throw new Error(errorMsg);
        }
        
        const result = await syncResp.json();
        appendSyncLog(`HTTP ${syncResp.status} OK`, { allowDuplicate: true });
        appendSyncLog(`Command: ${result.command || 'N/A'}`, { allowDuplicate: true });
        appendSyncLog(`Fetched ${result.data?.length || 0} sign-in events in ${result.durationMs || 0}ms`, { allowDuplicate: true });
        
        // Display the Graph data directly in the activity table
        if (result.data && result.data.length > 0) {
            displayGraphActivityData(result.data);
            
            // Now save to database in the background
            appendSyncLog('Saving events to database...', { allowDuplicate: true });
            try {
                const saveResp = await fetch('/api/account/entra/sync?mode=activity&maxPages=1&backfillHours=168&top=100', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targets: ['signins'] })
                });
                
                if (saveResp.ok) {
                    const saveResult = await saveResp.json();
                    if (saveResult.signIns?.count !== undefined) {
                        appendSyncLog(`Saved ${saveResult.signIns.count} events to database`, { allowDuplicate: true });
                        if (saveResult.signIns.count === 0 && saveResult.signIns.reason) {
                            appendSyncLog(`Reason: ${saveResult.signIns.reason}`, { allowDuplicate: true });
                        }
                    } else if (saveResult.signIns?.synced === false) {
                        appendSyncLog(`Database sync skipped: ${saveResult.signIns.reason || 'unknown'}`, { allowDuplicate: true });
                    } else {
                        appendSyncLog('Database sync completed', { allowDuplicate: true });
                    }
                } else {
                    const errorText = await saveResp.text().catch(() => '');
                    appendSyncLog(`Warning: Failed to save to database - ${errorText}`, { allowDuplicate: true });
                }
            } catch (saveError) {
                console.warn('Database save failed:', saveError);
                appendSyncLog(`Warning: Database save error - ${saveError.message}`, { allowDuplicate: true });
            }
            
            notifier.success(`Fetched ${result.data.length} events from Microsoft Graph`);
        } else {
            appendSyncLog('No sign-in events found in the specified time range.', { allowDuplicate: true });
            notifier.info('No sign-in events found');
            // Clear the table
            const container = document.getElementById('recent-activity');
            if (container) {
                container.innerHTML = '<div class="empty-state">No sign-in activity found in the last 24 hours.</div>';
            }
        }
    } catch (error) {
        console.error('[SYNC-DEBUG] Manual sync error:', error);
        notifier.error(error?.message || 'Failed to fetch activity');
        appendSyncLog(error?.message || 'Failed to fetch activity', { allowDuplicate: true });
    } finally {
        if (button) {
            removeButtonSpinner(button);
        }
        console.log('[SYNC-DEBUG] startManualSync completed');
        appendSyncLog('Sync completed.', { allowDuplicate: true });
    }
}

// New function to display Graph API data directly in the activity table
function displayGraphActivityData(events) {
    const container = document.getElementById('recent-activity');
    if (!container) return;

    if (!events || events.length === 0) {
        container.innerHTML = '<div class="empty-state">No activity data available.</div>';
        return;
    }

    // Convert Graph API format to activity table format
    const activities = events.map(event => ({
        receivedAt: event.createdDateTime,
        when: event.createdDateTime,
        appDisplayName: event.appDisplayName || 'Unknown Application',  // Maps to APPLICATION column
        clientAppUsed: event.clientAppUsed,
        deviceDisplayName: event.deviceDetail?.displayName,
        computerName: event.deviceDetail?.displayName,
        userPrincipalName: event.userPrincipalName || 'Unknown',
        windowsUser: event.userPrincipalName,
        userDisplayName: event.userDisplayName,
        source: 'entra',
        ipAddress: event.ipAddress,
        locationCity: event.location?.city,
        locationCountryOrRegion: event.location?.countryOrRegion,
        operatingSystem: event.deviceDetail?.operatingSystem,
        browser: event.deviceDetail?.browser,
        status: event.status?.errorCode === 0 ? 'Success' : 'Failed'
    }));

    // Use the existing updateActivityList function
    updateActivityList('recent-activity', activities);
    appendSyncLog('Activity table updated with Graph data.');
}

function toggleSyncLog() {
    const content = document.getElementById('sync-log-content');
    const toggle = document.getElementById('sync-log-toggle');
    
    if (content && toggle) {
        content.classList.toggle('expanded');
        toggle.classList.toggle('expanded');
    }
}

window.refreshData = refreshData;
window.filterBySource = filterBySource;
window.clearData = clearData;
window.toggleTheme = toggleTheme;
window.startManualSync = startManualSync;
window.cancelSync = cancelSync;
window.toggleSyncLog = toggleSyncLog;
