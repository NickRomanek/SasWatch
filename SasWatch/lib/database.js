// Database Abstraction Layer
// Provides the same interface as JSON file operations but uses PostgreSQL

const prisma = require('./prisma');

// ============================================
// User Operations
// ============================================

async function getUsersData() {
    try {
        const users = await prisma.user.findMany({
            include: {
                windowsUsernames: true
            },
            orderBy: {
                email: 'asc'
            }
        });
        
        // Build username mappings
        const usernameMappings = {};
        users.forEach(user => {
            user.windowsUsernames.forEach(wu => {
                usernameMappings[wu.username] = user.email;
            });
        });
        
        // Get unmapped usernames
        const unmappedUsernames = await prisma.unmappedUsername.findMany();
        
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

async function saveUsersData(data) {
    // This function now handles individual operations instead of bulk saves
    // Each operation (create, update, delete user) should use specific functions below
    console.warn('saveUsersData called - use specific database operations instead');
    return true;
}

async function createUser(userData) {
    const { email, firstName, lastName, adminRoles, userGroups, licenses, windowsUsernames, importedAt } = userData;
    
    const user = await prisma.user.create({
        data: {
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

async function updateUser(email, updates) {
    const { windowsUsernames, ...userUpdates } = updates;
    
    // Update user data
    const user = await prisma.user.update({
        where: { email },
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
        if (windowsUsernames.length > 0) {
            await prisma.windowsUsername.createMany({
                data: windowsUsernames.map(username => ({
                    username,
                    userId: user.id
                }))
            });
        }
    }
    
    return await prisma.user.findUnique({
        where: { email },
        include: { windowsUsernames: true }
    });
}

async function deleteUser(email) {
    // Cascade delete will handle windowsUsernames
    return await prisma.user.delete({
        where: { email }
    });
}

async function deleteAllUsers() {
    await prisma.windowsUsername.deleteMany({});
    await prisma.unmappedUsername.deleteMany({});
    await prisma.user.deleteMany({});
}

async function addUsernameMapping(username, email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('User not found');
    
    await prisma.windowsUsername.create({
        data: {
            username,
            userId: user.id
        }
    });
    
    // Remove from unmapped if it exists
    await prisma.unmappedUsername.deleteMany({
        where: { username }
    });
}

async function addUnmappedUsername(username) {
    try {
        await prisma.unmappedUsername.upsert({
            where: { username },
            update: {
                activityCount: {
                    increment: 1
                },
                lastSeen: new Date()
            },
            create: {
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
// Usage Event Operations
// ============================================

async function getUsageData(limit = 1000) {
    try {
        const [adobeEvents, wrapperEvents] = await Promise.all([
            prisma.usageEvent.findMany({
                where: { source: 'adobe' },
                orderBy: { receivedAt: 'desc' },
                take: limit
            }),
            prisma.usageEvent.findMany({
                where: { source: 'wrapper' },
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

async function addUsageEvent(eventData, source) {
    try {
        await prisma.usageEvent.create({
            data: {
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
            await updateUserActivityByUsername(eventData.windowsUser);
        }
    } catch (error) {
        console.error('Error adding usage event:', error);
    }
}

async function deleteAllUsageEvents() {
    await prisma.usageEvent.deleteMany({});
}

async function updateUserActivityByUsername(windowsUser) {
    try {
        // Find the username mapping
        const mapping = await prisma.windowsUsername.findUnique({
            where: { username: windowsUser },
            include: { user: true }
        });
        
        if (mapping) {
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
            // Add to unmapped usernames
            await addUnmappedUsername(windowsUser);
        }
    } catch (error) {
        console.error('Error updating user activity:', error);
    }
}

// ============================================
// Utility Functions
// ============================================

async function getDatabaseStats() {
    const [userCount, eventCount, unmappedCount] = await Promise.all([
        prisma.user.count(),
        prisma.usageEvent.count(),
        prisma.unmappedUsername.count()
    ]);
    
    return {
        users: userCount,
        usageEvents: eventCount,
        unmappedUsernames: unmappedCount
    };
}

module.exports = {
    // User operations
    getUsersData,
    saveUsersData,
    createUser,
    updateUser,
    deleteUser,
    deleteAllUsers,
    addUsernameMapping,
    addUnmappedUsername,
    
    // Usage event operations
    getUsageData,
    addUsageEvent,
    deleteAllUsageEvents,
    updateUserActivityByUsername,
    
    // Utility
    getDatabaseStats,
    
    // Direct prisma access if needed
    prisma
};

