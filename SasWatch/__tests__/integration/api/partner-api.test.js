/**
 * Integration tests for Partner API endpoints
 * Verifies partner authentication, account scoping, and data isolation
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import crypto from 'crypto';

const partnerRoutes = (await import('../../../lib/partner-routes.js')).default;
const partnerDb = await import('../../../lib/partner-database.js');
const auth = await import('../../../lib/auth.js');

const prisma = new PrismaClient();

/**
 * Create an Express app with Partner API routes
 */
function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/partner', partnerRoutes);
    return app;
}

/**
 * Make a fetch request to the test app
 */
async function fetchJson(app, path, options = {}) {
    const server = app.listen(0);
    const { port } = server.address();
    try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        const data = await response.json();
        return { response, data };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

describe('Partner API Authentication', () => {
    let partnerAccountId;
    let partnerApiKey;
    let linkedAccountId;

    beforeEach(async () => {
        // Create an account that will become a partner
        const partnerOwnerAccount = await prisma.account.create({
            data: {
                name: 'Partner Company',
                email: `partner-${Date.now()}@test.com`,
                apiKey: crypto.randomUUID()
            }
        });

        // Create a partner account
        const partner = await prisma.partnerAccount.create({
            data: {
                accountId: partnerOwnerAccount.id,
                partnerApiKey: crypto.randomUUID(),
                companyName: 'Test Partner MSP',
                isActive: true
            }
        });
        partnerAccountId = partner.id;
        partnerApiKey = partner.partnerApiKey;

        // Create a linked account
        const linkedAccount = await prisma.account.create({
            data: {
                name: 'Customer Account',
                email: `customer-${Date.now()}@test.com`,
                apiKey: crypto.randomUUID()
            }
        });
        linkedAccountId = linkedAccount.id;

        // Link the account to the partner
        await prisma.partnerAccountLink.create({
            data: {
                partnerAccountId: partner.id,
                linkedAccountId: linkedAccount.id,
                isActive: true,
                permissions: ['read']
            }
        });
    });

    afterEach(async () => {
        // Clean up in reverse order of creation
        await prisma.partnerAccountLink.deleteMany({
            where: { partnerAccountId }
        }).catch(() => {});

        await prisma.partnerAccount.deleteMany({
            where: { id: partnerAccountId }
        }).catch(() => {});

        // Delete accounts (cascades to partner accounts and links)
        await prisma.account.deleteMany({
            where: {
                OR: [
                    { id: linkedAccountId },
                    { email: { contains: 'partner-' } },
                    { email: { contains: 'customer-' } }
                ]
            }
        }).catch(() => {});
    });

    test('returns 401 when no API key provided', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(app, '/api/v1/partner/accounts');

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('PARTNER_AUTH_REQUIRED');
    });

    test('returns 401 when invalid API key provided', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(app, '/api/v1/partner/accounts', {
            headers: { 'X-Partner-API-Key': 'invalid-key' }
        });

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('INVALID_PARTNER_API_KEY');
    });

    test('returns 200 when valid API key provided', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(app, '/api/v1/partner/accounts', {
            headers: { 'X-Partner-API-Key': partnerApiKey }
        });

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(Array.isArray(data.data)).toBe(true);
    });
});

