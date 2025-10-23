// Multi-Tenant Routes Module
// Add these routes to your server.js for multi-tenant functionality

const express = require('express');
const session = require('express-session');
const auth = require('./lib/auth');
const db = require('./lib/database-multitenant');
const { generateMonitorScript, generateDeploymentInstructions } = require('./lib/script-generator');
const prisma = require('./lib/prisma');

// ============================================
// Session Configuration (add to server.js)
// ============================================

function setupSession(app) {
    const sessionConfig = {
        secret: process.env.SESSION_SECRET || 'your-super-secret-key-change-in-production',
        resave: false,
        saveUninitialized: false,
        proxy: true, // Trust Railway proxy
        cookie: {
            secure: process.env.NODE_ENV === 'production', // HTTPS only in production
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
            sameSite: 'lax' // Allow cookies on redirects
        }
    };
    
    // Use PostgreSQL session store in production
    if (process.env.DATABASE_URL) {
        console.log('Configuring PostgreSQL session store...');
        const pgSession = require('connect-pg-simple')(session);
        sessionConfig.store = new pgSession({
            conString: process.env.DATABASE_URL,
            tableName: 'session',
            createTableIfMissing: true,  // Auto-create session table
            pruneSessionInterval: 60 * 15 // Prune expired sessions every 15 minutes
        });
        
        // Test session store connection
        sessionConfig.store.on('error', (err) => {
            console.error('Session store error:', err);
        });
        
        console.log('PostgreSQL session store configured');
    } else {
        console.log('Using memory session store (development only)');
    }
    
    app.use(session(sessionConfig));
    app.use(auth.attachAccount); // Attach account to all requests if logged in
}

// ============================================
// Authentication Routes
// ============================================

function setupAuthRoutes(app) {
    // Signup page
    app.get('/signup', (req, res) => {
        res.render('signup', { error: null });
    });
    
    // Signup handler
    app.post('/signup', async (req, res) => {
        try {
            const { name, email, password, confirmPassword } = req.body;
            
            // Validation
            if (!name || !email || !password) {
                return res.render('signup', { 
                    error: 'All fields are required' 
                });
            }
            
            if (password !== confirmPassword) {
                return res.render('signup', { 
                    error: 'Passwords do not match' 
                });
            }
            
            if (password.length < 8) {
                return res.render('signup', { 
                    error: 'Password must be at least 8 characters' 
                });
            }
            
            // Create account
            const account = await auth.createAccount(name, email, password);
            
            // Auto-login after signup
            req.session.accountId = account.id;
            req.session.accountEmail = account.email;
            
            res.redirect('/');
        } catch (error) {
            console.error('Signup error:', error);
            res.render('signup', { 
                error: error.message || 'Failed to create account' 
            });
        }
    });
    
    // Login page
    app.get('/login', (req, res) => {
        if (req.session && req.session.accountId) {
            return res.redirect('/');
        }
        res.render('login', { error: null, message: null });
    });
    
    // Login handler
    app.post('/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            
            console.log('Login attempt for email:', email);
            
            if (!email || !password) {
                return res.render('login', { 
                    error: 'Email and password are required',
                    message: null
                });
            }
            
            const account = await auth.authenticateAccount(email, password);
            
            if (!account) {
                console.log('Authentication failed for email:', email);
                return res.render('login', { 
                    error: 'Invalid email or password',
                    message: null
                });
            }
            
            console.log('Authentication successful for account:', account.id);
            
            // Create session
            req.session.accountId = account.id;
            req.session.accountEmail = account.email;
            
            console.log('Session created:', req.session.accountId);
            
            // Save session before redirect
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.render('login', { 
                        error: 'Session error - please try again',
                        message: null
                    });
                }
                
                console.log('Session saved, redirecting to /');
                res.redirect('/');
            });
        } catch (error) {
            console.error('Login error:', error);
            res.render('login', { 
                error: error.message || 'Login failed',
                message: null
            });
        }
    });
    
    // Logout
    app.get('/logout', (req, res) => {
        req.session.destroy((err) => {
            if (err) {
                console.error('Logout error:', err);
            }
            res.redirect('/login');
        });
    });
}

// ============================================
// Account Management Routes
// ============================================

