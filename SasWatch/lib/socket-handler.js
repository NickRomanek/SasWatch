// Socket.IO Handler for Real-Time Communication
// Manages agent and dashboard connections with proper authentication

const { Server } = require('socket.io');
const cookie = require('cookie');
const auth = require('./auth');
const db = require('./database-multitenant');

// Session store reference (set by initializeSocketIO)
let sessionStore = null;

// Track connected agents and dashboards per account
const connectedAgents = new Map();  // accountId -> Set<socket.id>
const connectedDashboards = new Map();  // accountId -> Set<socket.id>

// Rate limiting: accountId -> { count, resetTime }
const rateLimiters = new Map();

// Connection statistics
const connectionStats = {
    totalAgentConnections: 0,
    totalDashboardConnections: 0,
    eventsReceived: 0,
    eventsBroadcast: 0
};

// Security constants
const MAX_CONNECTIONS_PER_ACCOUNT = 10;
const MAX_AGENT_CONNECTIONS_PER_ACCOUNT = 5;
const MAX_EVENTS_PER_MINUTE = 100;
const MAX_BATCH_SIZE = 50;
const MAX_EVENT_SIZE = 5000; // bytes

/**
 * Initialize Socket.IO server with namespaces
 * @param {http.Server} httpServer - The HTTP server instance
 * @param {Object} sessionStoreRef - Reference to session store for verification
 * @returns {Server} Socket.IO server instance
 */
