// Multi-Tenant Routes Module
// Add these routes to your server.js for multi-tenant functionality

const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const auth = require('./lib/auth');
const db = require('./lib/database-multitenant');
const { generateMonitorScript, generateDeploymentInstructions } = require('./lib/script-generator');
const { generateIntunePackage, getPackageFilename } = require('./lib/intune-package-generator');
const { fetchEntraDirectory, fetchEntraSignIns, fetchEntraApplications } = require('./lib/entra-sync');
const prisma = require('./lib/prisma');

const REQUEST_TIMEOUT_MS = 60000;

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
        console.log('Session store DATABASE_URL:', process.env.DATABASE_URL);
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
            const accountId = req.accountId || req.session.accountId;

            if (!accountId) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
            }

            const newApiKey = await auth.regenerateApiKey(accountId);
            
            res.json({ 
                success: true, 
                apiKey: newApiKey 
            });
        } catch (error) {
            console.error('Regenerate API key error:', error);
            res.status(500).json({ 
                success: false, 
                error: error?.message || 'Failed to regenerate API key' 
            });
        }
    });

    // Initiate Entra admin consent flow
    app.get('/integrations/entra/connect', auth.requireAuth, async (req, res) => {
        try {
            const clientId = process.env.CLIENT_ID;
            if (!clientId) {
                return res.status(500).send('Microsoft 365 integration is not configured. Please contact support.');
            }

            // Generate state token for CSRF protection
            const crypto = require('crypto');
            const state = crypto.randomBytes(16).toString('hex');
            
            // Store state in session
            req.session.entraConsentState = state;
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.status(500).send('Failed to initiate connection');
                }

                // Build admin consent URL
                // Use environment variable if set, otherwise construct dynamically
                let redirectUri;
                if (process.env.ENTRA_REDIRECT_URI) {
                    redirectUri = process.env.ENTRA_REDIRECT_URI;
                } else {
                    // Construct from request (works for both local and production)
                    redirectUri = `${req.protocol}://${req.get('host')}/integrations/entra/callback`;
                }
                const encodedRedirectUri = encodeURIComponent(redirectUri);
                const adminConsentUrl = `https://login.microsoftonline.com/common/adminconsent?` +
                    `client_id=${clientId}&` +
                    `redirect_uri=${encodedRedirectUri}&` +
                    `state=${state}`;

                res.redirect(adminConsentUrl);
            });
        } catch (error) {
            console.error('Entra connect error:', error);
            res.status(500).send('Failed to initiate Microsoft 365 connection');
        }
    });

    // Handle Entra admin consent callback
    app.get('/integrations/entra/callback', auth.requireAuth, async (req, res) => {
        try {
            const { admin_consent, tenant, state, error, error_description } = req.query;

            // Verify state token
            if (!req.session.entraConsentState || req.session.entraConsentState !== state) {
                return res.redirect('/account?error=invalid_state');
            }

            // Clear state from session
            delete req.session.entraConsentState;

            if (error || !admin_consent || admin_consent !== 'True') {
                console.error('Admin consent failed:', error, error_description);
                return res.redirect('/account?error=consent_denied&message=' + encodeURIComponent(error_description || 'Admin consent was denied or cancelled'));
            }

            if (!tenant) {
                return res.redirect('/account?error=no_tenant');
            }

            // Store tenant ID for this account
            const prisma = require('./lib/prisma');
            await prisma.account.update({
                where: { id: req.session.accountId },
                data: {
                    entraTenantId: tenant,
                    entraConnectedAt: new Date()
                }
            });

            res.redirect('/?success=entra_connected');
        } catch (error) {
            console.error('Entra callback error:', error);
            res.redirect('/account?error=callback_failed');
        }
    });

    // Disconnect Entra integration
    app.post('/api/account/entra/disconnect', auth.requireAuth, async (req, res) => {
        try {
            const prisma = require('./lib/prisma');
            await prisma.account.update({
                where: { id: req.session.accountId },
                data: {
                    entraTenantId: null,
                    entraConnectedAt: null,
                    entraLastSyncAt: null
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Disconnect Entra error:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Failed to disconnect Microsoft 365' 
            });
        }
    });

    // Manually trigger Entra sync
    app.post('/api/account/entra/sync', auth.requireAuth, async (req, res) => {
        try {
            const mode = typeof req.query.mode === 'string' ? req.query.mode.toLowerCase() : null;
            const body = req.body || {};
            const targets = Array.isArray(body.targets) ? body.targets.map(t => String(t).toLowerCase()) : null;

            const hasBool = (value) => typeof value === 'boolean';
            const includes = (collection, key) => Array.isArray(collection) && collection.includes(key);

            let includeUsers;
            let includeSignIns;

            if (mode === 'activity') {
                if (hasBool(body.includeUsers)) {
                    includeUsers = body.includeUsers;
                } else {
                    includeUsers = false;
                }
                includeSignIns = true;
            } else if (mode === 'users') {
                includeUsers = true;
                includeSignIns = false;
            } else if (targets) {
                includeUsers = includes(targets, 'users');
                includeSignIns = includes(targets, 'signins') || includes(targets, 'sign-ins') || includes(targets, 'activity');
            } else {
                includeUsers = hasBool(body.includeUsers) ? body.includeUsers : true;
                includeSignIns = hasBool(body.includeSignIns) ? body.includeSignIns : true;
            }

            if (!includeUsers && !includeSignIns) {
                includeSignIns = true; // Always run sign-in sync if nothing explicitly requested
            }

            const runUsersInBackground = includeUsers && (body.backgroundUsers === true || mode === 'activity');

            const results = {
                users: {
                    skipped: !includeUsers,
                    reason: !includeUsers ? 'not-requested' : undefined
                },
                signIns: {
                    skipped: !includeSignIns,
                    reason: !includeSignIns ? 'not-requested' : undefined
                }
            };

            const errors = [];

            if (includeSignIns) {
                try {
                    results.signIns = await db.syncEntraSignInsIfNeeded(req.session.accountId, { force: true });
                } catch (error) {
                    console.error('Manual Entra sign-in sync error:', error);
                    const message = error?.message || error?.code || 'Failed to sync sign-in logs';
                    results.signIns = {
                        synced: false,
                        error: message
                    };
                    errors.push(`sign-ins: ${message}`);
                }
            }

            if (includeUsers) {
                if (runUsersInBackground) {
                    results.users = {
                        synced: false,
                        queued: true,
                        message: 'User sync running in background'
                    };

                    // Fire-and-forget background user sync
                    db.syncEntraUsersIfNeeded(req.session.accountId, { force: true })
                        .then((userResult) => {
                            console.log('Background Entra user sync completed:', {
                                synced: userResult?.synced,
                                count: userResult?.count,
                                lastSync: userResult?.lastSync
                            });
                        })
                        .catch((error) => {
                            console.error('Background Entra user sync failed:', error);
                        });
                } else {
                    try {
                        results.users = await db.syncEntraUsersIfNeeded(req.session.accountId, { force: true });
                    } catch (error) {
                        console.error('Manual Entra user sync error:', error);
                        const message = error?.message || error?.code || 'Failed to sync directory users';
                        results.users = {
                            synced: false,
                            error: message
                        };
                        errors.push(`users: ${message}`);
                    }
                }
            }

            const requestedOperations =
                (includeSignIns ? 1 : 0) +
                (includeUsers && !runUsersInBackground ? 1 : 0);
            const failedOperations = errors.length;

            if (requestedOperations > 0 && failedOperations === requestedOperations) {
                return res.status(400).json({
                    success: false,
                    error: errors.join('; '),
                    users: results.users,
                    signIns: results.signIns
                });
            }

            res.json({
                success: true,
                users: results.users,
                signIns: results.signIns
            });
        } catch (error) {
            console.error('Manual Entra sync error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to sync Microsoft 365 directory'
            });
        }
    });
}

