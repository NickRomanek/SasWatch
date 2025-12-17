// SubTracker - Simple Usage Monitor
let currentSourceFilter = 'all';
let cachedActivityData = null;

const REFRESH_TIMEOUT_MS = 60000;
let syncStatusPoller = null;
let useSocketForSync = false; // Will be set to true when socket connects

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
    setupSocketEventHandlers();
});

// Setup Socket.IO event handlers for real-time updates
function setupSocketEventHandlers() {
    // Socket connected - use real-time updates
    window.addEventListener('socket:connected', () => {
        console.log('[App] Socket connected - enabling real-time updates');
        useSocketForSync = true;
        appendSyncLog('Real-time connection established');
    });

    // Socket disconnected - fall back to polling if needed
    window.addEventListener('socket:disconnected', (event) => {
        console.log('[App] Socket disconnected:', event.detail?.reason);
        useSocketForSync = false;
        appendSyncLog('Real-time connection lost - using manual refresh');
    });

    // Socket fallback - max reconnect attempts reached
    window.addEventListener('socket:fallback', () => {
        console.log('[App] Socket fallback - switching to polling mode');
        useSocketForSync = false;
        notifier.warning('Real-time connection unavailable. Using manual refresh.');
    });

    // Real-time activity event - prepend to activity list
    window.addEventListener('activity:new', (event) => {
        const data = event.detail;
        console.log('[App] Real-time activity received:', data);
        
        // Add to cached data and update UI
        if (cachedActivityData) {
            const source = (data.source || '').toLowerCase();
            
            // Add to appropriate source array
            if (source === 'adobe' || source === 'browser') {
                cachedActivityData.adobe = cachedActivityData.adobe || [];
                cachedActivityData.adobe.unshift(data);
            } else if (source === 'wrapper' || source === 'desktop') {
                cachedActivityData.wrapper = cachedActivityData.wrapper || [];
                cachedActivityData.wrapper.unshift(data);
            } else if (source.startsWith('entra')) {
                cachedActivityData.entra = cachedActivityData.entra || [];
                cachedActivityData.entra.unshift(data);
            }
            
            // Add to combined list
            cachedActivityData.all = cachedActivityData.all || [];
            cachedActivityData.all.unshift(data);
            
            // Trim to prevent memory growth
            const maxItems = 200;
            if (cachedActivityData.all.length > maxItems) {
                cachedActivityData.all = cachedActivityData.all.slice(0, maxItems);
                cachedActivityData.adobe = cachedActivityData.adobe?.slice(0, maxItems) || [];
                cachedActivityData.wrapper = cachedActivityData.wrapper?.slice(0, maxItems) || [];
                cachedActivityData.entra = cachedActivityData.entra?.slice(0, maxItems) || [];
            }
            
            // Re-apply filter to update display
            applySourceFilter();
            
            // Update stats counters
            incrementStatCounter(source);
        }
    });

    // Real-time sync progress (replaces polling when socket connected)
    window.addEventListener('sync:progress', (event) => {
        const data = event.detail;
        updateSyncProgress(data);
    });

    // Real-time sync complete
    window.addEventListener('sync:complete', (event) => {
        const data = event.detail;
        appendSyncLog(data.message || 'Sync complete', { allowDuplicate: true });
        
        // Remove button spinner if sync was triggered manually
        const syncButton = document.getElementById('sync-graph-btn');
        if (syncButton) {
            removeButtonSpinner(syncButton);
        }
        
        if (data.success !== false) {
            if (data.count > 0) {
                notifier.success(`Synced ${data.count} events`);
            } else {
                notifier.info(data.message || 'Sync complete - no new events');
            }
            
            // Refresh UI with new data
            refreshData({ silent: true, awaitSync: false });
        } else {
            notifier.error(data.message || 'Sync failed');
        }
        
        // Stop polling since socket delivered completion
        stopSyncStatusPolling();
    });
}

