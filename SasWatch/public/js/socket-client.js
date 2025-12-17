// Socket.IO Client for Real-Time Dashboard Updates
// Connects to /dashboard namespace and receives activity events in real-time

(function() {
    'use strict';

    // Socket.IO connection state
    let socket = null;
    let connectionState = 'disconnected';
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;

    // Get account ID from secure endpoint (validates session)
    async function getAccountId() {
        try {
            // Fetch from secure endpoint that validates session
            const response = await fetch('/api/socket/auth', {
                credentials: 'include', // Include session cookie
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                console.warn('[Socket.IO] Failed to get account ID from secure endpoint');
                return null;
            }

            const data = await response.json();
            if (data.success && data.accountId) {
                return data.accountId;
            }

            return null;
        } catch (error) {
            console.error('[Socket.IO] Error fetching account ID:', error);
            return null;
        }
    }

    // Initialize Socket.IO connection
    async function initSocket() {
        const accountId = await getAccountId();
        
        if (!accountId) {
            console.log('[Socket.IO] No account ID available, skipping socket connection');
            return;
        }

        // Check if Socket.IO library is loaded
        if (typeof io === 'undefined') {
            console.warn('[Socket.IO] Library not loaded, real-time updates disabled');
            return;
        }

        // Connect to dashboard namespace
        socket = io('/dashboard', {
            auth: {
                accountId: accountId
            },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000
        });

        setupEventHandlers();
        console.log('[Socket.IO] Connecting to dashboard namespace...');
    }

    // Setup socket event handlers
    function setupEventHandlers() {
        if (!socket) return;

        // Connection events
        socket.on('connect', () => {
            connectionState = 'connected';
            reconnectAttempts = 0;
            console.log('[Socket.IO] Connected to dashboard');
            updateConnectionStatus(true);
            
            // Notify app.js that socket is ready
            window.dispatchEvent(new CustomEvent('socket:connected'));
        });

        socket.on('disconnect', (reason) => {
            connectionState = 'disconnected';
            console.log('[Socket.IO] Disconnected:', reason);
            updateConnectionStatus(false);
            
            window.dispatchEvent(new CustomEvent('socket:disconnected', { detail: { reason } }));
        });

        socket.on('connect_error', (error) => {
            connectionState = 'error';
            reconnectAttempts++;
            console.error('[Socket.IO] Connection error:', error.message);
            
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                console.warn('[Socket.IO] Max reconnection attempts reached, falling back to polling');
                window.dispatchEvent(new CustomEvent('socket:fallback'));
            }
        });

        // Real-time activity events
        socket.on('activity:new', (data) => {
            console.log('[Socket.IO] New activity:', data);
            handleNewActivity(data);
        });

        // Agent connection status
        socket.on('agent:connected', (data) => {
            console.log('[Socket.IO] Agent connected:', data);
            updateAgentStatus(true, data);
            showNotification('Agent connected', 'success');
        });

        socket.on('agent:disconnected', (data) => {
            console.log('[Socket.IO] Agent disconnected:', data);
            updateAgentStatus(false, data);
        });

        // Sync progress (real-time instead of polling)
        socket.on('sync:progress', (data) => {
            console.log('[Socket.IO] Sync progress:', data);
            handleSyncProgress(data);
        });

        socket.on('sync:complete', (data) => {
            console.log('[Socket.IO] Sync complete:', data);
            handleSyncComplete(data);
        });

        // Agent status updates
        socket.on('status:agents', (data) => {
            console.log('[Socket.IO] Agent status:', data);
            updateAgentCount(data.connected);
        });
    }

    // Handle new activity event (prepend to activity list)
    function handleNewActivity(data) {
        // Dispatch event for app.js to handle
        window.dispatchEvent(new CustomEvent('activity:new', { 
            detail: data 
        }));

        // Also update cached data if available
        if (window.cachedActivityData) {
            const source = data.source || 'unknown';
            
            // Add to the appropriate array
            if (source === 'adobe' || source === 'browser') {
                window.cachedActivityData.adobe = window.cachedActivityData.adobe || [];
                window.cachedActivityData.adobe.unshift(data);
            } else if (source === 'wrapper' || source === 'desktop') {
                window.cachedActivityData.wrapper = window.cachedActivityData.wrapper || [];
                window.cachedActivityData.wrapper.unshift(data);
            }
            
            // Add to all
            window.cachedActivityData.all = window.cachedActivityData.all || [];
            window.cachedActivityData.all.unshift(data);
            
            // Trim to prevent memory growth (keep last 200)
            if (window.cachedActivityData.all.length > 200) {
                window.cachedActivityData.all = window.cachedActivityData.all.slice(0, 200);
            }
        }

        // Show subtle notification for new activity
        incrementActivityCounter();
    }

    // Handle sync progress updates (replaces polling)
    function handleSyncProgress(data) {
        window.dispatchEvent(new CustomEvent('sync:progress', { 
            detail: data 
        }));
        
        // Update sync log if function exists
        if (typeof window.appendSyncLog === 'function') {
            window.appendSyncLog(`${data.message} (${data.progress}%)`);
        }
    }

    // Handle sync completion
    function handleSyncComplete(data) {
        window.dispatchEvent(new CustomEvent('sync:complete', { 
            detail: data 
        }));
        
        if (typeof window.appendSyncLog === 'function') {
            window.appendSyncLog(data.message || 'Sync complete');
        }
        
        // Trigger data refresh
        if (typeof window.refreshData === 'function') {
            window.refreshData({ silent: true, awaitSync: false });
        }
    }

    // Update connection status indicator in UI
    function updateConnectionStatus(connected) {
        const indicator = document.getElementById('socket-status');
        if (indicator) {
            indicator.className = connected ? 'socket-status connected' : 'socket-status disconnected';
            indicator.title = connected ? 'Real-time updates active' : 'Real-time updates disconnected';
        }
        
        // Update any status text
        const statusText = document.getElementById('socket-status-text');
        if (statusText) {
            statusText.textContent = connected ? 'Live' : 'Offline';
        }
    }

    // Update agent status display
    function updateAgentStatus(connected, data) {
        const indicator = document.getElementById('agent-status');
        if (indicator) {
            indicator.className = connected ? 'agent-status connected' : 'agent-status disconnected';
            indicator.title = connected 
                ? `Agent connected: ${data.clientId}` 
                : 'No agents connected';
        }
    }

    // Update agent count display
    function updateAgentCount(count) {
        const countEl = document.getElementById('agent-count');
        if (countEl) {
            countEl.textContent = count;
        }
    }

    // Increment activity counter (visual feedback for new events)
    function incrementActivityCounter() {
        // Flash the activity count or show a badge
        const statsCard = document.querySelector('.stat-card.combined');
        if (statsCard) {
            statsCard.classList.add('activity-pulse');
            setTimeout(() => {
                statsCard.classList.remove('activity-pulse');
            }, 500);
        }
    }

    // Show notification using existing notifier if available
    function showNotification(message, type = 'info') {
        if (window.Toast && typeof window.Toast[type] === 'function') {
            window.Toast[type](message, 3000);
        }
    }

    // Public API
    window.SasWatchSocket = {
        init: initSocket,
        
        isConnected: function() {
            return connectionState === 'connected';
        },
        
        getState: function() {
            return connectionState;
        },
        
        // Request stats via socket
        requestStats: function(callback) {
            if (socket && connectionState === 'connected') {
                socket.emit('request:stats', callback);
            } else if (callback) {
                callback({ success: false, error: 'Not connected' });
            }
        },
        
        // Disconnect socket
        disconnect: function() {
            if (socket) {
                socket.disconnect();
                socket = null;
                connectionState = 'disconnected';
            }
        },
        
        // Reconnect socket
        reconnect: function() {
            if (socket) {
                socket.connect();
            } else {
                initSocket();
            }
        }
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSocket);
    } else {
        // DOM already loaded, init after a short delay to ensure account ID is available
        setTimeout(initSocket, 100);
    }

})();
