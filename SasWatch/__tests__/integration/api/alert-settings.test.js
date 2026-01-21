/**
 * Integration tests for Inactivity Alert Settings API
 * Tests account-level alert configuration endpoints
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

describe('Alert Settings API', () => {
  let accountId;

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        name: 'Alert Test Account',
        email: `alert-test-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID(),
        inactivityAlertEnabled: false,
        inactivityAlertThreshold: 30
      }
    });
    accountId = account.id;
  });

  afterEach(async () => {
    if (accountId) {
      await prisma.account.delete({ where: { id: accountId } }).catch(() => {});
    }
  });

  describe('GET /api/account/alert-settings', () => {
    test('returns current alert settings', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/account/alert-settings');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('inactivityAlertEnabled', false);
      expect(data).toHaveProperty('inactivityAlertThreshold', 30);
      expect(data).toHaveProperty('inactivityAlertEmail');
      expect(data).toHaveProperty('inactivityAlertLastSent');
    });

    test('returns updated settings after modification', async () => {
      // First enable alerts
      await prisma.account.update({
        where: { id: accountId },
        data: {
          inactivityAlertEnabled: true,
          inactivityAlertThreshold: 60,
          inactivityAlertEmail: 'alerts@test.com'
        }
      });

      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/account/alert-settings');

      expect(response.status).toBe(200);
      expect(data.inactivityAlertEnabled).toBe(true);
      expect(data.inactivityAlertThreshold).toBe(60);
      expect(data.inactivityAlertEmail).toBe('alerts@test.com');
    });
  });

  describe('PUT /api/account/alert-settings', () => {
    test('updates alert settings', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/account/alert-settings', {
        method: 'PUT',
        body: JSON.stringify({
          inactivityAlertEnabled: true,
          inactivityAlertThreshold: 60
        })
      });

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.settings.inactivityAlertEnabled).toBe(true);
      expect(data.settings.inactivityAlertThreshold).toBe(60);

      // Verify in database
      const account = await prisma.account.findUnique({ where: { id: accountId } });
      expect(account.inactivityAlertEnabled).toBe(true);
      expect(account.inactivityAlertThreshold).toBe(60);
    });

    test('updates alert email', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/account/alert-settings', {
        method: 'PUT',
        body: JSON.stringify({
          inactivityAlertEmail: 'custom-alerts@company.com'
        })
      });

      expect(response.status).toBe(200);
      expect(data.settings.inactivityAlertEmail).toBe('custom-alerts@company.com');
    });

    test('validates threshold values', async () => {
      const app = createTestApp(accountId);
      
      // Invalid threshold (not 7, 14, 30, 60, or 90)
      const { response, data } = await fetchJson(app, '/api/account/alert-settings', {
        method: 'PUT',
        body: JSON.stringify({
          inactivityAlertThreshold: 45
        })
      });

      expect(response.status).toBe(400);
      expect(data.error).toContain('threshold');
    });

    test('accepts valid threshold values', async () => {
      const app = createTestApp(accountId);
      
      for (const threshold of [7, 14, 30, 60, 90]) {
        const { response, data } = await fetchJson(app, '/api/account/alert-settings', {
          method: 'PUT',
          body: JSON.stringify({ inactivityAlertThreshold: threshold })
        });

        expect(response.status).toBe(200);
        expect(data.settings.inactivityAlertThreshold).toBe(threshold);
      }
    });

    test('validates email format', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/account/alert-settings', {
        method: 'PUT',
        body: JSON.stringify({
          inactivityAlertEmail: 'invalid-email'
        })
      });

      expect(response.status).toBe(400);
      expect(data.error).toContain('email');
    });
  });

  describe('Account scoping', () => {
    test('settings are account-specific', async () => {
      // Create second account
      const account2 = await prisma.account.create({
        data: {
          name: 'Second Account',
          email: `second-${Date.now()}@test.com`,
          apiKey: crypto.randomUUID(),
          inactivityAlertEnabled: true,
          inactivityAlertThreshold: 90
        }
      });

      try {
        // Account 1 should have default settings
        const app1 = createTestApp(accountId);
        const { data: data1 } = await fetchJson(app1, '/api/account/alert-settings');
        expect(data1.inactivityAlertEnabled).toBe(false);
        expect(data1.inactivityAlertThreshold).toBe(30);

        // Account 2 should have its own settings
        const app2 = createTestApp(account2.id);
        const { data: data2 } = await fetchJson(app2, '/api/account/alert-settings');
        expect(data2.inactivityAlertEnabled).toBe(true);
        expect(data2.inactivityAlertThreshold).toBe(90);
      } finally {
        await prisma.account.delete({ where: { id: account2.id } }).catch(() => {});
      }
    });
  });
});
