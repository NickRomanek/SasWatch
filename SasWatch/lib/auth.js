// Authentication Utilities
// Password hashing, session management, and authentication middleware

const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const prisma = require('./prisma');

const SALT_ROUNDS = 10;

// ============================================
// Password Management
// ============================================

async function hashPassword(password) {
    return await bcrypt.hash(password, SALT_ROUNDS);
}

async function comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

// ============================================
// Account Operations
// ============================================

async function createAccount(name, email, password) {
    const hashedPassword = await hashPassword(password);
    const { generateSecureToken } = require('./security');
    
    // Check if email already exists
    const existing = await prisma.account.findUnique({
        where: { email }
    });
    
    if (existing) {
        throw new Error('Account with this email already exists');
    }
    
    // Generate email verification token
    const verificationToken = generateSecureToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Create account with auto-generated API key
    const account = await prisma.account.create({
        data: {
            name,
            email,
            password: hashedPassword,
            subscriptionTier: 'free',
            isActive: true,
            emailVerified: false,
            emailVerificationToken: verificationToken,
            emailVerificationExpires: verificationExpires
        }
    });
    
    return account;
}

async function authenticateAccount(email, password) {
    const account = await prisma.account.findUnique({
        where: { email }
    });
    
    if (!account) {
        return null;
    }
    
    if (!account.isActive) {
        throw new Error('Account is not active');
    }
    
    const isValid = await comparePassword(password, account.password);
    
    if (!isValid) {
        return null;
    }
    
    // Update last login
    await prisma.account.update({
        where: { id: account.id },
        data: { lastLoginAt: new Date() }
    });
    
    // Return account without password
    const { password: _, ...accountWithoutPassword } = account;
    return accountWithoutPassword;
}

async function getAccountById(accountId) {
    const account = await prisma.account.findUnique({
        where: { id: accountId }
    });
    
    if (!account) {
        return null;
    }
    
    // Return without password
    const { password: _, ...accountWithoutPassword } = account;
    return accountWithoutPassword;
}

async function getAccountByApiKey(apiKey) {
    const account = await prisma.account.findUnique({
        where: { apiKey }
    });
    
    if (!account || !account.isActive) {
        return null;
    }
    
    const { password: _, ...accountWithoutPassword } = account;
    return accountWithoutPassword;
}

async function regenerateApiKey(accountId) {
    if (!accountId) {
        throw new Error('Missing account ID for API key regeneration');
    }

    const account = await prisma.account.update({
        where: { id: accountId },
        data: { apiKey: randomUUID() },
        select: { apiKey: true }
    });

    return account.apiKey;
}

// ============================================
// Email Verification
// ============================================

async function verifyEmail(token) {
    if (!token) {
        return { success: false, message: 'Verification token is required' };
    }

    // Find account by token
    const account = await prisma.account.findUnique({
        where: { emailVerificationToken: token }
    });

    if (!account) {
        return { success: false, message: 'Invalid or expired verification link' };
    }

    // Check if already verified
    if (account.emailVerified) {
        return { success: false, message: 'Email already verified' };
    }

    // Check if token expired
    if (account.emailVerificationExpires && new Date() > account.emailVerificationExpires) {
        return { success: false, message: 'Verification link has expired. Please request a new one.' };
    }

    // Verify email and clear token
    await prisma.account.update({
        where: { id: account.id },
        data: {
            emailVerified: true,
            emailVerificationToken: null,
            emailVerificationExpires: null
        }
    });

    return {
        success: true,
        accountId: account.id,
        email: account.email
    };
}

async function resendVerificationEmail(email) {
    const { generateSecureToken } = require('./security');

    // Find account by email
    const account = await prisma.account.findUnique({
        where: { email }
    });

    if (!account) {
        throw new Error('No account found with this email address');
    }

    // Check if already verified
    if (account.emailVerified) {
        throw new Error('Email is already verified');
    }

    // Generate new verification token
    const verificationToken = generateSecureToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Update account with new token
    const updatedAccount = await prisma.account.update({
        where: { id: account.id },
        data: {
            emailVerificationToken: verificationToken,
            emailVerificationExpires: verificationExpires
        }
    });

    return updatedAccount;
}

// ============================================
// Express Middleware
// ============================================

// Middleware to require authentication (session-based)
function requireAuth(req, res, next) {
    console.log('requireAuth check - session:', req.session ? 'exists' : 'missing');
    console.log('requireAuth check - accountId:', req.session?.accountId);
    
    if (!req.session || !req.session.accountId) {
        console.log('Authentication required - redirecting to login');
        // If it's an API request, return JSON
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        // Otherwise redirect to login
        return res.redirect('/login');
    }
    
    console.log('Authentication successful, proceeding');
    next();
}

// Middleware to require API key (for PowerShell scripts)
async function requireApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) {
        return res.status(401).json({ 
            error: 'API key required',
            message: 'Please provide API key in X-API-Key header'
        });
    }
    
    const account = await getAccountByApiKey(apiKey);
    
    if (!account) {
        return res.status(401).json({ 
            error: 'Invalid API key',
            message: 'API key is invalid or account is not active'
        });
    }
    
    // Attach account to request
    req.account = account;
    req.accountId = account.id;
    
    next();
}

// Middleware to attach account info to request (for authenticated users)
async function attachAccount(req, res, next) {
    if (req.session && req.session.accountId) {
        const account = await getAccountById(req.session.accountId);
        if (account) {
            req.account = account;
            req.accountId = account.id;
            res.locals.account = account; // Make available in templates
        }
    }
    next();
}

// Optional auth - doesn't require but attaches if present
function optionalAuth(req, res, next) {
    attachAccount(req, res, next);
}

// Middleware to require super admin access (hybrid security: env variable + DB flag)
async function requireSuperAdmin(req, res, next) {
    // Must be authenticated first
    if (!req.session || !req.session.accountId) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        return res.redirect('/login');
    }
    
    // Get fresh account from database (don't trust session alone)
    const account = await getAccountById(req.session.accountId);
    if (!account) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Account not found' });
        }
        return res.redirect('/login');
    }
    
    // Check against environment variable (can't be changed via DB)
    const adminEmails = (process.env.SUPER_ADMIN_EMAILS || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0);
    
    const isInAllowlist = adminEmails.length > 0 && 
        adminEmails.includes(account.email.toLowerCase());
    const hasDbFlag = account.isSuperAdmin === true;
    
    // BOTH must be true: database flag AND email in allowlist
    if (!isInAllowlist || !hasDbFlag) {
        const { auditLog } = require('./security');
        auditLog('ADMIN_ACCESS_DENIED', account.id, {
            path: req.path,
            hasDbFlag,
            isInAllowlist,
            email: account.email
        }, req);
        
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({ error: 'Super admin access required' });
        }
        return res.status(403).send('Access denied: Super admin privileges required');
    }
    
    req.account = account;
    req.isSuperAdmin = true;
    next();
}

// ============================================
// Utility Functions
// ============================================

function generateRandomPassword(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

function sanitizeAccountForClient(account) {
    const { password, ...safe } = account;
    return safe;
}

module.exports = {
    // Password
    hashPassword,
    comparePassword,
    
    // Account operations
    createAccount,
    authenticateAccount,
    getAccountById,
    getAccountByApiKey,
    regenerateApiKey,
    
    // Email verification
    verifyEmail,
    resendVerificationEmail,
    
    // Middleware
    requireAuth,
    requireApiKey,
    attachAccount,
    optionalAuth,
    requireSuperAdmin,
    
    // Utilities
    generateRandomPassword,
    sanitizeAccountForClient
};