describe('Partner API - List Accounts', () => {
    let partnerApiKey;
    let partnerAccountId;
    let linkedAccountIds = [];

    beforeEach(async () => {
        // Create partner owner account
        const partnerOwner = await prisma.account.create({
            data: {
                name: 'Partner MSP',
                email: `partner-owner-${Date.now()}@test.com`,
                apiKey: crypto.randomUUID()
            }
        });

        // Create partner account
        const partner = await prisma.partnerAccount.create({
            data: {
                accountId: partnerOwner.id,
                partnerApiKey: crypto.randomUUID(),
                companyName: 'Test Partner',
                isActive: true
            }
        });
        partnerAccountId = partner.id;
        partnerApiKey = partner.partnerApiKey;

        // Create multiple linked accounts
        for (let i = 0; i < 3; i++) {
            const account = await prisma.account.create({
                data: {
                    name: `Customer ${i + 1}`,
                    email: `customer-${i}-${Date.now()}@test.com`,
                    apiKey: crypto.randomUUID()
                }
            });
            linkedAccountIds.push(account.id);

            await prisma.partnerAccountLink.create({
                data: {
                    partnerAccountId: partner.id,
                    linkedAccountId: account.id,
                    isActive: true,
                    nickname: `Client ${i + 1}`,
                    permissions: ['read']
                }
            });
        }
    });

    afterEach(async () => {
        await prisma.partnerAccountLink.deleteMany({
            where: { partnerAccountId }
        }).catch(() => {});

        await prisma.partnerAccount.deleteMany({
            where: { id: partnerAccountId }
        }).catch(() => {});

        await prisma.account.deleteMany({
            where: {
                OR: [
                    { id: { in: linkedAccountIds } },
                    { email: { contains: 'partner-owner-' } }
                ]
            }
        }).catch(() => {});

        linkedAccountIds = [];
    });

    test('returns all linked accounts', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(app, '/api/v1/partner/accounts', {
            headers: { 'X-Partner-API-Key': partnerApiKey }
        });

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toHaveLength(3);
        expect(data.pagination.total).toBe(3);
    });

    test('supports pagination', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(app, '/api/v1/partner/accounts?limit=2&offset=0', {
            headers: { 'X-Partner-API-Key': partnerApiKey }
        });

        expect(response.status).toBe(200);
        expect(data.data).toHaveLength(2);
        expect(data.pagination.hasMore).toBe(true);
    });

    test('supports search filter', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(app, '/api/v1/partner/accounts?search=Customer%201', {
            headers: { 'X-Partner-API-Key': partnerApiKey }
        });

        expect(response.status).toBe(200);
        expect(data.data).toHaveLength(1);
        expect(data.data[0].name).toBe('Customer 1');
    });
});

describe('Partner API - Account Access Control', () => {
    let partnerAApiKey;
    let partnerBApiKey;
    let partnerAAccountId;
    let partnerBAccountId;
    let accountForPartnerA;
    let accountForPartnerB;

    beforeEach(async () => {
        // Create Partner A's owner account
        const partnerAOwner = await prisma.account.create({
            data: {
                name: 'Partner A MSP',
                email: `partner-a-${Date.now()}@test.com`,
                apiKey: crypto.randomUUID()
            }
        });

        // Create Partner A
        const partnerA = await prisma.partnerAccount.create({
            data: {
                accountId: partnerAOwner.id,
                partnerApiKey: crypto.randomUUID(),
                companyName: 'Partner A',
                isActive: true
            }
        });
        partnerAAccountId = partnerA.id;
        partnerAApiKey = partnerA.partnerApiKey;

        // Create Partner B's owner account
        const partnerBOwner = await prisma.account.create({
            data: {
                name: 'Partner B MSP',
                email: `partner-b-${Date.now()}@test.com`,
                apiKey: crypto.randomUUID()
            }
        });

        // Create Partner B
        const partnerB = await prisma.partnerAccount.create({
            data: {
                accountId: partnerBOwner.id,
                partnerApiKey: crypto.randomUUID(),
                companyName: 'Partner B',
                isActive: true
            }
        });
        partnerBAccountId = partnerB.id;
        partnerBApiKey = partnerB.partnerApiKey;

        // Create account linked to Partner A only
        accountForPartnerA = await prisma.account.create({
            data: {
                name: 'Customer for Partner A',
                email: `customer-a-${Date.now()}@test.com`,
                apiKey: crypto.randomUUID()
            }
        });

        await prisma.partnerAccountLink.create({
            data: {
                partnerAccountId: partnerA.id,
                linkedAccountId: accountForPartnerA.id,
                isActive: true,
                permissions: ['read']
            }
        });

        // Create account linked to Partner B only
        accountForPartnerB = await prisma.account.create({
            data: {
                name: 'Customer for Partner B',
                email: `customer-b-${Date.now()}@test.com`,
                apiKey: crypto.randomUUID()
            }
        });

        await prisma.partnerAccountLink.create({
            data: {
                partnerAccountId: partnerB.id,
                linkedAccountId: accountForPartnerB.id,
                isActive: true,
                permissions: ['read']
            }
        });
    });

    afterEach(async () => {
        await prisma.partnerAccountLink.deleteMany({
            where: {
                partnerAccountId: { in: [partnerAAccountId, partnerBAccountId] }
            }
        }).catch(() => {});

        await prisma.partnerAccount.deleteMany({
            where: { id: { in: [partnerAAccountId, partnerBAccountId] } }
        }).catch(() => {});

        await prisma.account.deleteMany({
            where: {
                OR: [
                    { id: accountForPartnerA?.id },
                    { id: accountForPartnerB?.id },
                    { email: { contains: 'partner-a-' } },
                    { email: { contains: 'partner-b-' } }
                ]
            }
        }).catch(() => {});
    });

    test('Partner A can access its linked account', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(
            app,
            `/api/v1/partner/accounts/${accountForPartnerA.id}`,
            { headers: { 'X-Partner-API-Key': partnerAApiKey } }
        );

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.id).toBe(accountForPartnerA.id);
    });

    test('Partner A cannot access Partner B linked account', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(
            app,
            `/api/v1/partner/accounts/${accountForPartnerB.id}`,
            { headers: { 'X-Partner-API-Key': partnerAApiKey } }
        );

        expect(response.status).toBe(403);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('ACCOUNT_ACCESS_DENIED');
    });

    test('Partner B cannot access Partner A linked account', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(
            app,
            `/api/v1/partner/accounts/${accountForPartnerA.id}`,
            { headers: { 'X-Partner-API-Key': partnerBApiKey } }
        );

        expect(response.status).toBe(403);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('ACCOUNT_ACCESS_DENIED');
    });
});

