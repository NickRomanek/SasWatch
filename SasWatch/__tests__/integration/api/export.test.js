/**
 * Integration tests for CSV export API endpoints
 * Verifies CSV generation, headers, and account scoping
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

async function fetchResponse(app, path) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const text = await response.text();
    return { 
      response, 
      text,
      contentType: response.headers.get('content-type'),
      contentDisposition: response.headers.get('content-disposition')
    };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('CSV Export API', () => {
  let accountAId;
  let accountBId;
  const createdUserIds = [];

  beforeEach(async () => {
    const accountA = await prisma.account.create({
      data: {
        name: 'Export Test Account A',
        email: `export-a-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID()
      }
    });

    const accountB = await prisma.account.create({
      data: {
        name: 'Export Test Account B',
        email: `export-b-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID()
      }
    });

    accountAId = accountA.id;
    accountBId = accountB.id;

    // Create test users for account A
    const user1 = await db.createUser(accountAId, {
      email: `user1-${Date.now()}@test.com`,
      firstName: 'John',
      lastName: 'Doe',
      licenses: ['Photoshop', 'Illustrator']
    });
    createdUserIds.push(user1.id);

    // Make user1 (John) active - activity today
    const today = new Date();
    await prisma.user.update({
      where: { id: user1.id },
      data: { lastActivity: today }
    });

    const user2 = await db.createUser(accountAId, {
      email: `user2-${Date.now()}@test.com`,
      firstName: 'Jane',
      lastName: 'Smith',
      licenses: ['Acrobat Pro']
    });
    createdUserIds.push(user2.id);

    // Make user2 (Jane) inactive (40 days ago)
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: user2.id },
      data: { lastActivity: fortyDaysAgo }
    });

    // Create user for account B (should not appear in A's export)
    const userB = await db.createUser(accountBId, {
      email: `userb-${Date.now()}@test.com`,
      firstName: 'Bob',
      lastName: 'Wilson',
      licenses: ['Creative Cloud']
    });
    createdUserIds.push(userB.id);
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

  describe('GET /api/users/export/csv', () => {
    test('returns CSV with proper headers', async () => {
      const app = createTestApp(accountAId);
      const { response, text, contentType, contentDisposition } = await fetchResponse(app, '/api/users/export/csv');

      expect(response.status).toBe(200);
      expect(contentType).toContain('text/csv');
      expect(contentDisposition).toContain('attachment');
      expect(contentDisposition).toContain('users-');
      expect(contentDisposition).toContain('.csv');
    });

    test('CSV contains header row and user data', async () => {
      const app = createTestApp(accountAId);
      const { text } = await fetchResponse(app, '/api/users/export/csv');

      const lines = text.trim().split('\n');
      
      // Should have header + 2 users
      expect(lines.length).toBeGreaterThanOrEqual(3);
      
      // Check header row
      const header = lines[0].toLowerCase();
      expect(header).toContain('email');
      expect(header).toContain('firstname');
      expect(header).toContain('lastname');
      expect(header).toContain('licenses');
      expect(header).toContain('lastactivity');
    });

    test('respects account scoping - only returns own users', async () => {
      const app = createTestApp(accountAId);
      const { text } = await fetchResponse(app, '/api/users/export/csv');

      // Should contain account A users
      expect(text).toContain('John');
      expect(text).toContain('Jane');
      
      // Should NOT contain account B users
      expect(text).not.toContain('Bob');
      expect(text).not.toContain('Wilson');
    });
  });

  describe('GET /api/users/inactive/export/csv', () => {
    test('returns CSV with proper headers', async () => {
      const app = createTestApp(accountAId);
      const { response, contentType, contentDisposition } = await fetchResponse(app, '/api/users/inactive/export/csv');

      expect(response.status).toBe(200);
      expect(contentType).toContain('text/csv');
      expect(contentDisposition).toContain('attachment');
      expect(contentDisposition).toContain('inactive-users-');
    });

    test('only includes inactive users', async () => {
      const app = createTestApp(accountAId);
      const { text } = await fetchResponse(app, '/api/users/inactive/export/csv?days=30');

      // Jane is inactive (40 days), John is not
      expect(text).toContain('Jane');
      expect(text).not.toContain('John');
    });

    test('CSV includes daysSinceActivity column', async () => {
      const app = createTestApp(accountAId);
      const { text } = await fetchResponse(app, '/api/users/inactive/export/csv');

      const header = text.split('\n')[0].toLowerCase();
      expect(header).toContain('dayssinceactivity');
    });

    test('respects days query parameter', async () => {
      const app = createTestApp(accountAId);
      
      // With 50 days threshold, Jane (40 days) should not be included
      const { text } = await fetchResponse(app, '/api/users/inactive/export/csv?days=50');
      expect(text).not.toContain('Jane');
    });
  });
});
