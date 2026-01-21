/**
 * MockCollector
 * Simulates a vendor interaction without a real browser or credentials.
 */
class MockCollector {
    constructor() {
        this.loginUrl = 'https://example.com/mock-login'; // Dummy URL
    }

    /**
     * Run the collector to extract data
     * @param {object} context - Playwright browser context
     * @param {object} connector - The HeadlessConnector database record
     */
    async run(context, connector) {
        console.log('[MockCollector] Running mock sync...');

        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Return fake data
        return {
            users: [
                { name: 'Alice Fake', email: 'alice@example.com', products: ['Mock Pro', 'Mock Lite'] },
                { name: 'Bob Mock', email: 'bob@example.com', products: ['Mock Pro'] },
                { name: 'Charlie Test', email: 'charlie@example.com', products: [] }
            ],
            licenses: [
                { name: 'Mock Pro', total: 10, assigned: 2 },
                { name: 'Mock Lite', total: 50, assigned: 1 }
            ]
        };
    }
}

module.exports = new MockCollector();
