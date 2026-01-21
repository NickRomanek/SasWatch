/**
 * Integration tests for inactive users API endpoint
 * Verifies account scoping and query parameter handling
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

describe('GET /api/users/inactive', () => {
  let accountAId;
  let accountBId;
  const createdUserIds = [];

  beforeEach(async () => {
    const accountA = await prisma.account.create({
      data: {
        name: 'Account A',
        email: `account-a-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID()
      }
    });

    const accountB = await prisma.account.create({
      data: {
        name: 'Account B',
        email: `account-b-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID()
      }
    });

    accountAId = accountA.id;
    accountBId = accountB.id;
  });

  afterEach(async () => {
    for (const userId of createdUserIds) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    createdUserIds.length = 0;

    if (accountAId) {
      await prisma.user.deleteMany({ where: { accountId: accountAId } }).catch(() => {});
      await prisma.account.delete({ where: { id: accountAId } }).catch(() => {});
    }

    if (accountBId) {
      await prisma.user.deleteMany({ where: { accountId: accountBId } }).catch(() => {});
      await prisma.account.delete({ where: { id: accountBId } }).catch(() => {});
    }
  });

  test('returns inactive users with default daysInactive', async () => {
    const now = new Date();
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    const inactiveUser = await db.createUser(accountAId, {
      email: `inactive-${Date.now()}@test.com`,
      firstName: 'Inactive',
      lastName: 'User',
      licenses: ['Photoshop']
    });
    createdUserIds.push(inactiveUser.id);
    await prisma.user.update({
      where: { id: inactiveUser.id },
      data: { lastActivity: fortyDaysAgo }
    });

    const activeUser = await db.createUser(accountAId, {
      email: `active-${Date.now()}@test.com`,
      firstName: 'Active',
      lastName: 'User',
      licenses: ['Illustrator']
    });
    createdUserIds.push(activeUser.id);
    await prisma.user.update({
      where: { id: activeUser.id },
      data: { lastActivity: fiveDaysAgo }
    });

    const app = createTestApp(accountAId);
    const { response, data } = await fetchJson(app, '/api/users/inactive');

    expect(response.status).toBe(200);
    expect(data.daysInactive).toBe(30);
    expect(data.count).toBe(1);
    expect(data.users).toHaveLength(1);
    expect(data.users[0].email).toContain('inactive');
  });

  test('respects days query parameter and account scoping', async () => {
    const now = new Date();
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);

    const accountAUser = await db.createUser(accountAId, {
      email: `inactive-a-${Date.now()}@test.com`,
      firstName: 'Inactive',
      lastName: 'A',
      licenses: ['Photoshop']
    });
    createdUserIds.push(accountAUser.id);
    await prisma.user.update({
      where: { id: accountAUser.id },
      data: { lastActivity: fifteenDaysAgo }
    });

    const accountBUser = await db.createUser(accountBId, {
      email: `inactive-b-${Date.now()}@test.com`,
      firstName: 'Inactive',
      lastName: 'B',
      licenses: ['Photoshop']
    });
    createdUserIds.push(accountBUser.id);
    await prisma.user.update({
      where: { id: accountBUser.id },
      data: { lastActivity: fifteenDaysAgo }
    });

    const app = createTestApp(accountAId);
    const { response, data } = await fetchJson(app, '/api/users/inactive?days=10');

    expect(response.status).toBe(200);
    expect(data.daysInactive).toBe(10);
    expect(data.count).toBe(1);
    expect(data.users[0].email).toContain('inactive-a');
  });
});
