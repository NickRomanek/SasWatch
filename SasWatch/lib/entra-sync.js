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
    try {
        console.log('[Graph API] Acquiring token for tenant:', tenantId);
        const client = getMsalClient(tenantId);
        const result = await client.acquireTokenByClientCredential({ scopes: GRAPH_SCOPES });
        
        if (!result || !result.accessToken) {
            throw new Error('Failed to acquire access token - no token in response');
        }
        
        console.log('[Graph API] Token acquired successfully');
        return result.accessToken;
    } catch (error) {
        console.error('[Graph API] Token acquisition failed:', error);
        throw error;
    }
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
    const onProgress = options.onProgress || (() => {}); // Progress callback
    
    // Send initial progress update
    onProgress({
        page: 0,
        eventsFetched: 0,
        elapsedMs: 0,
        message: 'Connecting to Microsoft Graph API...'
    });
    
    console.log('[Graph API] Acquiring access token...');
    const client = await getGraphClient(tenantId);
    console.log('[Graph API] Access token acquired, building request...');
    
    const events = [];
    const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : 10;
    const pageSize = Number.isFinite(options.top) ? Math.max(1, Math.min(1000, options.top)) : 100;
    const since = options.since ? new Date(options.since) : null;

    // Set a reasonable timeout for individual Graph API calls
    // Allow custom timeout override for background syncs
    const FIRST_PAGE_TIMEOUT_MS = options.timeout || 300000; // Default 5 minutes, but can be overridden
    const SUBSEQUENT_PAGE_TIMEOUT_MS = Math.min(FIRST_PAGE_TIMEOUT_MS, 120000); // 2 minutes max for subsequent pages

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

    // ✅ SERVER-SIDE FILTERING - Much more efficient than client-side filtering!
    if (since) {
        // Add 5-minute overlap buffer to catch any edge cases at sync boundaries
        const filterDate = new Date(since.getTime() - 5 * 60 * 1000);
        const filterDateStr = filterDate.toISOString();
        request = request.filter(`createdDateTime ge ${filterDateStr}`);
        console.log(`[Graph API] Filtering events since ${filterDateStr} (with 5min buffer for ${since.toISOString()})`);
    }

    let response;
    let page = 0;
    let latestTimestamp = since ? since.getTime() : 0;
    let shouldContinue = true;
    const startTime = Date.now();

    console.log('[Graph API] Starting to fetch sign-ins...');
    onProgress({
        page: 0,
        eventsFetched: 0,
        elapsedMs: 0,
        message: 'Sending request to Microsoft Graph API...'
    });

    try {
        while (shouldContinue && request) {
            page += 1;
            
            console.log(`[Graph API] Fetching page ${page}...`);
            onProgress({
                page: page - 1, // Show current page being fetched
                eventsFetched: events.length,
                elapsedMs: Date.now() - startTime,
                message: `Fetching page ${page} from Microsoft Graph API...`
            });

            // Use longer timeout for first page (large date ranges can be slow)
            const timeoutMs = page === 1 ? FIRST_PAGE_TIMEOUT_MS : SUBSEQUENT_PAGE_TIMEOUT_MS;
            
            // Create a timeout promise for this request
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    console.error(`[Graph API] Request timeout after ${timeoutMs / 1000}s for page ${page}`);
                    reject(new Error(`Microsoft Graph API request timed out after ${timeoutMs / 1000}s. This may happen with large datasets or slow connections. Try reducing the date range.`));
                }, timeoutMs);
            });

            // Race the Graph API request against the timeout
            const requestStartTime = Date.now();
            const timeoutSeconds = Math.floor(timeoutMs / 1000);
            console.log(`[Graph API] Sending GET request for page ${page} (timeout: ${timeoutSeconds}s)...`);
            
            // Send progress update that we're waiting
            if (page === 1) {
                onProgress({
                    page: 0,
                    eventsFetched: 0,
                    elapsedMs: Date.now() - startTime,
                    message: `Waiting for Microsoft Graph API response (this can take up to ${timeoutSeconds}s for large date ranges)...`
                });
            }
            
            // Set up periodic progress updates while waiting (every 15 seconds)
            let progressUpdateInterval = null;
            let requestPending = true; // Flag to prevent interval callbacks after completion
            
            if (page === 1) {
                progressUpdateInterval = setInterval(() => {
                    // Only send update if request is still pending
                    if (!requestPending) {
                        clearInterval(progressUpdateInterval);
                        return;
                    }
                    
                    const elapsed = Date.now() - requestStartTime;
                    const elapsedSeconds = Math.floor(elapsed / 1000);
                    onProgress({
                        page: 0,
                        eventsFetched: 0,
                        elapsedMs: elapsed,
                        message: `Still waiting for Microsoft Graph API... (${elapsedSeconds}s elapsed, timeout: ${timeoutSeconds}s)`
                    });
                }, 15000); // Update every 15 seconds
            }
            
            try {
                response = await Promise.race([request.get(), timeoutPromise]);
                const requestDuration = Date.now() - requestStartTime;
                console.log(`[Graph API] Page ${page} received in ${requestDuration}ms`);
                
                // Mark request as complete and clear interval immediately
                requestPending = false;
                if (progressUpdateInterval) {
                    clearInterval(progressUpdateInterval);
                    progressUpdateInterval = null;
                }
            } catch (requestError) {
                // Mark request as complete and clear interval on error
                requestPending = false;
                if (progressUpdateInterval) {
                    clearInterval(progressUpdateInterval);
                    progressUpdateInterval = null;
                }
                
                const elapsed = Date.now() - requestStartTime;
                console.error(`[Graph API] Error fetching page ${page}:`, {
                    message: requestError.message,
                    code: requestError.code,
                    statusCode: requestError.statusCode,
                    elapsed: elapsed,
                    timeout: timeoutMs
                });
                
                // If it's a timeout and we're on the first page, suggest reducing date range
                if (requestError.message?.includes('timeout') && page === 1) {
                    const enhancedError = new Error(`First page request timed out after ${timeoutSeconds}s. The date range (${options.backfillHours || 'default'} hours) may be too large. Try reducing backfillHours to 24 hours or less, or sync more frequently.`);
                    enhancedError.originalError = requestError;
                    throw enhancedError;
                }
                
                throw requestError;
            }

            // Progress update after successful fetch
            onProgress({
                page,
                eventsFetched: events.length,
                elapsedMs: Date.now() - startTime,
                message: `Fetched page ${page} (${events.length} events so far)`
            });
            console.log(`[Graph API] Page ${page} processed: ${response?.value?.length || 0} events, total: ${events.length}`);

            if (Array.isArray(response?.value)) {
                response.value.forEach((event) => {
                    if (!event?.id || !event?.createdDateTime) {
                        return;
                    }

                    // ✅ No client-side filtering needed - Graph API already filtered server-side!
                    events.push(event);
                    const createdTime = new Date(event.createdDateTime).getTime();
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

