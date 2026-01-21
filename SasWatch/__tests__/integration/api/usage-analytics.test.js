/**
 * Integration tests for Usage Analytics API
 * Tests dashboard analytics, trends, and license utilization
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

describe('Usage Analytics API', () => {
  let accountId;
  const createdUserIds = [];

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        name: 'Analytics Test Account',
        email: `analytics-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID(),
        licenseCosts: {
          'Photoshop': { costPerLicense: 55, currency: 'USD' },
          'Illustrator': { costPerLicense: 35, currency: 'USD' },
          'Acrobat Pro': { costPerLicense: 25, currency: 'USD' }
        }
      }
    });
    accountId = account.id;

    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);

    // High activity user (recent, multiple activities)
    const highActivityUser = await db.createUser(accountId, {
      email: `high-${Date.now()}@test.com`,
      firstName: 'High',
      lastName: 'Activity',
      licenses: ['Photoshop', 'Illustrator']
    });
    createdUserIds.push(highActivityUser.id);
    await prisma.user.update({
      where: { id: highActivityUser.id },
      data: { lastActivity: today, activityCount: 150 }
    });

    // Medium activity user
    const mediumActivityUser = await db.createUser(accountId, {
      email: `medium-${Date.now()}@test.com`,
      firstName: 'Medium',
      lastName: 'Activity',
      licenses: ['Photoshop']
    });
    createdUserIds.push(mediumActivityUser.id);
    await prisma.user.update({
      where: { id: mediumActivityUser.id },
      data: { lastActivity: sevenDaysAgo, activityCount: 50 }
    });

    // Low activity user
    const lowActivityUser = await db.createUser(accountId, {
      email: `low-${Date.now()}@test.com`,
      firstName: 'Low',
      lastName: 'Activity',
      licenses: ['Illustrator', 'Acrobat Pro']
    });
    createdUserIds.push(lowActivityUser.id);
    await prisma.user.update({
      where: { id: lowActivityUser.id },
      data: { lastActivity: thirtyDaysAgo, activityCount: 10 }
    });

    // Inactive user
    const inactiveUser = await db.createUser(accountId, {
      email: `inactive-${Date.now()}@test.com`,
      firstName: 'Inactive',
      lastName: 'User',
      licenses: ['Acrobat Pro']
    });
    createdUserIds.push(inactiveUser.id);
    await prisma.user.update({
      where: { id: inactiveUser.id },
      data: { lastActivity: sixtyDaysAgo, activityCount: 2 }
    });

    // Never active user
    const neverActiveUser = await db.createUser(accountId, {
      email: `never-${Date.now()}@test.com`,
      firstName: 'Never',
      lastName: 'Active',
      licenses: ['Photoshop']
    });
    createdUserIds.push(neverActiveUser.id);
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

  describe('GET /api/analytics/overview', () => {
    test('returns summary metrics', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/analytics/overview');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('totalUsers');
      expect(data).toHaveProperty('activeUsers');
      expect(data).toHaveProperty('inactiveUsers');
      expect(data).toHaveProperty('totalLicenses');
      expect(data).toHaveProperty('totalActivityCount');
      expect(data).toHaveProperty('averageActivityPerUser');
      
      expect(data.totalUsers).toBe(5);
    });

    test('calculates active vs inactive users correctly', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/analytics/overview?inactiveDays=30');

      // High and Medium should be active (within 30 days)
      // Low, Inactive, Never should be inactive
      expect(data.activeUsers).toBe(2);
      expect(data.inactiveUsers).toBe(3);
    });

    test('returns license count breakdown', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/analytics/overview');

      // 5 users with: PS+IL, PS, IL+AP, AP, PS = 7 licenses total
      expect(data.totalLicenses).toBe(7);
    });
  });

  describe('GET /api/analytics/license-utilization', () => {
    test('returns usage by license type', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/analytics/license-utilization');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('licenses');
      expect(Array.isArray(data.licenses)).toBe(true);
    });

    test('includes active and inactive counts per license', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/analytics/license-utilization?inactiveDays=30');

      const photoshop = data.licenses.find(l => l.name === 'Photoshop');
      expect(photoshop).toBeDefined();
      expect(photoshop).toHaveProperty('totalAssigned');
      expect(photoshop).toHaveProperty('activeUsers');
      expect(photoshop).toHaveProperty('inactiveUsers');
      expect(photoshop).toHaveProperty('utilizationRate');
    });

    test('calculates utilization rate correctly', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/analytics/license-utilization?inactiveDays=30');

      // Photoshop: High (active), Medium (active), Never (inactive) = 3 total, 2 active = 66.67%
      const photoshop = data.licenses.find(l => l.name === 'Photoshop');
      expect(photoshop.totalAssigned).toBe(3);
      expect(photoshop.activeUsers).toBe(2);
      expect(photoshop.utilizationRate).toBeCloseTo(66.67, 0);
    });

    test('includes cost information when available', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/analytics/license-utilization');

      const photoshop = data.licenses.find(l => l.name === 'Photoshop');
      expect(photoshop).toHaveProperty('monthlyCost');
      expect(photoshop).toHaveProperty('wastedCost');
    });
  });

  describe('GET /api/analytics/top-users', () => {
    test('returns most active users by default', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/analytics/top-users');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('users');
      expect(Array.isArray(data.users)).toBe(true);
      
      // Should be sorted by activity count descending
      expect(data.users[0].firstName).toBe('High');
    });

    test('supports limit parameter', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/analytics/top-users?limit=3');

      expect(data.users.length).toBe(3);
    });

    test('supports order parameter for least active', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/analytics/top-users?order=asc');

      // Never active (0) should be first, then Inactive (2)
      expect(data.users[0].activityCount).toBe(0);
    });

    test('includes user details and activity metrics', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/analytics/top-users?limit=1');

      const user = data.users[0];
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('firstName');
      expect(user).toHaveProperty('lastName');
      expect(user).toHaveProperty('licenses');
      expect(user).toHaveProperty('activityCount');
      expect(user).toHaveProperty('lastActivity');
    });
  });

  describe('GET /api/analytics/activity-summary', () => {
    test('returns activity breakdown by time period', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/analytics/activity-summary');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('last7Days');
      expect(data).toHaveProperty('last30Days');
      expect(data).toHaveProperty('last90Days');
      expect(data).toHaveProperty('neverActive');
    });

    test('categorizes users by last activity correctly', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/analytics/activity-summary');

      // High: today, Medium: 7 days ago
      expect(data.last7Days).toBeGreaterThanOrEqual(1);
      // Low: 30 days ago
      expect(data.last30Days).toBeGreaterThanOrEqual(1);
      // Never: null lastActivity
      expect(data.neverActive).toBe(1);
    });
  });

  describe('Account Scoping', () => {
    test('analytics only include own account data', async () => {
      // Create another account with users
      const otherAccount = await prisma.account.create({
        data: {
          name: 'Other Account',
          email: `other-${Date.now()}@test.com`,
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
        const app = createTestApp(accountId);
        const { data } = await fetchJson(app, '/api/analytics/overview');

        // Should only count our 5 users, not the other account's user
        expect(data.totalUsers).toBe(5);
      } finally {
        await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {});
        await prisma.account.delete({ where: { id: otherAccount.id } }).catch(() => {});
      }
    });
  });
});
