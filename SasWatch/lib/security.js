// Security Middleware and Utilities
// Provides HTTP security headers, rate limiting, input validation, and audit logging

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const { body, validationResult } = require('express-validator');
const winston = require('winston');
const crypto = require('crypto');

// ============================================
// Security Logging
// ============================================

const securityLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { 
        service: 'saswatch-security',
        environment: process.env.NODE_ENV || 'development'
    },
    transports: [
        // Write all security events to security.log
        new winston.transports.File({ 
            filename: 'logs/security.log',
            level: 'info',
            maxsize: 10485760, // 10MB
            maxFiles: 5,
            tailable: true
        }),
        // Write errors to error.log
        new winston.transports.File({ 
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 10485760, // 10MB
            maxFiles: 5
        })
    ]
});

// Also log to console in development
if (process.env.NODE_ENV !== 'production') {
    securityLogger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

/**
 * Audit log for security-relevant events
 * @param {string} action - Action type (LOGIN_SUCCESS, LOGIN_FAILED, etc.)
 * @param {string} accountId - Account ID (if applicable)
 * @param {object} details - Additional details
 * @param {object} req - Express request object
 */
function auditLog(action, accountId, details = {}, req = null) {
    const logData = {
        timestamp: new Date().toISOString(),
        action,
        accountId: accountId || 'anonymous',
        ...details
    };

    // Add request metadata if available
    if (req) {
        logData.ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        logData.userAgent = req.headers['user-agent'];
        logData.requestId = req.id;
        logData.path = req.path;
        logData.method = req.method;
    }

    // Log at appropriate level based on action
    if (action.includes('FAILED') || action.includes('BLOCKED') || action.includes('SUSPICIOUS')) {
        securityLogger.warn('Security Event', logData);
    } else {
        securityLogger.info('Security Event', logData);
    }
}

/**
 * Log application errors with full context
 * Separate from security audit log - focuses on application errors
 * @param {Error} error - Error object
 * @param {object} context - Additional context (req, accountId, etc.)
 */
function logApplicationError(error, context = {}) {
    const errorData = {
        timestamp: new Date().toISOString(),
        message: error.message,
        name: error.name,
        statusCode: error.statusCode || 500,
        stack: error.stack,
        isOperational: error.isOperational || false,
        ...context
    };

    // Add request context if available
    if (context.req) {
        const req = context.req;
        errorData.requestId = req.id;
        errorData.accountId = req.session?.accountId;
        errorData.accountEmail = req.session?.accountEmail;
        errorData.url = req.originalUrl || req.url;
        errorData.method = req.method;
        errorData.ip = req.ip || req.headers['x-forwarded-for'];
        errorData.userAgent = req.headers['user-agent'];
        
        // Remove req from errorData to avoid circular references
        delete errorData.req;
    }

    // Log to error.log
    securityLogger.error('Application Error', errorData);
}

// ============================================
// HTTP Security Headers (Helmet)
// ============================================

/**
 * Configure Helmet.js for secure HTTP headers
 * @param {object} app - Express app instance
 */
function setupHelmet(app) {
    // Helmet configuration - CSP disabled in development to allow inline scripts
    const helmetConfig = {
        // Content Security Policy - DISABLED in development for easier debugging
        // Your app uses inline onclick handlers and scripts which CSP blocks
        contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://static.cloudflareinsights.com", "https://cdn.jsdelivr.net", "https://cdn.socket.io"],
                scriptSrcAttr: ["'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "https://graph.microsoft.com", "https://login.microsoftonline.com", "https://cdn.socket.io"],
                fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
                objectSrc: ["'none'"]
            }
        } : false, // Disabled in development
        
        // HTTP Strict Transport Security - forces HTTPS (disabled in dev)
        hsts: process.env.NODE_ENV === 'production' ? {
            maxAge: 31536000, // 1 year
            includeSubDomains: true,
            preload: true
        } : false,
        
        // Don't advertise the tech stack
        hidePoweredBy: true,
        
        // Prevent MIME type sniffing
        noSniff: true,
        
        // Prevent clickjacking
        frameguard: {
            action: 'deny'
        },
        
        // XSS filter
        xssFilter: true,
        
        // Referrer policy
        referrerPolicy: {
            policy: 'strict-origin-when-cross-origin'
        }
    };

    app.use(helmet(helmetConfig));

    auditLog('HELMET_CONFIGURED', null, { 
        message: 'Security headers configured via Helmet.js',
        cspEnabled: process.env.NODE_ENV === 'production',
        environment: process.env.NODE_ENV || 'development'
    });
}

