// Multi-Tenant Routes Module
// Add these routes to your server.js for multi-tenant functionality

const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const auth = require('./lib/auth');
const db = require('./lib/database-multitenant');
const { generateMonitorScript, generateDeploymentInstructions } = require('./lib/script-generator');
const { generateIntunePackage, getPackageFilename } = require('./lib/intune-package-generator');
const { generateInstallerPackage } = require('./lib/msi-generator');
const { fetchEntraDirectory, fetchEntraSignIns, fetchEntraApplications } = require('./lib/entra-sync');
const prisma = require('./lib/prisma');
const {
    loginLimiter,
    signupLimiter,
    signupValidation,
    loginValidation,
    forgotPasswordValidation,
    resetPasswordValidation,
    handleValidationErrors,
    auditLog,
    generateSecureToken
} = require('./lib/security');
const { sendSurveyEmail, sendVerificationEmail, sendPasswordResetEmail, sendMfaEmail, SURVEY_EMAIL_REGEX } = require('./lib/email-sender');
const multer = require('multer');
const path = require('path');
const { extractFromDocument, processMultipleAttachments, isSupportedFileType, getMimeTypeFromFilename } = require('./lib/document-extractor');
const partnerDb = require('./lib/partner-database');
const headlessManager = require('./lib/headless-manager');


/**
 * Sanitize text for PostgreSQL UTF-8 storage
 * Removes null bytes and other problematic characters from PDF extraction
 */
function sanitizeTextForDb(text) {
    if (!text) return null;
    return text
        .replace(/\x00/g, '')  // Remove null bytes
        .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, ' ')  // Replace other control chars with space
        .trim();
}

/**
 * Escape a field value for CSV export
 * Handles commas, quotes, and newlines per RFC 4180
 */
function escapeCsvField(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    // If the field contains comma, quote, or newline, wrap in quotes and escape internal quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// Configure multer for file uploads
const uploadStorage = multer.memoryStorage();
const upload = multer({
    storage: uploadStorage,
    limits: {
        fileSize: 30 * 1024 * 1024, // 30MB max file size
        files: 10 // Max 10 files per upload
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/pdf',
            'image/png',
            'image/jpeg',
            'image/jpg',
            'image/gif',
            'image/webp',
            'text/plain'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
        }
    }
});

const REQUEST_TIMEOUT_MS = 180000; // 3 minutes to allow for Graph API calls that can take up to 2 minutes
const surveySubmissionLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            message: 'Too many survey submissions. Please try again later.'
        });
    }
});

// Global sync status tracking
const activeSyncs = new Map();

// Performance: Simple in-memory cache for stats (30 second TTL)
const statsCache = new Map();
const STATS_CACHE_TTL_MS = 30000; // 30 seconds

// ============================================
// Session Configuration (add to server.js)
// ============================================

function setupSession(app) {
    // Require SESSION_SECRET in all environments
    if (!process.env.SESSION_SECRET) {
        throw new Error('SESSION_SECRET environment variable is required. Generate one with: openssl rand -hex 32');
    }

    const sessionConfig = {
        secret: process.env.SESSION_SECRET,
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

    // Export session store for Socket.IO authentication
    return sessionConfig.store;
}

// ============================================
// Authentication Routes
// ============================================

/**
 * @openapi
 * components:
 *   schemas:
 *     Account:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         email:
 *           type: string
 *     Error:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: Error description
 */

function setupAuthRoutes(app) {
    /**
     * @openapi
     * /signup:
     *   get:
     *     summary: Render signup page
     *     tags: [Authentication]
     *     responses:
     *       200:
     *         description: Signup page rendered
     */
    // Signup page
    app.get('/signup', (req, res) => {
        res.render('signup', { error: null });
    });

    // Signup handler with rate limiting and validation
    /**
     * @openapi
     * /signup:
     *   post:
     *     summary: Register a new account
     *     tags: [Authentication]
     *     requestBody:
     *       required: true
     *       content:
     *         application/x-www-form-urlencoded:
     *           schema:
     *             type: object
     *             required:
     *               - name
     *               - email
     *               - password
     *             properties:
     *               name:
     *                 type: string
     *               email:
     *                 type: string
     *                 format: email
     *               password:
     *                 type: string
     *                 format: password
     *     responses:
     *       302:
     *         description: Redirects to dashboard on success
     *       400:
     *         description: Validation error
     */
    app.post('/signup', signupLimiter, signupValidation, handleValidationErrors, async (req, res) => {
        try {
            const { name, email, password } = req.body;

            // Create account (now includes verification token)
            const account = await auth.createAccount(name, email, password);

            // In development, auto-verify email and auto-login
            const isDevelopment = process.env.NODE_ENV !== 'production';

            if (isDevelopment) {
                // Auto-verify email in development
                await prisma.account.update({
                    where: { id: account.id },
                    data: {
                        emailVerified: true,
                        emailVerificationToken: null,
                        emailVerificationExpires: null
                    }
                });

                // Auto-login in development
                req.session.accountId = account.id;
                req.session.accountEmail = account.email;

                auditLog('SIGNUP_SUCCESS', account.id, {
                    email: email,
                    name: name,
                    autoVerified: true,
                    autoLoggedIn: true
                }, req);

                return res.redirect('/');
            }

            // In production, send verification email
            try {
                await sendVerificationEmail({
                    to: email,
                    token: account.emailVerificationToken,
                    accountName: name
                });
            } catch (emailError) {
                console.error('Failed to send verification email:', emailError);
                // Continue even if email fails - user can request resend
            }

            // Log successful signup
            auditLog('SIGNUP_SUCCESS', account.id, {
                email: email,
                name: name
            }, req);

            // DO NOT auto-login - require verification first
            // Show verification pending page instead
            res.render('verification-pending', { email, name });

        } catch (error) {
            console.error('Signup error:', error);

            // Log failed signup attempt
            auditLog('SIGNUP_FAILED', null, {
                email: req.body.email,
                error: error.message
            }, req);

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

    // Login handler with rate limiting and validation
    /**
     * @openapi
     * /login:
     *   post:
     *     summary: Log in to account
     *     tags: [Authentication]
     *     requestBody:
     *       required: true
     *       content:
     *         application/x-www-form-urlencoded:
     *           schema:
     *             type: object
     *             required:
     *               - email
     *               - password
     *             properties:
     *               email:
     *                 type: string
     *                 format: email
     *               password:
     *                 type: string
     *                 format: password
     *     responses:
     *       302:
     *         description: Redirects to dashboard
     *       401:
     *         description: Invalid credentials
     */
    app.post('/login', loginLimiter, loginValidation, handleValidationErrors, async (req, res) => {
        try {
            const { email, password } = req.body;

            console.log('Login attempt for email:', email);

            const account = await auth.authenticateAccount(email, password);

            if (!account) {
                console.log('Authentication failed for email:', email);

                // Log failed login attempt
                auditLog('LOGIN_FAILED', null, {
                    email: email,
                    reason: 'Invalid credentials'
                }, req);

                return res.render('login', {
                    error: 'Invalid email or password',
                    message: null,
                    showResendLink: false,
                    email: null
                });
            }

            console.log('Authentication successful for account:', account.id);

            // In development, skip email verification and MFA - only require email and password
            // Check NODE_ENV and also check if we're on Railway (Railway sets RAILWAY_ENVIRONMENT)
            const nodeEnv = process.env.NODE_ENV || 'development';
            const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
            const isDevelopment = nodeEnv !== 'production' && !isRailway;

            // Debug logging for MFA enforcement
            console.log(`[Login] Email: ${email}, NODE_ENV: ${nodeEnv}, isRailway: ${isRailway}, isDevelopment: ${isDevelopment}, mfaEnabled: ${account.mfaEnabled}`);

            // Check if email is verified (skip in development)
            if (!isDevelopment && !account.emailVerified) {
                auditLog('LOGIN_BLOCKED_UNVERIFIED', account.id, { email }, req);

                return res.render('login', {
                    error: 'Please verify your email before logging in. Check your inbox for the verification link.',
                    message: null,
                    showResendLink: true,
                    email: email
                });
            }

            // Check MFA requirement (skip in development)
            // Force MFA in production or on Railway, regardless of NODE_ENV
            const shouldEnforceMfa = (!isDevelopment || isRailway) && account.mfaEnabled;

            if (shouldEnforceMfa) {
                // Generate MFA token (reuse emailVerificationToken fields)
                const mfaToken = generateSecureToken();
                const mfaExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

                // Store MFA token in account
                await prisma.account.update({
                    where: { id: account.id },
                    data: {
                        emailVerificationToken: mfaToken,
                        emailVerificationExpires: mfaExpires
                    }
                });

                // Send MFA magic link email
                try {
                    await sendMfaEmail({
                        to: account.email,
                        token: mfaToken,
                        accountName: account.name
                    });

                    auditLog('MFA_EMAIL_SENT', account.id, { email: account.email }, req);

                    return res.render('login', {
                        message: 'We sent you a magic link via email. Click the link in your email to complete login.',
                        error: null,
                        showResendLink: false,
                        email: email
                    });
                } catch (emailError) {
                    console.error('Failed to send MFA email:', emailError);
                    auditLog('MFA_EMAIL_FAILED', account.id, {
                        email: account.email,
                        error: emailError.message
                    }, req);

                    return res.render('login', {
                        error: 'Failed to send MFA email. Please try again later.',
                        message: null,
                        showResendLink: false,
                        email: email
                    });
                }
            }

            // Log successful login
            auditLog('LOGIN_SUCCESS', account.id, {
                email: email,
                emailVerificationSkipped: isDevelopment && !account.emailVerified,
                mfaSkipped: !shouldEnforceMfa && account.mfaEnabled,
                nodeEnv: nodeEnv,
                isRailway: isRailway,
                memberId: account.memberId || null,
                memberRole: account.memberRole || 'owner'
            }, req);

            // Create session
            req.session.accountId = account.id;
            req.session.accountEmail = account.email;

            // Store member info if using new RBAC system
            if (account.memberId) {
                req.session.memberId = account.memberId;
                req.session.memberRole = account.memberRole;
            } else {
                // Legacy login - treat as owner
                req.session.memberRole = 'owner';
            }

            console.log('Session created:', req.session.accountId, 'role:', req.session.memberRole);

            // Save session before redirect
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);

                    auditLog('SESSION_ERROR', account.id, {
                        error: err.message
                    }, req);

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

            auditLog('LOGIN_ERROR', null, {
                email: req.body.email,
                error: error.message
            }, req);

            res.render('login', {
                error: error.message || 'Login failed',
                message: null
            });
        }
    });

    // Email verification endpoint
    app.get('/verify-email', async (req, res) => {
        try {
            const { token } = req.query;

            if (!token) {
                return res.render('verification-result', {
                    success: false,
                    message: 'Invalid verification link'
                });
            }

            const result = await auth.verifyEmail(token);

            if (result.success) {
                auditLog('EMAIL_VERIFIED', result.accountId, { email: result.email }, req);

                // Auto-login after successful verification
                req.session.accountId = result.accountId;
                req.session.accountEmail = result.email;

                return res.render('verification-result', {
                    success: true,
                    message: 'Email verified successfully! Redirecting to dashboard...'
                });
            } else {
                return res.render('verification-result', {
                    success: false,
                    message: result.message
                });
            }
        } catch (error) {
            console.error('Verification error:', error);
            res.render('verification-result', {
                success: false,
                message: 'Verification failed. Please try again.'
            });
        }
    });

    // MFA Verification Route
    app.get('/mfa/verify', async (req, res) => {
        try {
            const { token } = req.query;

            if (!token) {
                return res.render('verification-result', {
                    success: false,
                    message: 'Invalid verification link'
                });
            }

            // Find account by MFA token (stored in emailVerificationToken field)
            const account = await prisma.account.findUnique({
                where: { emailVerificationToken: token }
            });

            if (!account) {
                return res.render('verification-result', {
                    success: false,
                    message: 'Invalid or expired verification link'
                });
            }

            // Check expiration
            if (account.emailVerificationExpires && new Date() > account.emailVerificationExpires) {
                return res.render('verification-result', {
                    success: false,
                    message: 'Verification link has expired. Please login again.'
                });
            }

            // Clear token and create session
            await prisma.account.update({
                where: { id: account.id },
                data: {
                    emailVerificationToken: null,
                    emailVerificationExpires: null
                }
            });

            // Create session
            req.session.accountId = account.id;
            req.session.accountEmail = account.email;

            auditLog('MFA_VERIFIED', account.id, { email: account.email }, req);

            return res.render('verification-result', {
                success: true,
                message: 'Login successful! Redirecting to dashboard...'
            });
        } catch (error) {
            console.error('MFA verification error:', error);
            auditLog('MFA_VERIFICATION_ERROR', null, {
                error: error.message
            }, req);

            return res.render('verification-result', {
                success: false,
                message: 'An error occurred during verification. Please try again.'
            });
        }
    });

    // Resend verification email
    app.post('/resend-verification', async (req, res) => {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: 'Email address is required'
                });
            }

            const account = await auth.resendVerificationEmail(email);

            await sendVerificationEmail({
                to: email,
                token: account.emailVerificationToken,
                accountName: account.name
            });

            auditLog('VERIFICATION_RESENT', account.id, { email }, req);

            res.json({ success: true, message: 'Verification email sent!' });
        } catch (error) {
            console.error('Resend verification error:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Failed to resend verification email'
            });
        }
    });

    // Logout
    app.get('/logout', (req, res) => {
        const accountId = req.session?.accountId;

        req.session.destroy((err) => {
            if (err) {
                console.error('Logout error:', err);
            }

            // Log logout event
            auditLog('LOGOUT', accountId, {
                message: 'User logged out'
            }, req);

            res.redirect('/login');
        });
    });

    // Forgot password page
    app.get('/forgot-password', (req, res) => {
        if (req.session && req.session.accountId) {
            return res.redirect('/');
        }
        res.render('forgot-password', { error: null, message: null });
    });

    // Forgot password handler
    app.post('/forgot-password', loginLimiter, forgotPasswordValidation, handleValidationErrors, async (req, res) => {
        try {
            const { email } = req.body;

            console.log('Password reset request for email:', email);

            // Request password reset (always returns success for security)
            const result = await auth.requestPasswordReset(email);

            console.log('Password reset result:', { success: result.success, hasToken: !!result.token, hasEmail: !!result.email });

            if (result.success && result.token && result.email) {
                // Send password reset email (same pattern as verification email)
                try {
                    console.log('Sending password reset email to:', result.email);
                    await sendPasswordResetEmail({
                        to: result.email,
                        token: result.token,
                        accountName: result.accountName
                    });

                    console.log('Password reset email sent successfully to:', result.email);
                    auditLog('PASSWORD_RESET_REQUESTED', result.accountId, { email: result.email }, req);
                } catch (emailError) {
                    console.error('Failed to send password reset email:', emailError);
                    console.error('Error details:', {
                        message: emailError.message,
                        stack: emailError.stack
                    });
                    auditLog('PASSWORD_RESET_EMAIL_FAILED', result.accountId, {
                        email: result.email,
                        error: emailError.message
                    }, req);
                    // Still show success message for security (don't reveal if account exists)
                }
            } else {
                console.log('No password reset email sent - account may not exist or token generation failed');
            }

            // Always show success message (security best practice)
            res.render('forgot-password', {
                error: null,
                message: 'If an account with that email exists, we\'ve sent you a password reset link.'
            });
        } catch (error) {
            console.error('Forgot password error:', error);
            console.error('Error stack:', error.stack);

            auditLog('PASSWORD_RESET_ERROR', null, {
                email: req.body.email,
                error: error.message
            }, req);

            // Still show success message for security
            res.render('forgot-password', {
                error: null,
                message: 'If an account with that email exists, we\'ve sent you a password reset link.'
            });
        }
    });

    // Reset password page
    app.get('/reset-password', async (req, res) => {
        try {
            const { token } = req.query;

            if (!token) {
                return res.render('reset-password', {
                    error: 'Invalid reset link. Please request a new password reset.',
                    token: null
                });
            }

            // Verify token exists (but don't change password yet)
            const account = await prisma.account.findUnique({
                where: { passwordResetToken: token }
            });

            if (!account) {
                return res.render('reset-password', {
                    error: 'Invalid or expired reset link. Please request a new password reset.',
                    token: null
                });
            }

            // Check if token expired
            if (account.passwordResetExpires && new Date() > account.passwordResetExpires) {
                return res.render('reset-password', {
                    error: 'Reset link has expired. Please request a new password reset.',
                    token: null
                });
            }

            // Show reset form
            res.render('reset-password', {
                error: null,
                message: null,
                token: token
            });
        } catch (error) {
            console.error('Reset password page error:', error);
            res.render('reset-password', {
                error: 'An error occurred. Please try again.',
                token: null
            });
        }
    });

    // Reset password handler
    app.post('/reset-password', loginLimiter, resetPasswordValidation, handleValidationErrors, async (req, res) => {
        try {
            const { token, password } = req.body;

            console.log('Password reset attempt for token:', token ? 'provided' : 'missing');

            const result = await auth.resetPassword(token, password);

            if (result.success) {
                auditLog('PASSWORD_RESET_SUCCESS', result.accountId, { email: result.email }, req);

                return res.render('reset-password', {
                    error: null,
                    message: 'Your password has been successfully reset! You can now log in with your new password.',
                    success: true,
                    token: null
                });
            } else {
                auditLog('PASSWORD_RESET_FAILED', null, {
                    reason: result.message
                }, req);

                return res.render('reset-password', {
                    error: result.message || 'Failed to reset password. Please request a new reset link.',
                    token: token
                });
            }
        } catch (error) {
            console.error('Reset password error:', error);

            auditLog('PASSWORD_RESET_ERROR', null, {
                error: error.message
            }, req);

            res.render('reset-password', {
                error: error.message || 'An error occurred. Please try again.',
                token: req.body.token || null
            });
        }
    });
}

