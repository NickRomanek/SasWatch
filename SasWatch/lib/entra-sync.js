const { ConfidentialClientApplication } = require('@azure/msal-node');
const { Client } = require('@microsoft/microsoft-graph-client');

const GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];

function isConfigured() {
    return Boolean(
        process.env.CLIENT_ID &&
        process.env.CLIENT_SECRET
    );
}

function getMsalClient(tenantId) {
    if (!tenantId) {
        throw new Error('Tenant ID is required');
    }

    const msalConfig = {
        auth: {
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
            authority: `https://login.microsoftonline.com/${tenantId}`
        }
    };

    return new (require('@azure/msal-node').ConfidentialClientApplication)(msalConfig);
}

async function acquireToken(tenantId) {
    const client = getMsalClient(tenantId);
    const result = await client.acquireTokenByClientCredential({ scopes: GRAPH_SCOPES });
    return result.accessToken;
}

async function getGraphClient(tenantId) {
    if (!isConfigured()) {
        throw new Error('Graph API credentials are not configured');
    }

    if (!tenantId) {
        throw new Error('Tenant ID is required');
    }

    const token = await acquireToken(tenantId);
    return Client.init({
        authProvider: (done) => {
            done(null, token);
        }
    });
}

async function fetchSkuMap(client) {
    try {
        const response = await client
            .api('/subscribedSkus')
            .select('skuId,skuPartNumber,appliesTo')
            .get();

        const map = new Map();

        if (Array.isArray(response?.value)) {
            response.value.forEach((sku) => {
                if (!sku?.skuId) {
                    return;
                }
                const key = String(sku.skuId).toLowerCase();
                map.set(key, sku.skuPartNumber || sku.appliesTo || key);
            });
        }

        return map;
    } catch (error) {
        console.warn('Failed to fetch subscribed SKUs from Graph API:', error.message || error);
        return new Map();
    }
}

function normalizeNameParts({ givenName, surname, displayName }) {
    let firstName = givenName || '';
    let lastName = surname || '';

    if (!firstName && displayName) {
        const parts = displayName.split(/\s+/);
        firstName = parts.shift() || '';
        lastName = parts.join(' ');
    }

    return {
        firstName: firstName || '',
        lastName: lastName || ''
    };
}

async function fetchEntraDirectory(tenantId, options = {}) {
    const client = await getGraphClient(tenantId);
    const skuMap = await fetchSkuMap(client);
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : null;

    const users = [];
    let request = client
        .api('/users')
        .select('id,displayName,givenName,surname,mail,userPrincipalName,accountEnabled,assignedLicenses')
        .top(999);

    let response;

    do {
        response = await request.get();

        if (Array.isArray(response?.value)) {
            response.value.forEach((user) => {
                if (!user) {
                    return;
                }

                const email =
                    (user.mail || user.userPrincipalName || '').trim().toLowerCase();
                if (!email) {
                    return;
                }

                const { firstName, lastName } = normalizeNameParts(user);
                const assignedLicenses = Array.isArray(user.assignedLicenses)
                    ? user.assignedLicenses
                    : [];

                const licenseLabels = Array.from(
                    new Set(
                        assignedLicenses
                            .map((license) => {
                                if (!license?.skuId) {
                                    return null;
                                }
                                const key = String(license.skuId).toLowerCase();
                                return skuMap.get(key) || key;
                            })
                            .filter(Boolean)
                    )
                );

                users.push({
                    entraId: user.id,
                    email,
                    firstName,
                    lastName,
                    displayName: user.displayName || '',
                    accountEnabled: user.accountEnabled !== false,
                    licenses: licenseLabels
                });
            });
        }

        if (limit && users.length >= limit) {
            break;
        }

        if (response && response['@odata.nextLink'] && (!limit || users.length < limit)) {
            request = client.api(response['@odata.nextLink']);
        } else {
            request = null;
        }
    } while (request && (!limit || users.length < limit));

    return {
        users: limit ? users.slice(0, limit) : users,
        fetchedAt: new Date()
    };
}

async function fetchEntraSignIns(tenantId, options = {}) {
    const client = await getGraphClient(tenantId);
    const events = [];
    const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : 10;
    const pageSize = Number.isFinite(options.top) ? Math.max(1, Math.min(1000, options.top)) : 100;
    const since = options.since ? new Date(options.since) : null;

    let request = client
        .api('/auditLogs/signIns')
        .header('ConsistencyLevel', 'eventual')
        .header('Prefer', `odata.maxpagesize=${pageSize}`)
        .select([
            'id',
            'createdDateTime',
            'appDisplayName',
            'resourceDisplayName',
            'userDisplayName',
            'userPrincipalName',
            'userId',
            'clientAppUsed',
            'ipAddress',
            'deviceDetail',
            'location',
            'status',
            'riskState',
            'riskDetail',
            'conditionalAccessStatus',
            'correlationId',
            'isInteractive'
        ].join(','))
        .orderby('createdDateTime desc')
        .top(pageSize);

    let response;
    let page = 0;
    let latestTimestamp = since ? since.getTime() : 0;
    let shouldContinue = true;

    try {
        while (shouldContinue && request) {
            response = await request.get();
            page += 1;

            if (Array.isArray(response?.value)) {
                response.value.forEach((event) => {
                    if (!event?.id || !event?.createdDateTime) {
                        return;
                    }
                    const createdTime = new Date(event.createdDateTime).getTime();
                    
                    // Only include events newer than 'since' if specified, but don't stop processing
                    if (since && createdTime < since.getTime()) {
                        return; // Skip this event but continue processing others
                    }
                    
                    events.push(event);
                    if (createdTime > latestTimestamp) {
                        latestTimestamp = createdTime;
                    }
                });
            }

            if (shouldContinue && response && response['@odata.nextLink'] && page < maxPages) {
                request = client.api(response['@odata.nextLink']);
            } else {
                request = null;
            }
        }
    } catch (error) {
        console.error('❌ Failed to fetch Entra sign-ins:', error);
        console.error('Error details:', {
            message: error.message,
            statusCode: error.statusCode,
            code: error.code,
            body: error.body
        });
        // Check for permission errors
        if (error.statusCode === 403 || error.code === 'Forbidden') {
            console.error('⚠️  PERMISSION ERROR: AuditLog.Read.All requires admin consent!');
            console.error('   Go to Azure Portal → App Registrations → Your App → API Permissions');
            console.error('   Click "Grant admin consent for [Your Organization]"');
        }
        throw error; // Re-throw to surface the error
    }

    return {
        events,
        latestTimestamp: latestTimestamp ? new Date(latestTimestamp) : since || null,
        totalCount: events.length
    };
}

async function fetchEntraApplications(tenantId, options = {}) {
    const client = await getGraphClient(tenantId);
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 10;

    let request = client
        .api('/servicePrincipals')
        .select([
            'id',
            'displayName',
            'appId',
            'appOwnerOrganizationId',
            'createdDateTime',
            'servicePrincipalType',
            'publisherName',
            'tags'
        ].join(','))
        .orderby('createdDateTime desc')
        .top(limit);

    const response = await request.get();
    const apps = Array.isArray(response?.value) ? response.value.slice(0, limit) : [];

    return {
        apps,
        fetchedAt: new Date(),
        nextLink: response?.['@odata.nextLink'] || null
    };
}

module.exports = {
    isConfigured,
    fetchEntraDirectory,
    fetchEntraSignIns,
    fetchEntraApplications
};

