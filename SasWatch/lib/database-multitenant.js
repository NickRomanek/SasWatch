// Multi-Tenant Database Abstraction Layer
// All operations are account-scoped for data isolation

const prisma = require('./prisma');
const { isConfigured: isEntraConfigured, fetchEntraDirectory, fetchEntraSignIns } = require('./entra-sync');

const ENTRA_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const ENTRA_SIGNIN_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours (matches background sync schedule)
const ENTRA_SIGNIN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

function determineSignInVendor(name = '', signIn = {}) {
    const normalized = name.toLowerCase();
    const clientApp = (signIn.clientAppUsed || '').toLowerCase();

    if (normalized.includes('adobe') || clientApp.includes('adobe')) {
        return 'Adobe';
    }

    if (
        normalized.includes('microsoft') ||
        normalized.includes('office') ||
        normalized.includes('sharepoint') ||
        normalized.includes('subman') ||
        clientApp.includes('microsoft')
    ) {
        return 'Microsoft';
    }

    if (normalized.includes('google') || clientApp.includes('google')) {
        return 'Google';
    }

    return 'Microsoft Entra';
}

function classifySignInSource(clientAppUsed = '') {
    const normalized = (clientAppUsed || '').toLowerCase();

    if (!normalized) {
        return 'entra-other';
    }

    if (normalized.includes('browser')) {
        return 'entra-web';
    }

    if (normalized.includes('mobile') || normalized.includes('desktop') || normalized.includes('client')) {
        return 'entra-desktop';
    }

    return 'entra-other';
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

function mapSignInForResponse(signIn) {
    const when = signIn.createdDateTime instanceof Date ? signIn.createdDateTime : new Date(signIn.createdDateTime);
    const source = signIn.sourceChannel || classifySignInSource(signIn.clientAppUsed);
    const appDisplayName = signIn.appDisplayName || signIn.resourceDisplayName || 'Unknown Application';
    const clientApp = signIn.clientAppUsed ? signIn.clientAppUsed.trim() : '';
    const why = clientApp ? `Sign-in via ${clientApp}` : null;

    return {
        id: signIn.id,
        when,
        receivedAt: when,
        event: appDisplayName,
        appDisplayName,
        resourceDisplayName: signIn.resourceDisplayName || null,
        source,
        clientAppUsed: clientApp || null,
        computerName: signIn.deviceDisplayName || null,
        operatingSystem: signIn.operatingSystem || null,
        browser: signIn.browser || null,
        ipAddress: signIn.ipAddress || null,
        windowsUser: signIn.userPrincipalName || signIn.userDisplayName || null,
        userPrincipalName: signIn.userPrincipalName || null,
        userDisplayName: signIn.userDisplayName || null,
        locationCity: signIn.locationCity || null,
        locationCountryOrRegion: signIn.locationCountryOrRegion || null,
        statusErrorCode: signIn.statusErrorCode ?? null,
        statusFailureReason: signIn.statusFailureReason || null,
        riskState: signIn.riskState || null,
        riskDetail: signIn.riskDetail || null,
        conditionalAccessStatus: signIn.conditionalAccessStatus || null,
        correlationId: signIn.correlationId || null,
        isInteractive: signIn.isInteractive ?? null,
        why,
        type: 'entra'
    };
}

async function getUsageData(accountId, limit = 1000) {
    try {
        const [adobeEvents, wrapperEvents, signInEvents] = await Promise.all([
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
            }),
            prisma.entraSignIn.findMany({
                where: { accountId },
                orderBy: { createdDateTime: 'desc' },
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
            })),
            entra: signInEvents.map(mapSignInForResponse)
        };
    } catch (error) {
        console.error('Error getting usage data:', error);
        return { adobe: [], wrapper: [], entra: [] };
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
    await prisma.entraSignIn.deleteMany({
        where: { accountId }
    });
    
    // Reset Entra sync cursor so next sync pulls fresh data
    await prisma.account.update({
        where: { id: accountId },
        data: {
            entraSignInCursor: null,
            entraSignInLastSyncAt: null
        }
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
    const [userCount, eventCount, unmappedCount, signInCount] = await Promise.all([
        prisma.user.count({ where: { accountId } }),
        prisma.usageEvent.count({ where: { accountId } }),
        prisma.unmappedUsername.count({ where: { accountId } }),
        prisma.entraSignIn.count({ where: { accountId } })
    ]);
    
    return {
        users: userCount,
        usageEvents: eventCount,
        unmappedUsernames: unmappedCount,
        signInEvents: signInCount
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
        const [manualApps, overrides, usageEvents, signInEvents] = await Promise.all([
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
            }),
            prisma.entraSignIn.findMany({
                where: { accountId },
                select: {
                    appDisplayName: true,
                    resourceDisplayName: true,
                    clientAppUsed: true,
                    userPrincipalName: true,
                    userDisplayName: true,
                    deviceDisplayName: true
                }
            })
        ]);

        const overrideMap = new Map();
        overrides.forEach(override => {
            overrideMap.set(override.sourceKey, override);
        });

        const appMap = new Map();

        const addComponent = (entry, componentKey, data) => {
            if (!entry.components) {
                entry.components = new Map();
            }
            if (!entry.components.has(componentKey)) {
                entry.components.set(componentKey, data);
            }
        };

        manualApps.forEach(app => {
            const key = `manual:${app.id}`;
            const entry = {
                id: app.id,
                sourceKey: null,
                vendor: app.vendor,
                name: app.name,
                licensesOwned: app.licensesOwned || 0,
                detectedUsers: app.detectedUsers || 0,
                userIdentifiers: new Set(),
                isManual: true,
                hasOverride: false,
                components: new Map()
            };
            addComponent(entry, `manual:${app.id}`, {
                type: 'manual',
                id: app.id,
                sourceKey: null,
                name: app.name,
                vendor: app.vendor,
                originalName: app.name,
                originalVendor: app.vendor
            });
            appMap.set(key, entry);
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
                    hasOverride: !!override,
                    components: new Map()
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

            addComponent(entry, `auto:${metadata.key}`, {
                type: 'auto',
                id: null,
                sourceKey: metadata.key,
                name,
                vendor,
                originalName: metadata.name,
                originalVendor: metadata.vendor
            });
        });

        signInEvents.forEach(signIn => {
            const rawName = (signIn.appDisplayName || signIn.resourceDisplayName || signIn.clientAppUsed || '').trim();
            const displayName = rawName || 'Unknown Application';
            const vendor = determineSignInVendor(displayName, signIn);
            const sourceKey = `entra:${displayName.toLowerCase()}`;
            const override = overrideMap.get(sourceKey);

            if (override && override.isHidden) {
                return;
            }

            if (!appMap.has(sourceKey)) {
                appMap.set(sourceKey, {
                    id: null,
                    sourceKey,
                    vendor: override ? override.vendor : vendor,
                    name: override ? override.name : displayName,
                    licensesOwned: override ? override.licensesOwned : 0,
                    detectedUsers: 0,
                    userIdentifiers: new Set(),
                    isManual: false,
                    hasOverride: !!override,
                    components: new Map()
                });
            }

            const entry = appMap.get(sourceKey);
            entry.vendor = override ? override.vendor : vendor;
            entry.name = override ? override.name : displayName;
            if (override) {
                entry.licensesOwned = override.licensesOwned;
                entry.hasOverride = true;
            }

            const identifier = (signIn.userPrincipalName || signIn.userDisplayName || signIn.deviceDisplayName || '').trim().toLowerCase();
            if (identifier) {
                entry.userIdentifiers.add(identifier);
            }

            addComponent(entry, `auto:${sourceKey}`, {
                type: 'auto',
                id: null,
                sourceKey,
                name: entry.name,
                vendor: entry.vendor,
                originalName: displayName,
                originalVendor: vendor
            });
        });

        const combinedMap = new Map();

        appMap.forEach(entry => {
            const normalizedVendor = (entry.vendor || 'Uncategorized').trim() || 'Uncategorized';
            const normalizedName = (entry.name || 'Unknown Application').trim() || 'Unknown Application';
            const groupKey = `${normalizedVendor.toLowerCase()}||${normalizedName.toLowerCase()}`;

            if (!combinedMap.has(groupKey)) {
                combinedMap.set(groupKey, {
                    ids: entry.isManual && entry.id ? [entry.id] : [],
                    sourceKeys: entry.sourceKey ? [entry.sourceKey] : [],
                    vendor: normalizedVendor,
                    name: normalizedName,
                    manualDetected: entry.isManual ? (entry.detectedUsers || 0) : 0,
                    autoIdentifiers: entry.isManual ? new Set() : new Set(entry.userIdentifiers),
                    licensesOwned: entry.licensesOwned || 0,
                    hasOverride: entry.hasOverride,
                    isManual: entry.isManual,
                    components: entry.components ? new Map(entry.components) : new Map()
                });
            } else {
                const target = combinedMap.get(groupKey);

                if (entry.isManual) {
                    target.manualDetected = Math.max(target.manualDetected, entry.detectedUsers || 0);
                    if (entry.id) {
                        target.ids.push(entry.id);
                    }
                    target.isManual = true;
                } else {
                    entry.userIdentifiers.forEach(id => target.autoIdentifiers.add(id));
                    if (entry.sourceKey) {
                        target.sourceKeys.push(entry.sourceKey);
                    }
                }

                if (entry.components) {
                    entry.components.forEach((component, componentKey) => {
                        if (!target.components.has(componentKey)) {
                            target.components.set(componentKey, component);
                        }
                    });
                }

                target.licensesOwned = Math.max(target.licensesOwned || 0, entry.licensesOwned || 0);
                target.hasOverride = target.hasOverride || entry.hasOverride;

                const targetVendorLower = target.vendor.toLowerCase();
                if (targetVendorLower === 'uncategorized' && normalizedVendor.toLowerCase() !== 'uncategorized') {
                    target.vendor = normalizedVendor;
                }
                if (target.name === 'Unknown Application' && normalizedName !== 'Unknown Application') {
                    target.name = normalizedName;
                }
            }
        });

        const apps = Array.from(combinedMap.values())
            .map(entry => {
                const autoCount = entry.autoIdentifiers.size;
                const detectedUsers = Math.max(autoCount, entry.manualDetected || 0);
                const licensesOwned = entry.licensesOwned || 0;
                const unusedLicenses = licensesOwned - detectedUsers;

                return {
                    id: entry.ids.length > 0 ? entry.ids[0] : null,
                    sourceKey: entry.sourceKeys.length > 0 ? entry.sourceKeys[0] : null,
                    vendor: entry.vendor,
                    name: entry.name,
                    detectedUsers,
                    licensesOwned,
                    unusedLicenses,
                    isManual: entry.isManual,
                    hasOverride: entry.hasOverride,
                    components: Array.from(entry.components?.values() || [])
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
    await prisma.appOverride.deleteMany({
        where: { accountId }
    });
}

async function deleteAppsBatch(accountId, entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return { manualDeleted: 0, overridesHidden: 0, errors: [] };
    }

    let manualDeleted = 0;
    let overridesHidden = 0;
    const errors = [];

    for (const rawEntry of entries) {
        if (!rawEntry || typeof rawEntry !== 'object') {
            continue;
        }

        const ids = Array.isArray(rawEntry.ids)
            ? Array.from(new Set(rawEntry.ids.map(id => (id ? String(id) : '').trim()).filter(Boolean)))
            : [];
        const sourceKeys = Array.isArray(rawEntry.sourceKeys)
            ? Array.from(new Set(rawEntry.sourceKeys.map(key => (key ? String(key) : '').trim()).filter(Boolean)))
            : [];
        const vendor = (rawEntry.vendor || 'Uncategorized').toString();
        const name = (rawEntry.name || 'Unknown Application').toString();
        const licensesOwned = Number.isFinite(rawEntry.licensesOwned)
            ? rawEntry.licensesOwned
            : (parseInt(rawEntry.licensesOwned, 10) || 0);

        for (const id of ids) {
            try {
                await deleteApp(accountId, id);
                manualDeleted += 1;
            } catch (error) {
                console.error(`Failed to delete application ${id}:`, error);
                errors.push({
                    type: 'manual',
                    id,
                    message: error.message || 'Failed to delete application'
                });
            }
        }

        for (const sourceKey of sourceKeys) {
            try {
                await hideApp(accountId, {
                    id: null,
                    sourceKey,
                    vendor,
                    name,
                    licensesOwned
                });
                overridesHidden += 1;
            } catch (error) {
                console.error(`Failed to hide application ${sourceKey}:`, error);
                errors.push({
                    type: 'detected',
                    sourceKey,
                    message: error.message || 'Failed to hide application'
                });
            }
        }
    }

    return { manualDeleted, overridesHidden, errors };
}

function normalizeMergeAppEntry(entry = {}) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const id = entry.id ? String(entry.id) : null;
    const sourceKey = entry.sourceKey ? String(entry.sourceKey) : null;

    if (!id && !sourceKey) {
        return null;
    }

    return {
        id,
        sourceKey,
        licensesOwned: Number.isFinite(entry.licensesOwned)
            ? entry.licensesOwned
            : (parseInt(entry.licensesOwned, 10) || null),
        detectedUsers: Number.isFinite(entry.detectedUsers)
            ? entry.detectedUsers
            : (parseInt(entry.detectedUsers, 10) || 0)
    };
}

async function mergeApps(accountId, targetEntry, sourceEntries = [], canonical = {}) {
    const target = normalizeMergeAppEntry(targetEntry);
    const sources = Array.isArray(sourceEntries)
        ? sourceEntries.map(normalizeMergeAppEntry).filter(Boolean)
        : [];

    if (!target) {
        throw new Error('Target application is required');
    }

    if (sources.length === 0) {
        throw new Error('At least one source application is required');
    }

    const vendorRaw = (canonical.vendor || '').trim();
    const nameRaw = (canonical.name || '').trim();

    if (!vendorRaw) {
        throw new Error('Vendor is required');
    }

    if (!nameRaw) {
        throw new Error('Application name is required');
    }

    const vendor = toTitleCase(vendorRaw);
    const name = toTitleCase(nameRaw);

    const hasLicenseInput = canonical.licensesOwned !== undefined && canonical.licensesOwned !== null && canonical.licensesOwned !== '';
    const canonicalLicenses = hasLicenseInput
        ? Math.max(0, parseInt(canonical.licensesOwned, 10) || 0)
        : null;

    const manualIds = new Set();
    const autoKeys = new Set();

    if (target.id) manualIds.add(target.id);
    if (target.sourceKey) autoKeys.add(target.sourceKey);

    sources.forEach(entry => {
        if (entry.id) manualIds.add(entry.id);
        if (entry.sourceKey) autoKeys.add(entry.sourceKey);
    });

    // Validate manual apps belong to account
    if (manualIds.size > 0) {
        const manualApps = await prisma.application.findMany({
            where: {
                accountId,
                id: { in: Array.from(manualIds) }
            }
        });

        if (manualApps.length !== manualIds.size) {
            const foundIds = new Set(manualApps.map(app => app.id));
            const missing = Array.from(manualIds).filter(id => !foundIds.has(id));
            throw new Error(`Manual application(s) not found: ${missing.join(', ')}`);
        }
    }

    // Update manual apps (target + sources)
    for (const entry of [target, ...sources]) {
        if (entry && entry.id) {
            const data = {
                vendor,
                name
            };

            if (canonicalLicenses !== null && entry.id === target.id) {
                data.licensesOwned = canonicalLicenses;
            }

            await prisma.application.update({
                where: { id: entry.id },
                data
            });
        }
    }

    // Update overrides for detected apps
    for (const sourceKey of autoKeys) {
        if (!sourceKey) continue;
        // Determine fallback license if canonical not provided
        let licensesOwned = canonicalLicenses;
        if (licensesOwned === null) {
            const sourceEntry = [target, ...sources].find(entry => entry?.sourceKey === sourceKey);
            licensesOwned = Number.isFinite(sourceEntry?.licensesOwned)
                ? Math.max(0, sourceEntry.licensesOwned)
                : 0;
        }

        await upsertAppOverride(accountId, sourceKey, {
            vendor,
            name,
            licensesOwned
        });
    }

    return {
        vendor,
        name,
        licensesOwned: canonicalLicenses,
        updatedManualApps: Array.from(manualIds),
        updatedOverrides: Array.from(autoKeys)
    };
}

async function syncEntraSignInsIfNeeded(accountId, options = {}) {
    if (!isEntraConfigured()) {
        return { synced: false, reason: 'not-configured' };
    }

    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: {
            entraTenantId: true,
            entraSignInCursor: true,
            entraSignInLastSyncAt: true
        }
    });

    if (!account?.entraTenantId) {
        return { synced: false, reason: 'not-connected' };
    }

    const now = new Date();
    if (!options.force && account?.entraSignInLastSyncAt instanceof Date) {
        const diff = now.getTime() - account.entraSignInLastSyncAt.getTime();
        if (diff < ENTRA_SIGNIN_SYNC_INTERVAL_MS) {
            return {
                synced: false,
                reason: 'throttled',
                lastSync: account.entraSignInLastSyncAt
            };
        }
    }

    const backfillHours = Number.isFinite(options.backfillHours)
        ? Math.max(1, options.backfillHours)
        : null;

    let sinceDate;
    if (backfillHours) {
        sinceDate = new Date(now.getTime() - backfillHours * 60 * 60 * 1000);
    } else if (account?.entraSignInCursor) {
        sinceDate = new Date(account.entraSignInCursor);
    } else {
        sinceDate = new Date(now.getTime() - ENTRA_SIGNIN_LOOKBACK_MS);
    }

    const { events, latestTimestamp } = await fetchEntraSignIns(account.entraTenantId, {
        since: sinceDate.toISOString(),
        maxPages: options.maxPages,
        top: options.top
    });

    const records = Array.isArray(events)
        ? events
            .filter(event => event?.id && event?.createdDateTime)
            .map((event) => ({
                id: event.id,
                accountId,
                createdDateTime: new Date(event.createdDateTime),
                userDisplayName: event.userDisplayName || null,
                userPrincipalName: event.userPrincipalName || null,
                userId: event.userId || null,
                appDisplayName: event.appDisplayName || null,
                resourceDisplayName: event.resourceDisplayName || null,
                clientAppUsed: event.clientAppUsed || null,
                deviceDisplayName: event.deviceDetail?.deviceDisplayName || null,
                operatingSystem: event.deviceDetail?.operatingSystem || null,
                browser: event.deviceDetail?.browser || null,
                ipAddress: event.ipAddress || null,
                locationCity: event.location?.city || null,
                locationCountryOrRegion: event.location?.countryOrRegion || null,
                statusErrorCode: event.status?.errorCode ?? null,
                statusFailureReason: event.status?.failureReason || null,
                riskState: event.riskState || null,
                riskDetail: event.riskDetail || null,
                conditionalAccessStatus: event.conditionalAccessStatus || null,
                correlationId: event.correlationId || null,
                isInteractive: event.isInteractive ?? null,
                sourceChannel: classifySignInSource(event.clientAppUsed)
            }))
        : [];

    let insertedCount = 0;
    if (records.length > 0) {
        await prisma.entraSignIn.createMany({
            data: records,
            skipDuplicates: true
        });
        insertedCount = records.length;
    }

    // Only update cursor if we successfully processed events
    const cursorDate = latestTimestamp || (records.length > 0 ? records[0].createdDateTime : sinceDate);

    await prisma.account.update({
        where: { id: accountId },
        data: {
            entraSignInLastSyncAt: now,
            entraSignInCursor: cursorDate ? new Date(cursorDate).toISOString() : account.entraSignInCursor
        }
    });

    return {
        synced: insertedCount > 0,
        count: insertedCount,
        lastSync: now,
        cursor: cursorDate
    };
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
    deleteAppsBatch,
    mergeApps,

    syncEntraUsersIfNeeded,
    syncEntraSignInsIfNeeded,
    isEntraConfigured,

    // Direct prisma access if needed
    prisma
};