// ============================================
// Account Management Routes
// ============================================

function setupAccountRoutes(app) {
    // Sync status endpoint
    app.get('/api/sync/status', auth.requireAuth, (req, res) => {
        const accountId = req.session.accountId;
        const status = activeSyncs.get(accountId) || {
            active: false,
            message: 'No sync in progress',
            progress: 0,
            startedAt: null,
            lastUpdate: null
        };

        console.log(`[SYNC-DEBUG] Status request for account ${accountId}:`, {
            active: status.active,
            message: status.message,
            progress: status.progress,
            elapsed: status.startedAt ? (new Date() - new Date(status.startedAt)) / 1000 + 's' : 'N/A'
        });

        res.json(status);
    });

    // Entra sync status endpoint (for the improved activity sync)
    app.get('/api/account/entra/sync/status', auth.requireAuth, (req, res) => {
        const accountId = req.session.accountId;
        const status = activeSyncs.get(accountId) || {
            active: false,
            message: 'No active sync',
            progress: 0,
            startedAt: null,
            lastUpdate: null,
            result: null
        };

        console.log(`[SYNC] Entra sync status request for account ${accountId}:`, {
            active: status.active,
            progress: status.progress,
            message: status.message,
            hasResult: !!status.result
        });

        res.json(status);
    });

    // Cancel sync endpoint
    app.post('/api/sync/cancel', auth.requireAuth, (req, res) => {
        const accountId = req.session.accountId;
        const status = activeSyncs.get(accountId);

        if (status && status.active) {
            console.log(`[SYNC-DEBUG] Cancelling sync for account ${accountId}`);
            activeSyncs.set(accountId, {
                active: false,
                message: 'Sync cancelled by user',
                progress: 0,
                startedAt: status.startedAt,
                lastUpdate: new Date(),
                cancelled: true
            });
            res.json({ success: true, message: 'Sync cancelled' });
        } else {
            res.json({ success: false, message: 'No active sync to cancel' });
        }
    });

    // Account settings page
    app.get('/account', auth.requireAuth, auth.attachAccount, async (req, res) => {
        try {
            const account = req.account || await auth.getAccountById(req.session.accountId);
            const stats = await db.getDatabaseStats(req.session.accountId);

            res.render('account', { account, stats });
        } catch (error) {
            console.error('Account page error:', error);
            res.status(500).send('Error loading account page');
        }
    });

    // Regenerate API Key
    /**
     * @openapi
     * /api/account/regenerate-key:
     *   post:
     *     summary: Regenerate API Key
     *     tags: [Account]
     *     security:
     *       - cookieAuth: []
     *     responses:
     *       200:
     *         description: New API Key generated
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 apiKey:
     *                   type: string
     *                   example: sk_live_...
     */
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

            // Log API key regeneration (security-sensitive action)
            auditLog('API_KEY_REGENERATED', accountId, {
                message: 'API key was regenerated',
                reason: 'Security rotation or compromise'
            }, req);

            res.json({
                success: true,
                apiKey: newApiKey
            });
        } catch (error) {
            console.error('Regenerate API key error:', error);

            auditLog('API_KEY_REGENERATION_FAILED', accountId, {
                error: error.message
            }, req);

            res.status(500).json({
                success: false,
                error: error?.message || 'Failed to regenerate API key'
            });
        }
    });

    // Survey feedback submission
    app.post('/api/survey/submit', auth.requireAuth, surveySubmissionLimiter, async (req, res) => {
        try {
            const { email, feedback, rating } = req.body || {};

            if (typeof email !== 'string' || !SURVEY_EMAIL_REGEX.test(email.trim())) {
                return res.status(400).json({
                    success: false,
                    message: 'A valid email address is required.'
                });
            }

            if (feedback && typeof feedback !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'Feedback must be a string value.'
                });
            }

            if (rating && typeof rating !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'Rating must be a string value.'
                });
            }

            await sendSurveyEmail({
                email: email.trim(),
                feedback: feedback?.trim(),
                rating: rating?.trim(),
                submittedAt: new Date().toISOString(),
                context: {
                    accountId: req.session?.accountId,
                    accountEmail: req.session?.accountEmail,
                    ip: req.ip,
                    userAgent: req.get('user-agent')
                }
            });

            res.json({
                success: true,
                message: 'Thanks for the feedback!'
            });
        } catch (error) {
            console.error('Survey submission error:', error);
            res.status(500).json({
                success: false,
                message: 'We could not send your feedback right now. Please try again later.'
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
            const background = req.query.background === 'true';
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

            // Background, fast path for Activity sync: trigger and return immediately
            if (background && includeSignIns) {
                try {
                    const accountId = req.session.accountId;
                    const syncStart = Date.now();

                    // Initialize sync status
                    activeSyncs.set(accountId, {
                        active: true,
                        message: 'Connecting to Microsoft Graph API...',
                        progress: 5,
                        startedAt: new Date(),
                        lastUpdate: new Date(),
                        debug: {
                            accountId,
                            mode: mode || 'manual',
                            background: true,
                            force: true,
                            backfillHours: 24,
                            maxPages: 5,
                            syncStart: new Date(syncStart).toISOString()
                        }
                    });

                    const progressCallback = (progress) => {
                        activeSyncs.set(accountId, {
                            active: true,
                            message: progress.message,
                            progress: Math.min(90, Math.max(10, (progress.page / 10) * 100)),
                            startedAt: new Date(syncStart),
                            lastUpdate: new Date(),
                            details: progress,
                            debug: {
                                accountId,
                                mode: mode || 'manual',
                                background: true,
                                force: true,
                                backfillHours: 24,
                                maxPages: 5,
                                syncStart: new Date(syncStart).toISOString()
                            }
                        });
                    };

                    // Safety timeout similar to /api/usage/recent to ensure state transition
                    let safetyTimeoutId = setTimeout(() => {
                        const current = activeSyncs.get(accountId);
                        if (current?.active) {
                            activeSyncs.set(accountId, {
                                active: false,
                                message: `Sync timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Large datasets may take longer.`,
                                progress: 0,
                                startedAt: new Date(syncStart),
                                lastUpdate: new Date(),
                                error: { reason: 'timeout', message: `Sync exceeded ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Try again or check your internet connection.` }
                            });
                            setTimeout(() => activeSyncs.delete(accountId), 30000);
                        }
                    }, REQUEST_TIMEOUT_MS);

                    // Fire-and-forget bounded sync
                    db.syncEntraSignInsIfNeeded(accountId, {
                        force: true,
                        backfillHours: 24,
                        maxPages: 5,
                        onProgress: progressCallback
                    })
                        .then(result => {
                            if (safetyTimeoutId) {
                                clearTimeout(safetyTimeoutId);
                                safetyTimeoutId = null;
                            }
                            activeSyncs.set(accountId, {
                                active: false,
                                message: `Sync completed: ${result.count || 0} events synced`,
                                progress: 100,
                                startedAt: new Date(syncStart),
                                lastUpdate: new Date(),
                                result,
                                debug: {
                                    accountId,
                                    mode: mode || 'manual',
                                    background: true,
                                    completedAt: new Date().toISOString(),
                                    duration: Date.now() - syncStart
                                }
                            });
                            setTimeout(() => activeSyncs.delete(accountId), 30000);
                        })
                        .catch(error => {
                            if (safetyTimeoutId) {
                                clearTimeout(safetyTimeoutId);
                                safetyTimeoutId = null;
                            }
                            const isGraphThrottle = error?.statusCode === 429 || error?.code === 'TooManyRequests';
                            const errorResult = {
                                error: true,
                                reason: isGraphThrottle ? 'graph-throttled' : (error?.reason || 'error'),
                                message: error?.message || (isGraphThrottle ? 'Microsoft Graph returned 429 (Too Many Requests).' : 'Failed to sync Microsoft Entra sign-ins'),
                                statusCode: error?.statusCode
                            };
                            activeSyncs.set(accountId, {
                                active: false,
                                message: `Sync failed: ${errorResult.message}`,
                                progress: 0,
                                startedAt: new Date(syncStart),
                                lastUpdate: new Date(),
                                error: errorResult
                            });
                            setTimeout(() => activeSyncs.delete(accountId), 30000);
                        });

                    return res.status(202).json({
                        success: true,
                        status: 'background',
                        mode: mode || 'manual'
                    });
                } catch (bgError) {
                    console.error('Background Entra sign-in sync init failed:', bgError);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to start background sync'
                    });
                }
            }

            if (includeSignIns) {
                try {
                    // Bound workload by default to keep manual syncs fast
                    // Allow query params to override for even faster syncs
                    const maxPages = req.query.maxPages ? parseInt(req.query.maxPages, 10) : 5;
                    const backfillHours = req.query.backfillHours ? parseInt(req.query.backfillHours, 10) : 24;
                    const top = req.query.top ? parseInt(req.query.top, 10) : undefined;

                    results.signIns = await db.syncEntraSignInsIfNeeded(req.session.accountId, {
                        force: true,
                        backfillHours: Math.max(1, Math.min(backfillHours, 168)), // 1 hour to 7 days
                        maxPages: Math.max(1, Math.min(maxPages, 10)), // 1 to 10 pages
                        top: top ? Math.max(1, Math.min(top, 100)) : undefined // 1 to 100 events per page
                    });
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

    // Download Activity Agent Installer (customizable)
    app.post('/download/activity-agent-installer', auth.requireAuth, async (req, res) => {
        try {
            const account = await auth.getAccountById(req.session.accountId);

            // Prefer explicit API_URL, else infer from request protocol/host
            const inferredBaseUrl = `${req.protocol}://${req.get('host')}`;
            const apiUrl = process.env.API_URL || inferredBaseUrl;

            // Get configuration from request body
            const {
                apiUrl: customApiUrl,
                enableApplicationMonitoring = true,
                enableWindowFocusMonitoring = true,
                enableBrowserMonitoring = true,
                enableNetworkMonitoring = false,
                checkIntervalSeconds = 30,
                hideGui = false,
                startWithWindows = true,
                silentInstall = false
            } = req.body;

            // Use custom API URL if provided, otherwise use default
            const finalApiUrl = customApiUrl || apiUrl;

            console.log('Generating Activity Agent installer for account:', account.name);

            // Generate installer package with user configuration
            const packageBuffer = await generateInstallerPackage({
                apiUrl: finalApiUrl,
                apiKey: account.apiKey,
                enableApplicationMonitoring,
                enableWindowFocusMonitoring,
                enableBrowserMonitoring,
                enableNetworkMonitoring,
                checkIntervalSeconds: parseInt(checkIntervalSeconds) || 30,
                hideGui: hideGui === true || hideGui === 'true',
                startWithWindows: startWithWindows === true || startWithWindows === 'true',
                silentInstall: silentInstall === true || silentInstall === 'true'
            });

            // Generate filename
            const timestamp = new Date().toISOString().split('T')[0];
            const filename = `SasWatchAgent-Installer-${timestamp}.zip`;

            console.log('Activity Agent installer generated successfully:', filename);

            // Send ZIP file
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
            res.setHeader('Content-Length', packageBuffer.length);
            res.send(packageBuffer);

        } catch (error) {
            console.error('Activity Agent installer download error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate installer: ' + error.message
            });
        }
    });
}

// ============================================
// Headless Connector Routes
// ============================================

function setupHeadlessRoutes(app) {
    // Rate limiter for headless operations
    // Prevent abuse of browser launching/syncing
    const headlessLimiter = rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 10, // Limit each account to 10 requests per windowMs
        message: { success: false, message: 'Too many requests, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.session ? req.session.accountId : req.ip
    });

    // 1. Render the main configuration page
    app.get('/headless-connect', auth.requireAuth, async (req, res) => {
        try {
            const connectors = await prisma.headlessConnector.findMany({
                where: { accountId: req.session.accountId }
            });
            res.render('headless-connect', { connectors });
        } catch (error) {
            console.error('Headless page error:', error);
            res.status(500).send('Error loading headless connect page');
        }
    });

    // 2. Add a Connector & Start Interactive Capture
    app.post('/api/headless/connect', auth.requireAuth, headlessLimiter, async (req, res) => {
        try {
            const { vendor } = req.body;
            const accountId = req.session.accountId;

            // This will launch a non-headless browser on the SERVER (for dev/local use)
            await headlessManager.captureSession(accountId, vendor);

            res.json({ success: true, message: `Browser launched for ${vendor}. Please log in.` });
        } catch (error) {
            console.error('Headless connect error:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    });

    // 2.5 Get Connectors Status (Polling)
    app.get('/api/headless/status', auth.requireAuth, async (req, res) => {
        try {
            const connectors = await prisma.headlessConnector.findMany({
                where: { accountId: req.session.accountId },
                select: {
                    id: true,
                    vendor: true,
                    status: true,
                    lastSyncAt: true,
                    errorMessage: true
                }
            });
            res.json({ success: true, connectors });
        } catch (error) {
            console.error('Headless status error:', error);
            res.status(500).json({ success: false, message: 'Error fetching status' });
        }
    });

    // 3. Trigger Manual Sync
    app.post('/api/headless/sync', auth.requireAuth, headlessLimiter, async (req, res) => {
        try {
            const { vendor } = req.body;
            const accountId = req.session.accountId;

            const result = await headlessManager.sync(accountId, vendor);
            res.json({ success: true, result });
        } catch (error) {
            console.error('Headless sync error:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    });

    // 4. Delete Connector
    app.delete('/api/headless/connector/:id', auth.requireAuth, async (req, res) => {
        try {
            await prisma.headlessConnector.delete({
                where: {
                    id: req.params.id,
                    accountId: req.session.accountId // Security check
                }
            });
            res.json({ success: true });
        } catch (error) {
            console.error('Delete connector error:', error);
            res.status(400).json({ success: false, message: error.message });
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

    // Usage tracking endpoint (PowerShell scripts and ActivityAgent use this)
    // Auth first (sets req.accountId), then rate limit by account, then process request
    app.post('/api/track', auth.requireApiKey, trackingLimiter, async (req, res) => {
        try {
            const data = req.body;

            // Determine source based on event origin and type
            let source = 'adobe'; // default for web extension events
            if (data.why === 'agent_monitor') {
                // ActivityAgent events: classify by event type
                source = data.event === 'web_browsing' ? 'browser' : 'desktop';
            } else if (data.why === 'adobe_reader_wrapper' || data.why === 'process_monitor') {
                source = 'wrapper';
            }

            console.log(`[Track API] Event received: ${data.event} | source: ${source} | url: ${data.url} | why: ${data.why}`);

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
            service: 'SasWatch Multi-Tenant API'
        });
    });

    // Secure endpoint for Socket.IO authentication (dashboard namespace)
    // Returns accountId only if user is authenticated
    app.get('/api/socket/auth', auth.requireAuth, async (req, res) => {
        try {
            if (!req.accountId) {
                return res.status(401).json({
                    success: false,
                    error: 'Not authenticated'
                });
            }

            res.json({
                success: true,
                accountId: req.accountId
            });
        } catch (error) {
            console.error('Socket auth endpoint error:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
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

    app.get('/dev', auth.requireAuth, auth.requirePlatformAdmin, async (req, res) => {
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

            // SPEED OPTIMIZATION: Use small limits for fast responses
            const limit = Number.parseInt(req.query.limit, 10) || 10;  // Default 10 events
            const hours = Number.parseInt(req.query.hours, 10) || 24;  // Default 24 hours for testing
            const force = req.query.force === 'true';

            const sinceDate = new Date(Date.now() - hours * 60 * 60 * 1000);
            const start = Date.now();

            console.log('[DEV-SYNC] Manual sync - Fetching last', hours, 'hours, limit:', limit);

            // Fetch data - use limit to determine pages needed
            // Each page can have up to 999 events, but we'll fetch multiple pages if needed
            const eventsPerPage = Math.min(limit, 999);
            const pagesNeeded = Math.ceil(limit / eventsPerPage);
            const result = await fetchEntraSignIns(graphState.tenantId, {
                top: eventsPerPage,
                maxPages: Math.max(1, Math.min(pagesNeeded, 5)),  // Fetch up to 5 pages to get enough data
                since: sinceDate           // Filter by time range
            });

            console.log('[DEV-SYNC] Fetched', result.events?.length || 0, 'events from Graph');

            // IMPORTANT: Save the fetched events to database immediately for persistence
            if (result.events && result.events.length > 0) {
                try {
                    // Save to database using bulk upsert
                    for (const event of result.events) {
                        await prisma.entraSignIn.upsert({
                            where: { id: event.id },
                            update: {},  // Don't update if exists
                            create: {
                                id: event.id,
                                accountId: account.id,
                                createdDateTime: new Date(event.createdDateTime),
                                userDisplayName: event.userDisplayName,
                                userPrincipalName: event.userPrincipalName,
                                userId: event.userId,
                                appDisplayName: event.appDisplayName,
                                resourceDisplayName: event.resourceDisplayName,
                                clientAppUsed: event.clientAppUsed,
                                deviceDisplayName: event.deviceDetail?.displayName,
                                operatingSystem: event.deviceDetail?.operatingSystem,
                                browser: event.deviceDetail?.browser,
                                ipAddress: event.ipAddress,
                                locationCity: event.location?.city,
                                locationCountryOrRegion: event.location?.countryOrRegion,
                                statusErrorCode: event.status?.errorCode || 0,
                                statusFailureReason: event.status?.failureReason,
                                riskState: event.riskState,
                                riskDetail: event.riskDetail,
                                conditionalAccessStatus: event.conditionalAccessStatus,
                                correlationId: event.correlationId,
                                isInteractive: event.isInteractive,
                                sourceChannel: 'manual-sync'
                            }
                        });
                    }
                    console.log('[DEV-SYNC] Saved', result.events.length, 'events to database');
                } catch (saveError) {
                    console.error('[DEV-SYNC] Failed to save events:', saveError);
                    // Continue anyway - data is still displayed
                }
            }

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

// Valid inactivity alert thresholds
const VALID_ALERT_THRESHOLDS = [7, 14, 30, 60, 90];

function setupDataRoutes(app) {
    // ============================================
    // Alert Settings Endpoints
    // ============================================

    // Get alert settings for account
    /**
     * @openapi
     * /api/account/alert-settings:
     *   get:
     *     summary: Get account alert settings
     *     tags: [Account]
     *     security:
     *       - cookieAuth: []
     *     responses:
     *       200:
     *         description: Alert settings retrieved
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 inactivityAlertEnabled:
     *                   type: boolean
     *                 inactivityAlertThreshold:
     *                   type: integer
     *                 inactivityAlertLastSent:
     *                   type: string
     *                   format: date-time
     *                 inactivityAlertEmail:
     *                   type: string
     *       401:
     *         description: Unauthorized
     */
    app.get('/api/account/alert-settings', auth.requireAuth, async (req, res) => {
        try {
            const account = await prisma.account.findUnique({
                where: { id: req.session.accountId },
                select: {
                    inactivityAlertEnabled: true,
                    inactivityAlertThreshold: true,
                    inactivityAlertLastSent: true,
                    inactivityAlertEmail: true,
                    email: true // Fallback email
                }
            });

            if (!account) {
                return res.status(404).json({ error: 'Account not found' });
            }

            res.json({
                inactivityAlertEnabled: account.inactivityAlertEnabled,
                inactivityAlertThreshold: account.inactivityAlertThreshold,
                inactivityAlertLastSent: account.inactivityAlertLastSent,
                inactivityAlertEmail: account.inactivityAlertEmail || account.email
            });
        } catch (error) {
            console.error('Get alert settings error:', error);
            res.status(500).json({ error: 'Failed to get alert settings' });
        }
    });

    // Update alert settings for account
    /**
     * @openapi
     * /api/account/alert-settings:
     *   put:
     *     summary: Update account alert settings
     *     tags: [Account]
     *     security:
     *       - cookieAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               inactivityAlertEnabled:
     *                 type: boolean
     *               inactivityAlertThreshold:
     *                 type: integer
     *                 enum: [7, 14, 30, 60, 90]
     *               inactivityAlertEmail:
     *                 type: string
     *                 format: email
     *     responses:
     *       200:
     *         description: Alert settings updated
     *       400:
     *         description: Invalid input
     */
    app.put('/api/account/alert-settings', auth.requireAuth, async (req, res) => {
        try {
            const { inactivityAlertEnabled, inactivityAlertThreshold, inactivityAlertEmail } = req.body;
            const updateData = {};

            // Validate and set enabled status
            if (typeof inactivityAlertEnabled === 'boolean') {
                updateData.inactivityAlertEnabled = inactivityAlertEnabled;
            }

            // Validate threshold
            if (inactivityAlertThreshold !== undefined) {
                const threshold = Number(inactivityAlertThreshold);
                if (!VALID_ALERT_THRESHOLDS.includes(threshold)) {
                    return res.status(400).json({
                        error: `Invalid threshold. Must be one of: ${VALID_ALERT_THRESHOLDS.join(', ')} days`
                    });
                }
                updateData.inactivityAlertThreshold = threshold;
            }

            // Validate email format
            if (inactivityAlertEmail !== undefined) {
                if (inactivityAlertEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inactivityAlertEmail)) {
                    return res.status(400).json({ error: 'Invalid email format' });
                }
                updateData.inactivityAlertEmail = inactivityAlertEmail || null;
            }

            const account = await prisma.account.update({
                where: { id: req.session.accountId },
                data: updateData,
                select: {
                    inactivityAlertEnabled: true,
                    inactivityAlertThreshold: true,
                    inactivityAlertLastSent: true,
                    inactivityAlertEmail: true,
                    email: true
                }
            });

            res.json({
                success: true,
                settings: {
                    inactivityAlertEnabled: account.inactivityAlertEnabled,
                    inactivityAlertThreshold: account.inactivityAlertThreshold,
                    inactivityAlertLastSent: account.inactivityAlertLastSent,
                    inactivityAlertEmail: account.inactivityAlertEmail || account.email
                }
            });
        } catch (error) {
            console.error('Update alert settings error:', error);
            res.status(500).json({ error: 'Failed to update alert settings' });
        }
    });

    // ============================================
    // User Endpoints
    // ============================================

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

    // Get inactive users (account-scoped)
    app.get('/api/users/inactive', auth.requireAuth, async (req, res) => {
        try {
            const rawDays = Number.parseInt(req.query.days ?? '30', 10);
            const daysInactive = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
            const inactiveUsers = await db.getInactiveUsers(req.session.accountId, daysInactive);

            res.json({
                daysInactive,
                count: inactiveUsers.length,
                users: inactiveUsers
            });
        } catch (error) {
            console.error('Get inactive users error:', error);
            res.status(500).json({ error: 'Failed to get inactive users' });
        }
    });

    // Export all users to CSV (account-scoped)
    app.get('/api/users/export/csv', auth.requireAuth, async (req, res) => {
        try {
            const result = await db.getUsersData(req.session.accountId);
            const users = result.users || [];

            // Generate CSV content
            const headers = ['email', 'firstName', 'lastName', 'licenses', 'lastActivity', 'activityCount'];
            const csvRows = [headers.join(',')];

            for (const user of users) {
                const row = [
                    escapeCsvField(user.email || ''),
                    escapeCsvField(user.firstName || ''),
                    escapeCsvField(user.lastName || ''),
                    escapeCsvField((user.licenses || []).join('; ')),
                    user.lastActivity ? new Date(user.lastActivity).toISOString() : '',
                    user.activityCount || 0
                ];
                csvRows.push(row.join(','));
            }

            const csv = csvRows.join('\n');
            const filename = `users-${new Date().toISOString().split('T')[0]}.csv`;

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(csv);
        } catch (error) {
            console.error('Export users CSV error:', error);
            res.status(500).json({ error: 'Failed to export users' });
        }
    });

    // Export inactive users to CSV (account-scoped)
    app.get('/api/users/inactive/export/csv', auth.requireAuth, async (req, res) => {
        try {
            const rawDays = Number.parseInt(req.query.days ?? '30', 10);
            const daysInactive = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
            const inactiveUsers = await db.getInactiveUsers(req.session.accountId, daysInactive);

            // Generate CSV content with daysSinceActivity column
            const headers = ['email', 'firstName', 'lastName', 'licenses', 'lastActivity', 'daysSinceActivity', 'activityCount'];
            const csvRows = [headers.join(',')];

            for (const user of inactiveUsers) {
                const row = [
                    escapeCsvField(user.email || ''),
                    escapeCsvField(user.firstName || ''),
                    escapeCsvField(user.lastName || ''),
                    escapeCsvField((user.licenses || []).join('; ')),
                    user.lastActivity ? new Date(user.lastActivity).toISOString() : '',
                    user.daysSinceActivity ?? 'never',
                    user.activityCount || 0
                ];
                csvRows.push(row.join(','));
            }

            const csv = csvRows.join('\n');
            const filename = `inactive-users-${daysInactive}days-${new Date().toISOString().split('T')[0]}.csv`;

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(csv);
        } catch (error) {
            console.error('Export inactive users CSV error:', error);
            res.status(500).json({ error: 'Failed to export inactive users' });
        }
    });

    // ============================================
    // Email Notification Preferences Endpoints
    // ============================================

    const VALID_DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    const DEFAULT_NOTIFICATION_PREFERENCES = {
        renewalReminders: { enabled: true, daysBeforeExpiry: [60, 30, 7] },
        inactivityAlerts: { enabled: false, threshold: 30 },
        weeklyDigest: { enabled: true, dayOfWeek: 'monday' },
        licenseChanges: { enabled: true }
    };

    const NOTIFICATION_TYPES = [
        { id: 'renewalReminders', name: 'Renewal Reminders', description: 'Get notified before subscriptions expire' },
        { id: 'inactivityAlerts', name: 'Inactivity Alerts', description: 'Alerts when users haven\'t used their licenses' },
        { id: 'weeklyDigest', name: 'Weekly Digest', description: 'Weekly summary of license usage and activity' },
        { id: 'licenseChanges', name: 'License Changes', description: 'Notifications when licenses are added or removed' }
    ];

    // Get notification preferences
    app.get('/api/notifications/preferences', auth.requireAuth, async (req, res) => {
        try {
            const account = await prisma.account.findUnique({
                where: { id: req.session.accountId },
                select: { notificationPreferences: true }
            });

            if (!account) {
                return res.status(404).json({ error: 'Account not found' });
            }

            // Merge stored preferences with defaults
            const storedPrefs = account.notificationPreferences || {};
            const preferences = {
                renewalReminders: { ...DEFAULT_NOTIFICATION_PREFERENCES.renewalReminders, ...storedPrefs.renewalReminders },
                inactivityAlerts: { ...DEFAULT_NOTIFICATION_PREFERENCES.inactivityAlerts, ...storedPrefs.inactivityAlerts },
                weeklyDigest: { ...DEFAULT_NOTIFICATION_PREFERENCES.weeklyDigest, ...storedPrefs.weeklyDigest },
                licenseChanges: { ...DEFAULT_NOTIFICATION_PREFERENCES.licenseChanges, ...storedPrefs.licenseChanges }
            };

            res.json(preferences);
        } catch (error) {
            console.error('Get notification preferences error:', error);
            res.status(500).json({ error: 'Failed to get notification preferences' });
        }
    });

    // Update notification preferences
    app.put('/api/notifications/preferences', auth.requireAuth, async (req, res) => {
        try {
            const updates = req.body;

            // Validate dayOfWeek if provided
            if (updates.weeklyDigest?.dayOfWeek) {
                if (!VALID_DAYS_OF_WEEK.includes(updates.weeklyDigest.dayOfWeek.toLowerCase())) {
                    return res.status(400).json({
                        error: `Invalid dayOfWeek. Must be one of: ${VALID_DAYS_OF_WEEK.join(', ')}`
                    });
                }
                updates.weeklyDigest.dayOfWeek = updates.weeklyDigest.dayOfWeek.toLowerCase();
            }

            // Get current preferences
            const account = await prisma.account.findUnique({
                where: { id: req.session.accountId },
                select: { notificationPreferences: true }
            });

            if (!account) {
                return res.status(404).json({ error: 'Account not found' });
            }

            const currentPrefs = account.notificationPreferences || {};

            // Deep merge updates with current preferences
            const newPrefs = {
                renewalReminders: { ...currentPrefs.renewalReminders, ...updates.renewalReminders },
                inactivityAlerts: { ...currentPrefs.inactivityAlerts, ...updates.inactivityAlerts },
                weeklyDigest: { ...currentPrefs.weeklyDigest, ...updates.weeklyDigest },
                licenseChanges: { ...currentPrefs.licenseChanges, ...updates.licenseChanges }
            };

            // Clean up undefined values
            for (const key of Object.keys(newPrefs)) {
                newPrefs[key] = Object.fromEntries(
                    Object.entries(newPrefs[key]).filter(([, v]) => v !== undefined)
                );
            }

            await prisma.account.update({
                where: { id: req.session.accountId },
                data: { notificationPreferences: newPrefs }
            });

            res.json({ success: true, preferences: newPrefs });
        } catch (error) {
            console.error('Update notification preferences error:', error);
            res.status(500).json({ error: 'Failed to update notification preferences' });
        }
    });

    // Get available notification types
    app.get('/api/notifications/types', auth.requireAuth, async (req, res) => {
        res.json({ types: NOTIFICATION_TYPES });
    });

    // ============================================
    // Usage Analytics Endpoints
    // ============================================

    // Overview metrics
    app.get('/api/analytics/overview', auth.requireAuth, async (req, res) => {
        try {
            const rawDays = Number.parseInt(req.query.inactiveDays ?? '30', 10);
            const inactiveDays = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
            const cutoffDate = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);

            const users = await prisma.user.findMany({
                where: { accountId: req.session.accountId },
                select: {
                    licenses: true,
                    lastActivity: true,
                    activityCount: true
                }
            });

            const totalUsers = users.length;
            let activeUsers = 0;
            let totalLicenses = 0;
            let totalActivityCount = 0;

            for (const user of users) {
                totalLicenses += (user.licenses || []).length;
                totalActivityCount += user.activityCount || 0;
                if (user.lastActivity && new Date(user.lastActivity) >= cutoffDate) {
                    activeUsers++;
                }
            }

            res.json({
                totalUsers,
                activeUsers,
                inactiveUsers: totalUsers - activeUsers,
                totalLicenses,
                totalActivityCount,
                averageActivityPerUser: totalUsers > 0 ? Math.round(totalActivityCount / totalUsers) : 0,
                inactiveDaysThreshold: inactiveDays
            });
        } catch (error) {
            console.error('Analytics overview error:', error);
            res.status(500).json({ error: 'Failed to get analytics overview' });
        }
    });

    // License utilization
    app.get('/api/analytics/license-utilization', auth.requireAuth, async (req, res) => {
        try {
            const rawDays = Number.parseInt(req.query.inactiveDays ?? '30', 10);
            const inactiveDays = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
            const cutoffDate = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);

            const users = await prisma.user.findMany({
                where: { accountId: req.session.accountId },
                select: {
                    licenses: true,
                    lastActivity: true
                }
            });

            // Get account license costs
            const account = await prisma.account.findUnique({
                where: { id: req.session.accountId },
                select: { licenseCosts: true }
            });
            const licenseCosts = account?.licenseCosts || {};

            // Build license utilization map
            const licenseMap = {};

            for (const user of users) {
                const isActive = user.lastActivity && new Date(user.lastActivity) >= cutoffDate;

                for (const license of (user.licenses || [])) {
                    if (!licenseMap[license]) {
                        const cost = licenseCosts[license]?.costPerLicense || 0;
                        licenseMap[license] = {
                            name: license,
                            totalAssigned: 0,
                            activeUsers: 0,
                            inactiveUsers: 0,
                            costPerLicense: cost,
                            monthlyCost: 0,
                            wastedCost: 0
                        };
                    }
                    licenseMap[license].totalAssigned++;
                    if (isActive) {
                        licenseMap[license].activeUsers++;
                    } else {
                        licenseMap[license].inactiveUsers++;
                    }
                }
            }

            // Calculate utilization rates and costs
            const licenses = Object.values(licenseMap).map(l => {
                const utilizationRate = l.totalAssigned > 0
                    ? (l.activeUsers / l.totalAssigned) * 100
                    : 0;
                return {
                    ...l,
                    utilizationRate: Math.round(utilizationRate * 100) / 100,
                    monthlyCost: l.totalAssigned * l.costPerLicense,
                    wastedCost: l.inactiveUsers * l.costPerLicense
                };
            });

            // Sort by total assigned descending
            licenses.sort((a, b) => b.totalAssigned - a.totalAssigned);

            const totalWastedCost = licenses.reduce((sum, l) => sum + l.wastedCost, 0);

            res.json({
                licenses,
                totalWastedMonthlyCost: totalWastedCost,
                inactiveDaysThreshold: inactiveDays
            });
        } catch (error) {
            console.error('License utilization error:', error);
            res.status(500).json({ error: 'Failed to get license utilization' });
        }
    });

    // Top/bottom users by activity
    app.get('/api/analytics/top-users', auth.requireAuth, async (req, res) => {
        try {
            const rawLimit = Number.parseInt(req.query.limit ?? '10', 10);
            const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;
            const order = req.query.order === 'asc' ? 'asc' : 'desc';

            const users = await prisma.user.findMany({
                where: { accountId: req.session.accountId },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    licenses: true,
                    lastActivity: true,
                    activityCount: true
                },
                orderBy: { activityCount: order },
                take: limit
            });

            res.json({
                users: users.map(u => ({
                    id: u.id,
                    email: u.email,
                    firstName: u.firstName,
                    lastName: u.lastName,
                    licenses: u.licenses || [],
                    lastActivity: u.lastActivity,
                    activityCount: u.activityCount || 0
                })),
                order,
                limit
            });
        } catch (error) {
            console.error('Top users error:', error);
            res.status(500).json({ error: 'Failed to get top users' });
        }
    });

    // Activity summary by time period
    app.get('/api/analytics/activity-summary', auth.requireAuth, async (req, res) => {
        try {
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

            const users = await prisma.user.findMany({
                where: { accountId: req.session.accountId },
                select: { lastActivity: true }
            });

            let last7Days = 0;
            let last30Days = 0;
            let last90Days = 0;
            let neverActive = 0;
            let olderThan90 = 0;

            for (const user of users) {
                if (!user.lastActivity) {
                    neverActive++;
                } else {
                    const lastActivity = new Date(user.lastActivity);
                    if (lastActivity >= sevenDaysAgo) {
                        last7Days++;
                    } else if (lastActivity >= thirtyDaysAgo) {
                        last30Days++;
                    } else if (lastActivity >= ninetyDaysAgo) {
                        last90Days++;
                    } else {
                        olderThan90++;
                    }
                }
            }

            res.json({
                last7Days,
                last30Days,
                last90Days,
                olderThan90Days: olderThan90,
                neverActive,
                totalUsers: users.length
            });
        } catch (error) {
            console.error('Activity summary error:', error);
            res.status(500).json({ error: 'Failed to get activity summary' });
        }
    });

    // ============================================
    // License Reclamation Endpoints
    // ============================================

    // Get reclamation candidates (inactive users with licenses)
    app.get('/api/licenses/reclamation-candidates', auth.requireAuth, async (req, res) => {
        try {
            const rawDays = Number.parseInt(req.query.days ?? '30', 10);
            const daysInactive = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;

            // Get inactive users
            const inactiveUsers = await db.getInactiveUsers(req.session.accountId, daysInactive);

            // Filter to only users with licenses
            const candidates = inactiveUsers.filter(u => u.licenses && u.licenses.length > 0);

            // Get account license costs for savings calculation
            const account = await prisma.account.findUnique({
                where: { id: req.session.accountId },
                select: { licenseCosts: true }
            });
            const licenseCosts = account?.licenseCosts || {};

            // Calculate total licenses and potential savings
            let totalLicenses = 0;
            let monthlySavings = 0;

            for (const candidate of candidates) {
                totalLicenses += candidate.licenses.length;
                for (const license of candidate.licenses) {
                    const cost = licenseCosts[license]?.costPerLicense || 0;
                    monthlySavings += cost;
                }
            }

            res.json({
                daysInactive,
                candidates: candidates.map(c => ({
                    id: c.id,
                    email: c.email,
                    firstName: c.firstName,
                    lastName: c.lastName,
                    licenses: c.licenses,
                    lastActivity: c.lastActivity,
                    daysSinceActivity: c.daysSinceActivity
                })),
                totalLicenses,
                potentialSavings: {
                    monthly: monthlySavings,
                    annual: monthlySavings * 12,
                    currency: 'USD'
                }
            });
        } catch (error) {
            console.error('Get reclamation candidates error:', error);
            res.status(500).json({ error: 'Failed to get reclamation candidates' });
        }
    });

    // Reclaim licenses from a user
    app.post('/api/licenses/reclaim', auth.requireAuth, async (req, res) => {
        try {
            const { userId, licenses } = req.body;

            if (!userId) {
                return res.status(400).json({ error: 'userId is required' });
            }

            // Find user and verify account ownership
            const user = await prisma.user.findFirst({
                where: {
                    id: userId,
                    accountId: req.session.accountId
                }
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Determine which licenses to reclaim
            const currentLicenses = user.licenses || [];
            let licensesToReclaim;

            if (!licenses || licenses.length === 0) {
                // Reclaim all licenses
                licensesToReclaim = [...currentLicenses];
            } else {
                // Reclaim only specified licenses
                licensesToReclaim = licenses.filter(l => currentLicenses.includes(l));
            }

            // Remove reclaimed licenses
            const remainingLicenses = currentLicenses.filter(l => !licensesToReclaim.includes(l));

            await prisma.user.update({
                where: { id: userId },
                data: { licenses: remainingLicenses }
            });

            // Create audit log
            await createAuditLog(
                req.session.accountId,
                req.session.memberId,
                'license.reclaim',
                'user',
                userId,
                { licenses: licensesToReclaim, userEmail: user.email },
                req
            );

            res.json({
                success: true,
                userId,
                reclaimedLicenses: licensesToReclaim,
                remainingLicenses
            });
        } catch (error) {
            console.error('Reclaim licenses error:', error);
            res.status(500).json({ error: 'Failed to reclaim licenses' });
        }
    });

    // Bulk reclaim licenses from multiple users
    app.post('/api/licenses/reclaim-bulk', auth.requireAuth, async (req, res) => {
        try {
            const { userIds, licenses } = req.body;

            if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
                return res.status(400).json({ error: 'userIds array is required and must not be empty' });
            }

            if (userIds.length > 100) {
                return res.status(400).json({ error: 'Maximum batch size is 100 users' });
            }

            const results = [];
            let succeeded = 0;
            let failed = 0;

            for (const userId of userIds) {
                try {
                    // Find user and verify account ownership
                    const user = await prisma.user.findFirst({
                        where: {
                            id: userId,
                            accountId: req.session.accountId
                        }
                    });

                    if (!user) {
                        results.push({
                            userId,
                            success: false,
                            error: 'User not found or access denied'
                        });
                        failed++;
                        continue;
                    }

                    // Determine which licenses to reclaim
                    const currentLicenses = user.licenses || [];
                    let licensesToReclaim;

                    if (!licenses || licenses.length === 0) {
                        licensesToReclaim = [...currentLicenses];
                    } else {
                        licensesToReclaim = licenses.filter(l => currentLicenses.includes(l));
                    }

                    // Remove reclaimed licenses
                    const remainingLicenses = currentLicenses.filter(l => !licensesToReclaim.includes(l));

                    await prisma.user.update({
                        where: { id: userId },
                        data: { licenses: remainingLicenses }
                    });

                    results.push({
                        userId,
                        success: true,
                        reclaimedLicenses: licensesToReclaim,
                        remainingLicenses
                    });
                    succeeded++;
                } catch (err) {
                    results.push({
                        userId,
                        success: false,
                        error: err.message
                    });
                    failed++;
                }
            }

            res.json({
                success: failed === 0,
                processed: userIds.length,
                succeeded,
                failed,
                results
            });
        } catch (error) {
            console.error('Bulk reclaim licenses error:', error);
            res.status(500).json({ error: 'Failed to process bulk reclamation' });
        }
    });

    // Assign license to user
    app.post('/api/licenses/assign', auth.requireAuth, async (req, res) => {
        try {
            const { userId, license } = req.body;

            if (!userId) {
                return res.status(400).json({ error: 'userId is required' });
            }

            if (!license) {
                return res.status(400).json({ error: 'license is required' });
            }

            // Find user and verify account ownership
            const user = await prisma.user.findFirst({
                where: {
                    id: userId,
                    accountId: req.session.accountId
                }
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Check if user already has this license
            const currentLicenses = user.licenses || [];
            if (currentLicenses.includes(license)) {
                return res.status(400).json({ error: 'User already has this license' });
            }

            // Add the license
            const updatedLicenses = [...currentLicenses, license];

            await prisma.user.update({
                where: { id: userId },
                data: { licenses: updatedLicenses }
            });

            // Create audit log
            await createAuditLog(
                req.session.accountId,
                req.session.memberId,
                'license.assign',
                'user',
                userId,
                { license, userEmail: user.email },
                req
            );

            res.json({
                success: true,
                userId,
                assignedLicense: license,
                currentLicenses: updatedLicenses
            });
        } catch (error) {
            console.error('Assign license error:', error);
            res.status(500).json({ error: 'Failed to assign license' });
        }
    });

    // Get license inventory
    app.get('/api/licenses/inventory', auth.requireAuth, async (req, res) => {
        try {
            // Get account's license configuration
            const account = await prisma.account.findUnique({
                where: { id: req.session.accountId },
                select: { licenseCosts: true }
            });

            const licenseCosts = account?.licenseCosts || {};

            // Count assigned licenses across all users
            const users = await prisma.user.findMany({
                where: { accountId: req.session.accountId },
                select: { licenses: true }
            });

            // Count each license type
            const assignedCounts = {};
            for (const user of users) {
                for (const license of (user.licenses || [])) {
                    assignedCounts[license] = (assignedCounts[license] || 0) + 1;
                }
            }

            // Build inventory
            const licenses = Object.entries(licenseCosts).map(([name, config]) => {
                const totalLicenses = config.totalLicenses || 0;
                const assignedCount = assignedCounts[name] || 0;
                return {
                    name,
                    totalLicenses,
                    assignedCount,
                    availableCount: Math.max(0, totalLicenses - assignedCount),
                    costPerLicense: config.costPerLicense || 0
                };
            });

            // Add any licenses that users have but aren't in the config
            for (const [name, count] of Object.entries(assignedCounts)) {
                if (!licenseCosts[name]) {
                    licenses.push({
                        name,
                        totalLicenses: 0,
                        assignedCount: count,
                        availableCount: 0,
                        costPerLicense: 0
                    });
                }
            }

            res.json({ licenses });
        } catch (error) {
            console.error('Get license inventory error:', error);
            res.status(500).json({ error: 'Failed to get license inventory' });
        }
    });

    // Get reclamation summary
    app.get('/api/licenses/reclamation-summary', auth.requireAuth, async (req, res) => {
        try {
            const daysInactive = 30; // Default threshold

            // Get inactive users
            const inactiveUsers = await db.getInactiveUsers(req.session.accountId, daysInactive);

            // Filter to only users with licenses
            const usersWithLicenses = inactiveUsers.filter(u => u.licenses && u.licenses.length > 0);

            // Get account license costs
            const account = await prisma.account.findUnique({
                where: { id: req.session.accountId },
                select: { licenseCosts: true }
            });
            const licenseCosts = account?.licenseCosts || {};

            // Calculate by license type
            const byLicenseType = {};
            let totalReclaimableLicenses = 0;
            let totalMonthlySavings = 0;

            for (const user of usersWithLicenses) {
                for (const license of user.licenses) {
                    if (!byLicenseType[license]) {
                        const cost = licenseCosts[license]?.costPerLicense || 0;
                        byLicenseType[license] = {
                            count: 0,
                            costPerLicense: cost,
                            totalMonthlyCost: 0
                        };
                    }
                    byLicenseType[license].count++;
                    byLicenseType[license].totalMonthlyCost += licenseCosts[license]?.costPerLicense || 0;
                    totalReclaimableLicenses++;
                    totalMonthlySavings += licenseCosts[license]?.costPerLicense || 0;
                }
            }

            res.json({
                totalInactiveUsers: usersWithLicenses.length,
                totalReclaimableLicenses,
                potentialMonthlySavings: totalMonthlySavings,
                potentialAnnualSavings: totalMonthlySavings * 12,
                byLicenseType,
                thresholdDays: daysInactive
            });
        } catch (error) {
            console.error('Get reclamation summary error:', error);
            res.status(500).json({ error: 'Failed to get reclamation summary' });
        }
    });

    // ============================================
    // Audit Logging Endpoints
    // ============================================

    // Helper function to create audit log entries
    async function createAuditLog(accountId, actorId, action, targetType, targetId, details, req = null) {
        try {
            await prisma.auditLog.create({
                data: {
                    accountId,
                    actorId,
                    action,
                    targetType,
                    targetId,
                    details,
                    ipAddress: req?.ip || req?.connection?.remoteAddress,
                    userAgent: req?.get?.('user-agent')
                }
            });
        } catch (error) {
            console.error('Failed to create audit log:', error);
            // Don't throw - audit logging should not break main operations
        }
    }

    // Get audit logs
    app.get('/api/audit-logs', auth.requireAuth, async (req, res) => {
        try {
            const rawLimit = Number.parseInt(req.query.limit ?? '50', 10);
            const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 50;
            const rawOffset = Number.parseInt(req.query.offset ?? '0', 10);
            const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

            const whereClause = { accountId: req.session.accountId };

            // Filter by action type
            if (req.query.action) {
                whereClause.action = req.query.action;
            }

            // Filter by date range
            if (req.query.startDate || req.query.endDate) {
                whereClause.createdAt = {};
                if (req.query.startDate) {
                    whereClause.createdAt.gte = new Date(req.query.startDate);
                }
                if (req.query.endDate) {
                    whereClause.createdAt.lte = new Date(req.query.endDate);
                }
            }

            const [logs, total] = await Promise.all([
                prisma.auditLog.findMany({
                    where: whereClause,
                    orderBy: { createdAt: 'desc' },
                    take: limit,
                    skip: offset
                }),
                prisma.auditLog.count({ where: whereClause })
            ]);

            res.json({
                logs,
                total,
                limit,
                offset,
                hasMore: offset + logs.length < total
            });
        } catch (error) {
            console.error('Get audit logs error:', error);
            res.status(500).json({ error: 'Failed to get audit logs' });
        }
    });

    // ============================================
    // Scheduled Reports Endpoints
    // ============================================

    const VALID_FREQUENCIES = ['weekly', 'monthly'];
    const VALID_REPORT_TYPES = ['usage-summary', 'license-utilization', 'inactive-users', 'activity-summary'];

    const REPORT_TYPE_INFO = [
        { id: 'usage-summary', name: 'Usage Summary', description: 'Overview of user activity and license usage' },
        { id: 'license-utilization', name: 'License Utilization', description: 'License usage rates and cost analysis' },
        { id: 'inactive-users', name: 'Inactive Users', description: 'List of users with no recent activity' },
        { id: 'activity-summary', name: 'Activity Summary', description: 'Breakdown of activity by time period' }
    ];

    // Get all scheduled reports for account
    app.get('/api/reports/schedules', auth.requireAuth, async (req, res) => {
        try {
            const schedules = await prisma.scheduledReport.findMany({
                where: { accountId: req.session.accountId },
                orderBy: { createdAt: 'desc' }
            });
            res.json({ schedules });
        } catch (error) {
            console.error('Get schedules error:', error);
            res.status(500).json({ error: 'Failed to get report schedules' });
        }
    });

    // Create new scheduled report
    app.post('/api/reports/schedules', auth.requireAuth, async (req, res) => {
        try {
            const { name, frequency, reportType, dayOfWeek, dayOfMonth, recipients } = req.body;

            // Validate required fields
            if (!name) {
                return res.status(400).json({ error: 'name is required' });
            }

            if (!VALID_FREQUENCIES.includes(frequency)) {
                return res.status(400).json({ error: `Invalid frequency. Must be one of: ${VALID_FREQUENCIES.join(', ')}` });
            }

            if (!VALID_REPORT_TYPES.includes(reportType)) {
                return res.status(400).json({ error: `Invalid reportType. Must be one of: ${VALID_REPORT_TYPES.join(', ')}` });
            }

            if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
                return res.status(400).json({ error: 'At least one recipient email is required' });
            }

            if (frequency === 'weekly' && !dayOfWeek) {
                return res.status(400).json({ error: 'dayOfWeek is required for weekly frequency' });
            }

            if (frequency === 'weekly' && !VALID_DAYS_OF_WEEK.includes(dayOfWeek?.toLowerCase())) {
                return res.status(400).json({ error: `Invalid dayOfWeek. Must be one of: ${VALID_DAYS_OF_WEEK.join(', ')}` });
            }

            const schedule = await prisma.scheduledReport.create({
                data: {
                    accountId: req.session.accountId,
                    name,
                    frequency,
                    reportType,
                    dayOfWeek: dayOfWeek?.toLowerCase(),
                    dayOfMonth: dayOfMonth ? Number.parseInt(dayOfMonth, 10) : null,
                    recipients
                }
            });

            res.status(201).json({ success: true, schedule });
        } catch (error) {
            console.error('Create schedule error:', error);
            res.status(500).json({ error: 'Failed to create report schedule' });
        }
    });

    // Update scheduled report
    app.put('/api/reports/schedules/:id', auth.requireAuth, async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;

            // Verify ownership
            const existing = await prisma.scheduledReport.findFirst({
                where: { id, accountId: req.session.accountId }
            });

            if (!existing) {
                return res.status(404).json({ error: 'Schedule not found' });
            }

            // Validate if changing frequency/reportType
            if (updates.frequency && !VALID_FREQUENCIES.includes(updates.frequency)) {
                return res.status(400).json({ error: `Invalid frequency` });
            }

            if (updates.reportType && !VALID_REPORT_TYPES.includes(updates.reportType)) {
                return res.status(400).json({ error: `Invalid reportType` });
            }

            const schedule = await prisma.scheduledReport.update({
                where: { id },
                data: {
                    name: updates.name,
                    frequency: updates.frequency,
                    reportType: updates.reportType,
                    dayOfWeek: updates.dayOfWeek?.toLowerCase(),
                    dayOfMonth: updates.dayOfMonth,
                    recipients: updates.recipients,
                    enabled: updates.enabled
                }
            });

            res.json({ success: true, schedule });
        } catch (error) {
            console.error('Update schedule error:', error);
            res.status(500).json({ error: 'Failed to update report schedule' });
        }
    });

    // Delete scheduled report
    app.delete('/api/reports/schedules/:id', auth.requireAuth, async (req, res) => {
        try {
            const { id } = req.params;

            // Verify ownership
            const existing = await prisma.scheduledReport.findFirst({
                where: { id, accountId: req.session.accountId }
            });

            if (!existing) {
                return res.status(404).json({ error: 'Schedule not found' });
            }

            await prisma.scheduledReport.delete({ where: { id } });

            res.json({ success: true });
        } catch (error) {
            console.error('Delete schedule error:', error);
            res.status(500).json({ error: 'Failed to delete report schedule' });
        }
    });

    // Get available report types
    app.get('/api/reports/types', auth.requireAuth, async (req, res) => {
        res.json({ types: REPORT_TYPE_INFO });
    });

    // ============================================
    // User Activity History Endpoints
    // ============================================

    // Get user activity history
    app.get('/api/users/:userId/activity', auth.requireAuth, async (req, res) => {
        try {
            const { userId } = req.params;
            const rawLimit = Number.parseInt(req.query.limit ?? '50', 10);
            const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 50;
            const rawOffset = Number.parseInt(req.query.offset ?? '0', 10);
            const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

            // Verify user belongs to this account
            const user = await prisma.user.findFirst({
                where: {
                    id: userId,
                    accountId: req.session.accountId
                },
                include: {
                    windowsUsernames: true
                }
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Get usernames to match against events
            const usernames = user.windowsUsernames.map(wu => wu.username);

            // Build date filters
            const whereClause = {
                accountId: req.session.accountId,
                windowsUser: { in: usernames.length > 0 ? usernames : ['__no_match__'] }
            };

            if (req.query.startDate) {
                whereClause.when = { ...whereClause.when, gte: new Date(req.query.startDate) };
            }
            if (req.query.endDate) {
                whereClause.when = { ...whereClause.when, lte: new Date(req.query.endDate) };
            }

            // Get total count
            const total = await prisma.usageEvent.count({ where: whereClause });

            // Get activities
            const activities = await prisma.usageEvent.findMany({
                where: whereClause,
                orderBy: { when: 'desc' },
                take: limit,
                skip: offset,
                select: {
                    id: true,
                    event: true,
                    url: true,
                    when: true,
                    source: true,
                    windowTitle: true,
                    browser: true,
                    computerName: true
                }
            });

            res.json({
                userId,
                activities,
                total,
                limit,
                offset,
                hasMore: offset + activities.length < total
            });
        } catch (error) {
            console.error('Get user activity error:', error);
            res.status(500).json({ error: 'Failed to get user activity' });
        }
    });

    // Get user activity summary
    app.get('/api/users/:userId/activity/summary', auth.requireAuth, async (req, res) => {
        try {
            const { userId } = req.params;

            // Verify user belongs to this account
            const user = await prisma.user.findFirst({
                where: {
                    id: userId,
                    accountId: req.session.accountId
                },
                include: {
                    windowsUsernames: true
                }
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const usernames = user.windowsUsernames.map(wu => wu.username);

            const whereClause = {
                accountId: req.session.accountId,
                windowsUser: { in: usernames.length > 0 ? usernames : ['__no_match__'] }
            };

            // Get all events for aggregation
            const events = await prisma.usageEvent.findMany({
                where: whereClause,
                select: {
                    url: true,
                    source: true,
                    when: true
                }
            });

            // Aggregate by application
            const appCounts = {};
            const sourceCounts = {};
            let lastActivity = null;

            for (const event of events) {
                // Track by application/URL
                const app = event.url;
                appCounts[app] = (appCounts[app] || 0) + 1;

                // Track by source
                sourceCounts[event.source] = (sourceCounts[event.source] || 0) + 1;

                // Track last activity
                if (!lastActivity || new Date(event.when) > new Date(lastActivity)) {
                    lastActivity = event.when;
                }
            }

            res.json({
                userId,
                totalEvents: events.length,
                byApplication: Object.entries(appCounts)
                    .map(([application, count]) => ({ application, count }))
                    .sort((a, b) => b.count - a.count),
                bySource: Object.entries(sourceCounts)
                    .map(([source, count]) => ({ source, count }))
                    .sort((a, b) => b.count - a.count),
                lastActivity
            });
        } catch (error) {
            console.error('Get user activity summary error:', error);
            res.status(500).json({ error: 'Failed to get activity summary' });
        }
    });

    // ============================================
    // User Endpoints (continued)
    // ============================================

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
            const resetCursor = req.query.reset === 'true' || req.query.resetCursor === 'true';
            const cursorHours = Number.parseInt(req.query.cursorHours ?? req.query.backfillHours ?? '0', 10);
            await db.deleteAllUsageEvents(req.session.accountId, { resetCursor, cursorHours });
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
                        const emailKey = ['email', 'e_mail', 'user_email', 'username', 'upn', 'user_principal_name']
                            .find(k => k in firstRecord);
                        if (!emailKey) {
                            return res.status(400).json({
                                error: 'Missing required column: email'
                            });
                        }
                        // Normalize to .email for downstream logic
                        normalizedRecords.forEach(r => {
                            if (!r.email) {
                                const key = Object.keys(r).find(k => ['email', 'e_mail', 'user_email', 'username', 'upn', 'user_principal_name'].includes(k));
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
                                // Update existing user - merge licenses instead of replacing
                                const licensesStr = userData.team_products || userData.licenses;
                                const csvLicensesArray = licensesStr ? licensesStr.split(',').map(l => l.trim()).filter(l => l) : [];

                                // ✅ Merge CSV licenses with existing Adobe licenses (preserve existing, add new from CSV)
                                // Note: entraLicenses are separate and managed by Entra sync, so we only merge Adobe licenses
                                const existingAdobeLicenses = Array.isArray(existingUser.licenses) ? existingUser.licenses : [];
                                const existingEntraLicenses = Array.isArray(existingUser.entraLicenses) ? existingUser.entraLicenses : [];
                                const mergedLicenses = [...new Set([...existingAdobeLicenses, ...csvLicensesArray])]; // Deduplicate
                                const licensesArray = mergedLicenses.length > 0 ? mergedLicenses : existingAdobeLicenses;

                                // Debug logging for production troubleshooting
                                if (csvLicensesArray.length > 0) {
                                    console.log(`[Import] Updating user ${existingUser.email}:`);
                                    console.log(`  - Existing Adobe licenses: ${existingAdobeLicenses.length}`, existingAdobeLicenses);
                                    console.log(`  - Existing Entra licenses: ${existingEntraLicenses.length}`, existingEntraLicenses);
                                    console.log(`  - CSV licenses: ${csvLicensesArray.length}`, csvLicensesArray);
                                    console.log(`  - Merged Adobe licenses: ${licensesArray.length}`, licensesArray);
                                }

                                const updateData = {
                                    firstName: userData.first_name || userData.firstname || existingUser.firstName,
                                    lastName: userData.last_name || userData.lastname || existingUser.lastName,
                                    licenses: licensesArray,
                                    adminRoles: userData.admin_roles || userData.adminroles || existingUser.adminRoles,
                                    userGroups: userData.user_groups || userData.usergroups || existingUser.userGroups
                                };

                                // ✅ Use existing user's email (canonical from database) instead of CSV email to ensure case consistency
                                await db.updateUser(req.session.accountId, existingUser.email, updateData);
                                updated++;

                                // ✅ IMPROVED: Add small delay to ensure database transaction completes before responding
                                // This prevents race conditions where page reload happens before DB commit
                                await new Promise(resolve => setTimeout(resolve, 500));
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
            const limit = parseInt(req.query.limit, 10) || 1000;
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
            const accountId = req.session.accountId;
            const limit = parseInt(req.query.limit, 10) || 100;
            const awaitSync = req.query.awaitSync === 'true';
            const forceSync = req.query.force === 'true';
            const forceBackfill = req.query.forceBackfill === 'true';
            const backfillHours = Number.parseInt(req.query.backfillHours, 10) || 24;

            const syncOptions = {
                ...(forceBackfill ? { force: true, backfillHours, maxPages: 5 } : {}),
                ...(forceSync ? { force: true } : {})
            };

            const syncMeta = {
                triggered: false,
                awaited: awaitSync,
                forceBackfill,
                forced: forceSync
            };

            if (awaitSync) {
                const syncStart = Date.now();
                let timeoutId;

                console.log(`[SYNC-DEBUG] Starting sync for account ${accountId}, force=${forceSync}`);

                // Initialize sync status
                activeSyncs.set(accountId, {
                    active: true,
                    message: 'Connecting to Microsoft Graph API...',
                    progress: 5,
                    startedAt: new Date(),
                    lastUpdate: new Date(),
                    debug: {
                        accountId,
                        forceSync,
                        forceBackfill,
                        awaitSync,
                        syncStart: new Date(syncStart).toISOString()
                    }
                });

                const progressCallback = (progress) => {
                    console.log(`[SYNC-DEBUG] Progress update for account ${accountId}:`, progress);
                    activeSyncs.set(accountId, {
                        active: true,
                        message: progress.message,
                        progress: Math.min(90, Math.max(10, (progress.page / 10) * 100)), // Estimate progress based on pages
                        startedAt: new Date(syncStart),
                        lastUpdate: new Date(),
                        details: progress,
                        debug: {
                            accountId,
                            forceSync,
                            forceBackfill,
                            awaitSync,
                            syncStart: new Date(syncStart).toISOString()
                        }
                    });
                };

                const syncOptionsWithProgress = { ...syncOptions, onProgress: progressCallback };

                const syncPromise = db.syncEntraSignInsIfNeeded(accountId, syncOptionsWithProgress)
                    .then(result => {
                        console.log(`[SYNC-DEBUG] Sync completed successfully for account ${accountId}:`, result);
                        activeSyncs.set(accountId, {
                            active: false,
                            message: `Sync completed: ${result.count || 0} events synced`,
                            progress: 100,
                            startedAt: new Date(syncStart),
                            lastUpdate: new Date(),
                            result,
                            debug: {
                                accountId,
                                forceSync,
                                forceBackfill,
                                awaitSync,
                                syncStart: new Date(syncStart).toISOString(),
                                completedAt: new Date().toISOString(),
                                duration: Date.now() - syncStart
                            }
                        });
                        return { ...result, error: false };
                    })
                    .catch(error => {
                        console.warn('Entra sync failed (non-fatal):', error);
                        const isGraphThrottle = error?.statusCode === 429 || error?.code === 'TooManyRequests';
                        const isTimeout = error?.message?.includes('timeout');
                        const isPermissionError = error?.statusCode === 403 || error?.code === 'Forbidden';

                        // Use enhanced error message if available, otherwise provide defaults
                        const errorResult = {
                            error: true,
                            reason: isGraphThrottle ? 'graph-throttled' :
                                isTimeout ? 'timeout' :
                                    isPermissionError ? 'permission-denied' :
                                        (error.reason || 'error'),
                            message: error.message || (isGraphThrottle ? 'Microsoft Graph returned 429 (Too Many Requests).' : 'Failed to sync Microsoft Entra sign-ins'),
                            helpText: error.helpText,
                            statusCode: error?.statusCode,
                            details: error?.details
                        };

                        activeSyncs.set(accountId, {
                            active: false,
                            message: `Sync failed: ${errorResult.message}`,
                            progress: 0,
                            startedAt: new Date(syncStart),
                            lastUpdate: new Date(),
                            error: errorResult
                        });

                        return errorResult;
                    });

                const timeoutPromise = new Promise((resolve) => {
                    timeoutId = setTimeout(() => {
                        activeSyncs.set(accountId, {
                            active: false,
                            message: `Sync timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Large datasets may take longer.`,
                            progress: 0,
                            startedAt: new Date(syncStart),
                            lastUpdate: new Date(),
                            error: { reason: 'timeout', message: `Sync exceeded ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Try again or check your internet connection.` }
                        });
                        resolve({
                            error: true,
                            reason: 'timeout',
                            message: `Sync exceeded ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Try again or check your internet connection.`
                        });
                    }, REQUEST_TIMEOUT_MS);
                });

                try {
                    const syncOutcome = await Promise.race([syncPromise, timeoutPromise]);
                    Object.assign(syncMeta, syncOutcome, {
                        triggered: true,
                        durationMs: Date.now() - syncStart
                    });
                } finally {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                    // Clean up sync status after a delay
                    setTimeout(() => {
                        activeSyncs.delete(accountId);
                    }, 30000); // Keep status for 30 seconds after completion
                }
            } else {
                db.syncEntraSignInsIfNeeded(accountId, syncOptions)
                    .then(result => {
                        if (result?.synced) {
                            console.log('Background Entra sign-in sync completed:', {
                                accountId,
                                count: result.count,
                                lastSync: result.lastSync
                            });
                        }
                    })
                    .catch(error => {
                        console.warn('Background Entra sign-in sync failed:', error?.message || error);
                    });

                syncMeta.triggered = true;
                syncMeta.status = 'background';
            }

            const usageData = await db.getUsageData(accountId, limit);
            const account = await db.prisma.account.findUnique({
                where: { id: accountId },
                select: { entraSignInLastSyncAt: true }
            });

            syncMeta.lastSync = account?.entraSignInLastSyncAt || null;

            res.json({
                adobe: usageData.adobe || [],
                wrapper: usageData.wrapper || [],
                entra: usageData.entra || [],
                meta: {
                    sync: syncMeta,
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
            const accountId = req.session.accountId;
            const cacheKey = `stats:${accountId}`;

            // Check cache first
            const cached = statsCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < STATS_CACHE_TTL_MS) {
                return res.json(cached.data);
            }

            // Calculate date ranges
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);

            // Use database-level aggregation instead of loading all data
            const [adobeStats, wrapperStats, entraStats, account] = await Promise.all([
                // Adobe: total, today, this week, unique clients (sample-based for performance)
                Promise.all([
                    prisma.usageEvent.count({ where: { accountId, source: 'adobe' } }),
                    prisma.usageEvent.count({ where: { accountId, source: 'adobe', receivedAt: { gte: today } } }),
                    prisma.usageEvent.count({ where: { accountId, source: 'adobe', receivedAt: { gte: weekAgo } } }),
                    // For unique clients, fetch a sample and deduplicate (much faster than loading all)
                    prisma.usageEvent.findMany({
                        where: { accountId, source: 'adobe' },
                        select: { clientId: true, tabId: true },
                        take: 1000, // Sample size for unique count estimation
                        orderBy: { receivedAt: 'desc' }
                    })
                ]),
                // Wrapper: total, today, this week, unique clients
                Promise.all([
                    prisma.usageEvent.count({ where: { accountId, source: 'wrapper' } }),
                    prisma.usageEvent.count({ where: { accountId, source: 'wrapper', receivedAt: { gte: today } } }),
                    prisma.usageEvent.count({ where: { accountId, source: 'wrapper', receivedAt: { gte: weekAgo } } }),
                    prisma.usageEvent.findMany({
                        where: { accountId, source: 'wrapper' },
                        select: { computerName: true, windowsUser: true },
                        take: 1000,
                        orderBy: { receivedAt: 'desc' }
                    })
                ]),
                // Entra: total, today, this week, unique clients
                Promise.all([
                    prisma.entraSignIn.count({ where: { accountId } }),
                    prisma.entraSignIn.count({ where: { accountId, createdDateTime: { gte: today } } }),
                    prisma.entraSignIn.count({ where: { accountId, createdDateTime: { gte: weekAgo } } }),
                    prisma.entraSignIn.findMany({
                        where: { accountId },
                        select: { userPrincipalName: true, deviceDisplayName: true, ipAddress: true },
                        take: 1000,
                        orderBy: { createdDateTime: 'desc' }
                    })
                ]),
                // Account info for lastSync
                prisma.account.findUnique({
                    where: { id: accountId },
                    select: { entraSignInLastSyncAt: true }
                })
            ]);

            // Calculate unique clients (using Set to deduplicate from sample)
            const uniqueAdobeClients = new Set(
                adobeStats[3].map(e => e.clientId || e.tabId).filter(Boolean)
            ).size;
            const uniqueWrapperClients = new Set(
                wrapperStats[3].map(e => e.computerName || e.windowsUser).filter(Boolean)
            ).size;
            const uniqueEntraDevices = new Set(
                entraStats[3].map(e => e.userPrincipalName || e.deviceDisplayName || e.ipAddress).filter(Boolean)
            ).size;

            const data = {
                adobe: {
                    total: adobeStats[0],
                    today: adobeStats[1],
                    thisWeek: adobeStats[2],
                    uniqueClients: uniqueAdobeClients
                },
                wrapper: {
                    total: wrapperStats[0],
                    today: wrapperStats[1],
                    thisWeek: wrapperStats[2],
                    uniqueClients: uniqueWrapperClients
                },
                entra: {
                    total: entraStats[0],
                    today: entraStats[1],
                    thisWeek: entraStats[2],
                    uniqueClients: uniqueEntraDevices
                },
                meta: {
                    sync: {
                        lastSync: account?.entraSignInLastSyncAt || null,
                        awaited: false,
                        triggered: false
                    }
                }
            };

            // Cache the result
            statsCache.set(cacheKey, { data, timestamp: Date.now() });

            res.json(data);
        } catch (error) {
            console.error('Get stats error:', error);
            res.status(500).json({ error: 'Failed to get stats' });
        }
    });

    // Licenses page
    app.get('/licenses', auth.requireAuth, auth.attachAccount, async (req, res) => {
        try {
            res.render('licenses', {
                title: 'SasWatch - Licenses',
                account: req.account
            });
        } catch (error) {
            console.error('Licenses page error:', error);
            res.status(500).send('Error loading licenses page');
        }
    });

    // Get all detected licenses with aggregation (account-scoped)
    app.get('/api/licenses', auth.requireAuth, async (req, res) => {
        try {
            const licenses = await db.getLicensesData(req.session.accountId);

            // Calculate stats
            const stats = {
                totalLicenses: licenses.length,
                totalAssigned: licenses.reduce((sum, l) => sum + l.assigned, 0),
                totalActive: licenses.reduce((sum, l) => sum + l.active, 0),
                avgUtilization: licenses.length > 0
                    ? Math.round(licenses.reduce((sum, l) => sum + l.utilization, 0) / licenses.length)
                    : 0
            };

            res.json({ success: true, licenses, stats });
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

    // Update license cost and pricing info
    app.post('/api/licenses/cost', auth.requireAuth, async (req, res) => {
        try {
            const { licenseName, costPerLicense, totalLicenses, totalCost } = req.body;
            if (!licenseName) {
                return res.status(400).json({ error: 'License name is required' });
            }

            const account = await prisma.account.findUnique({
                where: { id: req.session.accountId },
                select: { licenseCosts: true }
            });

            const licenseCosts = account?.licenseCosts || {};

            // Parse and validate inputs
            const numCostPerLicense = costPerLicense !== undefined && costPerLicense !== '' ? parseFloat(costPerLicense) : null;
            const numTotalLicenses = totalLicenses !== undefined && totalLicenses !== '' ? parseFloat(totalLicenses) : null;
            const numTotalCost = totalCost !== undefined && totalCost !== '' ? parseFloat(totalCost) : null;

            // Validate non-negative numbers
            if (numCostPerLicense !== null && (isNaN(numCostPerLicense) || numCostPerLicense < 0)) {
                return res.status(400).json({ error: 'Cost per license must be a non-negative number' });
            }
            if (numTotalLicenses !== null && (isNaN(numTotalLicenses) || numTotalLicenses < 0)) {
                return res.status(400).json({ error: 'Total licenses must be a non-negative number' });
            }
            if (numTotalCost !== null && (isNaN(numTotalCost) || numTotalCost < 0)) {
                return res.status(400).json({ error: 'Total cost must be a non-negative number' });
            }

            // Calculate missing values based on what's provided
            let finalCostPerLicense = numCostPerLicense;
            let finalTotalLicenses = numTotalLicenses;
            let finalTotalCost = numTotalCost;

            // If total cost is provided and we have licenses, calculate cost per license
            if (finalTotalCost !== null && finalTotalLicenses !== null && finalTotalLicenses > 0) {
                finalCostPerLicense = finalTotalCost / finalTotalLicenses;
            }
            // If cost per license and licenses are provided, calculate total cost
            else if (finalCostPerLicense !== null && finalTotalLicenses !== null) {
                finalTotalCost = finalCostPerLicense * finalTotalLicenses;
            }
            // If total cost and cost per license are provided, calculate licenses
            else if (finalTotalCost !== null && finalCostPerLicense !== null && finalCostPerLicense > 0) {
                finalTotalLicenses = finalTotalCost / finalCostPerLicense;
            }

            // If all values are null/empty, remove the entry
            if (finalCostPerLicense === null && finalTotalLicenses === null && finalTotalCost === null) {
                delete licenseCosts[licenseName];
            } else {
                // Store the values (round to 2 decimals for currency)
                licenseCosts[licenseName] = {
                    costPerLicense: finalCostPerLicense !== null ? Math.round(finalCostPerLicense * 100) / 100 : null,
                    totalLicenses: finalTotalLicenses !== null ? Math.round(finalTotalLicenses) : null,
                    totalCost: finalTotalCost !== null ? Math.round(finalTotalCost * 100) / 100 : null
                };
            }

            await prisma.account.update({
                where: { id: req.session.accountId },
                data: {
                    licenseCosts: licenseCosts
                }
            });

            const result = licenseCosts[licenseName] || null;
            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Update license cost error:', error);
            console.error('Error stack:', error.stack);
            console.error('Request body:', req.body);
            console.error('Account ID:', req.session.accountId);

            // Provide more specific error messages
            let errorMessage = 'Failed to update license cost';
            if (error.code === 'P2002') {
                errorMessage = 'Database constraint violation';
            } else if (error.message) {
                errorMessage = error.message;
            }

            res.status(500).json({ error: errorMessage });
        }
    });
}

// ============================================
// Dashboard Routes (Account-Scoped)
// ============================================

function setupDashboardRoutes(app) {
    // Renewals page (default landing page)
    app.get('/', auth.requireAuth, async (req, res) => {
        try {
            const account = req.account || await auth.getAccountById(req.session.accountId);
            res.render('renewals', {
                title: 'SasWatch - Renewals & Subscriptions',
                account: account
            });
        } catch (error) {
            console.error('Renewals page error:', error);
            res.status(500).send('Error loading renewals page');
        }
    });

    // Users page (moved to /users)
    app.get('/users', auth.requireAuth, async (req, res) => {
        try {
            const account = await auth.getAccountById(req.session.accountId);
            const syncResult = await db.syncEntraUsersIfNeeded(req.session.accountId);
            const usersData = await db.getUsersData(req.session.accountId);

            res.render('users', {
                title: 'SasWatch - Users',
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
                title: 'SasWatch - Dashboard',
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
        const timeout = setTimeout(() => {
            if (!res.headersSent) {
                console.error('[Apps] Request timed out after 30 seconds');
                res.status(504).send('Apps page request timed out. Please try again.');
            }
        }, 30000); // 30-second timeout

        try {
            console.log('[Apps] Loading apps page...');
            const appsData = await db.getAppsData(req.session.accountId);

            clearTimeout(timeout);
            if (!res.headersSent) {
                console.log('[Apps] Rendering apps page...');
                res.render('apps', {
                    title: 'SasWatch - Applications',
                    apps: appsData.apps || [],
                    stats: appsData.stats || {},
                    account: req.account
                });
                console.log('[Apps] Apps page rendered successfully');
            }
        } catch (error) {
            clearTimeout(timeout);
            if (!res.headersSent) {
                console.error('[Apps] Apps page error:', error);
                res.status(500).send('Error loading apps page: ' + error.message);
            }
        }
    });

    // Get apps API endpoint
    app.get('/api/apps', auth.requireAuth, async (req, res) => {
        const timeout = setTimeout(() => {
            if (!res.headersSent) {
                console.error('[Apps API] Request timed out after 30 seconds');
                res.status(504).json({ error: 'Apps API request timed out' });
            }
        }, 30000); // 30-second timeout

        try {
            console.log('[Apps API] Fetching apps data...');
            const appsData = await db.getAppsData(req.session.accountId);

            clearTimeout(timeout);
            if (!res.headersSent) {
                res.json(appsData);
            }
        } catch (error) {
            clearTimeout(timeout);
            if (!res.headersSent) {
                console.error('[Apps API] Get apps error:', error);
                res.status(500).json({ error: 'Failed to get apps: ' + error.message });
            }
        }
    });

    // Get detailed app information with user usage data
    app.get('/api/apps/detail', auth.requireAuth, async (req, res) => {
        try {
            const { id, sourceKey } = req.query;

            if (!id && !sourceKey) {
                return res.status(400).json({ error: 'Either id or sourceKey is required' });
            }

            const appDetail = await db.getAppDetail(req.session.accountId, id, sourceKey);

            if (!appDetail) {
                return res.status(404).json({ error: 'Application not found' });
            }

            res.json(appDetail);
        } catch (error) {
            console.error('Get app detail error:', error);
            res.status(500).json({ error: 'Failed to get app details' });
        }
    });

    app.post('/api/apps/sync', auth.requireAuth, async (req, res) => {
        // Apps sync now just aggregates from the database
        // Use Activity page sync to populate the database first
        const syncResult = {
            synced: false,
            reason: 'aggregated-from-db',
            message: 'Aggregated apps from existing sign-in data in database'
        };

        try {
            const appsData = await db.getAppsData(req.session.accountId);

            // Count how many sign-in events are in the database
            const signInCount = await db.prisma.entraSignIn.count({
                where: { accountId: req.session.accountId }
            });

            syncResult.signInEventsInDb = signInCount;
            syncResult.appsFound = appsData.apps?.length || 0;

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

// ============================================
// Headless Automation Routes
// ============================================

function setupHeadlessRoutes(app) {
    // Headless connect page
    app.get('/headless-connect', auth.requireAuth, auth.attachAccount, async (req, res) => {
        try {
            const connectors = await prisma.headlessConnector.findMany({
                where: { accountId: req.session.accountId }
            });

            res.render('headless-connect', {
                title: 'SasWatch - Headless Connections',
                connectors,
                account: req.account
            });
        } catch (error) {
            console.error('Headless connect page error:', error);
            res.status(500).send('Error loading headless connect page');
        }
    });

    // Capture session (Interactive mode)
    app.post('/api/headless/connect', auth.requireAuth, async (req, res) => {
        try {
            const { vendor } = req.body;
            if (!vendor) return res.status(400).json({ error: 'Vendor is required' });

            // In local dev, we use captureSession which opens a headed browser
            // In production, we might need a different UI flow (like a VNC or remote browser)
            // For now, let's implement the trigger.
            console.log(`[Headless] Triggering session capture for ${vendor}`);

            // This is a placeholder for the actual interactive capture flow
            // which usually needs a separate process or a sophisticated frontend.
            // For this MVP, we'll suggest using a dummy successful capture if in dev
            if (process.env.NODE_ENV === 'development') {
                await prisma.headlessConnector.upsert({
                    where: { accountId_vendor: { accountId: req.session.accountId, vendor } },
                    update: { status: 'pending', errorMessage: null },
                    create: { accountId: req.session.accountId, vendor, status: 'pending' }
                });

                return res.json({
                    success: true,
                    message: `Initial connection for ${vendor} initialized. Please use the server console to complete login in headed mode.`
                });
            }

            res.status(501).json({ error: 'Interactive capture not yet implemented for production' });
        } catch (error) {
            console.error('Headless connect error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Trigger sync
    app.post('/api/headless/sync', auth.requireAuth, async (req, res) => {
        try {
            const { vendor } = req.body;
            if (!vendor) return res.status(400).json({ error: 'Vendor is required' });

            const accountId = req.session.accountId;

            // Re-use activeSyncs map for status tracking
            activeSyncs.set(accountId, {
                active: true,
                message: `Automating login to ${vendor}...`,
                progress: 10,
                startedAt: new Date(),
                lastUpdate: new Date()
            });

            // Run in background
            headlessManager.sync(accountId, vendor)
                .then(result => {
                    activeSyncs.set(accountId, {
                        active: false,
                        message: `Sync completed for ${vendor}`,
                        progress: 100,
                        startedAt: new Date(),
                        lastUpdate: new Date()
                    });
                    setTimeout(() => activeSyncs.delete(accountId), 60000);
                })
                .catch(error => {
                    activeSyncs.set(accountId, {
                        active: false,
                        message: `Sync failed for ${vendor}: ${error.message}`,
                        progress: 0,
                        startedAt: new Date(),
                        lastUpdate: new Date(),
                        error: true
                    });
                    setTimeout(() => activeSyncs.delete(accountId), 60000);
                });

            res.json({ success: true, message: 'Sync started in background' });
        } catch (error) {
            console.error('Headless sync error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Status endpoint
    app.get('/api/headless/status', auth.requireAuth, (req, res) => {
        const syncStatus = activeSyncs.get(req.session.accountId);
        res.json(syncStatus || { active: false });
    });
}

function setupMultiTenantRoutes(app) {

    console.log('Setting up multi-tenant routes...');

    setupSession(app);
    setupAuthRoutes(app);
    setupAccountRoutes(app);
    setupScriptRoutes(app);
    setupTrackingAPI(app);
    setupDataRoutes(app);
    setupHeadlessRoutes(app);
    setupDevRoutes(app);

    setupDashboardRoutes(app);
    setupAppsRoutes(app);
    setupAdminRoutes(app);

    console.log('✓ Multi-tenant routes configured');
}

// ============================================
// Admin Routes (Super Admin Only)
// ============================================

function setupAdminRoutes(app) {
    // Admin dashboard - list all accounts
    app.get('/admin', auth.requireAuth, auth.attachAccount, auth.requireSuperAdmin, async (req, res) => {
        // Add timeout to prevent hanging
        const timeout = setTimeout(() => {
            if (!res.headersSent) {
                console.error('[Admin] Request timeout after 30 seconds');
                res.status(504).send('Request timeout');
            }
        }, 30000);

        try {
            console.log('[Admin] Loading admin dashboard...');

            // Ensure account is set
            if (!req.account && req.session.accountId) {
                req.account = await auth.getAccountById(req.session.accountId);
            }
            const currentAccount = req.account;

            if (!currentAccount) {
                clearTimeout(timeout);
                return res.status(401).send('Account not found');
            }

            console.log('[Admin] Fetching accounts...');
            const accounts = await prisma.account.findMany({
                select: {
                    id: true,
                    name: true,
                    email: true,
                    subscriptionTier: true,
                    isActive: true,
                    isSuperAdmin: true,
                    createdAt: true,
                    lastLoginAt: true,
                    entraConnectedAt: true,
                    entraTenantId: true
                },
                orderBy: { createdAt: 'desc' }
            });

            console.log(`[Admin] Found ${accounts.length} accounts, loading stats...`);

            // ✅ OPTIMIZED: Process accounts SEQUENTIALLY to prevent memory exhaustion
            // Running all stats queries in parallel was overwhelming Railway's limited resources
            const accountsWithStats = [];
            for (const account of accounts) {
                try {
                    // Check if we still have time (allow 3s per account max)
                    const stats = await Promise.race([
                        db.getDatabaseStats(account.id),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Stats timeout')), 3000)
                        )
                    ]);
                    accountsWithStats.push({ ...account, stats });
                } catch (error) {
                    console.error(`[Admin] Error/timeout getting stats for account ${account.id}:`, error.message);
                    // Return account with default stats if query fails/times out
                    accountsWithStats.push({
                        ...account,
                        stats: {
                            users: 0,
                            usageEvents: 0,
                            unmappedUsernames: 0,
                            signInEvents: 0
                        }
                    });
                }
            }

            console.log('[Admin] Rendering admin page...');
            clearTimeout(timeout);
            res.render('admin', {
                title: 'Admin Dashboard',
                accounts: accountsWithStats,
                currentAccount: currentAccount
            });
            console.log('[Admin] Admin dashboard rendered successfully');
        } catch (error) {
            clearTimeout(timeout);
            console.error('[Admin] Admin dashboard error:', error);
            console.error('[Admin] Error stack:', error.stack);
            if (!res.headersSent) {
                res.status(500).send('Error loading admin dashboard');
            }
        }
    });

    // Get activity data for a specific account
    app.get('/api/admin/accounts/:id/activity', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        try {
            const accountId = req.params.id;

            // Verify account exists
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { id: true, email: true, name: true }
            });

            if (!account) {
                return res.status(404).json({ error: 'Account not found' });
            }

            // Get recent activity
            const [recentSignIns, recentEvents, userCount, appCount] = await Promise.all([
                prisma.entraSignIn.findMany({
                    where: { accountId },
                    orderBy: { createdDateTime: 'desc' },
                    take: 10,
                    select: {
                        id: true,
                        createdDateTime: true,
                        userDisplayName: true,
                        userPrincipalName: true,
                        appDisplayName: true,
                        ipAddress: true,
                        riskState: true,
                        conditionalAccessStatus: true
                    }
                }),
                prisma.usageEvent.findMany({
                    where: { accountId },
                    orderBy: { when: 'desc' },
                    take: 10,
                    select: {
                        id: true,
                        event: true,
                        url: true,
                        when: true,
                        source: true
                    }
                }),
                prisma.user.count({ where: { accountId } }),
                prisma.application.count({ where: { accountId } })
            ]);

            res.json({
                success: true,
                account: {
                    id: account.id,
                    email: account.email,
                    name: account.name
                },
                activity: {
                    recentSignIns,
                    recentEvents,
                    userCount,
                    appCount
                }
            });
        } catch (error) {
            console.error('Admin activity error:', error);
            res.status(500).json({ error: 'Failed to fetch account activity' });
        }
    });

    // Toggle account active status
    app.post('/admin/accounts/:id/toggle-active', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        try {
            const accountId = req.params.id;
            const { isActive } = req.body;

            // Prevent disabling yourself
            if (accountId === req.account.id && isActive === false) {
                return res.status(400).json({
                    error: 'Cannot disable your own account'
                });
            }

            const account = await prisma.account.update({
                where: { id: accountId },
                data: { isActive: isActive === true || isActive === 'true' },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    isActive: true
                }
            });

            // Log admin action
            auditLog('ADMIN_ACCOUNT_TOGGLE', req.account.id, {
                action: isActive ? 'enabled' : 'disabled',
                targetAccountId: accountId,
                targetEmail: account.email,
                targetName: account.name
            }, req);

            res.json({
                success: true,
                account,
                message: `Account ${account.isActive ? 'enabled' : 'disabled'} successfully`
            });
        } catch (error) {
            console.error('Toggle account error:', error);
            res.status(500).json({ error: 'Failed to update account status' });
        }
    });

    // Update account (platform admin + active status)
    app.post('/admin/accounts/:id/update', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        try {
            const accountId = req.params.id;
            const { isActive, platformAdmin } = req.body;

            // Prevent disabling yourself
            if (accountId === req.account.id && isActive === false) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot disable your own account'
                });
            }

            const account = await prisma.account.update({
                where: { id: accountId },
                data: {
                    isActive: isActive === true || isActive === 'true',
                    platformAdmin: platformAdmin === true || platformAdmin === 'true',
                    isSuperAdmin: platformAdmin === true || platformAdmin === 'true' // keep legacy in sync
                },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    isActive: true,
                    platformAdmin: true,
                    isSuperAdmin: true
                }
            });

            auditLog('ADMIN_ACCOUNT_UPDATE', req.account.id, {
                targetAccountId: accountId,
                targetEmail: account.email,
                targetName: account.name,
                isActive: account.isActive,
                platformAdmin: account.platformAdmin
            }, req);

            res.json({
                success: true,
                account,
                message: 'Account updated successfully'
            });
        } catch (error) {
            console.error('Update account error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update account'
            });
        }
    });

    // Toggle platform admin status
    app.post('/admin/accounts/:id/toggle-platform-admin', auth.requireAuth, auth.requirePlatformAdmin, async (req, res) => {
        try {
            const accountId = req.params.id;
            const { platformAdmin } = req.body;

            // Prevent modifying yourself
            if (accountId === req.account.id) {
                return res.status(400).json({
                    error: 'Cannot modify your own platform admin status'
                });
            }

            const account = await prisma.account.update({
                where: { id: accountId },
                data: {
                    platformAdmin: platformAdmin === true || platformAdmin === 'true',
                    isSuperAdmin: platformAdmin === true || platformAdmin === 'true' // Keep legacy field in sync
                },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    platformAdmin: true,
                    isSuperAdmin: true
                }
            });

            // Log admin action
            auditLog('PLATFORM_ADMIN_TOGGLE', req.account.id, {
                action: account.platformAdmin ? 'granted' : 'revoked',
                targetAccountId: accountId,
                targetEmail: account.email,
                targetName: account.name
            }, req);

            res.json({
                success: true,
                account,
                message: `Platform admin ${account.platformAdmin ? 'granted to' : 'revoked from'} ${account.name}`
            });
        } catch (error) {
            console.error('Toggle platform admin error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update platform admin status'
            });
        }
    });

    // Delete account (permanently removes account and all associated data)
    app.delete('/admin/accounts/:id', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        try {
            const accountId = req.params.id;

            // Prevent deleting yourself
            if (accountId === req.account.id) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot delete your own account'
                });
            }

            // Get account info before deletion for audit log
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    platformAdmin: true
                }
            });

            if (!account) {
                return res.status(404).json({
                    success: false,
                    error: 'Account not found'
                });
            }

            // Prevent deleting other platform admins (safety check)
            if (account.platformAdmin) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot delete platform admin accounts. Revoke platform admin status first.'
                });
            }

            // Delete account (cascade will handle related data)
            await prisma.account.delete({
                where: { id: accountId }
            });

            // Log admin action
            auditLog('ADMIN_ACCOUNT_DELETED', req.account.id, {
                deletedAccountId: accountId,
                deletedEmail: account.email,
                deletedName: account.name
            }, req);

            res.json({
                success: true,
                message: `Account "${account.name}" has been permanently deleted`
            });
        } catch (error) {
            console.error('Delete account error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete account: ' + error.message
            });
        }
    });

    // View single account details
    app.get('/admin/accounts/:id', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        try {
            const accountId = req.params.id;

            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    subscriptionTier: true,
                    isActive: true,
                    isSuperAdmin: true,
                    createdAt: true,
                    updatedAt: true,
                    lastLoginAt: true,
                    entraConnectedAt: true,
                    entraTenantId: true,
                    entraLastSyncAt: true
                }
            });

            if (!account) {
                return res.status(404).send('Account not found');
            }

            const stats = await db.getDatabaseStats(accountId);

            res.render('admin-account-detail', {
                title: `Account: ${account.name}`,
                account,
                stats,
                currentAccount: req.account
            });
        } catch (error) {
            console.error('Admin account detail error:', error);
            res.status(500).send('Error loading account details');
        }
    });

    // Superadmin-only: Manually trigger Graph API sync to database
    app.post('/api/admin/sync-graph', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        console.log('[Admin Sync] Superadmin triggered manual Graph API sync');

        // Get Socket.IO instance for progress updates
        const io = req.app.get('io');

        try {
            const accountId = req.session.accountId;
            const body = req.body || {};

            const clamp = (value, min, max, fallback) => {
                if (!Number.isFinite(value)) {
                    return fallback;
                }
                return Math.min(Math.max(value, min), max);
            };

            const lookbackHours = clamp(Number.parseInt(body.backfillHours, 10), 1, 168, 24);
            const requestedLimit = clamp(Number.parseInt(body.limit, 10), 1, 1000, NaN);
            const fallbackPageSize = Number.isFinite(requestedLimit) ? requestedLimit : 50;
            const requestedPageSize = clamp(
                Number.parseInt(body.pageSize, 10),
                1,
                999,
                fallbackPageSize
            );
            const pageSize = requestedPageSize;
            const inferredLimit = Number.isFinite(requestedLimit) ? requestedLimit : pageSize;
            const derivedMaxPages = Math.max(1, Math.ceil(inferredLimit / pageSize));
            const safeDerivedMaxPages = Math.min(Math.max(derivedMaxPages, 1), 20);
            const requestedMaxPages = clamp(Number.parseInt(body.maxPages, 10), 1, 20, safeDerivedMaxPages);
            const maxPages = requestedMaxPages;

            // Verify account has Entra configured
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { entraTenantId: true, email: true }
            });

            if (!account?.entraTenantId) {
                return res.status(400).json({
                    success: false,
                    error: 'Microsoft Entra not connected. Go to Account Settings to connect.'
                });
            }

            console.log(`[Admin Sync] Starting sync for ${account.email} with lookbackHours=${lookbackHours}, pageSize=${pageSize}, maxPages=${maxPages}`);

            // Send initial progress update immediately
            if (io) {
                io.of('/dashboard').to(`account:${accountId}`).emit('sync:progress', {
                    message: `Starting Microsoft Graph sync (lookback ${lookbackHours}h, up to ~${pageSize * maxPages} events)...`,
                    progress: 0,
                    page: 0,
                    eventsFetched: 0
                });
            }

            // Also log to sync log immediately
            console.log('[Admin Sync] Graph API sync initiated - progress updates will be sent via Socket.IO');

            // Track progress for Socket.IO updates
            let lastProgressUpdate = Date.now();
            const PROGRESS_UPDATE_INTERVAL = 1000; // Update every second

            // Add timeout wrapper for the entire sync operation (10 minutes max for large backfills)
            // First page alone can take 5 minutes, so we need more time for multiple pages
            const SYNC_TIMEOUT_MS = 10 * 60 * 1000;
            const syncPromise = db.syncEntraSignInsIfNeeded(accountId, {
                force: true,
                top: pageSize,
                maxPages,
                backfillHours: lookbackHours,
                onProgress: (progress) => {
                    // Throttle progress updates to avoid flooding
                    const now = Date.now();
                    if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
                        lastProgressUpdate = now;

                        // Log progress to console
                        console.log(`[Admin Sync] Progress: ${progress.message} - Page ${progress.page}, ${progress.eventsFetched} events`);

                        if (io) {
                            const progressPercent = Math.min(95, Math.floor((progress.page / maxPages) * 100));
                            io.of('/dashboard').to(`account:${accountId}`).emit('sync:progress', {
                                message: progress.message || `Fetching page ${progress.page}...`,
                                progress: progressPercent,
                                page: progress.page,
                                eventsFetched: progress.eventsFetched,
                                elapsedMs: progress.elapsedMs
                            });
                        }
                    }
                }
            });

            // Race sync against timeout
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Sync operation timed out after ${SYNC_TIMEOUT_MS / 1000} seconds. The Graph API may be slow or unresponsive.`));
                }, SYNC_TIMEOUT_MS);
            });

            const signInResult = await Promise.race([syncPromise, timeoutPromise]);

            console.log('[Admin Sync] Sync completed:', signInResult);

            // Send completion update
            if (io) {
                io.of('/dashboard').to(`account:${accountId}`).emit('sync:complete', {
                    message: `Synced ${signInResult.count || 0} sign-in events from Microsoft Graph`,
                    count: signInResult.count || 0,
                    success: true
                });
            }

            res.json({
                success: true,
                signIns: signInResult,
                message: `Synced ${signInResult.count || 0} sign-in events from Microsoft Graph`,
                settings: {
                    lookbackHours,
                    pageSize,
                    maxPages
                }
            });

        } catch (error) {
            console.error('[Admin Sync] Error:', error);
            console.error('[Admin Sync] Error stack:', error.stack);

            // Determine user-friendly error message
            let userMessage = error.message || 'Graph sync failed';
            if (error.message?.includes('timeout')) {
                userMessage = 'Sync timed out - Microsoft Graph API may be slow. Try again with fewer pages.';
            } else if (error.message?.includes('ENOTFOUND') || error.message?.includes('ECONNREFUSED')) {
                userMessage = 'Cannot connect to Microsoft Graph API. Check your internet connection.';
            } else if (error.statusCode === 403) {
                userMessage = 'Permission denied. Ensure AuditLog.Read.All has admin consent.';
            } else if (error.statusCode === 429) {
                userMessage = 'Rate limit exceeded. Please wait a few minutes and try again.';
            }

            // Send error update via Socket.IO
            if (io && req.session?.accountId) {
                io.of('/dashboard').to(`account:${req.session.accountId}`).emit('sync:complete', {
                    message: userMessage,
                    count: 0,
                    success: false,
                    error: userMessage
                });
            }

            res.status(500).json({
                success: false,
                error: userMessage
            });
        }
    });
}

/**
 * Setup Partner Management Routes (Super Admin Only)
 */
function setupPartnerManagementRoutes(app) {
    // GET /admin/partners - Render partner management dashboard
    app.get('/admin/partners', auth.requireAuth, auth.attachAccount, auth.requireSuperAdmin, async (req, res) => {
        try {
            const partners = await partnerDb.getAllPartners();
            const accounts = await prisma.account.findMany({
                where: { isActive: true },
                select: { id: true, name: true, email: true }
            });

            res.render('admin-partners', {
                title: 'Partner Management',
                partners,
                accounts,
                currentAccount: req.account
            });
        } catch (error) {
            console.error('[Admin-Partner] Error loading partners:', error);
            res.status(500).send('Error loading partner management');
        }
    });

    // POST /api/admin/partners - Create new partner (JSON API)
    app.post('/api/admin/partners', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        try {
            const { accountId, companyName, maxLinkedAccounts } = req.body;

            if (!accountId) {
                return res.status(400).json({ success: false, error: 'Account ID is required' });
            }

            const partner = await partnerDb.createPartnerAccount(accountId, {
                companyName,
                maxLinkedAccounts: maxLinkedAccounts ? parseInt(maxLinkedAccounts) : 100
            });

            auditLog('PARTNER_CREATED', req.account.id, {
                targetPartnerId: partner.id,
                targetAccountId: accountId,
                companyName
            }, req);

            res.json({ success: true, partner });
        } catch (error) {
            console.error('[Admin-Partner] Create error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /api/admin/partners/:id/toggle - Toggle partner active status
    app.post('/api/admin/partners/:id/toggle', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { isActive } = req.body;

            await partnerDb.updatePartnerAccount(id, { isActive });

            auditLog('PARTNER_TOGGLE_ACTIVE', req.account.id, {
                targetPartnerId: id,
                isActive
            }, req);

            res.json({ success: true });
        } catch (error) {
            console.error('[Admin-Partner] Toggle error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /api/admin/partners/:id/link - Link account to partner
    app.post('/api/admin/partners/:id/link', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { linkedAccountId, nickname } = req.body;

            if (!linkedAccountId) {
                return res.status(400).json({ success: false, error: 'Linked Account ID is required' });
            }

            const link = await partnerDb.linkAccountToPartner(id, linkedAccountId, { nickname });

            auditLog('PARTNER_ACCOUNT_LINKED', req.account.id, {
                partnerId: id,
                linkedAccountId,
                nickname
            }, req);

            res.json({ success: true, link });
        } catch (error) {
            console.error('[Admin-Partner] Link error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /api/admin/partners/:id/unlink - Unlink account from partner
    app.post('/api/admin/partners/:id/unlink', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { linkedAccountId } = req.body;

            await partnerDb.unlinkAccountFromPartner(id, linkedAccountId);

            auditLog('PARTNER_ACCOUNT_UNLINKED', req.account.id, {
                partnerId: id,
                linkedAccountId
            }, req);

            res.json({ success: true });
        } catch (error) {
            console.error('[Admin-Partner] Unlink error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /api/admin/partners/:id/key - Regenerate API key
    app.post('/api/admin/partners/:id/key', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const newKey = await partnerDb.regeneratePartnerApiKey(id);

            auditLog('PARTNER_KEY_REGENERATED', req.account.id, {
                targetPartnerId: id
            }, req);

            res.json({ success: true, apiKey: newKey });
        } catch (error) {
            console.error('[Admin-Partner] Key regen error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // GET /admin/partners/:id/details - Get partner details (JSON API)
    app.get('/admin/partners/:id/details', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const partner = await partnerDb.getPartnerById(id);
            if (!partner) return res.status(404).json({ success: false, error: 'Partner not found' });
            res.json({ success: true, partner });
        } catch (error) {
            console.error('[Admin-Partner] Details error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
}

// ============================================
// Renewals/Subscriptions Routes
// ============================================

function setupRenewalsRoutes(app) {
    // Rate limiters for renewals endpoints
    const renewalsApiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // 100 requests per 15 minutes per IP
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            error: 'Too many requests. Please try again later.'
        }
    });

    // Stricter rate limiter for test-alert (prevents email spamming)
    const testAlertLimiter = rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 5, // 5 test alerts per hour per IP
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            error: 'Too many test alerts. Please try again in an hour.'
        }
    });

    // Rate limiter for file uploads (expensive OpenAI calls)
    const uploadLimiter = rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 20, // 20 uploads per hour per IP
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            error: 'Too many uploads. Please try again later.'
        }
    });

    // Renewals page (calendar view)
    app.get('/renewals', auth.requireAuth, async (req, res) => {
        try {
            res.render('renewals', {
                title: 'SasWatch - Renewals & Subscriptions',
                account: req.account
            });
        } catch (error) {
            console.error('Renewals page error:', error);
            res.status(500).send('Error loading renewals page');
        }
    });

    // GET /api/renewals - Get all subscriptions for account
    app.get('/api/renewals', auth.requireAuth, async (req, res) => {
        try {
            const subscriptions = await prisma.subscription.findMany({
                where: {
                    accountId: req.session.accountId
                },
                orderBy: {
                    renewalDate: 'asc'
                }
            });

            res.json({
                success: true,
                subscriptions: subscriptions.map(sub => ({
                    ...sub,
                    renewalDate: sub.renewalDate.toISOString(),
                    cancelByDate: sub.cancelByDate ? sub.cancelByDate.toISOString() : null,
                    createdAt: sub.createdAt.toISOString(),
                    updatedAt: sub.updatedAt.toISOString(),
                    lastAlertSent: sub.lastAlertSent ? sub.lastAlertSent.toISOString() : null,
                    cost: sub.cost ? sub.cost.toString() : null
                }))
            });
        } catch (error) {
            console.error('Error fetching subscriptions:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch subscriptions'
            });
        }
    });

    // POST /api/renewals - Create new subscription
    app.post('/api/renewals', auth.requireAuth, renewalsApiLimiter, async (req, res) => {
        try {
            const { name, vendor, renewalDate, cancelByDate, cost, billingCycle, accountNumber, seats, owner, notes, alertEmail, alertDays } = req.body;

            if (!name || !vendor || !renewalDate) {
                return res.status(400).json({
                    success: false,
                    error: 'Name, vendor, and renewal date are required'
                });
            }

            const subscription = await prisma.subscription.create({
                data: {
                    accountId: req.session.accountId,
                    name,
                    vendor,
                    renewalDate: new Date(renewalDate),
                    cancelByDate: cancelByDate ? new Date(cancelByDate) : null,
                    cost: cost ? parseFloat(cost) : null,
                    billingCycle: billingCycle || 'annual',
                    accountNumber: accountNumber || null,
                    seats: seats ? parseInt(seats) : null,
                    owner: owner || null,
                    notes: notes || null,
                    alertEmail: alertEmail || null,
                    alertDays: alertDays || [60, 30, 7],
                    isArchived: false
                }
            });

            res.json({
                success: true,
                subscription: {
                    ...subscription,
                    renewalDate: subscription.renewalDate.toISOString(),
                    cancelByDate: subscription.cancelByDate ? subscription.cancelByDate.toISOString() : null,
                    cost: subscription.cost ? subscription.cost.toString() : null
                }
            });
        } catch (error) {
            console.error('Error creating subscription:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create subscription'
            });
        }
    });

    // PUT /api/renewals/:id - Update subscription
    app.put('/api/renewals/:id', auth.requireAuth, renewalsApiLimiter, async (req, res) => {
        try {
            const { id } = req.params;
            const { name, vendor, renewalDate, cancelByDate, cost, billingCycle, accountNumber, seats, owner, notes, alertEmail, alertDays, isArchived } = req.body;

            // Verify subscription belongs to account
            const existing = await prisma.subscription.findFirst({
                where: {
                    id,
                    accountId: req.session.accountId
                }
            });

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    error: 'Subscription not found'
                });
            }

            const subscription = await prisma.subscription.update({
                where: { id },
                data: {
                    name: name !== undefined ? name : existing.name,
                    vendor: vendor !== undefined ? vendor : existing.vendor,
                    renewalDate: renewalDate ? new Date(renewalDate) : existing.renewalDate,
                    cancelByDate: cancelByDate !== undefined ? (cancelByDate ? new Date(cancelByDate) : null) : existing.cancelByDate,
                    cost: cost !== undefined ? (cost ? parseFloat(cost) : null) : existing.cost,
                    billingCycle: billingCycle || existing.billingCycle,
                    accountNumber: accountNumber !== undefined ? accountNumber : existing.accountNumber,
                    seats: seats !== undefined ? (seats ? parseInt(seats) : null) : existing.seats,
                    owner: owner !== undefined ? owner : existing.owner,
                    notes: notes !== undefined ? notes : existing.notes,
                    alertEmail: alertEmail !== undefined ? alertEmail : existing.alertEmail,
                    alertDays: alertDays || existing.alertDays,
                    isArchived: isArchived !== undefined ? isArchived : existing.isArchived
                }
            });

            res.json({
                success: true,
                subscription: {
                    ...subscription,
                    renewalDate: subscription.renewalDate.toISOString(),
                    cancelByDate: subscription.cancelByDate ? subscription.cancelByDate.toISOString() : null,
                    cost: subscription.cost ? subscription.cost.toString() : null
                }
            });
        } catch (error) {
            console.error('Error updating subscription:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update subscription'
            });
        }
    });

    // DELETE /api/renewals/:id - Delete subscription
    app.delete('/api/renewals/:id', auth.requireAuth, renewalsApiLimiter, async (req, res) => {
        try {
            const { id } = req.params;

            // Verify subscription belongs to account
            const existing = await prisma.subscription.findFirst({
                where: {
                    id,
                    accountId: req.session.accountId
                }
            });

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    error: 'Subscription not found'
                });
            }

            await prisma.subscription.delete({
                where: { id }
            });

            res.json({
                success: true
            });
        } catch (error) {
            console.error('Error deleting subscription:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete subscription'
            });
        }
    });

    // POST /api/renewals/:id/test-alert - Send a test alert email immediately (dev only)
    app.post('/api/renewals/:id/test-alert', auth.requireAuth, testAlertLimiter, async (req, res) => {
        // Block in production
        if (process.env.NODE_ENV === 'production') {
            return res.status(403).json({
                success: false,
                error: 'Test alerts are not available in production'
            });
        }

        try {
            const { id } = req.params;

            // Verify subscription belongs to account
            const subscription = await prisma.subscription.findFirst({
                where: {
                    id,
                    accountId: req.session.accountId
                },
                include: {
                    account: {
                        select: {
                            email: true,
                            name: true
                        }
                    }
                }
            });

            if (!subscription) {
                return res.status(404).json({
                    success: false,
                    error: 'Subscription not found'
                });
            }

            // Determine recipient email
            const recipientEmail = subscription.alertEmail || subscription.account.email;

            if (!recipientEmail) {
                return res.status(400).json({
                    success: false,
                    error: 'No email address configured for this subscription'
                });
            }

            // Calculate days until renewal for the test email
            const renewalDate = new Date(subscription.renewalDate);
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            renewalDate.setHours(0, 0, 0, 0);
            const daysUntil = Math.floor((renewalDate - now) / (1000 * 60 * 60 * 24));

            // Send test alert email
            const { sendRenewalReminderEmail } = require('./lib/email-sender');
            await sendRenewalReminderEmail({
                to: recipientEmail,
                subscription,
                daysUntil,
                accountName: subscription.account.name
            });

            // Update lastAlertSent timestamp
            await prisma.subscription.update({
                where: { id },
                data: { lastAlertSent: new Date() }
            });

            res.json({
                success: true,
                message: `Test alert sent to ${recipientEmail}`
            });
        } catch (error) {
            console.error('Error sending test alert:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to send test alert'
            });
        }
    });

    // POST /api/renewals/:id/renew - Mark subscription as renewed (advance renewal date)
    app.post('/api/renewals/:id/renew', auth.requireAuth, renewalsApiLimiter, async (req, res) => {
        try {
            const { id } = req.params;

            // Verify subscription belongs to account
            const existing = await prisma.subscription.findFirst({
                where: {
                    id,
                    accountId: req.session.accountId
                }
            });

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    error: 'Subscription not found'
                });
            }

            // Calculate new renewal date based on billing cycle
            const currentDate = new Date(existing.renewalDate);
            let newDate = new Date(currentDate);

            switch (existing.billingCycle) {
                case 'monthly':
                    newDate.setMonth(newDate.getMonth() + 1);
                    break;
                case 'annual':
                    newDate.setFullYear(newDate.getFullYear() + 1);
                    break;
                case 'multi-year':
                    newDate.setFullYear(newDate.getFullYear() + 3);
                    break;
                default:
                    newDate.setFullYear(newDate.getFullYear() + 1);
            }

            const subscription = await prisma.subscription.update({
                where: { id },
                data: {
                    renewalDate: newDate,
                    lastAlertSent: null // Reset alert so it can be sent again
                }
            });

            res.json({
                success: true,
                subscription: {
                    ...subscription,
                    renewalDate: subscription.renewalDate.toISOString(),
                    cancelByDate: subscription.cancelByDate ? subscription.cancelByDate.toISOString() : null,
                    cost: subscription.cost ? subscription.cost.toString() : null
                }
            });
        } catch (error) {
            console.error('Error renewing subscription:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to renew subscription'
            });
        }
    });

    // ============================================
    // Document Upload & Pending Subscriptions API
    // ============================================

    // POST /api/renewals/upload - Upload documents for extraction
    app.post('/api/renewals/upload', auth.requireAuth, uploadLimiter, upload.array('files', 10), async (req, res) => {
        try {
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No files uploaded'
                });
            }

            console.log(`[Upload] Processing ${req.files.length} file(s) for account ${req.session.accountId}`);

            // Prepare attachments for processing
            const attachments = req.files.map(file => ({
                buffer: file.buffer,
                mimeType: file.mimetype,
                filename: file.originalname
            }));

            // Extract subscription data from documents
            const extractedData = await processMultipleAttachments(attachments);

            if (extractedData.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Could not extract subscription information from the uploaded files'
                });
            }

            // Save to pending_subscriptions table
            const pendingItems = [];

            for (const data of extractedData) {
                const pending = await prisma.pendingSubscription.create({
                    data: {
                        accountId: req.session.accountId,
                        sourceType: 'upload',
                        vendor: sanitizeTextForDb(data.vendor),
                        name: sanitizeTextForDb(data.name),
                        cost: data.cost,
                        renewalDate: data.renewalDate,
                        billingCycle: data.billingCycle,
                        accountNumber: sanitizeTextForDb(data.accountNumber),
                        confidence: data.confidence,
                        rawText: sanitizeTextForDb(data.rawText),
                        attachmentNames: data.attachmentNames || [],
                        status: 'pending'
                    }
                });

                pendingItems.push({
                    ...pending,
                    renewalDate: pending.renewalDate ? pending.renewalDate.toISOString() : null,
                    cost: pending.cost ? pending.cost.toString() : null,
                    createdAt: pending.createdAt.toISOString(),
                    updatedAt: pending.updatedAt.toISOString()
                });
            }

            res.json({
                success: true,
                message: `Extracted ${pendingItems.length} subscription(s) from ${req.files.length} file(s)`,
                pendingSubscriptions: pendingItems
            });

        } catch (error) {
            console.error('Error processing upload:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to process uploaded files'
            });
        }
    });

    // GET /api/renewals/pending - Get all pending subscriptions for account
    app.get('/api/renewals/pending', auth.requireAuth, async (req, res) => {
        try {
            const pendingSubscriptions = await prisma.pendingSubscription.findMany({
                where: {
                    accountId: req.session.accountId,
                    status: 'pending'
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });

            res.json({
                success: true,
                pendingSubscriptions: pendingSubscriptions.map(p => ({
                    ...p,
                    renewalDate: p.renewalDate ? p.renewalDate.toISOString() : null,
                    cost: p.cost ? p.cost.toString() : null,
                    createdAt: p.createdAt.toISOString(),
                    updatedAt: p.updatedAt.toISOString()
                }))
            });
        } catch (error) {
            console.error('Error fetching pending subscriptions:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch pending subscriptions'
            });
        }
    });

    // GET /api/renewals/pending/:id - Get single pending subscription
    app.get('/api/renewals/pending/:id', auth.requireAuth, async (req, res) => {
        try {
            const { id } = req.params;

            const pending = await prisma.pendingSubscription.findFirst({
                where: {
                    id,
                    accountId: req.session.accountId
                }
            });

            if (!pending) {
                return res.status(404).json({
                    success: false,
                    error: 'Pending subscription not found'
                });
            }

            res.json({
                success: true,
                pendingSubscription: {
                    ...pending,
                    renewalDate: pending.renewalDate ? pending.renewalDate.toISOString() : null,
                    cost: pending.cost ? pending.cost.toString() : null,
                    createdAt: pending.createdAt.toISOString(),
                    updatedAt: pending.updatedAt.toISOString()
                }
            });
        } catch (error) {
            console.error('Error fetching pending subscription:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch pending subscription'
            });
        }
    });

    // POST /api/renewals/pending/:id/approve - Convert pending to actual subscription
    app.post('/api/renewals/pending/:id/approve', auth.requireAuth, renewalsApiLimiter, async (req, res) => {
        try {
            const { id } = req.params;
            const { name, vendor, renewalDate, cancelByDate, cost, billingCycle, accountNumber, seats, owner, notes, alertEmail, alertDays } = req.body;

            // Verify pending subscription belongs to account
            const pending = await prisma.pendingSubscription.findFirst({
                where: {
                    id,
                    accountId: req.session.accountId
                }
            });

            if (!pending) {
                return res.status(404).json({
                    success: false,
                    error: 'Pending subscription not found'
                });
            }

            // Validate required fields (use from body or pending data)
            const finalName = name || pending.name;
            const finalVendor = vendor || pending.vendor;
            const finalRenewalDate = renewalDate || (pending.renewalDate ? pending.renewalDate.toISOString().split('T')[0] : null);

            if (!finalName || !finalVendor || !finalRenewalDate) {
                return res.status(400).json({
                    success: false,
                    error: 'Name, vendor, and renewal date are required'
                });
            }

            // Create the actual subscription
            const subscription = await prisma.subscription.create({
                data: {
                    accountId: req.session.accountId,
                    name: finalName,
                    vendor: finalVendor,
                    renewalDate: new Date(finalRenewalDate),
                    cancelByDate: cancelByDate ? new Date(cancelByDate) : null,
                    cost: cost !== undefined ? parseFloat(cost) : (pending.cost || null),
                    billingCycle: billingCycle || pending.billingCycle || 'annual',
                    accountNumber: accountNumber !== undefined ? accountNumber : (pending.accountNumber || null),
                    seats: seats ? parseInt(seats) : null,
                    owner: owner || null,
                    notes: notes || null,
                    alertEmail: alertEmail || null,
                    alertDays: alertDays || [60, 30, 7],
                    isArchived: false
                }
            });

            // Mark pending as approved
            await prisma.pendingSubscription.update({
                where: { id },
                data: { status: 'approved' }
            });

            res.json({
                success: true,
                subscription: {
                    ...subscription,
                    renewalDate: subscription.renewalDate.toISOString(),
                    cancelByDate: subscription.cancelByDate ? subscription.cancelByDate.toISOString() : null,
                    cost: subscription.cost ? subscription.cost.toString() : null
                }
            });

        } catch (error) {
            console.error('Error approving pending subscription:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to approve pending subscription'
            });
        }
    });

    // DELETE /api/renewals/pending/:id - Reject/delete pending subscription
    app.delete('/api/renewals/pending/:id', auth.requireAuth, renewalsApiLimiter, async (req, res) => {
        try {
            const { id } = req.params;

            // Verify pending subscription belongs to account
            const pending = await prisma.pendingSubscription.findFirst({
                where: {
                    id,
                    accountId: req.session.accountId
                }
            });

            if (!pending) {
                return res.status(404).json({
                    success: false,
                    error: 'Pending subscription not found'
                });
            }

            // Delete the pending subscription
            await prisma.pendingSubscription.delete({
                where: { id }
            });

            res.json({
                success: true,
                message: 'Pending subscription rejected and deleted'
            });

        } catch (error) {
            console.error('Error deleting pending subscription:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete pending subscription'
            });
        }
    });
}

// ============================================
// Team Members Routes (RBAC)
// ============================================

const permissions = require('./lib/permissions');

function setupMembersRoutes(app) {
    // GET /members - Team members page
    app.get('/members', auth.requireAuth, auth.attachAccount, auth.requireRole(['owner', 'admin']), async (req, res) => {
        try {
            const accountId = req.session.accountId;
            const members = await auth.getAccountMembers(accountId);
            const currentMember = req.member || { role: 'owner', id: req.session.memberId };

            res.render('members', {
                title: 'Team Members',
                account: req.account,
                currentAccount: req.account,
                members: members,
                currentMember: currentMember,
                roles: permissions.getAllRoles(),
                roleInfo: permissions.getRoleInfo,
                assignableRoles: permissions.getAssignableRoles(currentMember.role),
                canInvite: permissions.hasPermission(currentMember.role, 'members.invite')
            });
        } catch (error) {
            console.error('Error loading members page:', error);
            res.status(500).render('error', {
                title: 'Error',
                message: 'Failed to load team members',
                account: req.account
            });
        }
    });

    // GET /api/members - Get all members (API)
    app.get('/api/members', auth.requireAuth, auth.requireRole(['owner', 'admin']), async (req, res) => {
        try {
            const members = await auth.getAccountMembers(req.session.accountId);
            res.json({ success: true, members });
        } catch (error) {
            console.error('Error fetching members:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch members' });
        }
    });

    // POST /api/members/invite - Invite a new member
    app.post('/api/members/invite', auth.requireAuth, auth.requirePermission('members.invite'), async (req, res) => {
        try {
            const { email, name, role } = req.body;

            if (!email) {
                return res.status(400).json({ success: false, error: 'Email is required' });
            }

            // Get current member for audit and role check
            const currentMember = req.member || { id: req.session.memberId, role: req.session.memberRole || 'owner' };

            // Check if assigning allowed role
            const assignableRoles = permissions.getAssignableRoles(currentMember.role);
            const targetRole = role || 'viewer';
            if (!assignableRoles.includes(targetRole)) {
                return res.status(403).json({
                    success: false,
                    error: `You cannot assign the ${targetRole} role`
                });
            }

            // Create invited member (with invitation token, no password yet)
            const member = await auth.createMember(
                req.session.accountId,
                { email, name: name || email, role: targetRole },
                currentMember.id
            );

            // Send invitation email
            const { sendInvitationEmail } = require('./lib/email-sender');
            try {
                await sendInvitationEmail({
                    to: email,
                    token: member.invitationToken,
                    inviterName: currentMember.name || req.account.name,
                    accountName: req.account.name
                });
            } catch (emailError) {
                console.error('Failed to send invitation email:', emailError);
                // Don't fail the request - member was created
            }

            auditLog('MEMBER_INVITED', req.session.accountId, {
                invitedEmail: email,
                invitedRole: targetRole,
                invitedBy: currentMember.id
            }, req);

            res.json({
                success: true,
                message: `Invitation sent to ${email}`,
                member: auth.sanitizeMemberForClient(member)
            });
        } catch (error) {
            console.error('Error inviting member:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    });

    // PATCH /api/members/:id/role - Update member role
    app.patch('/api/members/:id/role', auth.requireAuth, auth.requirePermission('members.edit'), async (req, res) => {
        try {
            const { id } = req.params;
            const { role } = req.body;

            if (!role || !permissions.isValidRole(role)) {
                return res.status(400).json({ success: false, error: 'Invalid role' });
            }

            const currentMember = req.member || { id: req.session.memberId, role: req.session.memberRole || 'owner' };

            const updatedMember = await auth.updateMemberRole(id, role, currentMember);

            auditLog('MEMBER_ROLE_CHANGED', req.session.accountId, {
                memberId: id,
                newRole: role,
                changedBy: currentMember.id
            }, req);

            res.json({ success: true, member: auth.sanitizeMemberForClient(updatedMember) });
        } catch (error) {
            console.error('Error updating member role:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    });

    // DELETE /api/members/:id - Remove member
    app.delete('/api/members/:id', auth.requireAuth, auth.requirePermission('members.remove'), async (req, res) => {
        try {
            const { id } = req.params;
            const currentMember = req.member || { id: req.session.memberId, role: req.session.memberRole || 'owner' };

            await auth.removeMember(id, currentMember);

            auditLog('MEMBER_REMOVED', req.session.accountId, {
                memberId: id,
                removedBy: currentMember.id
            }, req);

            res.json({ success: true, message: 'Member removed' });
        } catch (error) {
            console.error('Error removing member:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    });

    // GET /invite/accept - Accept invitation page
    app.get('/invite/accept', async (req, res) => {
        try {
            const { token } = req.query;

            if (!token) {
                return res.render('invite-accept', {
                    error: 'Invalid invitation link',
                    token: null,
                    member: null
                });
            }

            // Find member by invitation token
            const member = await prisma.accountMember.findUnique({
                where: { invitationToken: token },
                include: { account: true }
            });

            if (!member) {
                return res.render('invite-accept', {
                    error: 'Invalid or expired invitation link',
                    token: null,
                    member: null
                });
            }

            if (member.invitationExpires && new Date() > member.invitationExpires) {
                return res.render('invite-accept', {
                    error: 'This invitation has expired. Please request a new one.',
                    token: null,
                    member: null
                });
            }

            res.render('invite-accept', {
                error: null,
                token: token,
                member: {
                    email: member.email,
                    name: member.name,
                    accountName: member.account.name
                }
            });
        } catch (error) {
            console.error('Error loading invitation page:', error);
            res.render('invite-accept', {
                error: 'An error occurred',
                token: null,
                member: null
            });
        }
    });

    // POST /invite/accept - Accept invitation and set password
    app.post('/invite/accept', async (req, res) => {
        try {
            const { token, name, password, confirmPassword } = req.body;

            if (!token) {
                return res.render('invite-accept', {
                    error: 'Invalid invitation',
                    token: null,
                    member: null
                });
            }

            if (!password || password.length < 8) {
                return res.render('invite-accept', {
                    error: 'Password must be at least 8 characters',
                    token: token,
                    member: { name }
                });
            }

            if (password !== confirmPassword) {
                return res.render('invite-accept', {
                    error: 'Passwords do not match',
                    token: token,
                    member: { name }
                });
            }

            const result = await auth.acceptInvitation(token, name, password);

            if (!result.success) {
                return res.render('invite-accept', {
                    error: result.message,
                    token: token,
                    member: { name }
                });
            }

            // Get member for session
            const member = await auth.getMemberById(result.memberId);

            if (!member) {
                return res.render('invite-accept', {
                    error: 'Failed to load member information',
                    token: token,
                    member: { name }
                });
            }

            // Clear any existing session data to prevent conflicts
            req.session.regenerate((err) => {
                if (err) {
                    console.error('Session regenerate error:', err);
                    return res.render('invite-accept', {
                        error: 'Failed to create session. Please try again.',
                        token: token,
                        member: { name }
                    });
                }

                // Log member in with correct email
                req.session.accountId = member.accountId;
                req.session.accountEmail = member.email; // Use member's email, not account owner's
                req.session.memberId = member.id;
                req.session.memberRole = member.role;

                // Clear any cached account/member attachments
                req.account = null;
                req.member = null;

                auditLog('MEMBER_INVITATION_ACCEPTED', member.accountId, {
                    memberId: member.id,
                    email: member.email
                }, req);

                req.session.save((err) => {
                    if (err) {
                        console.error('Session save error:', err);
                        return res.render('invite-accept', {
                            error: 'Failed to save session. Please try logging in.',
                            token: null,
                            member: null
                        });
                    }
                    res.redirect('/');
                });
            });
        } catch (error) {
            console.error('Error accepting invitation:', error);
            res.render('invite-accept', {
                error: 'An error occurred. Please try again.',
                token: req.body.token,
                member: { name: req.body.name }
            });
        }
    });
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
    setupAdminRoutes,
    setupPartnerManagementRoutes,
    setupRenewalsRoutes,
    setupMembersRoutes,  // New RBAC routes
    // Original names for backward compatibility
    setupScriptRoutes,
    setupTrackingAPI,
    setupDataRoutes,
    setupHeadlessRoutes
};

