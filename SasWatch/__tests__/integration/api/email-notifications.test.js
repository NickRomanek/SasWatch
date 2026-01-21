/**
 * Integration tests for Email Notification Preferences API
 * Tests configurable notification settings per account
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import crypto from 'crypto';

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

describe('Email Notification Preferences API', () => {
  let accountId;

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        name: 'Notification Test Account',
        email: `notify-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID()
      }
    });
    accountId = account.id;
  });

  afterEach(async () => {
    if (accountId) {
      await prisma.account.delete({ where: { id: accountId } }).catch(() => {});
    }
  });

  describe('GET /api/notifications/preferences', () => {
    test('returns default notification preferences', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/notifications/preferences');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('renewalReminders');
      expect(data).toHaveProperty('inactivityAlerts');
      expect(data).toHaveProperty('weeklyDigest');
      expect(data).toHaveProperty('licenseChanges');
    });

    test('returns correct default values', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/notifications/preferences');

      // Default should have renewal reminders enabled
      expect(data.renewalReminders).toHaveProperty('enabled');
      expect(data.weeklyDigest).toHaveProperty('enabled');
      expect(data.weeklyDigest).toHaveProperty('dayOfWeek');
    });
  });

  describe('PUT /api/notifications/preferences', () => {
    test('updates notification preferences', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          renewalReminders: { enabled: false },
          weeklyDigest: { enabled: true, dayOfWeek: 'friday' }
        })
      });

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('persists preference changes', async () => {
      const app = createTestApp(accountId);
      
      // Update preferences
      await fetchJson(app, '/api/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          renewalReminders: { enabled: false },
          weeklyDigest: { enabled: true, dayOfWeek: 'friday' }
        })
      });

      // Verify they persist
      const { data } = await fetchJson(app, '/api/notifications/preferences');
      expect(data.renewalReminders.enabled).toBe(false);
      expect(data.weeklyDigest.dayOfWeek).toBe('friday');
    });

    test('validates dayOfWeek values', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          weeklyDigest: { dayOfWeek: 'invalid-day' }
        })
      });

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test('allows partial updates', async () => {
      const app = createTestApp(accountId);
      
      // Set initial state
      await fetchJson(app, '/api/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          renewalReminders: { enabled: true },
          weeklyDigest: { enabled: true, dayOfWeek: 'monday' }
        })
      });

      // Partial update - only change weeklyDigest
      await fetchJson(app, '/api/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          weeklyDigest: { enabled: false }
        })
      });

      // Verify renewalReminders unchanged, weeklyDigest updated
      const { data } = await fetchJson(app, '/api/notifications/preferences');
      expect(data.renewalReminders.enabled).toBe(true); // Unchanged
      expect(data.weeklyDigest.enabled).toBe(false); // Updated
    });
  });

  describe('GET /api/notifications/types', () => {
    test('returns available notification types', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/notifications/types');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('types');
      expect(Array.isArray(data.types)).toBe(true);
      
      // Should include standard types
      const typeIds = data.types.map(t => t.id);
      expect(typeIds).toContain('renewalReminders');
      expect(typeIds).toContain('inactivityAlerts');
      expect(typeIds).toContain('weeklyDigest');
    });

    test('includes description for each type', async () => {
      const app = createTestApp(accountId);
      const { data } = await fetchJson(app, '/api/notifications/types');

      for (const type of data.types) {
        expect(type).toHaveProperty('id');
        expect(type).toHaveProperty('name');
        expect(type).toHaveProperty('description');
      }
    });
  });

  describe('Account Scoping', () => {
    test('preferences are account-specific', async () => {
      // Create another account
      const otherAccount = await prisma.account.create({
        data: {
          name: 'Other Account',
          email: `other-notify-${Date.now()}@test.com`,
          apiKey: crypto.randomUUID()
        }
      });

      try {
        const app1 = createTestApp(accountId);
        const app2 = createTestApp(otherAccount.id);

        // Set preferences for account 1
        await fetchJson(app1, '/api/notifications/preferences', {
          method: 'PUT',
          body: JSON.stringify({
            weeklyDigest: { enabled: false }
          })
        });

        // Set different preferences for account 2
        await fetchJson(app2, '/api/notifications/preferences', {
          method: 'PUT',
          body: JSON.stringify({
            weeklyDigest: { enabled: true, dayOfWeek: 'wednesday' }
          })
        });

        // Verify they are independent
        const { data: data1 } = await fetchJson(app1, '/api/notifications/preferences');
        const { data: data2 } = await fetchJson(app2, '/api/notifications/preferences');

        expect(data1.weeklyDigest.enabled).toBe(false);
        expect(data2.weeklyDigest.enabled).toBe(true);
        expect(data2.weeklyDigest.dayOfWeek).toBe('wednesday');
      } finally {
        await prisma.account.delete({ where: { id: otherAccount.id } }).catch(() => {});
      }
    });
  });
});
