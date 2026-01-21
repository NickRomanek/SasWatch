/**
 * Partner API Routes
 *
 * Versioned API for Partners (MSPs, resellers, integrators) to access
 * their linked accounts' SasWatch data.
 *
 * All routes require X-Partner-API-Key header authentication.
 * Base path: /api/v1/partner
 */

const express = require('express');
const router = express.Router();
const auth = require('./auth');
const partnerDb = require('./partner-database');

// ============================================
// Rate Limiting
// ============================================

const rateLimit = require('express-rate-limit');

const partnerApiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 120, // 120 requests per minute
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please wait before making more requests.',
            retryAfter: 60
        }
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Apply rate limiting to all partner routes
router.use(partnerApiLimiter);

// Apply Partner API key authentication to all routes
router.use(auth.requirePartnerApiKey);

// ============================================
// Helper Functions
// ============================================

/**
 * Build pagination response object
 */
function buildPagination(total, limit, offset) {
    return {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
    };
}

/**
 * Parse and validate pagination parameters
 */
function parsePaginationParams(query) {
    let limit = parseInt(query.limit) || 50;
    let offset = parseInt(query.offset) || 0;

    // Enforce limits
    limit = Math.min(Math.max(limit, 1), 500);
    offset = Math.max(offset, 0);

    return { limit, offset };
}

/**
 * Log partner API access for audit
 */
function logPartnerAccess(req, action, details = {}) {
    const { auditLog } = require('./security');
    auditLog(`PARTNER_API_${action}`, req.partnerAccount.accountId, {
        partnerId: req.partnerAccountId,
        partnerCompany: req.partnerAccount.companyName,
        ...details
    }, req);
}

// ============================================
// Routes
// ============================================

/**
 * GET /api/v1/partner/accounts
 * List all linked accounts for the partner
 */
router.get('/accounts', async (req, res) => {
    try {
        const { limit, offset } = parsePaginationParams(req.query);
        const search = req.query.search || '';

        const result = await partnerDb.getLinkedAccounts(req.partnerAccountId, {
            limit,
            offset,
            search
        });

        logPartnerAccess(req, 'LIST_ACCOUNTS', { count: result.accounts.length });

        res.json({
            success: true,
            data: result.accounts,
            pagination: buildPagination(result.total, limit, offset)
        });
    } catch (error) {
        console.error('Partner API - List accounts error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to retrieve linked accounts'
            }
        });
    }
});

/**
 * GET /api/v1/partner/accounts/:accountId
 * Get details for a specific linked account
 */
router.get('/accounts/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;

        // Check access
        if (!req.linkedAccountIds.includes(accountId)) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'ACCOUNT_ACCESS_DENIED',
                    message: 'You do not have access to this account'
                }
            });
        }

        const account = await partnerDb.getLinkedAccountDetails(req.partnerAccountId, accountId);

        if (!account) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'ACCOUNT_NOT_FOUND',
                    message: 'Account not found'
                }
            });
        }

        logPartnerAccess(req, 'VIEW_ACCOUNT', { targetAccountId: accountId });

        res.json({
            success: true,
            data: account
        });
    } catch (error) {
        console.error('Partner API - Get account error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to retrieve account details'
            }
        });
    }
});

/**
 * GET /api/v1/partner/accounts/:accountId/users
 * Get users for a specific linked account
 */
router.get('/accounts/:accountId/users', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { limit, offset } = parsePaginationParams(req.query);
        const search = req.query.search || '';

        // Check access
        if (!req.linkedAccountIds.includes(accountId)) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'ACCOUNT_ACCESS_DENIED',
                    message: 'You do not have access to this account'
                }
            });
        }

        const result = await partnerDb.getLinkedAccountUsers(req.partnerAccountId, accountId, {
            limit,
            offset,
            search
        });

        if (!result) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'ACCOUNT_NOT_FOUND',
                    message: 'Account not found'
                }
            });
        }

        logPartnerAccess(req, 'VIEW_USERS', {
            targetAccountId: accountId,
            count: result.users.length
        });

        res.json({
            success: true,
            data: result.users,
            pagination: buildPagination(result.total, limit, offset)
        });
    } catch (error) {
        console.error('Partner API - Get users error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to retrieve users'
            }
        });
    }
});

/**
 * GET /api/v1/partner/accounts/:accountId/activity
 * Get activity for a specific linked account
 */
router.get('/accounts/:accountId/activity', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { limit, offset } = parsePaginationParams(req.query);
        const { startDate, endDate } = req.query;

        // Check access
        if (!req.linkedAccountIds.includes(accountId)) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'ACCOUNT_ACCESS_DENIED',
                    message: 'You do not have access to this account'
                }
            });
        }

        const result = await partnerDb.getLinkedAccountActivity(req.partnerAccountId, accountId, {
            limit,
            offset,
            startDate,
            endDate
        });

        if (!result) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'ACCOUNT_NOT_FOUND',
                    message: 'Account not found'
                }
            });
        }

        logPartnerAccess(req, 'VIEW_ACTIVITY', {
            targetAccountId: accountId,
            count: result.events.length
        });

        res.json({
            success: true,
            data: result.events,
            pagination: buildPagination(result.total, limit, offset)
        });
    } catch (error) {
        console.error('Partner API - Get activity error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to retrieve activity'
            }
        });
    }
});

/**
 * GET /api/v1/partner/accounts/:accountId/licenses
 * Get license information for a specific linked account
 */
router.get('/accounts/:accountId/licenses', async (req, res) => {
    try {
        const { accountId } = req.params;

        // Check access
        if (!req.linkedAccountIds.includes(accountId)) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'ACCOUNT_ACCESS_DENIED',
                    message: 'You do not have access to this account'
                }
            });
        }

        const result = await partnerDb.getLinkedAccountLicenses(req.partnerAccountId, accountId);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'ACCOUNT_NOT_FOUND',
                    message: 'Account not found'
                }
            });
        }

        logPartnerAccess(req, 'VIEW_LICENSES', {
            targetAccountId: accountId,
            licenseCount: result.licenses.length
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Partner API - Get licenses error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to retrieve licenses'
            }
        });
    }
});

/**
 * GET /api/v1/partner/accounts/:accountId/analytics
 * Get analytics for a specific linked account
 */
router.get('/accounts/:accountId/analytics', async (req, res) => {
    try {
        const { accountId } = req.params;

        // Check access
        if (!req.linkedAccountIds.includes(accountId)) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'ACCOUNT_ACCESS_DENIED',
                    message: 'You do not have access to this account'
                }
            });
        }

        const result = await partnerDb.getLinkedAccountAnalytics(req.partnerAccountId, accountId);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'ACCOUNT_NOT_FOUND',
                    message: 'Account not found'
                }
            });
        }

        logPartnerAccess(req, 'VIEW_ANALYTICS', { targetAccountId: accountId });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Partner API - Get analytics error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to retrieve analytics'
            }
        });
    }
});

/**
 * GET /api/v1/partner/dashboard
 * Get aggregate dashboard across all linked accounts
 */
router.get('/dashboard', async (req, res) => {
    try {
        const result = await partnerDb.getPartnerDashboard(req.partnerAccountId);

        logPartnerAccess(req, 'VIEW_DASHBOARD', {
            accountCount: result.summary.totalAccounts
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Partner API - Get dashboard error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to retrieve dashboard'
            }
        });
    }
});

module.exports = router;
