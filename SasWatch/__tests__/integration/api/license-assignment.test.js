/**
 * Integration tests for License Assignment API
 * Tests assigning licenses to users
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import crypto from 'crypto';

const db = await import('../../../lib/database-multitenant.js');
const { setupDataRoutes } = await import('../../../server-multitenant-routes.js');

const prisma = new PrismaClient();

function createTestApp(accountId) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { accountId, memberId: 'test-member' };
    next();
  });
  setupDataRoutes(app);
  return app;
}

async function fetchJson(app, path, options = {}) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await response.json();
    return { response, data };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('License Assignment API', () => {
  let accountId;
  let userId;

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        name: 'Assignment Test Account',
        email: `assign-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID(),
        licenseCosts: {
          'Photoshop': { costPerLicense: 55, totalLicenses: 10 },
          'Illustrator': { costPerLicense: 35, totalLicenses: 5 },
          'Acrobat Pro': { costPerLicense: 25, totalLicenses: 20 }
        }
      }
    });
    accountId = account.id;

    const user = await db.createUser(accountId, {
      email: `user-${Date.now()}@test.com`,
      firstName: 'Test',
      lastName: 'User',
      licenses: []
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { accountId } }).catch(() => {});
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    if (accountId) {
      await prisma.account.delete({ where: { id: accountId } }).catch(() => {});
    }
  });

  describe('POST /api/licenses/assign', () => {
    test('assigns license to user', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/licenses/assign', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          license: 'Photoshop'
        })
      });

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.assignedLicense).toBe('Photoshop');

      // Verify user has the license
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user.licenses).toContain('Photoshop');
    });

    test('assigns multiple licenses in sequence', async () => {
      const app = createTestApp(accountId);
      
      await fetchJson(app, '/api/licenses/assign', {
        method: 'POST',
        body: JSON.stringify({ userId, license: 'Photoshop' })
      });
      
      await fetchJson(app, '/api/licenses/assign', {
        method: 'POST',
        body: JSON.stringify({ userId, license: 'Illustrator' })
      });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user.licenses).toContain('Photoshop');
      expect(user.licenses).toContain('Illustrator');
    });

    test('prevents duplicate license assignment', async () => {
      const app = createTestApp(accountId);
      
      // Assign first time
      await fetchJson(app, '/api/licenses/assign', {
        method: 'POST',
        body: JSON.stringify({ userId, license: 'Photoshop' })
      });
      
      // Try to assign again
      const { response, data } = await fetchJson(app, '/api/licenses/assign', {
        method: 'POST',
        body: JSON.stringify({ userId, license: 'Photoshop' })
      });

      expect(response.status).toBe(400);
      expect(data.error).toContain('already');
    });

    test('creates audit log for assignment', async () => {
      const app = createTestApp(accountId);
      
      await fetchJson(app, '/api/licenses/assign', {
        method: 'POST',
        body: JSON.stringify({ userId, license: 'Photoshop' })
      });

      const { data } = await fetchJson(app, '/api/audit-logs?action=license.assign');
      
      expect(data.logs.length).toBeGreaterThan(0);
      const log = data.logs[0];
      expect(log.action).toBe('license.assign');
      expect(log.targetId).toBe(userId);
      expect(log.details.license).toBe('Photoshop');
    });

    test('returns 404 for non-existent user', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/licenses/assign', {
        method: 'POST',
        body: JSON.stringify({
          userId: 'non-existent',
          license: 'Photoshop'
        })
      });

      expect(response.status).toBe(404);
      expect(data.error).toBeDefined();
    });

    test('requires license parameter', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/licenses/assign', {
        method: 'POST',
        body: JSON.stringify({ userId })
      });

      expect(response.status).toBe(400);
      expect(data.error).toContain('license');
    });
  });

  describe('GET /api/licenses/inventory', () => {
    test('returns license inventory', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/licenses/inventory');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('licenses');
      expect(Array.isArray(data.licenses)).toBe(true);
    });

    test('shows total and assigned counts', async () => {
      const app = createTestApp(accountId);
      
      // Assign some licenses
      await fetchJson(app, '/api/licenses/assign', {
        method: 'POST',
        body: JSON.stringify({ userId, license: 'Photoshop' })
      });

      const { data } = await fetchJson(app, '/api/licenses/inventory');
      
      const photoshop = data.licenses.find(l => l.name === 'Photoshop');
      expect(photoshop).toBeDefined();
      expect(photoshop).toHaveProperty('totalLicenses');
      expect(photoshop).toHaveProperty('assignedCount');
      expect(photoshop).toHaveProperty('availableCount');
      expect(photoshop.assignedCount).toBe(1);
    });

    test('calculates available licenses correctly', async () => {
      const app = createTestApp(accountId);
      
      // Create another user and assign licenses
      const user2 = await db.createUser(accountId, {
        email: `user2-${Date.now()}@test.com`,
        firstName: 'Second',
        lastName: 'User',
        licenses: ['Photoshop', 'Photoshop'] // This shouldn't happen but tests counting
      });

      try {
        await fetchJson(app, '/api/licenses/assign', {
          method: 'POST',
          body: JSON.stringify({ userId, license: 'Photoshop' })
        });

        const { data } = await fetchJson(app, '/api/licenses/inventory');
        
        const photoshop = data.licenses.find(l => l.name === 'Photoshop');
        // 10 total - 3 assigned (user2 has 2, user has 1) = 7 available
        expect(photoshop.totalLicenses).toBe(10);
        expect(photoshop.assignedCount).toBe(3);
        expect(photoshop.availableCount).toBe(7);
      } finally {
        await prisma.user.delete({ where: { id: user2.id } }).catch(() => {});
      }
    });
  });

  describe('Account Scoping', () => {
    test('cannot assign license to other account user', async () => {
      const otherAccount = await prisma.account.create({
        data: {
          name: 'Other Account',
          email: `other-assign-${Date.now()}@test.com`,
          apiKey: crypto.randomUUID()
        }
      });

      const otherUser = await db.createUser(otherAccount.id, {
        email: `other-user-${Date.now()}@test.com`,
        firstName: 'Other',
        lastName: 'User',
        licenses: []
      });

      try {
        const app = createTestApp(accountId);
        
        const { response } = await fetchJson(app, '/api/licenses/assign', {
          method: 'POST',
          body: JSON.stringify({
            userId: otherUser.id,
            license: 'Photoshop'
          })
        });

        expect(response.status).toBe(404);
      } finally {
        await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {});
        await prisma.account.delete({ where: { id: otherAccount.id } }).catch(() => {});
      }
    });
  });
});