function setupAccountRoutes(app) {
    // Account settings page
    app.get('/account', auth.requireAuth, async (req, res) => {
        try {
            const account = await auth.getAccountById(req.session.accountId);
            const stats = await db.getDatabaseStats(req.session.accountId);
            
            res.render('account', { account, stats });
        } catch (error) {
            console.error('Account page error:', error);
            res.status(500).send('Error loading account page');
        }
    });
    
    // Regenerate API key
    app.post('/api/account/regenerate-key', auth.requireAuth, async (req, res) => {
        try {
            const newApiKey = await auth.regenerateApiKey(req.session.accountId);
            
            res.json({ 
                success: true, 
                apiKey: newApiKey 
            });
        } catch (error) {
            console.error('Regenerate API key error:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Failed to regenerate API key' 
            });
        }
    });
}

// ============================================
// Script Download Routes
// ============================================

function setupScriptRoutes(app) {
    // Download monitor script
    app.get('/download/monitor-script', auth.requireAuth, async (req, res) => {
        try {
            const account = await auth.getAccountById(req.session.accountId);
            // Prefer explicit API_URL, else infer from request protocol/host
            const inferredBaseUrl = `${req.protocol}://${req.get('host')}`;
            const apiUrl = process.env.API_URL || inferredBaseUrl;
            
            const script = generateMonitorScript(account.apiKey, apiUrl);
            
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', 'attachment; filename=Monitor-AdobeUsage.ps1');
            res.send(script);
        } catch (error) {
            console.error('Script download error:', error);
            res.status(500).send('Failed to generate script');
        }
    });
    
    // Download deployment instructions
    app.get('/download/instructions', auth.requireAuth, async (req, res) => {
        try {
            const account = await auth.getAccountById(req.session.accountId);
            const apiUrl = process.env.API_URL || `https://${req.get('host')}`;
            
            const instructions = generateDeploymentInstructions(account.apiKey, apiUrl);
            
            res.setHeader('Content-Type', 'text/markdown');
            res.setHeader('Content-Disposition', 'attachment; filename=DEPLOYMENT-INSTRUCTIONS.md');
            res.send(instructions);
        } catch (error) {
            console.error('Instructions download error:', error);
            res.status(500).send('Failed to generate instructions');
        }
    });
    
    // Download Chrome extension
    app.get('/download/extension', auth.requireAuth, async (req, res) => {
        try {
            const path = require('path');
            const fs = require('fs');
            const archiver = require('archiver');
            
            const extensionPath = path.join(__dirname, '../extension');
            
            // Check if extension folder exists
            if (!fs.existsSync(extensionPath)) {
                return res.status(404).send('Extension files not found');
            }
            
            // Set headers for zip download
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename=adobe-usage-sensor.zip');
            
            // Create zip archive
            const archive = archiver('zip', {
                zlib: { level: 9 } // Maximum compression
            });
            
            // Pipe archive to response
            archive.pipe(res);
            
            // Add files from extension folder
            archive.directory(extensionPath, false, (entry) => {
                // Exclude README.md and any hidden files
                if (entry.name === 'README.md' || entry.name.startsWith('.')) {
                    return false;
                }
                return entry;
            });
            
            // Finalize the archive
            await archive.finalize();
            
        } catch (error) {
            console.error('Extension download error:', error);
            res.status(500).send('Failed to package extension');
        }
    });
}

// ============================================
// API Endpoint for Usage Tracking (API Key Auth)
// ============================================

function setupTrackingAPI(app) {
    // Usage tracking endpoint (PowerShell scripts use this)
    app.post('/api/track', auth.requireApiKey, async (req, res) => {
        try {
            const data = req.body;
            
            // Determine source
            const source = data.why === 'adobe_reader_wrapper' || data.why === 'process_monitor' 
                ? 'wrapper' 
                : 'adobe';
            
            // Save usage event with account association
            await db.addUsageEvent(req.accountId, data, source);
            
            res.json({ 
                success: true, 
                message: 'Usage data recorded' 
            });
        } catch (error) {
            console.error('Track API error:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Failed to save usage data' 
            });
        }
    });
    
    // Health check endpoint
    app.get('/api/health', (req, res) => {
        res.json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            service: 'SubTracker Multi-Tenant API'
        });
    });
}

// ============================================
// Account-Scoped Data Routes (Update Existing)
// ============================================

