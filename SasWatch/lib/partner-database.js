/**
 * Partner Database Layer
 *
 * Database operations for Partner API - provides access to linked accounts' data
 * All operations verify that the partner has access to the requested account
 */

const prisma = require('./prisma');

// ============================================
// Partner Account Operations
// ============================================

/**
 * Get partner account by Partner API key
 * @param {string} partnerApiKey - The partner's API key
 * @returns {Promise<Object|null>} Partner account with linked accounts
 */
async function getPartnerByApiKey(partnerApiKey) {
    return await prisma.partnerAccount.findUnique({
        where: { partnerApiKey },
        include: {
            account: true,
            linkedAccounts: {
                where: { isActive: true },
                include: { linkedAccount: true }
            }
        }
    });
}

/**
 * Get all linked accounts for a partner
 * @param {string} partnerAccountId - The partner account ID
 * @param {Object} options - Query options
 * @returns {Promise<Object[]>} Array of linked accounts
 */
async function getLinkedAccounts(partnerAccountId, options = {}) {
    const { limit = 50, offset = 0, search = '' } = options;

    const where = {
        partnerAccountId,
        isActive: true
    };

    // If search is provided, filter by account name or email
    if (search) {
        where.linkedAccount = {
            OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } }
            ]
        };
    }

    const [accounts, total] = await Promise.all([
        prisma.partnerAccountLink.findMany({
            where,
            include: {
                linkedAccount: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        subscriptionTier: true,
                        isActive: true,
                        createdAt: true
                    }
                }
            },
            skip: offset,
            take: limit,
            orderBy: { linkedAt: 'desc' }
        }),
        prisma.partnerAccountLink.count({ where })
    ]);

    return {
        accounts: accounts.map(link => ({
            id: link.linkedAccount.id,
            name: link.linkedAccount.name,
            email: link.linkedAccount.email,
            subscriptionTier: link.linkedAccount.subscriptionTier,
            isActive: link.linkedAccount.isActive,
            linkedAt: link.linkedAt,
            nickname: link.nickname,
            permissions: link.permissions,
            createdAt: link.linkedAccount.createdAt
        })),
        total,
        limit,
        offset,
        hasMore: offset + accounts.length < total
    };
}

/**
 * Check if a partner has access to a specific account
 * @param {string} partnerAccountId - The partner account ID
 * @param {string} linkedAccountId - The account ID to check access for
 * @returns {Promise<Object|null>} Link object if access granted, null otherwise
 */
async function checkPartnerAccess(partnerAccountId, linkedAccountId) {
    return await prisma.partnerAccountLink.findFirst({
        where: {
            partnerAccountId,
            linkedAccountId,
            isActive: true
        },
        include: {
            linkedAccount: true
        }
    });
}

/**
 * Get account details for a linked account
 * @param {string} partnerAccountId - The partner account ID
 * @param {string} linkedAccountId - The account ID to get details for
 * @returns {Promise<Object|null>} Account details or null if no access
 */
async function getLinkedAccountDetails(partnerAccountId, linkedAccountId) {
    const link = await checkPartnerAccess(partnerAccountId, linkedAccountId);
    if (!link) return null;

    const account = await prisma.account.findUnique({
        where: { id: linkedAccountId },
        select: {
            id: true,
            name: true,
            email: true,
            subscriptionTier: true,
            isActive: true,
            createdAt: true,
            _count: {
                select: {
                    users: true,
                    usageEvents: true
                }
            }
        }
    });

    if (!account) return null;

    return {
        ...account,
        userCount: account._count.users,
        eventCount: account._count.usageEvents,
        linkedAt: link.linkedAt,
        nickname: link.nickname,
        permissions: link.permissions
    };
}

// ============================================
// Users Operations (Partner-scoped)
// ============================================

/**
 * Get users for a linked account
 * @param {string} partnerAccountId - The partner account ID
 * @param {string} linkedAccountId - The account ID to get users for
 * @param {Object} options - Query options
 * @returns {Promise<Object|null>} Users data or null if no access
 */
async function getLinkedAccountUsers(partnerAccountId, linkedAccountId, options = {}) {
    const access = await checkPartnerAccess(partnerAccountId, linkedAccountId);
    if (!access) return null;

    const { limit = 50, offset = 0, search = '' } = options;

    const where = { accountId: linkedAccountId };

    if (search) {
        where.OR = [
            { email: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } }
        ];
    }

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where,
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                licenses: true,
                lastActivity: true,
                activityCount: true,
                createdAt: true
            },
            skip: offset,
            take: limit,
            orderBy: { lastName: 'asc' }
        }),
        prisma.user.count({ where })
    ]);

    return {
        users,
        total,
        limit,
        offset,
        hasMore: offset + users.length < total
    };
}

