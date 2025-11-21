// Error Handling Utilities
// Provides consistent error handling, logging, and user-friendly responses

const { auditLog } = require('./security');

/**
 * Custom Application Error Class
 * Extends Error with HTTP status code and additional context
 */
class AppError extends Error {
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.timestamp = new Date().toISOString();
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Async Handler Wrapper
 * Wraps async route handlers to automatically catch errors
 * Usage: app.get('/route', asyncHandler(async (req, res) => { ... }))
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Error Response Formatter
 * Sends consistent error responses based on request type (API vs Web)
 */
function errorResponse(res, error, req = null) {
    const statusCode = error.statusCode || 500;
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Log error with context
    if (req) {
        logError(error, req);
    }
    
    // Determine if this is an API request
    const isApiRequest = req?.path?.startsWith('/api/') || 
                         req?.headers?.accept?.includes('application/json');
    
    if (isApiRequest) {
        // API Error Response (JSON)
        const response = {
            success: false,
            message: error.message || 'An unexpected error occurred',
            requestId: req?.id
        };
        
        // Include stack trace in development only
        if (!isProduction && error.stack) {
            response.stack = error.stack;
        }
        
        return res.status(statusCode).json(response);
    } else {
        // Web Error Response (HTML)
        const errorData = {
            error: getErrorTitle(statusCode),
            message: getUserFriendlyMessage(error, statusCode),
            requestId: req?.id,
            showStack: !isProduction,
            stack: error.stack
        };
        
        return res.status(statusCode).render('error', errorData);
    }
}

/**
 * Error Logger
 * Logs errors with full context for debugging
 */
function logError(error, req) {
    const errorContext = {
        message: error.message,
        statusCode: error.statusCode || 500,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        requestId: req?.id,
        accountId: req?.session?.accountId,
        accountEmail: req?.session?.accountEmail,
        url: req?.originalUrl || req?.url,
        method: req?.method,
        ip: req?.ip,
        userAgent: req?.get('user-agent'),
        isOperational: error.isOperational
    };
    
    // Log to console
    console.error('❌ Application Error:', errorContext);
    
    // Log to audit system
    auditLog('APPLICATION_ERROR', req?.session?.accountId, {
        error: error.message,
        statusCode: error.statusCode,
        url: req?.originalUrl,
        requestId: req?.id,
        isOperational: error.isOperational
    }, req);
}

/**
 * Get Error Title
 * Returns user-friendly error title based on status code
 */
function getErrorTitle(statusCode) {
    const titles = {
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Page Not Found',
        429: 'Too Many Requests',
        500: 'Server Error',
        502: 'Bad Gateway',
        503: 'Service Unavailable'
    };
    
    return titles[statusCode] || 'Error';
}

/**
 * Get User-Friendly Message
 * Converts technical errors to user-friendly messages
 */
function getUserFriendlyMessage(error, statusCode) {
    // Use custom message if provided
    if (error.message && error.isOperational) {
        return error.message;
    }
    
    // Default messages by status code
    const messages = {
        400: 'The request was invalid. Please check your input and try again.',
        401: 'You need to be logged in to access this page. Please log in and try again.',
        403: 'You don\'t have permission to access this resource.',
        404: 'The page you\'re looking for doesn\'t exist. It may have been moved or deleted.',
        429: 'Too many requests. Please wait a moment and try again.',
        500: 'Something went wrong on our end. We\'ve been notified and will fix this soon.',
        502: 'Unable to connect to the service. Please try again in a moment.',
        503: 'The service is temporarily unavailable. Please try again later.'
    };
    
    return messages[statusCode] || 'An unexpected error occurred. Please try again or contact support.';
}

/**
 * Database Error Handler
 * Converts database errors to user-friendly messages
 */
function handleDatabaseError(error) {
    console.error('Database error:', error);
    
    // Prisma/Database specific errors
    if (error.code === 'P2002') {
        return new AppError('A record with this information already exists.', 409);
    }
    
    if (error.code === 'P2025') {
        return new AppError('The requested record was not found.', 404);
    }
    
    if (error.code === 'P2003') {
        return new AppError('This operation would violate a data constraint.', 400);
    }
    
    // Connection errors
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('ETIMEDOUT')) {
        return new AppError('Unable to connect to the database. Please try again.', 503);
    }
    
    // Generic database error
    return new AppError('A database error occurred. Please try again.', 500);
}

/**
 * Validation Error Handler
 * Formats validation errors from express-validator
 */
function handleValidationError(errors) {
    const messages = errors.map(err => err.msg).join(', ');
    return new AppError(messages, 400);
}

/**
 * Not Found Error
 * Creates a 404 error
 */
function notFoundError(resource = 'Resource') {
    return new AppError(`${resource} not found`, 404);
}

/**
 * Unauthorized Error
 * Creates a 401 error
 */
function unauthorizedError(message = 'Authentication required') {
    return new AppError(message, 401);
}

/**
 * Forbidden Error
 * Creates a 403 error
 */
function forbiddenError(message = 'Access forbidden') {
    return new AppError(message, 403);
}

module.exports = {
    AppError,
    asyncHandler,
    errorResponse,
    logError,
    handleDatabaseError,
    handleValidationError,
    notFoundError,
    unauthorizedError,
    forbiddenError,
    getErrorTitle,
    getUserFriendlyMessage
};