describe('Partner API - Users Endpoint', () => {
    let partnerApiKey;
    let partnerAccountId;
    let linkedAccountId;
    let createdUserIds = [];

    beforeEach(async () => {
        // Create partner
        const partnerOwner = await prisma.account.create({
            data: {
                name: 'Partner for Users Test',
                email: `partner-users-${Date.now()}@test.com`,
                apiKey: crypto.randomUUID()
            }
        });

        const partner = await prisma.partnerAccount.create({
            data: {
                accountId: partnerOwner.id,
                partnerApiKey: crypto.randomUUID(),
                companyName: 'Users Test Partner',
                isActive: true
            }
        });
        partnerAccountId = partner.id;
        partnerApiKey = partner.partnerApiKey;

        // Create linked account with users
        const linkedAccount = await prisma.account.create({
            data: {
                name: 'Customer with Users',
                email: `customer-users-${Date.now()}@test.com`,
                apiKey: crypto.randomUUID()
            }
        });
        linkedAccountId = linkedAccount.id;

        await prisma.partnerAccountLink.create({
            data: {
                partnerAccountId: partner.id,
                linkedAccountId: linkedAccount.id,
                isActive: true,
                permissions: ['read']
            }
        });

        // Create some users
        for (let i = 0; i < 5; i++) {
            const user = await prisma.user.create({
                data: {
                    accountId: linkedAccount.id,
                    email: `user-${i}-${Date.now()}@test.com`,
                    firstName: `User${i}`,
                    lastName: 'Test',
                    licenses: ['Photoshop', 'Illustrator']
                }
            });
            createdUserIds.push(user.id);
        }
    });

    afterEach(async () => {
        await prisma.user.deleteMany({
            where: { id: { in: createdUserIds } }
        }).catch(() => {});

        await prisma.partnerAccountLink.deleteMany({
            where: { partnerAccountId }
        }).catch(() => {});

        await prisma.partnerAccount.deleteMany({
            where: { id: partnerAccountId }
        }).catch(() => {});

        await prisma.account.deleteMany({
            where: {
                OR: [
                    { id: linkedAccountId },
                    { email: { contains: 'partner-users-' } }
                ]
            }
        }).catch(() => {});

        createdUserIds = [];
    });

    test('returns users for linked account', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(
            app,
            `/api/v1/partner/accounts/${linkedAccountId}/users`,
            { headers: { 'X-Partner-API-Key': partnerApiKey } }
        );

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toHaveLength(5);
        expect(data.pagination.total).toBe(5);
    });

    test('supports pagination for users', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(
            app,
            `/api/v1/partner/accounts/${linkedAccountId}/users?limit=2`,
            { headers: { 'X-Partner-API-Key': partnerApiKey } }
        );

        expect(response.status).toBe(200);
        expect(data.data).toHaveLength(2);
        expect(data.pagination.hasMore).toBe(true);
    });
});

