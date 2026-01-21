/**
 * Integration tests for License Reclamation API
 * Tests the workflow for identifying and reclaiming unused licenses
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

describe('License Reclamation API', () => {
  let accountId;
  const createdUserIds = [];

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        name: 'Reclamation Test Account',
        email: `reclaim-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID(),
        licenseCosts: {
          'Photoshop': { costPerLicense: 55, currency: 'USD' },
          'Illustrator': { costPerLicense: 35, currency: 'USD' },
          'Acrobat Pro': { costPerLicense: 25, currency: 'USD' }
        }
      }
    });
    accountId = account.id;

    // Create active user (activity today)
    const activeUser = await db.createUser(accountId, {
      email: `active-${Date.now()}@test.com`,
      firstName: 'Active',
      lastName: 'User',
      licenses: ['Photoshop', 'Illustrator']
    });
    createdUserIds.push(activeUser.id);
    await prisma.user.update({
      where: { id: activeUser.id },
      data: { lastActivity: new Date() }
    });

    // Create inactive user (60 days ago)
    const inactiveUser = await db.createUser(accountId, {
      email: `inactive-${Date.now()}@test.com`,
      firstName: 'Inactive',
      lastName: 'User',
      licenses: ['Photoshop', 'Acrobat Pro']
    });
    createdUserIds.push(inactiveUser.id);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: inactiveUser.id },
      data: { lastActivity: sixtyDaysAgo }
    });

    // Create never-active user (null lastActivity)
    const neverActiveUser = await db.createUser(accountId, {
      email: `never-${Date.now()}@test.com`,
      firstName: 'Never',
      lastName: 'Active',
      licenses: ['Illustrator']
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

  describe('GET /api/licenses/reclamation-candidates', () => {
    test('returns inactive users with licenses as reclamation candidates', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/licenses/reclamation-candidates?days=30');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('candidates');
      expect(data).toHaveProperty('totalLicenses');
      expect(data).toHaveProperty('potentialSavings');
      
      // Should include inactive and never-active users
      expect(data.candidates.length).toBeGreaterThanOrEqual(2);
    });

    test('calculates potential cost savings', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/licenses/reclamation-candidates?days=30');

      // Inactive user has Photoshop ($55) + Acrobat Pro ($25) = $80
      // Never-active user has Illustrator ($35)
      // Total potential savings: $115
      expect(data.potentialSavings).toBeDefined();
      expect(data.potentialSavings.monthly).toBeGreaterThan(0);
      expect(data.potentialSavings.annual).toBe(data.potentialSavings.monthly * 12);
    });

    test('respects days threshold parameter', async () => {
      const app = createTestApp(accountId);
      
      // With 90 day threshold, only never-active user should be included
      // (inactive user was 60 days ago)
      const { data: data90 } = await fetchJson(app, '/api/licenses/reclamation-candidates?days=90');
      
      // With 30 day threshold, both should be included
      const { data: data30 } = await fetchJson(app, '/api/licenses/reclamation-candidates?days=30');
      
      expect(data30.candidates.length).toBeGreaterThanOrEqual(data90.candidates.length);
    });

    test('excludes users with no licenses', async () => {
      // Create user with no licenses
      const noLicenseUser = await db.createUser(accountId, {
        email: `nolicense-${Date.now()}@test.com`,
        firstName: 'No',
        lastName: 'License',
        licenses: []
      });
      createdUserIds.push(noLicenseUser.id);

      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/licenses/reclamation-candidates?days=30');

      // Should not include user with no licenses
      const noLicenseCandidate = data.candidates.find(c => c.email.includes('nolicense'));
      expect(noLicenseCandidate).toBeUndefined();
    });
  });

  describe('POST /api/licenses/reclaim', () => {
    test('removes licenses from specified user', async () => {
      const app = createTestApp(accountId);
      
      // Get candidates first
      const { data: candidatesData } = await fetchJson(app, '/api/licenses/reclamation-candidates?days=30');
      const inactiveCandidate = candidatesData.candidates.find(c => c.firstName === 'Inactive');
      
      expect(inactiveCandidate).toBeDefined();

      // Reclaim one license
      const { response, data } = await fetchJson(app, '/api/licenses/reclaim', {
        method: 'POST',
        body: JSON.stringify({
          userId: inactiveCandidate.id,
          licenses: ['Photoshop']
        })
      });

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.reclaimedLicenses).toContain('Photoshop');

      // Verify license was removed
      const updatedUser = await prisma.user.findUnique({ where: { id: inactiveCandidate.id } });
      expect(updatedUser.licenses).not.toContain('Photoshop');
      expect(updatedUser.licenses).toContain('Acrobat Pro'); // Should still have other license
    });

    test('reclaims all licenses when none specified', async () => {
      const app = createTestApp(accountId);
      
      const { data: candidatesData } = await fetchJson(app, '/api/licenses/reclamation-candidates?days=30');
      const inactiveCandidate = candidatesData.candidates.find(c => c.firstName === 'Inactive');

      const { response, data } = await fetchJson(app, '/api/licenses/reclaim', {
        method: 'POST',
        body: JSON.stringify({
          userId: inactiveCandidate.id,
          licenses: [] // Empty means all
        })
      });

      expect(response.status).toBe(200);
      expect(data.reclaimedLicenses.length).toBe(2); // Photoshop + Acrobat Pro

      // Verify all licenses removed
      const updatedUser = await prisma.user.findUnique({ where: { id: inactiveCandidate.id } });
      expect(updatedUser.licenses).toHaveLength(0);
    });

    test('returns error for invalid user ID', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/licenses/reclaim', {
        method: 'POST',
        body: JSON.stringify({
          userId: 'non-existent-id',
          licenses: ['Photoshop']
        })
      });

      expect(response.status).toBe(404);
      expect(data.error).toBeDefined();
    });

    test('respects account scoping - cannot reclaim from other account', async () => {
      // Create another account
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
        const app = createTestApp(accountId); // Using original account
        
        const { response, data } = await fetchJson(app, '/api/licenses/reclaim', {
          method: 'POST',
          body: JSON.stringify({
            userId: otherUser.id,
            licenses: ['Photoshop']
          })
        });

        // Should fail - user belongs to different account
        expect(response.status).toBe(404);
      } finally {
        await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {});
        await prisma.account.delete({ where: { id: otherAccount.id } }).catch(() => {});
      }
    });
  });

  describe('GET /api/licenses/reclamation-summary', () => {
    test('returns summary of reclamation opportunities', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/licenses/reclamation-summary');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('totalInactiveUsers');
      expect(data).toHaveProperty('totalReclaimableLicenses');
      expect(data).toHaveProperty('potentialMonthlySavings');
      expect(data).toHaveProperty('byLicenseType');
    });
  });
});
