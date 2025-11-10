const express = require('express');
const path = require('path');
require('dotenv').config();

const { startBackgroundSync } = require('./lib/background-sync');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Middleware Setup
// ============================================

// Trust Railway proxy for secure cookies
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

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
    setupDevRoutes
} = require('./server-multitenant-routes');

// Initialize session management (must be before routes)
setupSession(app);

// Setup all route modules
setupAuthRoutes(app);
setupDashboardRoutes(app);
setupUserManagementRoutes(app);
setupAccountRoutes(app);
setupApiRoutes(app);
setupDownloadRoutes(app);
setupAppsRoutes(app);
setupDevRoutes(app);

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║         📊 SasWatch Multi-Tenant Server         ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log('');
    console.log(`🚀 Server running on: http://localhost:${PORT}`);
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
});