// Increment stat counter when new activity arrives
function incrementStatCounter(source) {
    const sourceType = (source || '').toLowerCase();
    
    if (sourceType === 'adobe' || sourceType === 'browser') {
        const adobeTotal = document.getElementById('adobe-total');
        const adobeToday = document.getElementById('adobe-today');
        if (adobeTotal) {
            adobeTotal.textContent = parseInt(adobeTotal.textContent || '0') + 1;
        }
        if (adobeToday) {
            const current = parseInt(adobeToday.textContent.split(' ')[0] || '0');
            adobeToday.textContent = `${current + 1} today`;
        }
    } else if (sourceType === 'wrapper' || sourceType === 'desktop') {
        const wrapperTotal = document.getElementById('wrapper-total');
        const wrapperToday = document.getElementById('wrapper-today');
        if (wrapperTotal) {
            wrapperTotal.textContent = parseInt(wrapperTotal.textContent || '0') + 1;
        }
        if (wrapperToday) {
            const current = parseInt(wrapperToday.textContent.split(' ')[0] || '0');
            wrapperToday.textContent = `${current + 1} today`;
        }
    }
    
    // Always increment week total
    const weekTotal = document.getElementById('week-total');
    if (weekTotal) {
        weekTotal.textContent = parseInt(weekTotal.textContent || '0') + 1;
    }
}

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
    // Skip polling if socket is connected - real-time updates will handle it
    if (useSocketForSync && window.SasWatchSocket?.isConnected()) {
        console.log('[SYNC-DEBUG] Socket connected - skipping HTTP polling, using real-time updates');
        return;
    }

    if (syncStatusPoller) {
        clearInterval(syncStatusPoller);
    }

    console.log('[SYNC-DEBUG] Starting status polling (socket not available)');
    let pollCount = 0;

    syncStatusPoller = setInterval(async () => {
        // Check if socket reconnected - stop polling if so
        if (useSocketForSync && window.SasWatchSocket?.isConnected()) {
            console.log('[SYNC-DEBUG] Socket reconnected - stopping HTTP polling');
            stopSyncStatusPolling();
            return;
        }

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
    }, 5000); // Poll every 5 seconds (optimized from 2s)
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
    
    // Build progress message with more detail if available
    let text = status.message || 'Syncing...';
    if (status.progress !== undefined) {
        text += ` (${status.progress}%)`;
    }
    if (status.eventsFetched !== undefined) {
        text += ` - ${status.eventsFetched} events`;
    }
    if (status.page !== undefined) {
        text += ` - Page ${status.page}`;
    }
    
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
        
        // Check if data was recently cleared (within last 5 minutes) - don't auto-backfill
        const dataClearedAt = sessionStorage.getItem('dataClearedAt');
        const wasRecentlyCleared = dataClearedAt && (Date.now() - parseInt(dataClearedAt, 10)) < 5 * 60 * 1000; // 5 minutes
        if (wasRecentlyCleared && looksIncomplete) {
            console.log('[SYNC-DEBUG] Data was recently cleared, skipping auto-backfill');
            sessionStorage.removeItem('dataClearedAt'); // Clear the flag after use
        }

        if ((looksIncomplete || initialSyncProblem) && allowBackfill && !wasRecentlyCleared) {
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
        ? data.adobe.map(item => ({ ...item, source: item.source || 'adobe' }))
        : [];
    // Wrapper array now contains desktop, browser, and legacy wrapper events - preserve their source
    const wrapperEvents = Array.isArray(data.wrapper)
        ? data.wrapper.map(item => ({ ...item, source: item.source || 'wrapper' }))
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
    const source = (item.source || '').toLowerCase();

    // Determine app name and detail based on source type
    let appName = 'Unknown';
    let appDetail = '';

    if (source === 'desktop') {
        // Desktop app launch: show friendly name or process name, with window title as detail
        const processName = item.url; // Agent stores process name in 'url' field
        appName = formatProcessName(processName) || processName || 'Unknown App';
        // Show window title as detail if it adds context
        if (item.windowTitle && item.windowTitle !== processName) {
            appDetail = item.windowTitle;
        }
    } else if (source === 'browser') {
        // Browser activity: show browser name with URL/domain as detail
        appName = formatBrowserName(item.browser) || item.browser || 'Browser';
        appDetail = item.url || '';
    } else if (source.startsWith('entra') || item.appDisplayName) {
        // Entra SSO events: use appDisplayName
        appName = item.appDisplayName || item.resourceDisplayName || 'Unknown App';
        if (item.clientAppUsed) {
            appDetail = `via ${item.clientAppUsed}`;
        }
    } else {
        // Legacy/other sources
        appName = item.appDisplayName || item.event || item.url || 'Unknown';
        if (item.why && item.why !== 'agent_monitor') {
            appDetail = item.why;
        }
    }

    // Build detail line (app-specific detail + IP if available)
    const detailSegments = [];
    if (appDetail) {
        detailSegments.push(escapeHtml(appDetail));
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

// Map process names to friendly application names
function formatProcessName(processName) {
    if (!processName) return null;
    
    const appNames = {
        // Adobe apps
        'acrobat': 'Adobe Acrobat Pro',
        'acrord32': 'Adobe Acrobat Reader',
        'photoshop': 'Adobe Photoshop',
        'illustrator': 'Adobe Illustrator',
        'indesign': 'Adobe InDesign',
        'premiere': 'Adobe Premiere Pro',
        'afterfx': 'Adobe After Effects',
        'audition': 'Adobe Audition',
        'animate': 'Adobe Animate',
        'dreamweaver': 'Adobe Dreamweaver',
        'lightroom': 'Adobe Lightroom',
        'xd': 'Adobe XD',
        'bridge': 'Adobe Bridge',
        'media encoder': 'Adobe Media Encoder',
        // Microsoft apps
        'winword': 'Microsoft Word',
        'excel': 'Microsoft Excel',
        'powerpnt': 'Microsoft PowerPoint',
        'outlook': 'Microsoft Outlook',
        'onenote': 'Microsoft OneNote',
        'teams': 'Microsoft Teams',
        'msteams': 'Microsoft Teams',
        // Development tools
        'code': 'Visual Studio Code',
        'devenv': 'Visual Studio',
        'rider': 'JetBrains Rider',
        'idea64': 'IntelliJ IDEA',
        'webstorm64': 'WebStorm',
        'pycharm64': 'PyCharm',
        // System/common apps
        'explorer': 'File Explorer',
        'notepad': 'Notepad',
        'notepad++': 'Notepad++',
        'slack': 'Slack',
        'discord': 'Discord',
        'spotify': 'Spotify',
        'zoom': 'Zoom',
        'windowsterminal': 'Windows Terminal',
        'cmd': 'Command Prompt',
        'powershell': 'PowerShell',
        'cursor': 'Cursor'
    };
    
    const key = processName.toLowerCase().replace('.exe', '');
    return appNames[key] || null;
}

// Map browser process names to friendly names
function formatBrowserName(browser) {
    if (!browser) return null;
    
    const browsers = {
        'chrome': 'Google Chrome',
        'msedge': 'Microsoft Edge',
        'firefox': 'Mozilla Firefox',
        'brave': 'Brave',
        'opera': 'Opera',
        'vivaldi': 'Vivaldi',
        'arc': 'Arc',
        'safari': 'Safari'
    };
    
    return browsers[browser.toLowerCase()] || browser;
}

function getSourceMeta(item = {}) {
    const source = (item.source || '').toLowerCase();

    // ActivityAgent sources
    if (source === 'desktop') {
        return { label: '💻 Desktop App', className: 'source-desktop' };
    }

    if (source === 'browser') {
        return { label: '🌐 Browser', className: 'source-browser' };
    }

    // Legacy sources
    if (source === 'adobe') {
        return { label: '🌐 Web', className: 'source-adobe' };
    }

    if (source === 'wrapper') {
        return { label: '💻 Desktop', className: 'source-wrapper' };
    }

    // Entra SSO sources
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
            message: 'This will permanently delete all tracked usage events and re-sync the last 6 hours from Microsoft Graph. This action cannot be undone.',
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
        // Clear data and reset cursor to 6 hours ago
        const response = await fetch('/api/usage?resetCursor=true&cursorHours=6', {
            method: 'DELETE'
        });

        if (response.ok) {
            notifier.success('Data cleared. Syncing last 6 hours...');
            appendSyncLog('Data cleared. Starting automatic sync of last 6 hours...');
            
            // Clear cached data
            cachedActivityData = { adobe: [], wrapper: [], entra: [] };
            updateActivityList('recent-activity', []);
            
            // Automatically trigger Entra sync to backfill the last 6 hours
            try {
                appendSyncLog('Triggering Entra sign-in sync...');
                const syncResp = await fetch('/api/account/entra/sync?mode=activity&background=false', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        includeSignIns: true,
                        maxPages: 10,
                        backfillHours: 6
                    })
                });
                
                if (syncResp.ok) {
                    const syncResult = await syncResp.json();
                    const count = syncResult.results?.signIns?.count || syncResult.signIns?.count || 0;
                    appendSyncLog(`✅ Synced ${count} sign-in events from the last 6 hours.`);
                    notifier.success(`Synced ${count} sign-in events`);
                } else {
                    appendSyncLog('⚠️ Sync request sent but may still be processing.');
                }
            } catch (syncError) {
                console.warn('Auto-sync after clear failed:', syncError);
                appendSyncLog('⚠️ Auto-sync failed. Use "Sync Graph" button to manually sync.');
            }
            
            // Refresh UI with new data
            await refreshData({ silent: true, awaitSync: false });
            appendSyncLog('✅ Activity refresh complete.');
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
// Simple refresh from database - no Graph API calls
async function startManualSync() {
    console.log('[SYNC] startManualSync called - Refreshing from database');

    const button = document.querySelector('.dashboard-controls .btn.btn-primary') || document.querySelector('.btn.btn-primary');
    const original = button ? button.innerHTML : null;

    resetSyncLog('Refreshing activity from database...');

    if (button) {
        addButtonSpinner(button, original || '🔄 Refresh');
    }

    try {
        // Just refresh data from database - background job handles Graph API sync every 30 min
        await refreshData({ silent: false, awaitSync: false, force: true });
        appendSyncLog('✅ Activity refreshed from database.', { allowDuplicate: true });
        console.log('[SYNC] Database refresh completed');
    } catch (error) {
        console.error('[SYNC] Refresh error:', error);
        appendSyncLog(`❌ Refresh failed: ${error.message}`, { allowDuplicate: true });
        notifier.error(error.message || 'Failed to refresh activity');
    } finally {
        if (button) {
            removeButtonSpinner(button);
        }
    }
}

// Superadmin-only: Trigger Graph API sync to database
async function syncGraphManual() {
    console.log('[SYNC] syncGraphManual called - Superadmin Graph API sync');

    const button = document.getElementById('sync-graph-btn');
    const original = button ? button.innerHTML : null;
    const configuredHours = Number(button?.dataset?.syncHours) || 24;
    const configuredLimit = Number(button?.dataset?.syncLimit) || 50;
    const configuredPageSize = Number(button?.dataset?.syncPageSize) || Math.min(configuredLimit, 25);
    const calculatedMaxPages = Math.max(1, Math.ceil(configuredLimit / configuredPageSize));

    resetSyncLog(`Superadmin: Triggering Microsoft Graph sync (lookback: ${configuredHours}h, up to ${configuredLimit} events)...`);
    appendSyncLog('> POST /api/admin/sync-graph', { allowDuplicate: true });

    if (button) {
        addButtonSpinner(button, original || '🔄 Sync Graph');
    }

    try {
        appendSyncLog('Connecting to Microsoft Graph API...', { allowDuplicate: true });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout

        const syncResp = await fetch('/api/admin/sync-graph', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                backfillHours: configuredHours,
                limit: configuredLimit,
                pageSize: configuredPageSize,
                maxPages: calculatedMaxPages
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!syncResp.ok) {
            const errorData = await syncResp.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${syncResp.status}`);
        }

        const result = await syncResp.json();
        console.log('[SYNC] Graph sync result:', result);

        if (result.success) {
            const count = result.signIns?.count || 0;
            appendSyncLog(`✅ Graph sync completed: ${count} sign-in events synced`, { allowDuplicate: true });
            notifier.success(`Graph sync completed: ${count} events`);
            
            // Refresh UI with new data
            await refreshData({ silent: true, awaitSync: false });
        } else {
            throw new Error(result.error || 'Sync failed');
        }

    } catch (error) {
        console.error('[SYNC] Graph sync error:', error);
        appendSyncLog(`❌ Graph sync failed: ${error.message}`, { allowDuplicate: true });
        notifier.error(error.message || 'Graph sync failed');
    } finally {
        if (button) {
            removeButtonSpinner(button);
        }
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
window.syncGraphManual = syncGraphManual;
window.cancelSync = cancelSync;
window.toggleSyncLog = toggleSyncLog;

