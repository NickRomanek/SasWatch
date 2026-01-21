const { chromium } = require('playwright');

(async () => {
    console.log('Starting Playwright launch check...');
    try {
        const browser = await chromium.launch({ headless: false });
        console.log('Browser launched successfully!');
        const page = await browser.newPage();
        await page.goto('https://example.com');
        console.log('Navigated to example.com');

        // Keep it open for a few seconds to verify
        await new Promise(r => setTimeout(r, 5000));

        await browser.close();
        console.log('Browser closed.');
    } catch (error) {
        console.error('FAILED to launch browser:', error);
        process.exit(1);
    }
})();
