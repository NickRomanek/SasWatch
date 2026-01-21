/**
 * Integration tests for Audit Logging API
 * Tests tracking admin actions for compliance
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import crypto from 'crypto';

const db = await import('../../../lib/database-multitenant.js');
const { setupDataRoutes } = await import('../../../server-multitenant-routes.js');

const prisma = new PrismaClient();

function createTestApp(accountId, memberId = 'test-member') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { accountId, memberId };
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

describe('Audit Logging API', () => {
  let accountId;
  let userId;

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        name: 'Audit Test Account',
        email: `audit-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID()
      }
    });
    accountId = account.id;

    const user = await db.createUser(accountId, {
      email: `user-${Date.now()}@test.com`,
      firstName: 'Test',
      lastName: 'User',
      licenses: ['Photoshop', 'Illustrator']
    });
    userId = user.id;
  });

  afterEach(async () => {
    // Clean up audit logs
    await prisma.auditLog.deleteMany({ where: { accountId } }).catch(() => {});
    
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    if (accountId) {
      await prisma.account.delete({ where: { id: accountId } }).catch(() => {});
    }
  });

  describe('GET /api/audit-logs', () => {
    test('returns empty array when no logs exist', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/audit-logs');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('logs');
      expect(data).toHaveProperty('total');
      expect(Array.isArray(data.logs)).toBe(true);
    });

    test('returns audit logs with correct structure', async () => {
      const app = createTestApp(accountId);
      
      // Trigger an action that creates a log (license reclamation)
      await fetchJson(app, '/api/licenses/reclaim', {
        method: 'POST',
        body: JSON.stringify({ userId, licenses: ['Photoshop'] })
      });

      const { data } = await fetchJson(app, '/api/audit-logs');

      expect(data.logs.length).toBeGreaterThan(0);
      
      const log = data.logs[0];
      expect(log).toHaveProperty('id');
      expect(log).toHaveProperty('action');
      expect(log).toHaveProperty('targetType');
      expect(log).toHaveProperty('targetId');
      expect(log).toHaveProperty('details');
      expect(log).toHaveProperty('createdAt');
    });

    test('logs license reclamation actions', async () => {
      const app = createTestApp(accountId);
      
      await fetchJson(app, '/api/licenses/reclaim', {
        method: 'POST',
        body: JSON.stringify({ userId, licenses: ['Photoshop'] })
      });

      const { data } = await fetchJson(app, '/api/audit-logs');
      
      const reclaimLog = data.logs.find(l => l.action === 'license.reclaim');
      expect(reclaimLog).toBeDefined();
      expect(reclaimLog.targetId).toBe(userId);
      expect(reclaimLog.details.licenses).toContain('Photoshop');
    });

    test('supports pagination with limit and offset', async () => {
      const app = createTestApp(accountId);
      
      // Create multiple log entries
      for (let i = 0; i < 5; i++) {
        await fetchJson(app, '/api/licenses/reclaim', {
          method: 'POST',
          body: JSON.stringify({ userId, licenses: [] })
        });
        // Re-add licenses for next iteration
        await prisma.user.update({
          where: { id: userId },
          data: { licenses: ['Photoshop', 'Illustrator'] }
        });
      }

      const { data: page1 } = await fetchJson(app, '/api/audit-logs?limit=2&offset=0');
      const { data: page2 } = await fetchJson(app, '/api/audit-logs?limit=2&offset=2');

      expect(page1.logs.length).toBe(2);
      expect(page2.logs.length).toBe(2);
      expect(page1.logs[0].id).not.toBe(page2.logs[0].id);
    });

    test('supports filtering by action type', async () => {
      const app = createTestApp(accountId);
      
      // Create a reclaim action
      await fetchJson(app, '/api/licenses/reclaim', {
        method: 'POST',
        body: JSON.stringify({ userId, licenses: ['Photoshop'] })
      });

      const { data } = await fetchJson(app, '/api/audit-logs?action=license.reclaim');
      
      expect(data.logs.every(l => l.action === 'license.reclaim')).toBe(true);
    });

    test('supports date range filtering', async () => {
      const app = createTestApp(accountId);
      
      await fetchJson(app, '/api/licenses/reclaim', {
        method: 'POST',
        body: JSON.stringify({ userId, licenses: ['Photoshop'] })
      });

      const now = new Date();
      const yesterday = new Date(now - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const { data: inRange } = await fetchJson(app, 
        `/api/audit-logs?startDate=${yesterday.toISOString()}&endDate=${tomorrow.toISOString()}`
      );
      expect(inRange.logs.length).toBeGreaterThan(0);

      const { data: outOfRange } = await fetchJson(app,
        `/api/audit-logs?startDate=${tomorrow.toISOString()}`
      );
      expect(outOfRange.logs.length).toBe(0);
    });

    test('returns logs sorted by date descending', async () => {
      const app = createTestApp(accountId);
      
      // Create multiple logs
      for (let i = 0; i < 3; i++) {
        await fetchJson(app, '/api/licenses/reclaim', {
          method: 'POST',
          body: JSON.stringify({ userId, licenses: [] })
        });
        await prisma.user.update({
          where: { id: userId },
          data: { licenses: ['Photoshop'] }
        });
      }

      const { data } = await fetchJson(app, '/api/audit-logs');
      
      for (let i = 1; i < data.logs.length; i++) {
        const prev = new Date(data.logs[i - 1].createdAt);
        const curr = new Date(data.logs[i].createdAt);
        expect(prev.getTime()).toBeGreaterThanOrEqual(curr.getTime());
      }
    });
  });

  describe('Account Scoping', () => {
    test('audit logs are account-specific', async () => {
      const otherAccount = await prisma.account.create({
        data: {
          name: 'Other Account',
          email: `other-audit-${Date.now()}@test.com`,
          apiKey: crypto.randomUUID()
        }
      });

      try {
        const app1 = createTestApp(accountId);
        
        // Create a log in account 1
        await fetchJson(app1, '/api/licenses/reclaim', {
          method: 'POST',
          body: JSON.stringify({ userId, licenses: ['Photoshop'] })
        });

        // Account 2 should not see account 1's logs
        const app2 = createTestApp(otherAccount.id);
        const { data } = await fetchJson(app2, '/api/audit-logs');
        
        expect(data.logs.length).toBe(0);
      } finally {
        await prisma.auditLog.deleteMany({ where: { accountId: otherAccount.id } }).catch(() => {});
        await prisma.account.delete({ where: { id: otherAccount.id } }).catch(() => {});
      }
    });
  });
});