// ============================================
// HTTPS Enforcement
// ============================================

/**
 * Middleware to enforce HTTPS in production
 * Redirects HTTP requests to HTTPS
 */
function requireHTTPS(req, res, next) {
    if (process.env.NODE_ENV === 'production' && process.env.ENFORCE_HTTPS !== 'false') {
        // Check if request is not secure
        if (!req.secure && req.headers['x-forwarded-proto'] !== 'https') {
            auditLog('HTTP_REDIRECT', null, {
                message: 'Redirecting HTTP request to HTTPS',
                originalUrl: req.url
            }, req);
            
            return res.redirect(301, 'https://' + req.headers.host + req.url);
        }
    }
    next();
}

// ============================================
// Rate Limiting
// ============================================

/**
 * Rate limiter for login endpoint
 * Prevents brute force attacks
 */
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 login attempts per window
    message: {
        error: 'Too many login attempts from this IP. Please try again in 15 minutes.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    skipSuccessfulRequests: false, // Count successful requests
    handler: (req, res) => {
        auditLog('RATE_LIMIT_EXCEEDED', null, {
            message: 'Login rate limit exceeded',
            limit: 5,
            window: '15 minutes'
        }, req);
        
        res.status(429).render('login', {
            error: 'Too many login attempts. Please try again in 15 minutes.',
            message: null
        });
    }
});

/**
 * Rate limiter for signup endpoint
 * Prevents account creation spam
 */
const signupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 signups per hour per IP
    message: {
        error: 'Too many accounts created from this IP. Please try again in an hour.',
        retryAfter: '1 hour'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        auditLog('RATE_LIMIT_EXCEEDED', null, {
            message: 'Signup rate limit exceeded',
            limit: 3,
            window: '1 hour'
        }, req);
        
        res.status(429).render('signup', {
            error: 'Too many accounts created from this IP. Please try again later.'
        });
    }
});

/**
 * Speed limiter for API endpoints
 * Progressively slows down requests before blocking
 */
const apiSpeedLimiter = slowDown({
    windowMs: 15 * 60 * 1000, // 15 minutes
    delayAfter: 50, // Allow 50 requests per window at full speed
    // Preserve legacy incremental delay behavior per express-slow-down v1
    delayMs: (used, req) => {
        const delayAfter = req.slowDown.limit;
        return (used - delayAfter) * 100;
    },
    maxDelayMs: 5000, // Maximum delay of 5 seconds
    skipSuccessfulRequests: false
});

// ============================================
// Input Validation
// ============================================

/**
 * Validation rules for signup form
 */
const signupValidation = [
    body('name')
        .trim()
        .notEmpty()
        .withMessage('Name is required')
        .isLength({ min: 2, max: 100 })
        .withMessage('Name must be between 2 and 100 characters')
        .matches(/^[a-zA-Z0-9\s\-_.]+$/)
        .withMessage('Name contains invalid characters'),
    
    body('email')
        .trim()
        .notEmpty()
        .withMessage('Email is required')
        .isEmail()
        .withMessage('Invalid email address')
        .normalizeEmail()
        .isLength({ max: 255 })
        .withMessage('Email is too long'),
    
    body('password')
        .notEmpty()
        .withMessage('Password is required')
        .isLength({ min: 12 })
        .withMessage('Password must be at least 12 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .withMessage('Password must contain uppercase, lowercase, number, and special character (@$!%*?&)'),
    
    body('confirmPassword')
        .notEmpty()
        .withMessage('Please confirm your password')
        .custom((value, { req }) => {
            if (value !== req.body.password) {
                throw new Error('Passwords do not match');
            }
            return true;
        })
];

/**
 * Validation rules for login form
 */
const loginValidation = [
    body('email')
        .trim()
        .notEmpty()
        .withMessage('Email is required')
        .isEmail()
        .withMessage('Invalid email address')
        .normalizeEmail(),
    
    body('password')
        .notEmpty()
        .withMessage('Password is required')
];

/**
 * Validation rules for forgot password form
 */
const forgotPasswordValidation = [
    body('email')
        .trim()
        .notEmpty()
        .withMessage('Email is required')
        .isEmail()
        .withMessage('Invalid email address')
        .normalizeEmail()
];

/**
 * Validation rules for reset password form
 */
const resetPasswordValidation = [
    body('token')
        .notEmpty()
        .withMessage('Reset token is required'),
    
    body('password')
        .trim()
        .notEmpty()
        .withMessage('Password is required')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long'),
    
    body('confirmPassword')
        .trim()
        .notEmpty()
        .withMessage('Please confirm your password')
        .custom((value, { req }) => {
            if (value !== req.body.password) {
                throw new Error('Passwords do not match');
            }
            return true;
        })
];

/**
 * Middleware to check validation results and render errors
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Next middleware
 */
function handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        const firstError = errors.array()[0];
        
        auditLog('VALIDATION_FAILED', req.session?.accountId, {
            message: 'Input validation failed',
            field: firstError.param,
            error: firstError.msg,
            path: req.path
        }, req);
        
        // Determine which page to render based on the route
        let page = 'login';
        let templateData = { error: firstError.msg, message: null };
        
        if (req.path.includes('signup')) {
            page = 'signup';
            templateData = { error: firstError.msg };
        } else if (req.path.includes('forgot-password')) {
            page = 'forgot-password';
            templateData = { error: firstError.msg };
        } else if (req.path.includes('reset-password')) {
            page = 'reset-password';
            templateData = { error: firstError.msg, token: req.body.token || req.query.token };
        }
        
        return res.status(400).render(page, templateData);
    }
    
    next();
}