// ============================================
// Activity Operations (Partner-scoped)
// ============================================

/**
 * Get activity for a linked account
 * @param {string} partnerAccountId - The partner account ID
 * @param {string} linkedAccountId - The account ID to get activity for
 * @param {Object} options - Query options
 * @returns {Promise<Object|null>} Activity data or null if no access
 */
async function getLinkedAccountActivity(partnerAccountId, linkedAccountId, options = {}) {
    const access = await checkPartnerAccess(partnerAccountId, linkedAccountId);
    if (!access) return null;

    const { limit = 50, offset = 0, startDate, endDate } = options;

    const where = { accountId: linkedAccountId };

    if (startDate || endDate) {
        where.when = {};
        if (startDate) where.when.gte = new Date(startDate);
        if (endDate) where.when.lte = new Date(endDate);
    }

    const [events, total] = await Promise.all([
        prisma.usageEvent.findMany({
            where,
            select: {
                id: true,
                event: true,
                url: true,
                windowsUser: true,
                computerName: true,
                source: true,
                when: true
            },
            skip: offset,
            take: limit,
            orderBy: { when: 'desc' }
        }),
        prisma.usageEvent.count({ where })
    ]);

    return {
        events,
        total,
        limit,
        offset,
        hasMore: offset + events.length < total
    };
}

// ============================================
// License Operations (Partner-scoped)
// ============================================

/**
 * Get licenses for a linked account
 * @param {string} partnerAccountId - The partner account ID
 * @param {string} linkedAccountId - The account ID to get licenses for
 * @returns {Promise<Object|null>} License data or null if no access
 */
async function getLinkedAccountLicenses(partnerAccountId, linkedAccountId) {
    const access = await checkPartnerAccess(partnerAccountId, linkedAccountId);
    if (!access) return null;

    // Get all users with their licenses
    const users = await prisma.user.findMany({
        where: { accountId: linkedAccountId },
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            licenses: true,
            lastActivity: true,
            activityCount: true
        }
    });

    // Aggregate licenses
    const licenseMap = new Map();

    for (const user of users) {
        for (const license of user.licenses) {
            if (!licenseMap.has(license)) {
                licenseMap.set(license, {
                    name: license,
                    totalAssigned: 0,
                    activeUsers: 0,
                    inactiveUsers: 0,
                    users: []
                });
            }

            const licenseData = licenseMap.get(license);
            licenseData.totalAssigned++;

            // Consider user active if activity in last 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const isActive = user.lastActivity && user.lastActivity > thirtyDaysAgo;

            if (isActive) {
                licenseData.activeUsers++;
            } else {
                licenseData.inactiveUsers++;
            }

            licenseData.users.push({
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                lastActivity: user.lastActivity,
                isActive
            });
        }
    }

    return {
        licenses: Array.from(licenseMap.values()),
        totalUsers: users.length
    };
}

// ============================================
// Analytics Operations (Partner-scoped)
// ============================================

/**
 * Get analytics for a linked account
 * @param {string} partnerAccountId - The partner account ID
 * @param {string} linkedAccountId - The account ID to get analytics for
 * @returns {Promise<Object|null>} Analytics data or null if no access
 */
