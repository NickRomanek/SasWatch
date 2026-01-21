const { chromium } = require('playwright');
const prisma = require('./prisma');
const { encrypt, decrypt } = require('./encryption');
const path = require('path');
const fs = require('fs').promises;

/**
 * HeadlessManager - Coordinates headless browser automation
 */
class HeadlessManager {
    constructor() {
        this.collectors = new Map();
        this.syncLocks = new Set(); // Track active syncs: "accountId:vendor"

        // Register known collectors
        this.registerCollector('Adobe', require('./collectors/adobe-collector'));
        this.registerCollector('Mock', require('./collectors/mock-collector'));
    }


    /**
     * Register a vendor-specific collector
     * @param {string} vendor - Vendor name (e.g., 'Adobe')
     * @param {object} collector - Collector implementation
     */
    registerCollector(vendor, collector) {
        this.collectors.set(vendor.toLowerCase(), collector);
    }

    /**
     * Start a sync process for a vendor
     * @param {string} accountId - SasWatch account ID
     * @param {string} vendor - Vendor name
     */
    async sync(accountId, vendor) {
        const vendorKey = vendor.toLowerCase();
        const lockKey = `${accountId}:${vendorKey}`;

        if (this.syncLocks.has(lockKey)) {
            throw new Error(`Sync already in progress for ${vendor}`);
        }

        const collector = this.collectors.get(vendorKey);
        if (!collector) {
            throw new Error(`No collector registered for vendor: ${vendor}`);
        }

        this.syncLocks.add(lockKey); // Acquire lock

        let browser = null;
        let context = null;

        try {
            console.log(`[HeadlessManager] Starting sync for ${vendor} (Account: ${accountId})`);

            // Find or create connector record
            let connector = await prisma.headlessConnector.findUnique({
                where: { accountId_vendor: { accountId, vendor } }
            });

            if (!connector) {
                connector = await prisma.headlessConnector.create({
                    data: { accountId, vendor, status: 'pending' }
                });
            }

            browser = await chromium.launch({
                headless: process.env.NODE_ENV === 'production',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            let storageState = null;

            // Restore session if available
            if (connector.sessionData) {
                try {
                    const decrypted = decrypt(connector.sessionData);
                    storageState = JSON.parse(decrypted);
                    // Minimal validation
                    if (!storageState.cookies) storageState = null;
                } catch (e) {
                    console.warn(`[HeadlessManager] Failed to decrypt session for ${vendor}: ${e.message}`);
                }
            }

            // Create context with restored state if available
            context = storageState
                ? await browser.newContext({ storageState })
                : await browser.newContext();

            // Update status to active (syncing)
            await prisma.headlessConnector.update({
                where: { id: connector.id },
                data: { status: 'active', errorMessage: null }
            });

            // Execute collector
            const result = await collector.run(context, connector);

            // 1. Process Users (Upsert Users)
            if (result.users && Array.isArray(result.users)) {
                console.log(`[HeadlessManager] Syncing ${result.users.length} users for ${vendor}`);

                for (const user of result.users) {
                    if (user.email) {
                        const firstName = user.name ? user.name.split(' ')[0] : '';
                        const lastName = user.name ? user.name.split(' ').slice(1).join(' ') : '';

                        await prisma.user.upsert({
                            where: {
                                accountId_email: {
                                    accountId: accountId,
                                    email: user.email
                                }
                            },
                            update: {
                                firstName: firstName || undefined,
                                lastName: lastName || undefined,
                                licenses: user.products || [],
                                importedAt: new Date()
                            },
                            create: {
                                accountId: accountId,
                                email: user.email,
                                firstName: firstName,
                                lastName: lastName,
                                licenses: user.products || [],
                                importedAt: new Date()
                            }
                        });
                    }
                }
            }

            // 2. Process Licenses/Products (Upsert Applications)
            if (result.licenses && Array.isArray(result.licenses)) {
                console.log(`[HeadlessManager] Syncing ${result.licenses.length} licenses for ${vendor}`);

                for (const lic of result.licenses) {
                    await prisma.application.upsert({
                        where: {
                            accountId_vendor_name: {
                                accountId: accountId,
                                vendor: vendor,
                                name: lic.name
                            }
                        },
                        update: {
                            licensesOwned: lic.total || 0,
                            detectedUsers: lic.assigned || 0,
                            updatedAt: new Date()
                        },
                        create: {
                            accountId: accountId,
                            vendor: vendor,
                            name: lic.name,
                            licensesOwned: lic.total || 0,
                            detectedUsers: lic.assigned || 0
                        }
                    });
                }
            }

            // Save updated session state
            const newState = await context.storageState();
            const encryptedState = encrypt(JSON.stringify(newState));

            await prisma.headlessConnector.update({
                where: { id: connector.id },
                data: {
                    sessionData: encryptedState,
                    status: 'active',
                    lastSyncAt: new Date(),
                    errorMessage: null
                }
            });

            console.log(`[HeadlessManager] Sync complete for ${vendor}`);
            return result;

        } catch (error) {
            console.error(`[HeadlessManager] Sync failed for ${vendor}:`, error.message);

            // Try to update status if we have the connector ID
            try {
                // Fetch fresh in case it wasn't created yet or other error
                const conn = await prisma.headlessConnector.findUnique({
                    where: { accountId_vendor: { accountId, vendor } }
                });
                if (conn) {
                    await prisma.headlessConnector.update({
                        where: { id: conn.id },
                        data: {
                            status: 'error',
                            errorMessage: error.message
                        }
                    });
                }
            } catch (statusError) {
                console.error('Failed to update error status:', statusError);
            }

            throw error;
        } finally {
            if (browser) {
                await browser.close();
            }
            this.syncLocks.delete(lockKey); // Release lock
        }
    }

    /**
     * Capture a session interactively (used during initial setup)
     * @param {string} accountId 
     * @param {string} vendor 
     */
    async captureSession(accountId, vendor) {
        // This will be used by the UI to open a headed browser for the user to log in
        // In a production server, this might need a different approach (like a proxy or remote browser)
        // For now, we'll assume the server has access to a display or we use a remote solution later.
        // For local dev, we can just open a headed browser.

        console.log(`[HeadlessManager] Capturing session for ${vendor} (Account: ${accountId})`);

        // Special handling for Mock vendor to bypass browser launch
        if (vendor.toLowerCase() === 'mock') {
            console.log('[HeadlessManager] Mock vendor detected. Auto-creating session.');
            const encryptedState = encrypt(JSON.stringify({ cookies: [], origins: [] }));

            await prisma.headlessConnector.upsert({
                where: { accountId_vendor: { accountId, vendor } },
                update: {
                    sessionData: encryptedState,
                    status: 'active',
                    lastSyncAt: new Date(),
                    errorMessage: null
                },
                create: {
                    accountId,
                    vendor,
                    sessionData: encryptedState,
                    status: 'active',
                    lastSyncAt: new Date()
                }
            });
            return;
        }

        console.log('[HeadlessManager] Launching browser...');
        const browser = await chromium.launch({
            headless: false,
            // Log executable path to debug why it might not appear
            logger: {
                isEnabled: (name, severity) => true,
                log: (name, severity, message, args) => console.log(`[Playwright] ${name} ${message}`)
            }
        });
        const context = await browser.newContext();
        const page = await context.newPage();

        const vendorKey = vendor.toLowerCase();
        const collector = this.collectors.get(vendorKey);

        if (collector && collector.loginUrl) {
            try {
                await page.goto(collector.loginUrl);
            } catch (e) {
                console.error(`[HeadlessManager] Failed to navigate to login URL: ${e.message}`);
            }
        }

        // Expose function to save session from within the browser
        await context.exposeFunction('saveSasWatchSession', async () => {
            try {
                console.log(`[HeadlessManager] User clicked save for ${vendor}. Capturing state...`);

                const state = await context.storageState();
                const encryptedState = encrypt(JSON.stringify(state));

                // Find or create the connector
                // We use accountId + vendor as unique key conceptually
                const connector = await prisma.headlessConnector.findFirst({
                    where: { accountId, vendor }
                });

                if (connector) {
                    await prisma.headlessConnector.update({
                        where: { id: connector.id },
                        data: {
                            sessionData: encryptedState,
                            status: 'active',
                            lastSyncAt: new Date(), // Mark as synced so we know we have data
                            errorMessage: null
                        }
                    });
                } else {
                    await prisma.headlessConnector.create({
                        data: {
                            accountId,
                            vendor,
                            sessionData: encryptedState,
                            status: 'active',
                            lastSyncAt: new Date()
                        }
                    });
                }

                console.log(`[HeadlessManager] Session saved for ${vendor}. Closing browser.`);
                await browser.close();
            } catch (error) {
                console.error('[HeadlessManager] Error saving session:', error);
            }
        });

        // Inject the floating "Save & Finish" button using a robust content script
        const injectUi = `
            const div = document.createElement('div');
            div.style.position = 'fixed';
            div.style.bottom = '20px';
            div.style.right = '20px';
            div.style.zIndex = '999999';
            div.style.background = 'white';
            div.style.padding = '16px';
            div.style.borderRadius = '8px';
            div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            div.style.fontFamily = 'system-ui, -apple-system, sans-serif';
            div.style.border = '1px solid #e5e7eb';
            
            div.innerHTML = \`
                <div style="font-weight: 600; margin-bottom: 8px; color: #111827;">SasWatch Connector</div>
                <div style="font-size: 14px; margin-bottom: 12px; color: #4b5563;">Login to ${vendor}, then click below.</div>
                <button id="saswatch-save-btn" style="
                    background: #10b981; 
                    color: white; 
                    border: none; 
                    padding: 8px 16px; 
                    border-radius: 4px; 
                    cursor: pointer; 
                    font-weight: 500;
                    width: 100%;
                ">Save & Finish</button>
            \`;
            
            document.body.appendChild(div);
            
            document.getElementById('saswatch-save-btn').onclick = () => {
                const btn = document.getElementById('saswatch-save-btn');
                btn.textContent = 'Saving...';
                btn.disabled = true;
                btn.style.background = '#6b7280';
                window.saveSasWatchSession();
            };
        `;

        await page.addInitScript(injectUi);

        // Also run it immediately in case page is already loaded
        try {
            await page.evaluate(injectUi);
        } catch (e) {
            // Ignore if re-declared
        }

        return { browser, context, page };
    }
}

module.exports = new HeadlessManager();