describe('Partner API - Dashboard', () => {
    let partnerApiKey;
    let partnerAccountId;
    let linkedAccountIds = [];

    beforeEach(async () => {
        const partnerOwner = await prisma.account.create({
            data: {
                name: 'Partner for Dashboard Test',
                email: `partner-dash-${Date.now()}@test.com`,
                apiKey: crypto.randomUUID()
            }
        });

        const partner = await prisma.partnerAccount.create({
            data: {
                accountId: partnerOwner.id,
                partnerApiKey: crypto.randomUUID(),
                companyName: 'Dashboard Test Partner',
                isActive: true
            }
        });
        partnerAccountId = partner.id;
        partnerApiKey = partner.partnerApiKey;

        // Create multiple linked accounts
        for (let i = 0; i < 2; i++) {
            const account = await prisma.account.create({
                data: {
                    name: `Dashboard Customer ${i + 1}`,
                    email: `customer-dash-${i}-${Date.now()}@test.com`,
                    apiKey: crypto.randomUUID()
                }
            });
            linkedAccountIds.push(account.id);

            await prisma.partnerAccountLink.create({
                data: {
                    partnerAccountId: partner.id,
                    linkedAccountId: account.id,
                    isActive: true,
                    permissions: ['read']
                }
            });

            // Add some users
            await prisma.user.create({
                data: {
                    accountId: account.id,
                    email: `user-dash-${i}-${Date.now()}@test.com`,
                    firstName: 'Dashboard',
                    lastName: 'User',
                    licenses: ['Photoshop']
                }
            });
        }
    });

    afterEach(async () => {
        await prisma.user.deleteMany({
            where: { accountId: { in: linkedAccountIds } }
        }).catch(() => {});

        await prisma.partnerAccountLink.deleteMany({
            where: { partnerAccountId }
        }).catch(() => {});

        await prisma.partnerAccount.deleteMany({
            where: { id: partnerAccountId }
        }).catch(() => {});

        await prisma.account.deleteMany({
            where: {
                OR: [
                    { id: { in: linkedAccountIds } },
                    { email: { contains: 'partner-dash-' } }
                ]
            }
        }).catch(() => {});

        linkedAccountIds = [];
    });

    test('returns aggregate dashboard data', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(app, '/api/v1/partner/dashboard', {
            headers: { 'X-Partner-API-Key': partnerApiKey }
        });

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.summary.totalAccounts).toBe(2);
        expect(data.data.summary.totalUsers).toBe(2);
        expect(data.data.accounts).toHaveLength(2);
    });
});

describe('Partner API - Inactive Partner', () => {
    let inactivePartnerApiKey;
    let partnerAccountId;
    let partnerOwnerAccountId;

    beforeEach(async () => {
        const partnerOwner = await prisma.account.create({
            data: {
                name: 'Inactive Partner',
                email: `inactive-partner-${Date.now()}@test.com`,
                apiKey: crypto.randomUUID()
            }
        });
        partnerOwnerAccountId = partnerOwner.id;

        const partner = await prisma.partnerAccount.create({
            data: {
                accountId: partnerOwner.id,
                partnerApiKey: crypto.randomUUID(),
                companyName: 'Inactive Partner',
                isActive: false // Partner is inactive
            }
        });
        partnerAccountId = partner.id;
        inactivePartnerApiKey = partner.partnerApiKey;
    });

    afterEach(async () => {
        await prisma.partnerAccount.deleteMany({
            where: { id: partnerAccountId }
        }).catch(() => {});

        await prisma.account.deleteMany({
            where: { id: partnerOwnerAccountId }
        }).catch(() => {});
    });

    test('returns 401 for inactive partner', async () => {
        const app = createTestApp();
        const { response, data } = await fetchJson(app, '/api/v1/partner/accounts', {
            headers: { 'X-Partner-API-Key': inactivePartnerApiKey }
        });

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('INVALID_PARTNER_API_KEY');
    });
});