function setupDataRoutes(app) {
    // Get users (account-scoped)
    app.get('/api/users', auth.requireAuth, async (req, res) => {
        try {
            const usersData = await db.getUsersData(req.session.accountId);
            res.json(usersData);
        } catch (error) {
            console.error('Get users error:', error);
            res.status(500).json({ error: 'Failed to get users' });
        }
    });
    
    // Add user (account-scoped)
    app.post('/api/users', auth.requireAuth, async (req, res) => {
        try {
            const user = await db.createUser(req.session.accountId, req.body);
            res.json({ success: true, user });
        } catch (error) {
            console.error('Add user error:', error);
            res.status(500).json({ error: 'Failed to add user' });
        }
    });
    
    // Update user (account-scoped)
    app.put('/api/users/update', auth.requireAuth, async (req, res) => {
        try {
            const { oldEmail, ...updates } = req.body;
            const user = await db.updateUser(req.session.accountId, oldEmail, updates);
            res.json({ success: true, user });
        } catch (error) {
            console.error('Update user error:', error);
            res.status(500).json({ error: 'Failed to update user' });
        }
    });
    
    // Delete user (account-scoped)
    app.delete('/api/users/:email', auth.requireAuth, async (req, res) => {
        try {
            await db.deleteUser(req.session.accountId, req.params.email);
            res.json({ success: true });
        } catch (error) {
            console.error('Delete user error:', error);
            res.status(500).json({ error: 'Failed to delete user' });
        }
    });
    
    // Delete all users (account-scoped)
    app.delete('/api/users', auth.requireAuth, async (req, res) => {
        try {
            await db.deleteAllUsers(req.session.accountId);
            res.json({ success: true, message: 'All users deleted' });
        } catch (error) {
            console.error('Delete all users error:', error);
            res.status(500).json({ error: 'Failed to delete all users' });
        }
    });

    // Clear all usage data (account-scoped)
    app.delete('/api/usage', auth.requireAuth, async (req, res) => {
        try {
            await prisma.usageEvent.deleteMany({
                where: { accountId: req.session.accountId }
            });
            res.json({ success: true, message: 'Usage data cleared successfully' });
        } catch (error) {
            console.error('Clear usage data error:', error);
            res.status(500).json({ error: 'Failed to clear usage data' });
        }
    });

    // Map a Windows username to a user (account-scoped)
    app.post('/api/users/mapping', auth.requireAuth, async (req, res) => {
        try {
            const accountId = req.session.accountId;
            const { username, email } = req.body || {};
            if (!username || !email) {
                return res.status(400).json({ success: false, error: 'Missing username or email' });
            }

            // Create mapping and remove from unmapped
            await db.addUsernameMapping(accountId, username, email);

            // Retroactively count existing usage events for this username
            const user = await prisma.user.findFirst({ where: { accountId, email } });
            let retroactiveActivity = 0;
            if (user) {
                const events = await prisma.usageEvent.findMany({
                    where: { accountId, windowsUser: username },
                    select: { receivedAt: true },
                    orderBy: { receivedAt: 'desc' }
                });
                retroactiveActivity = events.length;
                if (retroactiveActivity > 0) {
                    await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            activityCount: { increment: retroactiveActivity },
                            lastActivity: events[0]?.receivedAt || user.lastActivity
                        }
                    });
                }
            }

            res.json({ success: true, retroactiveActivity });
        } catch (error) {
            console.error('Map username error:', error);
            res.status(500).json({ success: false, error: 'Failed to map username' });
        }
    });
    
    // Import users from CSV (account-scoped)
    app.post('/api/users/import', auth.requireAuth, async (req, res) => {
        try {
            const multer = require('multer');
            const upload = multer({ storage: multer.memoryStorage() });
            
            // Handle file upload
            upload.single('csvFile')(req, res, async (err) => {
                if (err) {
                    console.error('File upload error:', err);
                    return res.status(400).json({ error: 'File upload failed' });
                }
                
                if (!req.file) {
                    return res.status(400).json({ error: 'No file uploaded' });
                }
                
                try {
                    // Parse CSV using proper CSV parser
                    const { parse } = require('csv-parse/sync');
                    const csvData = req.file.buffer.toString('utf-8');
                    
                    // Parse CSV with proper handling of quoted fields
                    const records = parse(csvData, {
                        columns: true,
                        skip_empty_lines: true,
                        trim: true,
                        relax_quotes: true
                    });
                    
                    if (records.length === 0) {
                        return res.status(400).json({ error: 'CSV file is empty or invalid' });
                    }
                    
                    // Normalize headers
                    const normalizedRecords = records.map(record => {
                        const normalized = {};
                        Object.keys(record).forEach(key => {
                            // Clean BOM and normalize header casing/spaces
                            const cleanedKey = key.replace(/^\uFEFF/, '').trim();
                            const normalizedKey = cleanedKey.toLowerCase().replace(/\s+/g, '_');
                            normalized[normalizedKey] = record[key];
                        });
                        return normalized;
                    });
                    
                    // Validate required columns exist
                    if (normalizedRecords.length > 0) {
                        const firstRecord = normalizedRecords[0];
                        // Accept common variants for the email column
                        const emailKey = ['email','e_mail','user_email','username','upn','user_principal_name']
                            .find(k => k in firstRecord);
                        if (!emailKey) {
                            return res.status(400).json({ 
                                error: 'Missing required column: email' 
                            });
                        }
                        // Normalize to .email for downstream logic
                        normalizedRecords.forEach(r => {
                            if (!r.email) {
                                const key = Object.keys(r).find(k => ['email','e_mail','user_email','username','upn','user_principal_name'].includes(k));
                                if (key) {
                                    r.email = r[key];
                                }
                            }
                        });
                    }
                    
                    let imported = 0;
                    let updated = 0;
                    let errors = 0;
                    
                    // Process each row
                    for (const userData of normalizedRecords) {
                        if (!userData.email || !userData.email.trim()) continue;
                        
                        try {
                            // Check if user exists
                            const existingUsers = await db.getUsersData(req.session.accountId);
                            const existingUser = existingUsers.users.find(u => 
                                u.email.toLowerCase() === userData.email.toLowerCase()
                            );
                            
                            if (existingUser) {
                                // Update existing user
                                const licensesStr = userData.team_products || userData.licenses;
                                const licensesArray = licensesStr ? licensesStr.split(',').map(l => l.trim()).filter(l => l) : existingUser.licenses;
                                
                                const updateData = {
                                    firstName: userData.first_name || userData.firstname || existingUser.firstName,
                                    lastName: userData.last_name || userData.lastname || existingUser.lastName,
                                    licenses: licensesArray,
                                    adminRoles: userData.admin_roles || userData.adminroles || existingUser.adminRoles,
                                    userGroups: userData.user_groups || userData.usergroups || existingUser.userGroups
                                };
                                
                                await db.updateUser(req.session.accountId, userData.email, updateData);
                                updated++;
                            } else {
                                // Create new user
                                const licensesStr = userData.team_products || userData.licenses || '';
                                const licensesArray = licensesStr ? licensesStr.split(',').map(l => l.trim()).filter(l => l) : [];
                                
                                const newUser = {
                                    email: userData.email,
                                    firstName: userData.first_name || userData.firstname || '',
                                    lastName: userData.last_name || userData.lastname || '',
                                    licenses: licensesArray,
                                    adminRoles: userData.admin_roles || userData.adminroles || '',
                                    userGroups: userData.user_groups || userData.usergroups || ''
                                };
                                
                                await db.createUser(req.session.accountId, newUser);
                                imported++;
                            }
                        } catch (userError) {
                            console.error('Error processing user:', userData.email, userError);
                            errors++;
                        }
                    }
                    
                    res.json({ 
                        success: true, 
                        imported, 
                        updated, 
                        errors,
                        total: imported + updated
                    });
                    
                } catch (parseError) {
                    console.error('CSV parse error:', parseError);
                    res.status(400).json({ error: 'Failed to parse CSV file' });
                }
            });
            
        } catch (error) {
            console.error('Import error:', error);
            res.status(500).json({ error: 'Failed to import users' });
        }
    });
    
    // Get usage data (account-scoped)
    app.get('/api/usage', auth.requireAuth, async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 1000;
            const usageData = await db.getUsageData(req.session.accountId, limit);
            res.json(usageData);
        } catch (error) {
            console.error('Get usage error:', error);
            res.status(500).json({ error: 'Failed to get usage data' });
        }
    });
    
    // Get recent activity (account-scoped) - for dashboard
    app.get('/api/usage/recent', auth.requireAuth, async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 100;
            // Returns shape: { adobe: [...], wrapper: [...] }
            const usageData = await db.getUsageData(req.session.accountId, limit);
            res.json({ adobe: usageData.adobe || [], wrapper: usageData.wrapper || [] });
        } catch (error) {
            console.error('Get recent usage error:', error);
            res.status(500).json({ error: 'Failed to get recent activity' });
        }
    });
    
    // Get stats (account-scoped) - for dashboard
    app.get('/api/stats', auth.requireAuth, async (req, res) => {
        try {
            const stats = await db.getDatabaseStats(req.session.accountId);
            const usageData = await db.getUsageData(req.session.accountId, 1000); // { adobe, wrapper }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);

            const allAdobe = usageData.adobe || [];
            const allWrapper = usageData.wrapper || [];

            const adobeToday = allAdobe.filter(e => new Date(e.when || e.receivedAt) >= today).length;
            const wrapperToday = allWrapper.filter(e => new Date(e.when || e.receivedAt) >= today).length;

            const adobeWeek = allAdobe.filter(e => new Date(e.when || e.receivedAt) >= weekAgo).length;
            const wrapperWeek = allWrapper.filter(e => new Date(e.when || e.receivedAt) >= weekAgo).length;

            const uniqueAdobeClients = new Set(allAdobe.map(e => e.clientId || e.tabId)).size;
            const uniqueWrapperClients = new Set(allWrapper.map(e => e.computerName || e.windowsUser)).size;

            res.json({
                adobe: {
                    total: stats.adobeEvents || 0,
                    today: adobeToday,
                    thisWeek: adobeWeek,
                    uniqueClients: uniqueAdobeClients
                },
                wrapper: {
                    total: stats.wrapperEvents || 0,
                    today: wrapperToday,
                    thisWeek: wrapperWeek,
                    uniqueClients: uniqueWrapperClients
                }
            });
        } catch (error) {
            console.error('Get stats error:', error);
            res.status(500).json({ error: 'Failed to get stats' });
        }
    });
}