async function getLinkedAccountAnalytics(partnerAccountId, linkedAccountId) {
    const access = await checkPartnerAccess(partnerAccountId, linkedAccountId);
    if (!access) return null;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [
        totalUsers,
        activeUsers30Days,
        totalEvents30Days,
        totalEvents90Days,
        eventsBySource,
        recentEvents
    ] = await Promise.all([
        // Total users
        prisma.user.count({ where: { accountId: linkedAccountId } }),

        // Active users in last 30 days
        prisma.user.count({
            where: {
                accountId: linkedAccountId,
                lastActivity: { gte: thirtyDaysAgo }
            }
        }),

        // Total events in last 30 days
        prisma.usageEvent.count({
            where: {
                accountId: linkedAccountId,
                when: { gte: thirtyDaysAgo }
            }
        }),

        // Total events in last 90 days
        prisma.usageEvent.count({
            where: {
                accountId: linkedAccountId,
                when: { gte: ninetyDaysAgo }
            }
        }),

        // Events by source in last 30 days
        prisma.usageEvent.groupBy({
            by: ['source'],
            where: {
                accountId: linkedAccountId,
                when: { gte: thirtyDaysAgo }
            },
            _count: true
        }),

        // Recent events (last 10)
        prisma.usageEvent.findMany({
            where: { accountId: linkedAccountId },
            select: {
                id: true,
                event: true,
                url: true,
                source: true,
                when: true
            },
            orderBy: { when: 'desc' },
            take: 10
        })
    ]);

    return {
        summary: {
            totalUsers,
            activeUsers30Days,
            inactiveUsers30Days: totalUsers - activeUsers30Days,
            utilizationRate: totalUsers > 0 ? Math.round((activeUsers30Days / totalUsers) * 100) : 0
        },
        activity: {
            last30Days: totalEvents30Days,
            last90Days: totalEvents90Days,
            bySource: eventsBySource.map(e => ({
                source: e.source,
                count: e._count
            }))
        },
        recentEvents
    };
}

// ============================================
// Dashboard Operations (Aggregate)
// ============================================

/**
 * Get aggregate dashboard for all linked accounts
 * @param {string} partnerAccountId - The partner account ID
 * @returns {Promise<Object>} Aggregate dashboard data
 */
async function getPartnerDashboard(partnerAccountId) {
    // Get all active linked accounts
    const links = await prisma.partnerAccountLink.findMany({
        where: {
            partnerAccountId,
            isActive: true
        },
        include: {
            linkedAccount: {
                select: {
                    id: true,
                    name: true,
                    isActive: true
                }
            }
        }
    });

    const linkedAccountIds = links.map(l => l.linkedAccountId);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
        totalUsers,
        activeUsers30Days,
        totalEvents30Days,
        accountStats
    ] = await Promise.all([
        // Total users across all linked accounts
        prisma.user.count({
            where: { accountId: { in: linkedAccountIds } }
        }),

        // Active users across all linked accounts
        prisma.user.count({
            where: {
                accountId: { in: linkedAccountIds },
                lastActivity: { gte: thirtyDaysAgo }
            }
        }),

        // Total events across all linked accounts
        prisma.usageEvent.count({
            where: {
                accountId: { in: linkedAccountIds },
                when: { gte: thirtyDaysAgo }
            }
        }),

        // Per-account stats
        Promise.all(links.map(async (link) => {
            const [userCount, activeUserCount, eventCount] = await Promise.all([
                prisma.user.count({ where: { accountId: link.linkedAccountId } }),
                prisma.user.count({
                    where: {
                        accountId: link.linkedAccountId,
                        lastActivity: { gte: thirtyDaysAgo }
                    }
                }),
                prisma.usageEvent.count({
                    where: {
                        accountId: link.linkedAccountId,
                        when: { gte: thirtyDaysAgo }
                    }
                })
            ]);

            return {
                accountId: link.linkedAccountId,
                accountName: link.linkedAccount.name,
                nickname: link.nickname,
                isActive: link.linkedAccount.isActive,
                userCount,
                activeUserCount,
                eventCount30Days: eventCount,
                utilizationRate: userCount > 0 ? Math.round((activeUserCount / userCount) * 100) : 0
            };
        }))
    ]);

    return {
        summary: {
            totalAccounts: links.length,
            totalUsers,
            activeUsers30Days,
            inactiveUsers30Days: totalUsers - activeUsers30Days,
            totalEvents30Days,
            averageUtilization: totalUsers > 0 ? Math.round((activeUsers30Days / totalUsers) * 100) : 0
        },
        accounts: accountStats.sort((a, b) => b.userCount - a.userCount)
    };
}

// ============================================
// Partner Management Operations
// ============================================

/**
 * Create a partner account for an existing account
 * @param {string} accountId - The account to make a partner
 * @param {Object} data - Partner data { companyName, maxLinkedAccounts }
 * @returns {Promise<Object>} Created partner account
 */
async function createPartnerAccount(accountId, data = {}) {
    const { companyName = null, maxLinkedAccounts = 100 } = data;

    return await prisma.partnerAccount.create({
        data: {
            accountId,
            companyName,
            maxLinkedAccounts,
            isActive: true
        }
    });
}

