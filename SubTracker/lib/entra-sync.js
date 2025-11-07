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

async function fetchEntraDirectory(tenantId) {
    const client = await getGraphClient(tenantId);
    const skuMap = await fetchSkuMap(client);

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

        if (response && response['@odata.nextLink']) {
            request = client.api(response['@odata.nextLink']);
        } else {
            request = null;
        }
    } while (request);

    return {
        users,
        fetchedAt: new Date()
    };
}

module.exports = {
    isConfigured,
    fetchEntraDirectory
};

