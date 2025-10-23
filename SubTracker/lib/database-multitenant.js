// Multi-Tenant Database Abstraction Layer
// All operations are account-scoped for data isolation

const prisma = require('./prisma');

// ============================================
// User Operations (Account-Scoped)
// ============================================

async function getUsersData(accountId) {
    try {
        const users = await prisma.user.findMany({
            where: { accountId },
            include: {
                windowsUsernames: true
            },
            orderBy: {
                email: 'asc'
            }
        });
        
        // Build username mappings for this account
        const usernameMappings = {};
        users.forEach(user => {
            user.windowsUsernames.forEach(wu => {
                usernameMappings[wu.username] = user.email;
            });
        });
        
        // Get unmapped usernames for this account
        const unmappedUsernames = await prisma.unmappedUsername.findMany({
            where: { accountId }
        });
        
        // Transform to match JSON structure
        const transformedUsers = users.map(user => ({
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            adminRoles: user.adminRoles || '',
            userGroups: user.userGroups || '',
            licenses: user.licenses,
            windowsUsernames: user.windowsUsernames.map(wu => wu.username),
            lastActivity: user.lastActivity,
            activityCount: user.activityCount,
            importedAt: user.importedAt
        }));
        
        return {
            users: transformedUsers,
            usernameMappings,
            unmappedUsernames: unmappedUsernames.map(u => ({
                username: u.username,
                activityCount: u.activityCount,
                firstSeen: u.firstSeen,
                lastSeen: u.lastSeen
            }))
        };
    } catch (error) {
        console.error('Error getting users data:', error);
        return { users: [], usernameMappings: {}, unmappedUsernames: [] };
    }
}

async function createUser(accountId, userData) {
    const { email, firstName, lastName, adminRoles, userGroups, licenses, windowsUsernames, importedAt } = userData;
    
    const user = await prisma.user.create({
        data: {
            accountId,
            email,
            firstName,
            lastName,
            adminRoles: adminRoles || null,
            userGroups: userGroups || null,
            licenses: licenses || [],
            activityCount: 0,
            importedAt: importedAt || new Date(),
            windowsUsernames: windowsUsernames && windowsUsernames.length > 0 ? {
                create: windowsUsernames.map(username => ({ username }))
            } : undefined
        },
        include: {
            windowsUsernames: true
        }
    });
    
    return user;
}

async function updateUser(accountId, email, updates) {
    const { windowsUsernames, ...userUpdates } = updates;
    
    // Find user by account and email
    const user = await prisma.user.findFirst({
        where: { accountId, email }
    });
    
    if (!user) {
        throw new Error('User not found');
    }
    
    // Update user data
    const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: userUpdates,
        include: {
            windowsUsernames: true
        }
    });
    
    // Update Windows usernames if provided
    if (windowsUsernames !== undefined) {
        // Delete old usernames
        await prisma.windowsUsername.deleteMany({
            where: { userId: user.id }
        });
        
        // Create new usernames
        await prisma.windowsUsername.createMany({
            data: windowsUsernames.map(username => ({
                username,
                userId: user.id
            }))
        });
    }
    
    return await prisma.user.findUnique({
        where: { id: user.id },
        include: { windowsUsernames: true }
    });
}

async function deleteUser(accountId, email) {
    // Find user by account and email
    const user = await prisma.user.findFirst({
        where: { accountId, email }
    });
    
    if (!user) {
        throw new Error('User not found');
    }
    
    // Cascade delete will handle windowsUsernames
    return await prisma.user.delete({
        where: { id: user.id }
    });
}

async function deleteAllUsers(accountId) {
    // Delete all users for this account (cascades to windowsUsernames)
    await prisma.user.deleteMany({
        where: { accountId }
    });
    
    // Also clear unmapped usernames
    await prisma.unmappedUsername.deleteMany({
        where: { accountId }
    });
}

async function addUsernameMapping(accountId, username, email) {
    const user = await prisma.user.findFirst({ 
        where: { accountId, email } 
    });
    
    if (!user) throw new Error('User not found');
    
    await prisma.windowsUsername.create({
        data: {
            username,
            userId: user.id
        }
    });
    
    // Remove from unmapped if it exists
    await prisma.unmappedUsername.deleteMany({
        where: { accountId, username }
    });
}

async function addUnmappedUsername(accountId, username) {
    try {
        await prisma.unmappedUsername.upsert({
            where: { 
                accountId_username: {
                    accountId,
                    username
                }
            },
            update: {
                activityCount: {
                    increment: 1
                },
                lastSeen: new Date()
            },
            create: {
                accountId,
                username,
                activityCount: 1,
                firstSeen: new Date(),
                lastSeen: new Date()
            }
        });
    } catch (error) {
        console.error('Error adding unmapped username:', error);
    }
}

