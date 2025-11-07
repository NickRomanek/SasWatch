// Multi-Tenant Database Abstraction Layer
// All operations are account-scoped for data isolation

const prisma = require('./prisma');
const { isConfigured: isEntraConfigured, fetchEntraDirectory } = require('./entra-sync');

const ENTRA_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const PROCESS_APP_MAP = {
    'acrobat.exe': { vendor: 'Adobe', name: 'Acrobat Pro' },
    'acrord32.exe': { vendor: 'Adobe', name: 'Acrobat Reader' },
    'illustrator.exe': { vendor: 'Adobe', name: 'Illustrator' },
    'photoshop.exe': { vendor: 'Adobe', name: 'Photoshop' },
    'indesign.exe': { vendor: 'Adobe', name: 'InDesign' },
    'afterfx.exe': { vendor: 'Adobe', name: 'After Effects' },
    'premiere pro.exe': { vendor: 'Adobe', name: 'Premiere Pro' }
};

const DOMAIN_MATCHERS = [
    { pattern: /(documentcloud|acrobat)/, vendor: 'Adobe', name: 'Acrobat Web' },
    { pattern: /(express\.adobe|adobeexpress)/, vendor: 'Adobe', name: 'Adobe Express' },
    { pattern: /(photoshop)/, vendor: 'Adobe', name: 'Photoshop' },
    { pattern: /(illustrator)/, vendor: 'Adobe', name: 'Illustrator' },
    { pattern: /(indesign)/, vendor: 'Adobe', name: 'InDesign' },
    { pattern: /(lightroom)/, vendor: 'Adobe', name: 'Lightroom' },
    { pattern: /(premiere)/, vendor: 'Adobe', name: 'Premiere Pro' },
    { pattern: /(aftereffects|afterfx)/, vendor: 'Adobe', name: 'After Effects' },
    { pattern: /(creativecloud|creativeclouddesktop)/, vendor: 'Adobe', name: 'Creative Cloud Desktop' }
];

