/**
 * Integration tests for User Activity History API
 * Tests querying detailed activity history per user
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

async function fetchJson(app, path) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const data = await response.json();
    return { response, data };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('User Activity History API', () => {
  let accountId;
  let userId;
  const createdEventIds = [];

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        name: 'Activity History Test',
        email: `activity-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID()
      }
    });
    accountId = account.id;

    // Create a user
    const user = await db.createUser(accountId, {
      email: `user-${Date.now()}@test.com`,
      firstName: 'Test',
      lastName: 'User',
      licenses: ['Photoshop']
    });
    userId = user.id;

    // Add the user's windows username for linking events
    await prisma.windowsUsername.create({
      data: {
        userId: userId,
        username: 'testuser'
      }
    });

    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000;

    // Create usage events for this user
    const events = [
      { event: 'application_launch', url: 'Photoshop.exe', when: new Date(now - oneDay * 1), source: 'desktop' },
      { event: 'application_launch', url: 'Illustrator.exe', when: new Date(now - oneDay * 2), source: 'desktop' },
      { event: 'web_browsing', url: 'https://adobe.com', when: new Date(now - oneDay * 3), source: 'browser' },
      { event: 'application_launch', url: 'Photoshop.exe', when: new Date(now - oneDay * 5), source: 'desktop' },
      { event: 'application_launch', url: 'Acrobat.exe', when: new Date(now - oneDay * 10), source: 'desktop' }
    ];

    for (const evt of events) {
      const created = await prisma.usageEvent.create({
        data: {
          accountId,
          event: evt.event,
          url: evt.url,
          clientId: 'test-client',
          why: 'test',
          when: evt.when,
          windowsUser: 'testuser',
          source: evt.source
        }
      });
      createdEventIds.push(created.id);
    }
  });

  afterEach(async () => {
    for (const eventId of createdEventIds) {
      await prisma.usageEvent.delete({ where: { id: eventId } }).catch(() => {});
    }
    createdEventIds.length = 0;

    if (userId) {
      await prisma.windowsUsername.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }

    if (accountId) {
      await prisma.account.delete({ where: { id: accountId } }).catch(() => {});
    }
  });

  describe('GET /api/users/:userId/activity', () => {
    test('returns activity history for user', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, `/api/users/${userId}/activity`);

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('activities');
      expect(data).toHaveProperty('total');
      expect(Array.isArray(data.activities)).toBe(true);
    });

    test('includes event details in response', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, `/api/users/${userId}/activity`);

      expect(data.activities.length).toBeGreaterThan(0);
      
      const activity = data.activities[0];
      expect(activity).toHaveProperty('event');
      expect(activity).toHaveProperty('url');
      expect(activity).toHaveProperty('when');
      expect(activity).toHaveProperty('source');
    });

    test('returns activities sorted by date descending', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, `/api/users/${userId}/activity`);

      for (let i = 1; i < data.activities.length; i++) {
        const prev = new Date(data.activities[i - 1].when);
        const curr = new Date(data.activities[i].when);
        expect(prev.getTime()).toBeGreaterThanOrEqual(curr.getTime());
      }
    });

    test('supports limit parameter for pagination', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, `/api/users/${userId}/activity?limit=2`);

      expect(data.activities.length).toBe(2);
      expect(data.total).toBe(5); // Total events created
    });

    test('supports offset parameter for pagination', async () => {
      const app = createTestApp(accountId);
      
      const { data: page1 } = await fetchJson(app, `/api/users/${userId}/activity?limit=2&offset=0`);
      const { data: page2 } = await fetchJson(app, `/api/users/${userId}/activity?limit=2&offset=2`);

      expect(page1.activities[0].id).not.toBe(page2.activities[0].id);
    });

    test('supports date range filtering', async () => {
      const app = createTestApp(accountId);
      const now = new Date();
      const fourDaysAgo = new Date(now - 4 * 24 * 60 * 60 * 1000);
      
      const { data } = await fetchJson(app, `/api/users/${userId}/activity?startDate=${fourDaysAgo.toISOString()}`);

      // Should only return events from last 4 days (3 events: 1, 2, 3 days ago)
      expect(data.activities.length).toBe(3);
    });

    test('returns 404 for non-existent user', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/users/non-existent-id/activity');

      expect(response.status).toBe(404);
      expect(data.error).toBeDefined();
    });

    test('respects account scoping', async () => {
      // Create another account with a user
      const otherAccount = await prisma.account.create({
        data: {
          name: 'Other Account',
          email: `other-activity-${Date.now()}@test.com`,
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
        const { response, data } = await fetchJson(app, `/api/users/${otherUser.id}/activity`);

        // Should not be able to access other account's user
        expect(response.status).toBe(404);
      } finally {
        await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {});
        await prisma.account.delete({ where: { id: otherAccount.id } }).catch(() => {});
      }
    });
  });

  describe('GET /api/users/:userId/activity/summary', () => {
    test('returns activity summary for user', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, `/api/users/${userId}/activity/summary`);

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('totalEvents');
      expect(data).toHaveProperty('byApplication');
      expect(data).toHaveProperty('bySource');
      expect(data).toHaveProperty('lastActivity');
    });

    test('groups activities by application', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, `/api/users/${userId}/activity/summary`);

      expect(data.byApplication).toBeDefined();
      // Should have Photoshop with 2 events
      const photoshop = data.byApplication.find(a => a.application.includes('Photoshop'));
      expect(photoshop).toBeDefined();
      expect(photoshop.count).toBe(2);
    });
  });
});
