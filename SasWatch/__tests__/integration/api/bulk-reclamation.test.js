/**
 * Integration tests for Bulk License Reclamation API
 * Tests processing multiple users for license reclamation at once
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
    req.session = { accountId };
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

describe('Bulk License Reclamation API', () => {
  let accountId;
  const createdUserIds = [];

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        name: 'Bulk Reclaim Test Account',
        email: `bulk-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID()
      }
    });
    accountId = account.id;

    // Create multiple users with licenses
    for (let i = 0; i < 5; i++) {
      const user = await db.createUser(accountId, {
        email: `user${i}-${Date.now()}@test.com`,
        firstName: `User${i}`,
        lastName: 'Test',
        licenses: ['Photoshop', 'Illustrator']
      });
      createdUserIds.push(user.id);
    }
  });

  afterEach(async () => {
    for (const userId of createdUserIds) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    createdUserIds.length = 0;

    if (accountId) {
      await prisma.account.delete({ where: { id: accountId } }).catch(() => {});
    }
  });

  describe('POST /api/licenses/reclaim-bulk', () => {
    test('reclaims licenses from multiple users', async () => {
      const app = createTestApp(accountId);
      const usersToReclaim = createdUserIds.slice(0, 3);

      const { response, data } = await fetchJson(app, '/api/licenses/reclaim-bulk', {
        method: 'POST',
        body: JSON.stringify({
          userIds: usersToReclaim,
          licenses: ['Photoshop']
        })
      });

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.processed).toBe(3);
      expect(data.succeeded).toBe(3);
      expect(data.failed).toBe(0);

      // Verify licenses were removed
      for (const userId of usersToReclaim) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        expect(user.licenses).not.toContain('Photoshop');
        expect(user.licenses).toContain('Illustrator');
      }
    });

    test('reclaims all licenses when none specified', async () => {
      const app = createTestApp(accountId);
      const usersToReclaim = createdUserIds.slice(0, 2);

      const { response, data } = await fetchJson(app, '/api/licenses/reclaim-bulk', {
        method: 'POST',
        body: JSON.stringify({
          userIds: usersToReclaim,
          licenses: []
        })
      });

      expect(response.status).toBe(200);
      expect(data.succeeded).toBe(2);

      // Verify all licenses were removed
      for (const userId of usersToReclaim) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        expect(user.licenses).toHaveLength(0);
      }
    });

    test('returns results array with per-user details', async () => {
      const app = createTestApp(accountId);

      const { data } = await fetchJson(app, '/api/licenses/reclaim-bulk', {
        method: 'POST',
        body: JSON.stringify({
          userIds: createdUserIds.slice(0, 2),
          licenses: ['Photoshop']
        })
      });

      expect(data.results).toBeDefined();
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.results.length).toBe(2);

      for (const result of data.results) {
        expect(result).toHaveProperty('userId');
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('reclaimedLicenses');
      }
    });

    test('handles partial success with invalid user IDs', async () => {
      const app = createTestApp(accountId);
      const mixedIds = [createdUserIds[0], 'invalid-id', createdUserIds[1]];

      const { response, data } = await fetchJson(app, '/api/licenses/reclaim-bulk', {
        method: 'POST',
        body: JSON.stringify({
          userIds: mixedIds,
          licenses: ['Photoshop']
        })
      });

      expect(response.status).toBe(200);
      expect(data.processed).toBe(3);
      expect(data.succeeded).toBe(2);
      expect(data.failed).toBe(1);

      // Check failure details
      const failedResult = data.results.find(r => !r.success);
      expect(failedResult).toBeDefined();
      expect(failedResult.error).toBeDefined();
    });

    test('respects account scoping - cannot reclaim from other accounts', async () => {
      // Create another account with a user
      const otherAccount = await prisma.account.create({
        data: {
          name: 'Other Account',
          email: `other-bulk-${Date.now()}@test.com`,
          apiKey: crypto.randomUUID()
        }
      });

      const otherUser = await db.createUser(otherAccount.id, {
        email: `other-user-${Date.now()}@test.com`,
        firstName: 'Other',
        lastName: 'User',
        licenses: ['Photoshop']
      });

      try {
        const app = createTestApp(accountId); // Using original account

        const { data } = await fetchJson(app, '/api/licenses/reclaim-bulk', {
          method: 'POST',
          body: JSON.stringify({
            userIds: [otherUser.id, createdUserIds[0]],
            licenses: ['Photoshop']
          })
        });

        // Should succeed for own user, fail for other account's user
        expect(data.succeeded).toBe(1);
        expect(data.failed).toBe(1);

        // Other user's licenses should be unchanged
        const otherUserAfter = await prisma.user.findUnique({ where: { id: otherUser.id } });
        expect(otherUserAfter.licenses).toContain('Photoshop');
      } finally {
        await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {});
        await prisma.account.delete({ where: { id: otherAccount.id } }).catch(() => {});
      }
    });

    test('returns error for empty userIds array', async () => {
      const app = createTestApp(accountId);

      const { response, data } = await fetchJson(app, '/api/licenses/reclaim-bulk', {
        method: 'POST',
        body: JSON.stringify({
          userIds: [],
          licenses: ['Photoshop']
        })
      });

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test('limits batch size to prevent abuse', async () => {
      const app = createTestApp(accountId);
      const tooManyIds = Array(101).fill('fake-id');

      const { response, data } = await fetchJson(app, '/api/licenses/reclaim-bulk', {
        method: 'POST',
        body: JSON.stringify({
          userIds: tooManyIds,
          licenses: ['Photoshop']
        })
      });

      expect(response.status).toBe(400);
      expect(data.error).toContain('100');
    });
  });
});