function initializeSocketIO(httpServer, sessionStoreRef = null) {
    sessionStore = sessionStoreRef;
    // Determine allowed origins
    let allowedOrigins = false;
    if (process.env.NODE_ENV === 'development') {
        allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
    } else if (process.env.ALLOWED_ORIGINS) {
        allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    }

    const io = new Server(httpServer, {
        cors: {
            origin: allowedOrigins,
            methods: ['GET', 'POST'],
            credentials: true,
            allowedHeaders: ['X-API-Key', 'Content-Type']
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        transports: ['websocket', 'polling'],
        maxHttpBufferSize: MAX_EVENT_SIZE * 2, // Allow some overhead
        allowEIO3: false // Disable old Engine.IO v3 clients
    });

    // Setup namespaces
    setupAgentNamespace(io);
    setupDashboardNamespace(io);

    console.log('[Socket.IO] Server initialized with /agent and /dashboard namespaces');

    return io;
}

/**
 * Setup /agent namespace for ActivityAgent connections
 */
function setupAgentNamespace(io) {
    const agentNsp = io.of('/agent');

    // Authentication middleware for agents (API key)
    agentNsp.use(async (socket, next) => {
        const apiKey = socket.handshake.auth?.apiKey || 
                       socket.handshake.headers['x-api-key'];

        if (!apiKey) {
            console.log('[Socket.IO] Agent connection rejected: No API key');
            return next(new Error('API key required'));
        }

        try {
            const account = await auth.getAccountByApiKey(apiKey);
            if (!account) {
                console.log('[Socket.IO] Agent connection rejected: Invalid API key');
                return next(new Error('Invalid API key'));
            }

            // Attach account info to socket
            socket.accountId = account.id;
            socket.accountEmail = account.email;
            socket.clientId = socket.handshake.auth?.clientId || 'unknown';
            
            next();
        } catch (error) {
            console.error('[Socket.IO] Agent auth error:', error);
            next(new Error('Authentication failed'));
        }
    });

    agentNsp.on('connection', (socket) => {
        const { accountId, clientId } = socket;
        
        // Check connection limits
        const currentConnections = connectedAgents.get(accountId)?.size || 0;
        if (currentConnections >= MAX_AGENT_CONNECTIONS_PER_ACCOUNT) {
            console.log(`[Socket.IO] Agent connection rejected: Max connections (${MAX_AGENT_CONNECTIONS_PER_ACCOUNT}) reached for account ${accountId}`);
            socket.emit('error', { message: 'Maximum connections reached' });
            socket.disconnect();
            return;
        }
        
        // Track connected agent
        if (!connectedAgents.has(accountId)) {
            connectedAgents.set(accountId, new Set());
        }
        connectedAgents.get(accountId).add(socket.id);
        connectionStats.totalAgentConnections++;

        console.log(`[Socket.IO] Agent connected: ${clientId} for account ${accountId}`);

        // Join account-specific room for broadcasting
        socket.join(`account:${accountId}`);

        // Notify dashboards that an agent connected
        broadcastToDashboards(accountId, 'agent:connected', {
            clientId,
            timestamp: new Date().toISOString()
        });

        // Handle activity events from agent
        socket.on('activity:event', async (data, callback) => {
            try {
                // Input validation
                const validationError = validateEventData(data);
                if (validationError) {
                    console.warn(`[Socket.IO] Invalid event data from ${clientId}:`, validationError);
                    if (callback) callback({ success: false, error: validationError });
                    return;
                }

                // Rate limiting
                const rateLimitError = checkRateLimit(accountId);
                if (rateLimitError) {
                    console.warn(`[Socket.IO] Rate limit exceeded for account ${accountId}`);
                    if (callback) callback({ success: false, error: rateLimitError });
                    return;
                }

                connectionStats.eventsReceived++;
                
                // Determine source based on event type
                let source = 'adobe';
                if (data.why === 'agent_monitor') {
                    source = data.event === 'web_browsing' ? 'browser' : 'desktop';
                } else if (data.why === 'adobe_reader_wrapper' || data.why === 'process_monitor') {
                    source = 'wrapper';
                }

                console.log(`[Socket.IO] Event: ${data.event} | source: ${source} | client: ${clientId}`);

                // Save to database
                await db.addUsageEvent(accountId, data, source);

                // Broadcast to connected dashboards
                broadcastToDashboards(accountId, 'activity:new', {
                    ...data,
                    source,
                    receivedAt: new Date().toISOString()
                });
                connectionStats.eventsBroadcast++;

                // Acknowledge receipt
                if (callback) callback({ success: true });
            } catch (error) {
                console.error('[Socket.IO] Error processing event:', error);
                if (callback) callback({ success: false, error: error.message });
            }
        });

        // Handle batch events
        socket.on('activity:batch', async (events, callback) => {
            try {
                // Validate batch
                if (!Array.isArray(events)) {
                    if (callback) callback({ success: false, error: 'Batch must be an array' });
                    return;
                }

                if (events.length > MAX_BATCH_SIZE) {
                    if (callback) callback({ success: false, error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` });
                    return;
                }

                // Rate limiting for batch (counts as multiple events)
                const rateLimitError = checkRateLimit(accountId, events.length);
                if (rateLimitError) {
                    if (callback) callback({ success: false, error: rateLimitError });
                    return;
                }

                let successCount = 0;
                let failCount = 0;

                for (const data of events) {
                    try {
                        // Validate each event
                        const validationError = validateEventData(data);
                        if (validationError) {
                            failCount++;
                            continue;
                        }

                        connectionStats.eventsReceived++;
                        
                        let source = 'adobe';
                        if (data.why === 'agent_monitor') {
                            source = data.event === 'web_browsing' ? 'browser' : 'desktop';
                        } else if (data.why === 'adobe_reader_wrapper' || data.why === 'process_monitor') {
                            source = 'wrapper';
                        }

                        await db.addUsageEvent(accountId, data, source);
                        
                        broadcastToDashboards(accountId, 'activity:new', {
                            ...data,
                            source,
                            receivedAt: new Date().toISOString()
                        });
                        connectionStats.eventsBroadcast++;
                        successCount++;
                    } catch (err) {
                        failCount++;
                        console.error('[Socket.IO] Batch event error:', err);
                    }
                }

                console.log(`[Socket.IO] Batch processed: ${successCount} success, ${failCount} failed`);
                if (callback) callback({ success: true, processed: successCount, failed: failCount });
            } catch (error) {
                console.error('[Socket.IO] Batch processing error:', error);
                if (callback) callback({ success: false, error: error.message });
            }
        });

        // Handle agent heartbeat
        socket.on('heartbeat', (data, callback) => {
            if (callback) callback({ 
                success: true, 
                serverTime: new Date().toISOString() 
            });
        });

        // Handle disconnection
        socket.on('disconnect', (reason) => {
            console.log(`[Socket.IO] Agent disconnected: ${clientId} (${reason})`);
            
            if (connectedAgents.has(accountId)) {
                connectedAgents.get(accountId).delete(socket.id);
                if (connectedAgents.get(accountId).size === 0) {
                    connectedAgents.delete(accountId);
                }
            }

            // Notify dashboards
            broadcastToDashboards(accountId, 'agent:disconnected', {
                clientId,
                reason,
                timestamp: new Date().toISOString()
            });
        });

        // Handle errors
        socket.on('error', (error) => {
            console.error(`[Socket.IO] Agent error: ${clientId}`, error);
        });
    });

    return agentNsp;
}

/**
 * Setup /dashboard namespace for web dashboard connections
 */
function setupDashboardNamespace(io) {
    const dashboardNsp = io.of('/dashboard');

    // Authentication middleware for dashboards (session-based)
    dashboardNsp.use(async (socket, next) => {
        // Get session cookie from handshake
        const cookies = socket.handshake.headers.cookie;
        if (!cookies) {
            console.log('[Socket.IO] Dashboard connection rejected: No session cookie');
            return next(new Error('Session required'));
        }

        // Parse cookies
        const parsedCookies = cookie.parse(cookies);
        const sessionId = parsedCookies['connect.sid'];
        
        if (!sessionId) {
            console.log('[Socket.IO] Dashboard connection rejected: No session ID in cookie');
            return next(new Error('Invalid session'));
        }

        try {
            // Verify session if store is available
            let sessionData = null;
            if (sessionStore && typeof sessionStore.get === 'function') {
                // Extract session ID (may be signed, format: s:sessionId.signature)
                const sessionKey = sessionId.startsWith('s:') 
                    ? sessionId.split('.')[0].substring(2) 
                    : sessionId;
                
                sessionData = await new Promise((resolve) => {
                    sessionStore.get(sessionKey, (err, session) => {
                        if (err) {
                            console.error('[Socket.IO] Session store error:', err);
                            resolve(null);
                        } else {
                            resolve(session);
                        }
                    });
                });
            }

            // Get accountId from auth (frontend fetches from secure endpoint)
            const accountId = socket.handshake.auth?.accountId;
            
            if (!accountId) {
                console.log('[Socket.IO] Dashboard connection rejected: No account ID in auth');
                return next(new Error('Account ID required'));
            }

            // If we have session data, verify accountId matches
            if (sessionData && sessionData.accountId !== accountId) {
                console.log('[Socket.IO] Dashboard connection rejected: Account ID mismatch');
                return next(new Error('Session mismatch'));
            }

            // Verify account exists and is active
            const account = await auth.getAccountById(accountId);
            if (!account || !account.isActive) {
                console.log('[Socket.IO] Dashboard connection rejected: Invalid or inactive account');
                return next(new Error('Invalid account'));
            }

            socket.accountId = accountId;
            socket.accountEmail = account.email;
            next();
        } catch (error) {
            console.error('[Socket.IO] Dashboard auth error:', error);
            next(new Error('Authentication failed'));
        }
    });

    dashboardNsp.on('connection', (socket) => {
        const { accountId } = socket;

        // Check connection limits
        const currentConnections = connectedDashboards.get(accountId)?.size || 0;
        if (currentConnections >= MAX_CONNECTIONS_PER_ACCOUNT) {
            console.log(`[Socket.IO] Dashboard connection rejected: Max connections (${MAX_CONNECTIONS_PER_ACCOUNT}) reached for account ${accountId}`);
            socket.emit('error', { message: 'Maximum connections reached' });
            socket.disconnect();
            return;
        }

        // Track connected dashboard
        if (!connectedDashboards.has(accountId)) {
            connectedDashboards.set(accountId, new Set());
        }
        connectedDashboards.get(accountId).add(socket.id);
        connectionStats.totalDashboardConnections++;

        console.log(`[Socket.IO] Dashboard connected for account ${accountId}`);

        // Join account-specific room
        socket.join(`account:${accountId}`);

        // Send current agent status
        const agentCount = connectedAgents.get(accountId)?.size || 0;
        socket.emit('status:agents', {
            connected: agentCount,
            timestamp: new Date().toISOString()
        });

        // Handle subscription to specific data streams
        socket.on('subscribe', (streams) => {
            console.log(`[Socket.IO] Dashboard subscribed to: ${streams.join(', ')}`);
            // Future: Allow granular subscriptions
        });

        // Handle request for current stats
        socket.on('request:stats', async (callback) => {
            try {
                // Get basic stats from database
                const stats = {
                    connected: true,
                    agentCount: connectedAgents.get(accountId)?.size || 0,
                    timestamp: new Date().toISOString()
                };
                if (callback) callback({ success: true, stats });
            } catch (error) {
                if (callback) callback({ success: false, error: error.message });
            }
        });

        // Handle disconnection
        socket.on('disconnect', (reason) => {
            console.log(`[Socket.IO] Dashboard disconnected: ${accountId} (${reason})`);
            
            if (connectedDashboards.has(accountId)) {
                connectedDashboards.get(accountId).delete(socket.id);
                if (connectedDashboards.get(accountId).size === 0) {
                    connectedDashboards.delete(accountId);
                }
            }
        });
    });

    return dashboardNsp;
}

/**
 * Validate event data structure and content
 */
function validateEventData(data) {
    if (!data || typeof data !== 'object') {
        return 'Event data must be an object';
    }

    if (!data.event || typeof data.event !== 'string') {
        return 'Event type is required and must be a string';
    }

    if (data.event.length > 500) {
        return 'Event type exceeds maximum length';
    }

    if (data.url && typeof data.url !== 'string') {
        return 'URL must be a string';
    }

    if (data.url && data.url.length > 2000) {
        return 'URL exceeds maximum length';
    }

    // Check total size
    const dataSize = JSON.stringify(data).length;
    if (dataSize > MAX_EVENT_SIZE) {
        return `Event data exceeds maximum size of ${MAX_EVENT_SIZE} bytes`;
    }

    return null; // Valid
}

/**
 * Check rate limit for an account
 */
function checkRateLimit(accountId, eventCount = 1) {
    const now = Date.now();
    const limiter = rateLimiters.get(accountId) || { count: 0, resetTime: now + 60000 };

    // Reset if window expired
    if (now > limiter.resetTime) {
        limiter.count = 0;
        limiter.resetTime = now + 60000; // 1 minute window
    }

    // Check limit
    if (limiter.count + eventCount > MAX_EVENTS_PER_MINUTE) {
        return `Rate limit exceeded: Maximum ${MAX_EVENTS_PER_MINUTE} events per minute`;
    }

    // Update count
    limiter.count += eventCount;
    rateLimiters.set(accountId, limiter);

    return null; // Within limit
}

/**
 * Broadcast event to all connected dashboards for an account
 */
function broadcastToDashboards(accountId, event, data) {
    const dashboards = connectedDashboards.get(accountId);
    if (dashboards && dashboards.size > 0) {
        // Use the dashboard namespace's room
        dashboardNamespace?.to(`account:${accountId}`).emit(event, data);
    }
}

// Store namespace references for broadcasting
let dashboardNamespace = null;
let agentNamespace = null;

/**
 * Get connection statistics
 */
function getConnectionStats() {
    return {
        ...connectionStats,
        currentAgents: Array.from(connectedAgents.entries()).map(([accountId, sockets]) => ({
            accountId,
            count: sockets.size
        })),
        currentDashboards: Array.from(connectedDashboards.entries()).map(([accountId, sockets]) => ({
            accountId,
            count: sockets.size
        }))
    };
}

/**
 * Emit event to specific account's dashboards (called from HTTP routes)
 */
function emitToAccount(accountId, event, data) {
    if (dashboardNamespace) {
        dashboardNamespace.to(`account:${accountId}`).emit(event, data);
    }
}

/**
 * Initialize and store namespace references
 */
function setupNamespaceReferences(io) {
    dashboardNamespace = io.of('/dashboard');
    agentNamespace = io.of('/agent');
}

module.exports = {
    initializeSocketIO,
    getConnectionStats,
    emitToAccount,
    setupNamespaceReferences,
    // Expose for testing
    connectedAgents,
    connectedDashboards
};