function toTitleCase(value = '') {
    return value
        .split(' ')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function deriveFallbackName(raw = '') {
    if (!raw) {
        return 'Unknown Application';
    }

    const sanitized = raw
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\.adobe\.com$/i, '')
        .replace(/\.html?$/i, '')
        .replace(/[?#].*$/, '')
        .replace(/[\/_-]+/g, ' ')
        .trim();

    if (!sanitized) {
        return 'Unknown Application';
    }

    return toTitleCase(sanitized);
}

function deriveSourceKey(event = {}) {
    const source = (event.source || '').toLowerCase();
    const rawUrl = (event.url || '').trim();

    if (source === 'wrapper') {
        const processName = (rawUrl || event.event || 'unknown').toLowerCase();
        return `wrapper:${processName}`;
    }

    if (rawUrl) {
        try {
            const normalized = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
            const url = new URL(normalized);
            const path = url.pathname === '/' ? '' : url.pathname;
            return `web:${url.hostname.toLowerCase()}${path.toLowerCase()}`;
        } catch (error) {
            return `web:${rawUrl.toLowerCase()}`;
        }
    }

    const eventName = (event.event || event.why || 'unknown').toLowerCase();
    return `event:${eventName}`;
}

function resolveAppMetadataFromEvent(event = {}) {
    const source = (event.source || '').toLowerCase();
    const rawUrl = (event.url || '').trim();
    const rawEvent = (event.event || '').trim();
    const key = deriveSourceKey(event);

    if (!rawUrl && !rawEvent) {
        return null;
    }

    if (source === 'wrapper') {
        const processKey = rawUrl.toLowerCase();
        if (PROCESS_APP_MAP[processKey]) {
            return { ...PROCESS_APP_MAP[processKey], key };
        }

        const fallbackName = toTitleCase(rawUrl.replace(/\.exe$/i, '').replace(/[._-]+/g, ' '));
        const name = fallbackName || 'Adobe Desktop App';
        const vendor = name === 'System' ? 'SubTracker' : 'Adobe';

        return {
            vendor,
            name: name === 'System' ? 'System Activity' : name,
            key
        };
    }

    let lookup = rawUrl || rawEvent;
    let context = lookup.toLowerCase();

    try {
        const normalized = lookup.startsWith('http') ? lookup : `https://${lookup}`;
        const url = new URL(normalized);
        context = `${url.hostname}${url.pathname}`.toLowerCase();
    } catch (error) {
        // Fall back to raw lower-cased string
    }

    for (const matcher of DOMAIN_MATCHERS) {
        if (matcher.pattern.test(context)) {
            return { vendor: matcher.vendor, name: matcher.name, key };
        }
    }

    const name = deriveFallbackName(lookup);
    const vendor = context.includes('adobe') ? 'Adobe' : 'Uncategorized';

    return {
        vendor,
        name: name === 'System' ? 'System Activity' : name,
        key
    };
}

function createAppKey(vendor = '', name = '') {
    return `${vendor.toLowerCase()}::${name.toLowerCase()}`;
}

function normalizeAppInput(appData = {}) {
    const vendor = toTitleCase((appData.vendor || '').trim());
    const name = toTitleCase((appData.name || '').trim());

    if (!vendor || !name) {
        throw new Error('Vendor and name are required');
    }

    return {
        vendor,
        name,
        licensesOwned: Number.isFinite(appData.licensesOwned) ? appData.licensesOwned : (parseInt(appData.licensesOwned, 10) || 0),
        detectedUsers: Number.isFinite(appData.detectedUsers) ? appData.detectedUsers : (parseInt(appData.detectedUsers, 10) || 0)
    };
}

// ============================================
// User Operations (Account-Scoped)
// ============================================

async function getUsersData(accountId) {
    try {
        // Get account to retrieve hidden licenses
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { hiddenLicenses: true }
        });
        const hiddenLicenses = account?.hiddenLicenses || [];

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
        
        // Filter out hidden licenses
        const filterLicenses = (licenses) => {
            if (!Array.isArray(licenses)) return [];
            return licenses.filter(license => !hiddenLicenses.includes(license));
        };
        
        // Transform to match JSON structure
        const transformedUsers = users.map(user => ({
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            adminRoles: user.adminRoles || '',
            userGroups: user.userGroups || '',
            licenses: filterLicenses(user.licenses),
            entraLicenses: filterLicenses(user.entraLicenses),
            entraId: user.entraId || null,
            entraAccountEnabled: user.entraAccountEnabled,
            entraLastSyncedAt: user.entraLastSyncedAt,
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
    const {
        email,
        firstName,
        lastName,
        adminRoles,
        userGroups,
        licenses,
        windowsUsernames,
        importedAt,
        entraId,
        entraAccountEnabled,
        entraLicenses,
        entraLastSyncedAt
    } = userData;
    
    const user = await prisma.user.create({
        data: {
            accountId,
            email,
            firstName,
            lastName,
            adminRoles: adminRoles || null,
            userGroups: userGroups || null,
            licenses: licenses || [],
            entraId: entraId || null,
            entraAccountEnabled: entraAccountEnabled ?? null,
            entraLicenses: entraLicenses || [],
            entraLastSyncedAt: entraLastSyncedAt || null,
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

async function mergeUsers(accountId, targetEmail, sourceEmails) {
    // Find target user (should have Entra data)
    const targetUser = await prisma.user.findFirst({
        where: { accountId, email: targetEmail },
        include: { windowsUsernames: true }
    });
    
    if (!targetUser) {
        throw new Error(`Target user ${targetEmail} not found`);
    }
    
    // Find all source users
    const sourceUsers = await prisma.user.findMany({
        where: {
            accountId,
            email: { in: sourceEmails }
        },
        include: { windowsUsernames: true }
    });
    
    if (sourceUsers.length !== sourceEmails.length) {
        const foundEmails = sourceUsers.map(u => u.email);
        const missing = sourceEmails.filter(e => !foundEmails.includes(e));
        throw new Error(`Source user(s) not found: ${missing.join(', ')}`);
    }
    
    // Collect all licenses from source users (non-Entra licenses)
    const allLicenses = new Set(targetUser.licenses || []);
    sourceUsers.forEach(sourceUser => {
        if (sourceUser.licenses && Array.isArray(sourceUser.licenses)) {
            sourceUser.licenses.forEach(license => {
                if (license && !allLicenses.has(license)) {
                    allLicenses.add(license);
                }
            });
        }
    });
    
    // Collect all Windows usernames from source users
    const allWindowsUsernames = new Set();
    (targetUser.windowsUsernames || []).forEach(wu => allWindowsUsernames.add(wu.username));
    sourceUsers.forEach(sourceUser => {
        (sourceUser.windowsUsernames || []).forEach(wu => {
            if (wu.username) {
                allWindowsUsernames.add(wu.username);
            }
        });
    });
    
    // Update target user with merged data
    // Keep all Entra data, add licenses from source users
    await prisma.user.update({
        where: { id: targetUser.id },
        data: {
            licenses: Array.from(allLicenses),
            windowsUsernames: {
                deleteMany: {}, // Delete existing
                create: Array.from(allWindowsUsernames).map(username => ({ username }))
            }
        }
    });
    
    // Usage events are already linked via windowsUser field, which is now mapped to target user
    // No need to update usage events - they'll be associated via the merged windowsUsernames
    
    // Delete source users (cascades to windowsUsernames)
    await prisma.user.deleteMany({
        where: {
            accountId,
            email: { in: sourceEmails }
        }
    });
    
    return {
        targetEmail,
        sourceEmails,
        mergedLicenses: Array.from(allLicenses).length - (targetUser.licenses?.length || 0),
        mergedUsernames: Array.from(allWindowsUsernames).length - (targetUser.windowsUsernames?.length || 0)
    };
}

async function deleteUsersBulk(accountId, emails) {
    // Delete multiple users by email
    const result = await prisma.user.deleteMany({
        where: {
            accountId,
            email: { in: emails }
        }
    });
    
    return result.count;
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

// Get usage activity for a specific user
async function getUserActivityData(accountId, userEmail, limit = 500) {
    try {
        // Get user and their Windows usernames
        const user = await prisma.user.findUnique({
            where: {
                accountId_email: {
                    accountId,
                    email: userEmail
                }
            },
            include: {
                windowsUsernames: true
            }
        });

        if (!user) {
            return { user: null, activity: [] };
        }

        // Get all Windows usernames for this user
        const windowsUsernames = user.windowsUsernames.map(wu => wu.username);

        // Get usage events for these Windows usernames
        const events = await prisma.usageEvent.findMany({
            where: {
                accountId,
                windowsUser: {
                    in: windowsUsernames
                }
            },
            orderBy: { receivedAt: 'desc' },
            take: limit
        });

        return {
            user: {
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                licenses: user.licenses,
                lastActivity: user.lastActivity,
                activityCount: user.activityCount,
                windowsUsernames: windowsUsernames
            },
            activity: events.map(e => ({
                event: e.event,
                url: e.url,
                source: e.source,
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
        console.error('Error getting user activity data:', error);
        return { user: null, activity: [] };
    }
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

// ============================================
// Application Operations (Account-Scoped)
// ============================================

async function getAppsData(accountId) {
    try {
        const [manualApps, overrides, usageEvents] = await Promise.all([
            prisma.application.findMany({
                where: { accountId, isHidden: false },
                orderBy: [
                    { vendor: 'asc' },
                    { name: 'asc' }
                ]
            }),
            prisma.appOverride.findMany({
                where: { accountId }
            }),
            prisma.usageEvent.findMany({
                where: { accountId },
                select: {
                    event: true,
                    url: true,
                    source: true,
                    windowsUser: true,
                    clientId: true,
                    computerName: true
                }
            })
        ]);

        const overrideMap = new Map();
        overrides.forEach(override => {
            overrideMap.set(override.sourceKey, override);
        });

        const appMap = new Map();

        manualApps.forEach(app => {
            const key = `manual:${app.id}`;
            appMap.set(key, {
                id: app.id,
                sourceKey: null,
                vendor: app.vendor,
                name: app.name,
                licensesOwned: app.licensesOwned || 0,
                detectedUsers: app.detectedUsers || 0,
                userIdentifiers: new Set(),
                isManual: true,
                hasOverride: false
            });
        });

        usageEvents.forEach(event => {
            const metadata = resolveAppMetadataFromEvent(event);
            if (!metadata || !metadata.key) {
                return;
            }

            const override = overrideMap.get(metadata.key);
            if (override && override.isHidden) {
                return;
            }
            const vendor = override ? override.vendor : metadata.vendor;
            const name = override ? override.name : metadata.name;
            const licensesOwned = override ? override.licensesOwned : 0;

            if (!appMap.has(metadata.key)) {
                appMap.set(metadata.key, {
                    id: null,
                    sourceKey: metadata.key,
                    vendor,
                    name,
                    licensesOwned,
                    detectedUsers: 0,
                    userIdentifiers: new Set(),
                    isManual: false,
                    hasOverride: !!override
                });
            }

            const entry = appMap.get(metadata.key);
            entry.vendor = vendor;
            entry.name = name;
            if (override) {
                entry.licensesOwned = override.licensesOwned;
                entry.hasOverride = true;
            }

            const identifier = (event.windowsUser || event.clientId || event.computerName || '').trim().toLowerCase();
            if (identifier) {
                entry.userIdentifiers.add(identifier);
            }
        });

        const apps = Array.from(appMap.values())
            .map(entry => {
                const detectedUsers = entry.isManual ? entry.detectedUsers : entry.userIdentifiers.size;
                const licensesOwned = entry.licensesOwned || 0;
                const unusedLicenses = licensesOwned - detectedUsers;

                return {
                    id: entry.isManual ? entry.id : null,
                    sourceKey: entry.sourceKey,
                    vendor: entry.vendor,
                    name: entry.name,
                    detectedUsers,
                    licensesOwned,
                    unusedLicenses,
                    isManual: entry.isManual,
                    hasOverride: entry.hasOverride
                };
            })
            .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));

        const stats = {
            totalApps: apps.length,
            totalLicenses: apps.reduce((sum, app) => sum + (app.licensesOwned || 0), 0),
            totalDetected: apps.reduce((sum, app) => sum + (app.detectedUsers || 0), 0),
            totalUnused: apps.reduce((sum, app) => sum + Math.max(app.unusedLicenses, 0), 0)
        };

        stats.totalUsers = stats.totalDetected;

        return { apps, stats };
    } catch (error) {
        console.error('Error getting apps data:', error);
        return { apps: [], stats: {} };
    }
}

async function createApp(accountId, appData) {
    const payload = normalizeAppInput(appData);

    return prisma.application.create({
        data: {
            accountId,
            vendor: payload.vendor,
            name: payload.name,
            licensesOwned: payload.licensesOwned,
            detectedUsers: payload.detectedUsers
        }
    });
}

async function updateApp(accountId, appId, updates) {
    const existing = await prisma.application.findFirst({
        where: { id: appId, accountId }
    });

    if (!existing) {
        throw new Error('Application not found');
    }

    const payload = normalizeAppInput({
        vendor: updates.vendor ?? existing.vendor,
        name: updates.name ?? existing.name,
        licensesOwned: updates.licensesOwned ?? existing.licensesOwned,
        detectedUsers: updates.detectedUsers ?? existing.detectedUsers
    });

    return prisma.application.update({
        where: { id: appId },
        data: payload
    });
}

async function upsertAppOverride(accountId, sourceKey, appData) {
    if (!sourceKey) {
        throw new Error('sourceKey is required');
    }

    const payload = normalizeAppInput({
        vendor: appData.vendor,
        name: appData.name,
        licensesOwned: appData.licensesOwned,
        detectedUsers: 0
    });
    const isHidden = appData.isHidden === true;

    const existing = await prisma.appOverride.findFirst({
        where: { accountId, sourceKey }
    });

    if (existing) {
        return prisma.appOverride.update({
            where: { id: existing.id },
            data: {
                vendor: payload.vendor,
                name: payload.name,
                licensesOwned: payload.licensesOwned,
                isHidden
            }
        });
    }

    return prisma.appOverride.create({
        data: {
            accountId,
            sourceKey,
            vendor: payload.vendor,
            name: payload.name,
            licensesOwned: payload.licensesOwned,
            isHidden
        }
    });
}

async function deleteAppOverride(accountId, sourceKey) {
    await prisma.appOverride.deleteMany({
        where: { accountId, sourceKey }
    });
}

async function hideApp(accountId, { id, sourceKey, vendor, name, licensesOwned }) {
    if (id) {
        return prisma.application.updateMany({
            where: { id, accountId },
            data: { isHidden: true }
        });
    }

    if (sourceKey) {
        return upsertAppOverride(accountId, sourceKey, {
            vendor,
            name,
            licensesOwned,
            isHidden: true
        });
    }

    throw new Error('Either application id or sourceKey is required to hide app');
}

async function deleteApp(accountId, appId) {
    // Verify app belongs to account
    const app = await prisma.application.findFirst({
        where: { id: appId, accountId }
    });

    if (!app) {
        throw new Error('Application not found');
    }

    await prisma.application.delete({
        where: { id: appId }
    });
}

async function deleteAllApps(accountId) {
    await prisma.application.deleteMany({
        where: { accountId }
    });
}

async function syncEntraUsersIfNeeded(accountId, options = {}) {
    if (!isEntraConfigured()) {
        return { synced: false, reason: 'not-configured' };
    }

    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { entraLastSyncAt: true, entraTenantId: true }
    });

    if (!account?.entraTenantId) {
        return { synced: false, reason: 'not-connected' };
    }

    const now = new Date();
    if (!options.force && account?.entraLastSyncAt) {
        const diff = now.getTime() - account.entraLastSyncAt.getTime();
        if (diff < ENTRA_SYNC_INTERVAL_MS) {
            return {
                synced: false,
                reason: 'throttled',
                lastSync: account.entraLastSyncAt
            };
        }
    }

    try {
        const directory = await fetchEntraDirectory(account.entraTenantId);
        const syncedAt = directory.fetchedAt || new Date();
        const seenEmails = new Set();

        for (const graphUser of directory.users) {
            const email = (graphUser.email || '').trim().toLowerCase();
            if (!email || seenEmails.has(email)) {
                continue;
            }
            seenEmails.add(email);

            const licenseList = Array.isArray(graphUser.licenses) ? graphUser.licenses : [];
            const existing = await prisma.user.findFirst({
                where: { accountId, email }
            });

            if (existing) {
                const updateData = {
                    entraId: graphUser.entraId || existing.entraId,
                    entraAccountEnabled: graphUser.accountEnabled,
                    entraLicenses: licenseList,
                    entraLastSyncedAt: syncedAt
                };

                if (graphUser.firstName) {
                    updateData.firstName = graphUser.firstName;
                }
                if (graphUser.lastName) {
                    updateData.lastName = graphUser.lastName;
                }
                if (!graphUser.firstName && !graphUser.lastName && graphUser.displayName) {
                    const parts = graphUser.displayName.split(/\s+/);
                    if (!existing.firstName && parts[0]) {
                        updateData.firstName = parts[0];
                    }
                    if (!existing.lastName && parts.length > 1) {
                        updateData.lastName = parts.slice(1).join(' ');
                    }
                }

                if (licenseList.length > 0) {
                    updateData.licenses = licenseList;
                }

                await prisma.user.update({
                    where: { id: existing.id },
                    data: updateData
                });
            } else {
                const firstName = graphUser.firstName || (graphUser.displayName ? graphUser.displayName.split(/\s+/)[0] : 'Unknown');
                const lastName = graphUser.lastName || (graphUser.displayName ? graphUser.displayName.split(/\s+/).slice(1).join(' ') : '');

                await prisma.user.create({
                    data: {
                        accountId,
                        email,
                        firstName: firstName || 'Unknown',
                        lastName: lastName || '',
                        licenses: licenseList,
                        entraId: graphUser.entraId || null,
                        entraAccountEnabled: graphUser.accountEnabled,
                        entraLicenses: licenseList,
                        entraLastSyncedAt: syncedAt,
                        activityCount: 0,
                        importedAt: syncedAt
                    }
                });
            }
        }

        await prisma.account.update({
            where: { id: accountId },
            data: {
                entraLastSyncAt: syncedAt
            }
        });

        return {
            synced: true,
            lastSync: syncedAt,
            count: seenEmails.size
        };
    } catch (error) {
        console.error('Entra sync error:', error);
        return {
            synced: false,
            error: error.message || String(error)
        };
    }
}

module.exports = {
    // User operations (all account-scoped)
    getUsersData,
    createUser,
    updateUser,
    deleteUser,
    deleteAllUsers,
    mergeUsers,
    deleteUsersBulk,
    addUsernameMapping,
    addUnmappedUsername,
    
    // Usage event operations (all account-scoped)
    getUsageData,
    getUserActivityData,
    addUsageEvent,
    deleteAllUsageEvents,
    updateUserActivityByUsername,
    
    // Utility (account-scoped)
    getDatabaseStats,
    importUsersFromCSV,

    // Application operations (all account-scoped)
    getAppsData,
    createApp,
    updateApp,
    upsertAppOverride,
    deleteAppOverride,
    hideApp,
    deleteApp,
    deleteAllApps,

    syncEntraUsersIfNeeded,
    isEntraConfigured,

    // Direct prisma access if needed
    prisma
};

