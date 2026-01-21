/**
 * Adobe Collector - Extracts data from Adobe Admin Console
 */
class AdobeCollector {
    constructor() {
        this.loginUrl = 'https://adminconsole.adobe.com/';
    }

    /**
     * Main execution loop for the collector
     * @param {BrowserContext} context - Playwright browser context
     * @param {object} connector - HeadlessConnector record
     */
    async run(context, connector) {
        const page = await context.newPage();

        console.log('[AdobeCollector] Navigating to Admin Console...');
        await page.goto(this.loginUrl, { waitUntil: 'networkidle' });

        // Check if we are logged in
        const url = page.url();
        if (url.includes('auth.services.adobe.com')) {
            console.log('[AdobeCollector] Session expired, login required.');
            throw new Error('Session expired. Please reconnect your Adobe account.');
        }

        // Example: Wait for the users dashboard to load
        // This is a simplified example. Real selectors would be more robust.
        try {
            await page.waitForSelector('.spectrum-Table', { timeout: 10000 });
            console.log('[AdobeCollector] Dashboard loaded successfully.');
        } catch (e) {
            console.log('[AdobeCollector] Dashboard selectors not found, might be on landing page.');
        }

        // --- Data Extraction Logic ---

        // 1. Navigate to Users tab
        console.log('[AdobeCollector] Navigating to Users tab...');
        await page.goto('https://adminconsole.adobe.com/team/chrome/users', { waitUntil: 'networkidle' });

        // 2. Extract users list
        console.log('[AdobeCollector] Extracting users...');
        const users = await this.extractUsers(page);
        console.log(`[AdobeCollector] Found ${users.length} users.`);

        // 3. Navigate to Products/Overview tab for license counts
        console.log('[AdobeCollector] Navigating to Products tab...');
        await page.goto('https://adminconsole.adobe.com/team/chrome/products', { waitUntil: 'networkidle' });

        // 4. Extract licenses summary
        console.log('[AdobeCollector] Extracting licenses...');
        const licenses = await this.extractLicenses(page);
        console.log(`[AdobeCollector] Found ${licenses.length} license types.`);

        return {
            success: true,
            extractedAt: new Date(),
            users: users,
            licenses: licenses,
            message: `Successfully synced ${users.length} users and ${licenses.length} license types.`
        };
    }

    /**
     * Scrape the users table
     * @param {Page} page 
     */
    async extractUsers(page) {
        const users = [];
        try {
            // Wait for table to load
            await page.waitForSelector('table tbody tr', { timeout: 15000 });

            // simple iteration over rows (handling only first page for MVP)
            const rows = await page.$$('table tbody tr');

            for (const row of rows) {
                try {
                    // This selector logic is a BEST GUESS based on standard tables.
                    // Adobe Admin Console changes class names often (Spectrum UI).
                    const text = await row.innerText();
                    const lines = text.split('\n');

                    // Heuristic: finding email and name
                    // Usually: Name | Email | Status | Products

                    let name = lines[0] || '';
                    let email = lines.find(l => l.includes('@')) || '';

                    // Products often listed in a specific column or badge
                    // We'll just take all text that isn't name/email as "products" roughly
                    // Detailed scraping requires inspecting the specific DOM attributes (aria-label, etc.)
                    const potentialProducts = lines.filter(l => l !== name && l !== email && !l.includes('Active'));

                    if (email) {
                        users.push({
                            name: name,
                            email: email,
                            products: potentialProducts
                        });
                    }
                } catch (err) {
                    console.warn('[AdobeCollector] Error parsing row:', err.message);
                }
            }
        } catch (e) {
            console.error('[AdobeCollector] User table not found or extraction failed', e.message);
        }
        return users;
    }

    /**
     * Scrape the licenses/products overview
     * @param {Page} page 
     */
    async extractLicenses(page) {
        const licenses = [];
        try {
            // Wait for cards or list items
            // Adobe often uses cards for products on the overview
            await page.waitForSelector('[class*="Card"]', { timeout: 15000 });

            const cards = await page.$$('[class*="Card"]');

            for (const card of cards) {
                try {
                    const text = await card.innerText();
                    const lines = text.split('\n');

                    // Heuristic extraction
                    // e.g. "Creative Cloud All Apps", "10 assigned", "20 total"
                    const name = lines[0]; // Title usually first
                    const assignedMatch = text.match(/([\d,]+)\s+assigned/i);
                    const totalMatch = text.match(/([\d,]+)\s+total/i) || text.match(/([\d,]+)\s+available/i); // 'available' + 'assigned' = total?

                    let assigned = assignedMatch ? parseInt(assignedMatch[1].replace(/,/g, '')) : 0;
                    let total = 0;

                    // If we have "available", total = assigned + available
                    const availableMatch = text.match(/([\d,]+)\s+available/i);
                    if (availableMatch) {
                        const available = parseInt(availableMatch[1].replace(/,/g, ''));
                        total = assigned + available;
                    } else if (totalMatch) {
                        total = parseInt(totalMatch[1].replace(/,/g, ''));
                    }

                    if (name && total > 0) {
                        licenses.push({
                            name: name,
                            total: total,
                            assigned: assigned
                        });
                    }
                } catch (err) {
                    // ignore non-license cards
                }
            }
        } catch (e) {
            console.error('[AdobeCollector] License cards not found or extraction failed', e.message);
        }
        return licenses;
    }
}

module.exports = new AdobeCollector();