// ============================================
// Usage Event Operations (Account-Scoped)
// ============================================

async function getUsageData(accountId, limit = 1000) {
    try {
        const [adobeEvents, wrapperEvents] = await Promise.all([
            prisma.usageEvent.findMany({
                where: { 
                    accountId,
                    source: 'adobe' 
                },
                orderBy: { receivedAt: 'desc' },
                take: limit
            }),
            prisma.usageEvent.findMany({
                where: { 
                    accountId,
                    source: 'wrapper' 
                },
                orderBy: { receivedAt: 'desc' },
                take: limit
            })
        ]);
        
        return {
            adobe: adobeEvents.map(e => ({
                event: e.event,
                url: e.url,
                tabId: e.tabId,
                clientId: e.clientId,
                why: e.why,
                when: e.when,
                receivedAt: e.receivedAt,
                windowsUser: e.windowsUser,
                userDomain: e.userDomain,
                computerName: e.computerName
            })),
            wrapper: wrapperEvents.map(e => ({
                event: e.event,
                url: e.url,
                tabId: e.tabId,
                clientId: e.clientId,
                why: e.why,
                when: e.when,
                receivedAt: e.receivedAt,
                windowsUser: e.windowsUser,
                userDomain: e.userDomain,
                computerName: e.computerName
            }))
        };
    } catch (error) {
        console.error('Error getting usage data:', error);
        return { adobe: [], wrapper: [] };
    }
}

async function addUsageEvent(accountId, eventData, source) {
    try {
        await prisma.usageEvent.create({
            data: {
                accountId,
                event: eventData.event,
                url: eventData.url,
                tabId: eventData.tabId || null,
                clientId: eventData.clientId,
                why: eventData.why,
                when: new Date(eventData.when),
                receivedAt: new Date(),
                windowsUser: eventData.windowsUser || null,
                userDomain: eventData.userDomain || null,
                computerName: eventData.computerName || null,
                source
            }
        });
        
        // Update user activity if windowsUser is present
        if (eventData.windowsUser) {
            await updateUserActivityByUsername(accountId, eventData.windowsUser);
        }
    } catch (error) {
        console.error('Error adding usage event:', error);
    }
}

async function deleteAllUsageEvents(accountId) {
    await prisma.usageEvent.deleteMany({
        where: { accountId }
    });
}

async function updateUserActivityByUsername(accountId, windowsUser) {
    try {
        // Find the username mapping scoped to this account
        const mapping = await prisma.windowsUsername.findFirst({
            where: {
                username: windowsUser,
                user: { accountId }
            },
            include: { user: true }
        });
        
        if (mapping && mapping.user) {
            // Update user's last activity and increment count
            await prisma.user.update({
                where: { id: mapping.userId },
                data: {
                    lastActivity: new Date(),
                    activityCount: {
                        increment: 1
                    }
                }
            });
        } else {
            // Add to unmapped usernames for this account
            await addUnmappedUsername(accountId, windowsUser);
        }
    } catch (error) {
        console.error('Error updating user activity:', error);
    }
}

// ============================================
// Utility Functions (Account-Scoped)
// ============================================

async function getDatabaseStats(accountId) {
    const [userCount, eventCount, unmappedCount] = await Promise.all([
        prisma.user.count({ where: { accountId } }),
        prisma.usageEvent.count({ where: { accountId } }),
        prisma.unmappedUsername.count({ where: { accountId } })
    ]);
    
    return {
        users: userCount,
        usageEvents: eventCount,
        unmappedUsernames: unmappedCount
    };
}

async function importUsersFromCSV(accountId, csvData) {
    // Parse CSV and create users
    const users = [];
    
    for (const row of csvData) {
        try {
            const user = await createUser(accountId, row);
            users.push(user);
        } catch (error) {
            console.error(`Failed to import user ${row.email}:`, error.message);
        }
    }
    
    return users;
}

module.exports = {
    // User operations (all account-scoped)
    getUsersData,
    createUser,
    updateUser,
    deleteUser,
    deleteAllUsers,
    addUsernameMapping,
    addUnmappedUsername,
    
    // Usage event operations (all account-scoped)
    getUsageData,
    addUsageEvent,
    deleteAllUsageEvents,
    updateUserActivityByUsername,
    
    // Utility (account-scoped)
    getDatabaseStats,
    importUsersFromCSV,
    
    // Direct prisma access if needed
    prisma
};