// ============================================
// Script Download Routes
// ============================================

function setupScriptRoutes(app) {
    // Download monitor script for testing (5-second intervals)
    app.get('/download/monitor-script-testing', auth.requireAuth, async (req, res) => {
        try {
            const account = await auth.getAccountById(req.session.accountId);
            // Prefer explicit API_URL, else infer from request protocol/host
            const inferredBaseUrl = `${req.protocol}://${req.get('host')}`;
            const apiUrl = process.env.API_URL || inferredBaseUrl;

            // Force testing mode for 5-second intervals
            let script = generateMonitorScript(account.apiKey, apiUrl, 'testing');

            // Normalize all line endings to Windows format (CRLF)
            // First normalize to LF, then convert to CRLF
            script = script.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');

            // Create buffer with UTF-8 BOM for Windows compatibility
            const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
            const scriptBuffer = Buffer.concat([bom, Buffer.from(script, 'utf8')]);

            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment; filename=Monitor-AdobeUsage-Testing.ps1');
            res.setHeader('Content-Length', scriptBuffer.length);
            res.send(scriptBuffer);
        } catch (error) {
            console.error('Script download error:', error);
            res.status(500).send('Failed to generate script');
        }
    });

    // Download monitor script (always 5-second intervals for testing)
    app.get('/download/monitor-script', auth.requireAuth, async (req, res) => {
        try {
            const account = await auth.getAccountById(req.session.accountId);
            // Prefer explicit API_URL, else infer from request protocol/host
            const inferredBaseUrl = `${req.protocol}://${req.get('host')}`;
            const apiUrl = process.env.API_URL || inferredBaseUrl;

            // Always use testing mode for simple script (5-second intervals)
            let script = generateMonitorScript(account.apiKey, apiUrl, 'testing');

            // Normalize all line endings to Windows format (CRLF)
            // First normalize to LF, then convert to CRLF
            script = script.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');

            // Create buffer with UTF-8 BOM for Windows compatibility
            const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
            const scriptBuffer = Buffer.concat([bom, Buffer.from(script, 'utf8')]);

            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment; filename=Monitor-AdobeUsage.ps1');
            res.setHeader('Content-Length', scriptBuffer.length);
            res.send(scriptBuffer);
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

            // Ensure proper Windows line endings
            const instructionsBuffer = Buffer.from(instructions.replace(/\n/g, '\r\n'), 'utf8');

            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename=DEPLOYMENT-INSTRUCTIONS.md');
            res.send(instructionsBuffer);
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

    // Download Intune deployment package (production - 5-minute intervals)
    app.get('/download/intune-package', auth.requireAuth, async (req, res) => {
        try {
            const account = await auth.getAccountById(req.session.accountId);

            // Prefer explicit API_URL, else infer from request protocol/host
            const inferredBaseUrl = `${req.protocol}://${req.get('host')}`;
            const apiUrl = process.env.API_URL || inferredBaseUrl;

            console.log('Generating Intune package (production) for account:', account.name);

            // Generate ZIP package with production intervals (5 minutes)
            const packageBuffer = await generateIntunePackage(account, apiUrl, 'production');

            // Get suggested filename
            const filename = getPackageFilename(account, 'production');

            console.log('Intune package (production) generated successfully:', filename);

            // Send ZIP file
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
            res.setHeader('Content-Length', packageBuffer.length);
            res.send(packageBuffer);

        } catch (error) {
            console.error('Intune package download error:', error);
            res.status(500).send('Failed to generate Intune package');
        }
    });

    // Download Intune deployment package (testing - 5-second intervals)
    app.get('/download/intune-package-testing', auth.requireAuth, async (req, res) => {
        try {
            const account = await auth.getAccountById(req.session.accountId);

            // Prefer explicit API_URL, else infer from request protocol/host
            const inferredBaseUrl = `${req.protocol}://${req.get('host')}`;
            const apiUrl = process.env.API_URL || inferredBaseUrl;

            console.log('Generating Intune package (testing) for account:', account.name);

            // Generate ZIP package with testing intervals (5 seconds)
            const packageBuffer = await generateIntunePackage(account, apiUrl, 'testing');

            // Get suggested filename
            const filename = getPackageFilename(account, 'testing');

            console.log('Intune package (testing) generated successfully:', filename);

            // Send ZIP file
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
            res.setHeader('Content-Length', packageBuffer.length);
            res.send(packageBuffer);

        } catch (error) {
            console.error('Intune package download error:', error);
            res.status(500).send('Failed to generate Intune package');
        }
    });
}

// ============================================
// API Endpoint for Usage Tracking (API Key Auth)
// ============================================

function setupTrackingAPI(app) {
    // Rate limiter for tracking endpoint
    // Prevents abuse, infinite loops, and excessive API calls
    // Applied AFTER auth so we can rate limit per account, not just per IP
    const trackingLimiter = rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute window
        max: 100, // Max 100 requests per minute per account
        message: {
            success: false,
            error: 'Too many tracking requests. Please wait a moment and try again.',
            retryAfter: '60 seconds'
        },
        standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
        legacyHeaders: false, // Disable `X-RateLimit-*` headers
        // Use account ID as the identifier (set by auth.requireApiKey middleware)
        // Since this runs after auth, req.accountId will always be set
        keyGenerator: (req) => {
            return req.accountId; // Always use accountId (set by auth middleware)
        }
    });

    // Usage tracking endpoint (PowerShell scripts use this)
    // Auth first (sets req.accountId), then rate limit by account, then process request
    app.post('/api/track', auth.requireApiKey, trackingLimiter, async (req, res) => {
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
// Developer Diagnostics Routes
// ============================================

function setupDevRoutes(app) {
    async function resolveAccount(req) {
        if (req.account) {
            return req.account;
        }
        if (req.session?.accountId) {
            return await auth.getAccountById(req.session.accountId);
        }
        return null;
    }

    function ensureGraphReady(account) {
        if (!db.isEntraConfigured()) {
            return { error: 'Graph API credentials are not configured on this server.' };
        }
        if (!account?.entraTenantId) {
            return { error: 'This account is not connected to Microsoft 365 (Entra ID).' };
        }
        return { tenantId: account.entraTenantId };
    }

    app.get('/dev', auth.requireAuth, async (req, res) => {
        try {
            const account = await resolveAccount(req);
            res.render('dev', {
                title: 'Dev Diagnostics',
                graphConfigured: db.isEntraConfigured(),
                tenantConfigured: !!account?.entraTenantId,
                account
            });
        } catch (error) {
            console.error('Dev diagnostics page error:', error);
            res.status(500).send('Failed to load Dev diagnostics');
        }
    });

    app.get('/api/dev/graph/users', auth.requireAuth, async (req, res) => {
        try {
            const account = await resolveAccount(req);
            const graphState = ensureGraphReady(account);
            if (graphState.error) {
                return res.status(400).json({ success: false, error: graphState.error });
            }

            const limit = Number.parseInt(req.query.limit, 10) || 10;
            const force = req.query.force === 'true';
            const start = Date.now();

            if (force) {
                await db.syncEntraUsersIfNeeded(account.id, { force: true });
            }

            const result = await fetchEntraDirectory(graphState.tenantId, { limit });
            const duration = Date.now() - start;

            res.json({
                success: true,
                requestedAt: new Date(start),
                durationMs: duration,
                command: `GET /users?$top=${limit}&$select=id,displayName,givenName,surname,mail,userPrincipalName,accountEnabled,assignedLicenses`,
                params: { limit, force },
                data: result.users,
                meta: {
                    fetchedAt: result.fetchedAt,
                    totalReturned: result.users.length
                }
            });
        } catch (error) {
            console.error('Dev users fetch error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to fetch users' });
        }
    });

    app.get('/api/dev/graph/apps', auth.requireAuth, async (req, res) => {
        try {
            const account = await resolveAccount(req);
            const graphState = ensureGraphReady(account);
            if (graphState.error) {
                return res.status(400).json({ success: false, error: graphState.error });
            }

            const limit = Number.parseInt(req.query.limit, 10) || 10;
            const start = Date.now();
            const result = await fetchEntraApplications(graphState.tenantId, { limit });
            const duration = Date.now() - start;

            res.json({
                success: true,
                requestedAt: new Date(start),
                durationMs: duration,
                command: `GET /servicePrincipals?$top=${limit}&$select=id,displayName,appId,appOwnerOrganizationId,createdDateTime,servicePrincipalType,publisherName,tags&$orderby=createdDateTime desc`,
                params: { limit },
                data: result.apps,
                meta: {
                    fetchedAt: result.fetchedAt,
                    totalReturned: result.apps.length,
                    nextLink: result.nextLink
                }
            });
        } catch (error) {
            console.error('Dev apps fetch error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to fetch apps' });
        }
    });

    app.get('/api/dev/graph/activity', auth.requireAuth, async (req, res) => {
        try {
            const account = await resolveAccount(req);
            const graphState = ensureGraphReady(account);
            if (graphState.error) {
                return res.status(400).json({ success: false, error: graphState.error });
            }

            const limit = Number.parseInt(req.query.limit, 10) || 10;
            const hours = Number.parseInt(req.query.hours, 10) || 24;
            const force = req.query.force === 'true';

            const sinceDate = new Date(Date.now() - hours * 60 * 60 * 1000);
            const start = Date.now();

            if (force) {
                await db.syncEntraSignInsIfNeeded(account.id, { force: true });
            }

            // For Dev view, don't pass 'since' to match Graph Explorer behavior
            const result = await fetchEntraSignIns(graphState.tenantId, {
                top: limit,
                maxPages: 1
            });
            const duration = Date.now() - start;
            const events = Array.isArray(result.events) ? result.events.slice(0, limit) : [];

            res.json({
                success: true,
                requestedAt: new Date(start),
                durationMs: duration,
                command: `GET /auditLogs/signIns?$top=${limit}&$orderby=createdDateTime desc${sinceDate ? `&$filter=createdDateTime ge ${sinceDate.toISOString()}` : ''}`,
                params: { limit, hours, force },
                data: events,
                meta: {
                    fetchedAt: new Date(),
                    latestTimestamp: result.latestTimestamp || null,
                    totalReturned: events.length
                }
            });
        } catch (error) {
            console.error('Dev activity fetch error:', error);
            
            // Provide more detailed error information
            const errorResponse = {
                success: false,
                error: error.message || 'Failed to fetch activity',
                errorCode: error.statusCode || error.code,
                details: {}
            };

            // Check for permission errors
            if (error.statusCode === 403 || error.code === 'Forbidden') {
                errorResponse.error = 'Permission denied: Admin consent required for AuditLog.Read.All';
                errorResponse.details = {
                    reason: 'The application does not have admin consent for AuditLog.Read.All permission',
                    solution: 'Go to Azure Portal → App Registrations → Your App → API Permissions → Grant admin consent'
                };
            }

            res.status(error.statusCode || 500).json(errorResponse);
        }
    });
}

// ============================================
// Account-Scoped Data Routes (Update Existing)
// ============================================

function setupDataRoutes(app) {
    // Get users (account-scoped)
    app.get('/api/users', auth.requireAuth, async (req, res) => {
        try {
            const syncResult = await db.syncEntraUsersIfNeeded(req.session.accountId);
            const usersData = await db.getUsersData(req.session.accountId);
            res.json({
                ...usersData,
                entraSync: syncResult,
                entraSyncEnabled: db.isEntraConfigured()
            });
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

    // Merge users (account-scoped)
    // IMPORTANT: This route must be defined BEFORE app.delete('/api/users') to avoid route conflicts
    app.post('/api/users/merge', auth.requireAuth, async (req, res) => {
        console.log('Merge users endpoint called:', { targetEmail: req.body.targetEmail, sourceEmails: req.body.sourceEmails });
        try {
            const { targetEmail, sourceEmails } = req.body;
            
            if (!targetEmail || !sourceEmails || !Array.isArray(sourceEmails) || sourceEmails.length === 0) {
                return res.status(400).json({ error: 'targetEmail and sourceEmails array are required' });
            }
            
            const result = await db.mergeUsers(req.session.accountId, targetEmail, sourceEmails);
            res.json({ success: true, ...result });
        } catch (error) {
            console.error('Merge users error:', error);
            res.status(500).json({ error: 'Failed to merge users: ' + error.message });
        }
    });

    // Bulk delete users (account-scoped)
    app.delete('/api/users/bulk', auth.requireAuth, async (req, res) => {
        try {
            const { emails } = req.body;
            
            if (!emails || !Array.isArray(emails) || emails.length === 0) {
                return res.status(400).json({ error: 'emails array is required' });
            }
            
            const deletedCount = await db.deleteUsersBulk(req.session.accountId, emails);
            res.json({ success: true, deletedCount });
        } catch (error) {
            console.error('Bulk delete users error:', error);
            res.status(500).json({ error: 'Failed to delete users: ' + error.message });
        }
    });

    // Clear all usage data (account-scoped)
    app.delete('/api/usage', auth.requireAuth, async (req, res) => {
        try {
            await db.deleteAllUsageEvents(req.session.accountId);
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
            await db.syncEntraSignInsIfNeeded(req.session.accountId);
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

            const forceBackfill = req.query.forceBackfill === 'true';
            const backfillHours = Number.parseInt(req.query.backfillHours, 10) || 24;
            const syncOptions = forceBackfill
                ? { force: true, backfillHours, maxPages: 5 }
                : {};

            const syncStart = Date.now();
            let timeoutId;
            const syncPromise = db.syncEntraSignInsIfNeeded(req.session.accountId, syncOptions)
                .then(result => ({ ...result, error: false }))
                .catch(error => {
                    console.warn('Entra sync failed (non-fatal):', error);
                    const isGraphThrottle = error?.statusCode === 429 || error?.code === 'TooManyRequests';
                    return {
                        error: true,
                        reason: isGraphThrottle ? 'graph-throttled' : (error.reason || 'error'),
                        message: isGraphThrottle ? 'Microsoft Graph returned 429 (Too Many Requests).' : (error.message || 'Failed to sync Microsoft Entra sign-ins'),
                        statusCode: error?.statusCode
                    };
                });
            const timeoutPromise = new Promise((resolve) => {
                timeoutId = setTimeout(() => resolve({
                    error: true,
                    reason: 'timeout',
                    message: `Sync exceeded ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s`
                }), REQUEST_TIMEOUT_MS);
            });

            try {
                var syncOutcome = await Promise.race([syncPromise, timeoutPromise]);
            } catch (syncError) {
                // Log sync error but don't fail the entire request
                console.warn('Entra sync failed (non-fatal):', syncError?.message || syncError);
                syncOutcome = {
                    error: true,
                    reason: (syncError?.statusCode === 429 ? 'graph-throttled' : (syncError?.reason || 'error')),
                    message: (syncError?.statusCode === 429 ? 'Microsoft Graph returned 429 (Too Many Requests).' : (syncError?.message || 'Failed to sync Microsoft Entra sign-ins')),
                    statusCode: syncError?.statusCode
                };
            } finally {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            }
            const syncDuration = Date.now() - syncStart;
            
            // Returns shape: { adobe: [...], wrapper: [...], entra: [...] }
            const usageData = await db.getUsageData(req.session.accountId, limit);
            res.json({ 
                adobe: usageData.adobe || [], 
                wrapper: usageData.wrapper || [],
                entra: usageData.entra || [],
                meta: {
                    sync: syncOutcome,
                    durationMs: syncDuration,
                    forceBackfill,
                    totalEvents: {
                        adobe: usageData.adobe?.length || 0,
                        wrapper: usageData.wrapper?.length || 0,
                        entra: usageData.entra?.length || 0
                    }
                }
            });
        } catch (error) {
            console.error('Get recent usage error:', error);
            res.status(500).json({ error: 'Failed to get recent activity' });
        }
    });
    
    // Get stats (account-scoped) - for dashboard
    app.get('/api/stats', auth.requireAuth, async (req, res) => {
        try {
            const forceBackfill = req.query.forceBackfill === 'true';
            const backfillHours = Number.parseInt(req.query.backfillHours, 10) || 24;
            const syncOptions = forceBackfill
                ? { force: true, backfillHours, maxPages: 5 }
                : {};

            const syncStart = Date.now();
            let timeoutId;
            const syncPromise = db.syncEntraSignInsIfNeeded(req.session.accountId, syncOptions)
                .then(result => ({ ...result, error: false }))
                .catch(error => {
                    console.warn('Entra stats sync failed (non-fatal):', error);
                    return {
                        error: true,
                        reason: error.reason || 'error',
                        message: error.message || 'Failed to sync Microsoft Entra sign-ins'
                    };
                });
            const timeoutPromise = new Promise((resolve) => {
                timeoutId = setTimeout(() => resolve({
                    error: true,
                    reason: 'timeout',
                    message: `Sync exceeded ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s`
                }), REQUEST_TIMEOUT_MS);
            });

            try {
                var syncOutcome = await Promise.race([syncPromise, timeoutPromise]);
            } catch (syncError) {
                console.warn('Entra sync failed (non-fatal):', syncError?.message || syncError);
                syncOutcome = {
                    error: true,
                    reason: syncError?.reason || 'error',
                    message: syncError?.message || 'Failed to sync Microsoft Entra sign-ins'
                };
            } finally {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            }
            const syncDuration = Date.now() - syncStart;
            
            const stats = await db.getDatabaseStats(req.session.accountId);
            const usageData = await db.getUsageData(req.session.accountId, 1000); // { adobe, wrapper }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);

            const allAdobe = usageData.adobe || [];
            const allWrapper = usageData.wrapper || [];
            const allEntra = usageData.entra || [];

            const adobeToday = allAdobe.filter(e => new Date(e.when || e.receivedAt) >= today).length;
            const wrapperToday = allWrapper.filter(e => new Date(e.when || e.receivedAt) >= today).length;
            const entraToday = allEntra.filter(e => new Date(e.when || e.receivedAt) >= today).length;

            const adobeWeek = allAdobe.filter(e => new Date(e.when || e.receivedAt) >= weekAgo).length;
            const wrapperWeek = allWrapper.filter(e => new Date(e.when || e.receivedAt) >= weekAgo).length;
            const entraWeek = allEntra.filter(e => new Date(e.when || e.receivedAt) >= weekAgo).length;

            const uniqueAdobeClients = new Set(allAdobe.map(e => e.clientId || e.tabId)).size;
            const uniqueWrapperClients = new Set(allWrapper.map(e => e.computerName || e.windowsUser)).size;
            const uniqueEntraDevices = new Set(allEntra.map(e => e.computerName || e.windowsUser || e.userPrincipalName || e.ipAddress)).size;

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
                },
                entra: {
                    total: stats.signInEvents || 0,
                    today: entraToday,
                    thisWeek: entraWeek,
                    uniqueClients: uniqueEntraDevices
                },
                meta: {
                    sync: syncOutcome,
                    durationMs: syncDuration,
                    forceBackfill
                }
            });
        } catch (error) {
            console.error('Get stats error:', error);
            res.status(500).json({ error: 'Failed to get stats' });
        }
    });

    // Get all detected licenses (account-scoped)
    app.get('/api/licenses', auth.requireAuth, async (req, res) => {
        try {
            const prisma = require('./lib/prisma');
            const account = await prisma.account.findUnique({
                where: { id: req.session.accountId },
                select: { hiddenLicenses: true }
            });

            // Get all unique licenses from users
            const users = await prisma.user.findMany({
                where: { accountId: req.session.accountId },
                select: { licenses: true, entraLicenses: true }
            });

            const allLicenses = new Set();
            users.forEach(user => {
                if (user.licenses && Array.isArray(user.licenses)) {
                    user.licenses.forEach(license => allLicenses.add(license));
                }
                if (user.entraLicenses && Array.isArray(user.entraLicenses)) {
                    user.entraLicenses.forEach(license => allLicenses.add(license));
                }
            });

            const hiddenLicenses = account?.hiddenLicenses || [];
            const licensesList = Array.from(allLicenses).sort().map(license => ({
                name: license,
                hidden: hiddenLicenses.includes(license)
            }));

            res.json({ success: true, licenses: licensesList, hiddenLicenses });
        } catch (error) {
            console.error('Get licenses error:', error);
            res.status(500).json({ error: 'Failed to get licenses' });
        }
    });

    // Hide a license
    app.post('/api/licenses/hide', auth.requireAuth, async (req, res) => {
        try {
            const { license } = req.body;
            if (!license) {
                return res.status(400).json({ error: 'License name is required' });
            }

            const prisma = require('./lib/prisma');
            const account = await prisma.account.findUnique({
                where: { id: req.session.accountId },
                select: { hiddenLicenses: true }
            });

            const hiddenLicenses = account?.hiddenLicenses || [];
            if (!hiddenLicenses.includes(license)) {
                await prisma.account.update({
                    where: { id: req.session.accountId },
                    data: {
                        hiddenLicenses: [...hiddenLicenses, license]
                    }
                });
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Hide license error:', error);
            res.status(500).json({ error: 'Failed to hide license' });
        }
    });

    // Show a license (unhide)
    app.post('/api/licenses/show', auth.requireAuth, async (req, res) => {
        try {
            const { license } = req.body;
            if (!license) {
                return res.status(400).json({ error: 'License name is required' });
            }

            const prisma = require('./lib/prisma');
            const account = await prisma.account.findUnique({
                where: { id: req.session.accountId },
                select: { hiddenLicenses: true }
            });

            const hiddenLicenses = (account?.hiddenLicenses || []).filter(l => l !== license);
            await prisma.account.update({
                where: { id: req.session.accountId },
                data: {
                    hiddenLicenses: hiddenLicenses
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Show license error:', error);
            res.status(500).json({ error: 'Failed to show license' });
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
            const account = await auth.getAccountById(req.session.accountId);
            const syncResult = await db.syncEntraUsersIfNeeded(req.session.accountId);
            const usersData = await db.getUsersData(req.session.accountId);
            
            res.render('users', { 
                title: 'SubTracker - Users',
                usersData,
                users: usersData.users || [],
                unmappedUsernames: usersData.unmappedUsernames || [],
                account: req.account,
                azureSyncEnabled: db.isEntraConfigured() && !!account.entraTenantId,
                entraSync: syncResult
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

    // User Activity Detail Page
    app.get('/user/:email/activity', auth.requireAuth, async (req, res) => {
        try {
            const userEmail = decodeURIComponent(req.params.email);
            const accountId = req.session.accountId;

            const { user, activity } = await db.getUserActivityData(accountId, userEmail);

            if (!user) {
                return res.status(404).send('User not found or you do not have access to this user.');
            }

            res.render('user-activity', {
                title: `Activity - ${user.firstName} ${user.lastName}`,
                user,
                activity
            });
        } catch (error) {
            console.error('User activity error:', error);
            res.status(500).send('Error loading user activity');
        }
    });
}

// ============================================
// Apps Routes (Account-Scoped)
// ============================================

function setupAppsRoutes(app) {
    // Apps page
    app.get('/apps', auth.requireAuth, auth.attachAccount, async (req, res) => {
        try {
            const appsData = await db.getAppsData(req.session.accountId);
            res.render('apps', {
                title: 'SubTracker - Applications',
                apps: appsData.apps || [],
                stats: appsData.stats || {},
                account: req.account
            });
        } catch (error) {
            console.error('Apps page error:', error);
            res.status(500).send('Error loading apps page');
        }
    });

    // Get apps API endpoint
    app.get('/api/apps', auth.requireAuth, async (req, res) => {
        try {
            const appsData = await db.getAppsData(req.session.accountId);
            res.json(appsData);
        } catch (error) {
            console.error('Get apps error:', error);
            res.status(500).json({ error: 'Failed to get apps' });
        }
    });

    app.post('/api/apps/sync', auth.requireAuth, async (req, res) => {
        const backfillHours = Number.parseInt(req.body?.backfillHours, 10) || 24;
        let syncResult;

        try {
            syncResult = await db.syncEntraSignInsIfNeeded(req.session.accountId, {
                force: true,
                backfillHours,
                maxPages: 5
            });
            if (!syncResult) {
                syncResult = { synced: false, reason: 'unknown' };
            }
        } catch (error) {
            console.warn('Apps sync encountered error:', error);
            const isGraphThrottle = error?.statusCode === 429 || error?.code === 'TooManyRequests';
            syncResult = {
                error: true,
                reason: isGraphThrottle ? 'graph-throttled' : (error?.reason || 'error'),
                message: isGraphThrottle
                    ? 'Microsoft Graph returned 429 (Too Many Requests).'
                    : (error?.message || 'Failed to sync Microsoft Entra sign-ins'),
                statusCode: error?.statusCode
            };
        }

        try {
            const appsData = await db.getAppsData(req.session.accountId);
            res.json({
                success: true,
                sync: syncResult,
                apps: appsData.apps || [],
                stats: appsData.stats || {}
            });
        } catch (error) {
            console.error('Apps sync aggregation error:', error);
            res.status(500).json({
                error: 'Failed to refresh applications after sync',
                sync: syncResult
            });
        }
    });

    app.post('/api/apps/merge', auth.requireAuth, async (req, res) => {
        try {
            const { target, sources, vendor, name, licensesOwned } = req.body || {};

            if (!target) {
                return res.status(400).json({ error: 'Target application is required' });
            }
            if (!Array.isArray(sources) || sources.length === 0) {
                return res.status(400).json({ error: 'Select at least two applications to merge' });
            }

            const mergeResult = await db.mergeApps(req.session.accountId, target, sources, {
                vendor,
                name,
                licensesOwned
            });

            const appsData = await db.getAppsData(req.session.accountId);

            res.json({
                success: true,
                merged: mergeResult,
                apps: appsData.apps || [],
                stats: appsData.stats || {}
            });
        } catch (error) {
            console.error('Merge apps error:', error);
            res.status(500).json({ error: error.message || 'Failed to merge applications' });
        }
    });

    // Create app
    app.post('/api/apps', auth.requireAuth, async (req, res) => {
        try {
            const app = await db.createApp(req.session.accountId, req.body);
            res.json(app);
        } catch (error) {
            console.error('Create app error:', error);
            res.status(500).json({ error: 'Failed to create app' });
        }
    });

    // Update app
    app.put('/api/apps/:id', auth.requireAuth, async (req, res) => {
        try {
            const app = await db.updateApp(req.session.accountId, req.params.id, req.body);
            res.json(app);
        } catch (error) {
            console.error('Update app error:', error);
            res.status(500).json({ error: 'Failed to update app' });
        }
    });

    // Create or update override for auto-detected app
    app.post('/api/apps/override', auth.requireAuth, async (req, res) => {
        try {
            const { sourceKey, vendor, name, licensesOwned } = req.body || {};

            if (!sourceKey || !vendor || !name) {
                return res.status(400).json({ error: 'sourceKey, vendor, and name are required' });
            }

            const override = await db.upsertAppOverride(req.session.accountId, sourceKey, {
                vendor,
                name,
                licensesOwned
            });

            res.json({ success: true, override });
        } catch (error) {
            console.error('Upsert app override error:', error);
            res.status(500).json({ error: 'Failed to update app' });
        }
    });

    // Hide application from listing
    app.post('/api/apps/hide', auth.requireAuth, async (req, res) => {
        try {
            const { id, sourceKey, vendor, name, licensesOwned } = req.body || {};

            if (id) {
                await db.hideApp(req.session.accountId, { id });
            } else if (sourceKey) {
                if (!vendor || !name) {
                    return res.status(400).json({ error: 'vendor and name required when hiding detected apps' });
                }

                await db.hideApp(req.session.accountId, {
                    sourceKey,
                    vendor,
                    name,
                    licensesOwned
                });
            } else {
                return res.status(400).json({ error: 'id or sourceKey required' });
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Hide app error:', error);
            res.status(500).json({ error: 'Failed to hide app' });
        }
    });

    app.delete('/api/apps/bulk', auth.requireAuth, async (req, res) => {
        try {
            const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];

            if (entries.length === 0) {
                return res.status(400).json({ success: false, error: 'No applications specified' });
            }

            const result = await db.deleteAppsBatch(req.session.accountId, entries);

            const hasErrors = result.errors.length > 0;

            res.json({
                success: !hasErrors,
                manualDeleted: result.manualDeleted,
                overridesHidden: result.overridesHidden,
                errors: result.errors,
                error: hasErrors ? 'Some applications could not be removed.' : undefined
            });
        } catch (error) {
            console.error('Bulk delete apps error:', error);
            res.status(500).json({ success: false, error: error.message || 'Failed to delete applications' });
        }
    });

    // Delete app
    app.delete('/api/apps/:id', auth.requireAuth, async (req, res) => {
        try {
            await db.deleteApp(req.session.accountId, req.params.id);
            res.json({ success: true });
        } catch (error) {
            console.error('Delete app error:', error);
            res.status(500).json({ error: 'Failed to delete app' });
        }
    });

    // Delete all apps
    app.delete('/api/apps', auth.requireAuth, async (req, res) => {
        try {
            await db.deleteAllApps(req.session.accountId);
            res.json({ success: true });
        } catch (error) {
            console.error('Delete all apps error:', error);
            res.status(500).json({ error: 'Failed to delete all apps' });
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
    setupDevRoutes(app);
    setupDashboardRoutes(app);
    setupAppsRoutes(app);

    console.log('✓ Multi-tenant routes configured');
}

module.exports = {
    setupMultiTenantRoutes,
    setupSession,
    setupAuthRoutes,
    setupAccountRoutes,
    setupDevRoutes,
    setupDownloadRoutes: setupScriptRoutes,  // Alias for consistency
    setupApiRoutes: setupTrackingAPI,  // Alias for consistency
    setupUserManagementRoutes: setupDataRoutes,  // Alias for consistency
    setupDashboardRoutes,
    setupAppsRoutes,
    // Original names for backward compatibility
    setupScriptRoutes,
    setupTrackingAPI,
    setupDataRoutes
};