// ============================================
// Dashboard Routes (Account-Scoped)
// ============================================

function setupDashboardRoutes(app) {
    // Users page (default landing page)
    app.get('/', auth.requireAuth, async (req, res) => {
        try {
            const usersData = await db.getUsersData(req.session.accountId);
            
            res.render('users', { 
                title: 'SubTracker - Users',
                usersData,
                users: usersData.users || [],
                unmappedUsernames: usersData.unmappedUsernames || [],
                account: req.account,
                azureSyncEnabled: false // Disabled for now
            });
        } catch (error) {
            console.error('Users page error:', error);
            res.status(500).send('Error loading users page');
        }
    });
    
    // Activity dashboard (requires auth)
    app.get('/dashboard', auth.requireAuth, async (req, res) => {
        try {
            const usersData = await db.getUsersData(req.session.accountId);
            const stats = await db.getDatabaseStats(req.session.accountId);
            
            res.render('index', { 
                title: 'SubTracker - Dashboard',
                users: usersData.users,
                adobeCount: stats.adobeEvents || 0,
                wrapperCount: stats.wrapperEvents || 0,
                stats,
                account: req.account
            });
        } catch (error) {
            console.error('Dashboard error:', error);
            res.status(500).send('Error loading dashboard');
        }
    });
}

// ============================================
// Main Setup Function
// ============================================

function setupMultiTenantRoutes(app) {
    console.log('Setting up multi-tenant routes...');
    
    setupSession(app);
    setupAuthRoutes(app);
    setupAccountRoutes(app);
    setupScriptRoutes(app);
    setupTrackingAPI(app);
    setupDataRoutes(app);
    setupDashboardRoutes(app);
    
    console.log('✓ Multi-tenant routes configured');
}

module.exports = {
    setupMultiTenantRoutes,
    setupSession,
    setupAuthRoutes,
    setupAccountRoutes,
    setupDownloadRoutes: setupScriptRoutes,  // Alias for consistency
    setupApiRoutes: setupTrackingAPI,  // Alias for consistency
    setupUserManagementRoutes: setupDataRoutes,  // Alias for consistency
    setupDashboardRoutes,
    // Original names for backward compatibility
    setupScriptRoutes,
    setupTrackingAPI,
    setupDataRoutes
};

