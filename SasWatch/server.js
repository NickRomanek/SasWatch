const express = require('express');
const path = require('path');
const compression = require('compression');
const http = require('http');
require('dotenv').config();

const { startBackgroundSync } = require('./lib/background-sync');
const { initializeSocketIO, setupNamespaceReferences } = require('./lib/socket-handler');
const { startRenewalScheduler } = require('./lib/renewal-scheduler');
const { 
    setupHelmet, 
    requireHTTPS, 
    addRequestId, 
    validateSessionSecret,
    auditLog 
} = require('./lib/security');
const { errorResponse } = require('./lib/error-handler');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Security Validation
// ============================================

// Validate critical security configuration
try {
    validateSessionSecret();
} catch (error) {
    console.error('❌ CRITICAL SECURITY ERROR:', error.message);
    console.error('   Application cannot start without proper security configuration.');
    process.exit(1);
}

// ============================================
// Middleware Setup
// ============================================

// Trust Railway proxy for secure cookies
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Security: HTTPS enforcement (must be first)
app.use(requireHTTPS);

// Security: HTTP security headers via Helmet
setupHelmet(app);

// Security: Add unique request IDs for tracing
app.use(addRequestId);

// Performance: Enable response compression (gzip/brotli)
app.use(compression());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================
// Multi-Tenant Routes Integration
// ============================================

// Import and setup all multi-tenant routes
const {
    setupSession,
    setupAuthRoutes,
    setupDashboardRoutes,
    setupUserManagementRoutes,
    setupAccountRoutes,
    setupApiRoutes,
    setupDownloadRoutes,
    setupAppsRoutes,
    setupDevRoutes,
    setupAdminRoutes,
    setupDataRoutes,
    setupRenewalsRoutes,
    setupMembersRoutes
} = require('./server-multitenant-routes');

// Initialize session management (must be before routes)
const sessionStore = setupSession(app);

// Setup all route modules
setupAuthRoutes(app);
setupDashboardRoutes(app);
setupUserManagementRoutes(app);
setupAccountRoutes(app);
setupApiRoutes(app);
setupDownloadRoutes(app);
setupDataRoutes(app);
setupAppsRoutes(app);
setupDevRoutes(app);
setupAdminRoutes(app);
setupRenewalsRoutes(app);
setupMembersRoutes(app);

// ============================================
// Health Check Endpoints
// ============================================

// Simple health check for monitoring
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Detailed health check for API monitoring
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// ============================================
// Error Handling Middleware
// ============================================

// 404 Handler - Must be after all routes
app.use((req, res, next) => {
    const isApiRequest = req.path.startsWith('/api/') || 
                         req.headers.accept?.includes('application/json');
    
    if (isApiRequest) {
        res.status(404).json({
            success: false,
            message: 'Endpoint not found',
            requestId: req.id
        });
    } else {
        res.status(404).render('error', {
            error: 'Page Not Found',
            message: 'The page you\'re looking for doesn\'t exist. It may have been moved or deleted.',
            requestId: req.id,
            showStack: false,
            stack: null
        });
    }
});

// Global Error Handler - Must be last
app.use((err, req, res, next) => {
    // Log the error
    console.error('❌ Unhandled error caught by global handler:', {
        message: err.message,
        stack: err.stack,
        requestId: req.id,
        url: req.originalUrl,
        method: req.method
    });
    
    // Use centralized error response
    errorResponse(res, err, req);
});

// ============================================
// Process-Level Error Handlers
// ============================================

// Memory monitoring - log usage every 5 minutes in production
const logMemoryUsage = () => {
    const used = process.memoryUsage();
    const mb = (bytes) => Math.round(bytes / 1024 / 1024);
    console.log(`[Memory] RSS: ${mb(used.rss)}MB, Heap: ${mb(used.heapUsed)}/${mb(used.heapTotal)}MB, External: ${mb(used.external)}MB`);
};

// Log memory on startup and periodically
logMemoryUsage();
setInterval(logMemoryUsage, 5 * 60 * 1000); // Every 5 minutes

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ UNHANDLED PROMISE REJECTION:', {
        reason: reason,
        promise: promise,
        timestamp: new Date().toISOString()
    });
    
    // Log memory state during rejection
    logMemoryUsage();
    
    // Log to audit system
    auditLog('UNHANDLED_REJECTION', null, {
        reason: reason?.toString(),
        stack: reason?.stack
    });
    
    // In production, we continue running. In development, we might want to crash.
    if (process.env.NODE_ENV !== 'production') {
        console.error('💥 Unhandled rejection in development mode. Consider fixing this.');
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ UNCAUGHT EXCEPTION:', {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
    });
    
    // Log to audit system
    auditLog('UNCAUGHT_EXCEPTION', null, {
        message: error.message,
        stack: error.stack
    });
    
    // Uncaught exceptions are serious - we should exit gracefully
    console.error('💥 Server will shut down due to uncaught exception.');
    
    // Give time for logs to flush
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('📴 SIGTERM signal received: closing HTTP server gracefully');
    server.close(() => {
        console.log('✅ HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('📴 SIGINT signal received: closing HTTP server gracefully');
    server.close(() => {
        console.log('✅ HTTP server closed');
        process.exit(0);
    });
});

// ============================================
// Start Server with Socket.IO
// ============================================

// Create HTTP server (required for Socket.IO)
const server = http.createServer(app);

// Initialize Socket.IO on the HTTP server (pass session store for dashboard auth)
const io = initializeSocketIO(server, sessionStore);
setupNamespaceReferences(io);

// Make io available to routes if needed
app.set('io', io);

server.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║         📊 SasWatch Multi-Tenant Server         ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log('');
    console.log(`🚀 Server running on: http://localhost:${PORT}`);
    console.log(`🔌 Socket.IO: Enabled (namespaces: /agent, /dashboard)`);
    console.log(`🔐 Database: ${process.env.DATABASE_URL ? 'PostgreSQL (Connected)' : 'PostgreSQL (Local)'}`);
    console.log('');
    console.log('📖 Quick Start:');
    console.log(`   1. Visit: http://localhost:${PORT}`);
    console.log('   2. Click "Sign up" to create your first account');
    console.log('   3. Start tracking Adobe usage!');
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    
    // Start background sync for Entra sign-ins
    startBackgroundSync();
    
    // Start renewal reminder scheduler
    startRenewalScheduler();
});
