// Authentication Utilities
// Password hashing, session management, and authentication middleware

const bcrypt = require('bcrypt');
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
    
    // Check if email already exists
    const existing = await prisma.account.findUnique({
        where: { email }
    });
    
    if (existing) {
        throw new Error('Account with this email already exists');
    }
    
    // Create account with auto-generated API key
    const account = await prisma.account.create({
        data: {
            name,
            email,
            password: hashedPassword,
            subscriptionTier: 'free',
            isActive: true
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
    const { v4: uuidv4 } = require('uuid');
    
    const account = await prisma.account.update({
        where: { id: accountId },
        data: { apiKey: uuidv4() }
    });
    
    return account.apiKey;
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
    
    // Middleware
    requireAuth,
    requireApiKey,
    attachAccount,
    optionalAuth,
    
    // Utilities
    generateRandomPassword,
    sanitizeAccountForClient
};