/**
 * Link an account to a partner
 * @param {string} partnerAccountId - The partner account ID
 * @param {string} linkedAccountId - The account ID to link
 * @param {Object} data - Link data { nickname, permissions }
 * @returns {Promise<Object>} Created link
 */
async function linkAccountToPartner(partnerAccountId, linkedAccountId, data = {}) {
    const { nickname = null, permissions = ['read'] } = data;

    // Check if already linked
    const existing = await prisma.partnerAccountLink.findUnique({
        where: {
            partnerAccountId_linkedAccountId: {
                partnerAccountId,
                linkedAccountId
            }
        }
    });

    if (existing) {
        // Reactivate if inactive
        if (!existing.isActive) {
            return await prisma.partnerAccountLink.update({
                where: { id: existing.id },
                data: {
                    isActive: true,
                    nickname,
                    permissions
                }
            });
        }
        throw new Error('Account is already linked to this partner');
    }

    // Check max linked accounts limit
    const partner = await prisma.partnerAccount.findUnique({
        where: { id: partnerAccountId },
        include: {
            linkedAccounts: { where: { isActive: true } }
        }
    });

    if (partner.linkedAccounts.length >= partner.maxLinkedAccounts) {
        throw new Error(`Partner has reached maximum linked accounts limit (${partner.maxLinkedAccounts})`);
    }

    return await prisma.partnerAccountLink.create({
        data: {
            partnerAccountId,
            linkedAccountId,
            nickname,
            permissions
        }
    });
}

/**
 * Unlink an account from a partner
 * @param {string} partnerAccountId - The partner account ID
 * @param {string} linkedAccountId - The account ID to unlink
 * @returns {Promise<boolean>} True if unlinked
 */
async function unlinkAccountFromPartner(partnerAccountId, linkedAccountId) {
    const link = await prisma.partnerAccountLink.findUnique({
        where: {
            partnerAccountId_linkedAccountId: {
                partnerAccountId,
                linkedAccountId
            }
        }
    });

    if (!link) {
        throw new Error('Account is not linked to this partner');
    }

    await prisma.partnerAccountLink.update({
        where: { id: link.id },
        data: { isActive: false }
    });

    return true;
}


/**
 * Get all partner accounts
 * @returns {Promise<Object[]>} All partners with linked account counts
 */
async function getAllPartners() {
    return await prisma.partnerAccount.findMany({
        include: {
            account: {
                select: {
                    name: true,
                    email: true
                }
            },
            _count: {
                select: {
                    linkedAccounts: { where: { isActive: true } }
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
}

/**
 * Get detailed partner information
 * @param {string} id - Partner ID
 * @returns {Promise<Object|null>} Detailed partner info
 */
async function getPartnerById(id) {
    return await prisma.partnerAccount.findUnique({
        where: { id },
        include: {
            account: true,
            linkedAccounts: {
                include: {
                    linkedAccount: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            isActive: true
                        }
                    }
                }
            }
        }
    });
}

/**
 * Update partner account settings
 * @param {string} id - Partner ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated partner
 */
async function updatePartnerAccount(id, data) {
    const { companyName, maxLinkedAccounts, isActive } = data;
    return await prisma.partnerAccount.update({
        where: { id },
        data: {
            companyName,
            maxLinkedAccounts: maxLinkedAccounts ? parseInt(maxLinkedAccounts) : undefined,
            isActive: isActive !== undefined ? (isActive === true || isActive === 'true') : undefined
        }
    });
}

/**
 * Regenerate partner API key
 * @param {string} id - Partner ID
 * @returns {Promise<string>} New API key
 */
async function regeneratePartnerApiKey(id) {
    const { randomUUID } = require('crypto');
    const newKey = randomUUID();
    await prisma.partnerAccount.update({
        where: { id },
        data: { partnerApiKey: newKey }
    });
    return newKey;
}

module.exports = {
    // Partner Account
    getPartnerByApiKey,
    getLinkedAccounts,
    checkPartnerAccess,
    getLinkedAccountDetails,
    getAllPartners,
    getPartnerById,

    // Users
    getLinkedAccountUsers,

    // Activity
    getLinkedAccountActivity,

    // Licenses
    getLinkedAccountLicenses,

    // Analytics
    getLinkedAccountAnalytics,

    // Dashboard
    getPartnerDashboard,

    // Partner Management
    createPartnerAccount,
    updatePartnerAccount,
    regeneratePartnerApiKey,
    linkAccountToPartner,
    unlinkAccountFromPartner
};
