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
    const onProgress = options.onProgress || (() => {}); // Progress callback

    // Set a reasonable timeout for individual Graph API calls (2 minutes per page)
    const REQUEST_TIMEOUT_MS = 120000;

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
    const startTime = Date.now();

    try {
        while (shouldContinue && request) {
            page += 1;

            // Create a timeout promise for this request
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Microsoft Graph API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s. This may happen with large datasets or slow connections.`)), REQUEST_TIMEOUT_MS);
            });

            // Race the Graph API request against the timeout
            response = await Promise.race([request.get(), timeoutPromise]);

            onProgress({
                page,
                eventsFetched: events.length,
                elapsedMs: Date.now() - startTime,
                message: `Fetched page ${page} (${events.length} events so far)`
            });

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
            body: error.body,
            pagesProcessed: page,
            eventsFetched: events.length
        });

        // Provide user-friendly error messages
        let userMessage = error.message || 'Failed to sync Microsoft Entra sign-ins';
        let helpText = '';

        if (error.statusCode === 403 || error.code === 'Forbidden') {
            userMessage = 'Permission denied: AuditLog.Read.All requires admin consent';
            helpText = 'Go to Azure Portal → App Registrations → Your App → API Permissions → Grant admin consent for your organization';
        } else if (error.statusCode === 429 || error.code === 'TooManyRequests') {
            userMessage = 'Microsoft Graph API rate limit exceeded';
            helpText = 'Please wait a few minutes and try again. Microsoft limits API requests per app.';
        } else if (error.statusCode === 401 || error.code === 'Unauthorized') {
            userMessage = 'Authentication failed with Microsoft Graph';
            helpText = 'Please reconnect your Microsoft Entra integration in Account Settings.';
        } else if (error.statusCode >= 500) {
            userMessage = 'Microsoft Graph API server error';
            helpText = 'This is a temporary issue with Microsoft\'s servers. Please try again later.';
        } else if (error.message?.includes('timeout')) {
            userMessage = 'Microsoft Graph API request timed out';
            helpText = 'Large datasets or slow connections can cause timeouts. Try again, or consider syncing during off-peak hours.';
        } else if (error.message?.includes('ENOTFOUND') || error.message?.includes('ECONNREFUSED')) {
            userMessage = 'Unable to connect to Microsoft Graph API';
            helpText = 'Please check your internet connection and try again.';
        }

        console.error('❌ Failed to fetch Entra sign-ins:', {
            message: error.message,
            statusCode: error.statusCode,
            code: error.code,
            userMessage,
            helpText,
            pagesProcessed: page,
            eventsFetched: events.length
        });

        // Enhance error with user-friendly information
        const enhancedError = new Error(userMessage);
        enhancedError.statusCode = error.statusCode;
        enhancedError.code = error.code;
        enhancedError.helpText = helpText;
        enhancedError.details = {
            pagesProcessed: page,
            eventsFetched: events.length,
            totalElapsedMs: Date.now() - startTime,
            originalMessage: error.message
        };

        throw enhancedError; // Re-throw to surface the error
    }

    const totalElapsed = Date.now() - startTime;
    console.log(`✅ Successfully fetched ${events.length} Entra sign-ins in ${totalElapsed}ms (${page} pages)`);

    return {
        events,
        latestTimestamp: latestTimestamp ? new Date(latestTimestamp) : since || null,
        totalCount: events.length,
        pagesProcessed: page,
        totalElapsedMs: totalElapsed
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