// ============================================
// Request ID Generator
// ============================================

/**
 * Middleware to add unique request ID for tracing
 * Useful for debugging and audit logs
 */
function addRequestId(req, res, next) {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-ID', req.id);
    next();
}

// ============================================
// Session Secret Validator
// ============================================

/**
 * Validates that SESSION_SECRET is properly set
 * Throws error if using weak or default secret in production
 */
function validateSessionSecret() {
    const secret = process.env.SESSION_SECRET;
    
    // Require SESSION_SECRET in production
    if (process.env.NODE_ENV === 'production' && !secret) {
        throw new Error('SESSION_SECRET environment variable must be set in production');
    }
    
    // Warn if secret is too short
    if (secret && secret.length < 32) {
        console.warn('⚠️  WARNING: SESSION_SECRET should be at least 32 characters long');
        console.warn('   Generate a secure secret with: openssl rand -hex 32');
    }
    
    // Block known weak secrets in production
    const weakSecrets = [
        'your-super-secret-key-change-in-production',
        'secret',
        'password',
        'changeme',
        '12345678'
    ];
    
    if (process.env.NODE_ENV === 'production' && weakSecrets.includes(secret)) {
        throw new Error('Weak SESSION_SECRET detected. Generate a secure secret with: openssl rand -hex 32');
    }
    
    auditLog('SESSION_SECRET_VALIDATED', null, {
        message: 'Session secret validation passed',
        secretLength: secret ? secret.length : 0
    });
}

// ============================================
// Security Utilities
// ============================================

/**
 * Generate a cryptographically secure random token
 * @param {number} length - Length in bytes (default 32)
 * @returns {string} Hex-encoded random token
 */
function generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash sensitive data for logging (e.g., partial email)
 * @param {string} value - Value to hash
 * @returns {string} Partially masked value
 */
function maskSensitiveData(value) {
    if (!value || value.length < 4) return '****';
    
    if (value.includes('@')) {
        // Email: show first 2 chars and domain
        const [local, domain] = value.split('@');
        return `${local.substring(0, 2)}****@${domain}`;
    }
    
    // Default: show first 2 and last 2 chars
    return `${value.substring(0, 2)}****${value.substring(value.length - 2)}`;
}

// ============================================
// Exports
// ============================================

module.exports = {
    // HTTP Security
    setupHelmet,
    requireHTTPS,
    
    // Rate Limiting
    loginLimiter,
    signupLimiter,
    apiSpeedLimiter,
    
    // Input Validation
    signupValidation,
    loginValidation,
    forgotPasswordValidation,
    resetPasswordValidation,
    handleValidationErrors,
    
    // Logging
    auditLog,
    logApplicationError,
    securityLogger,
    
    // Middleware
    addRequestId,
    
    // Validators
    validateSessionSecret,
    
    // Utilities
    generateSecureToken,
    maskSensitiveData
};

