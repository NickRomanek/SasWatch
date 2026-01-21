/**
 * Integration tests for Scheduled Reports API
 * Tests configuring automated email reports
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

describe('Scheduled Reports API', () => {
  let accountId;

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        name: 'Report Test Account',
        email: `report-${Date.now()}@test.com`,
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

  describe('GET /api/reports/schedules', () => {
    test('returns empty array when no schedules configured', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/reports/schedules');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('schedules');
      expect(Array.isArray(data.schedules)).toBe(true);
    });

    test('returns configured schedules', async () => {
      // First create a schedule
      const app = createTestApp(accountId);
      await fetchJson(app, '/api/reports/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Weekly Report',
          frequency: 'weekly',
          reportType: 'usage-summary',
          dayOfWeek: 'monday',
          recipients: ['admin@test.com']
        })
      });

      const { data } = await fetchJson(app, '/api/reports/schedules');
      expect(data.schedules.length).toBe(1);
      expect(data.schedules[0].name).toBe('Weekly Report');
    });
  });

  describe('POST /api/reports/schedules', () => {
    test('creates new report schedule', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/reports/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Monthly License Report',
          frequency: 'monthly',
          reportType: 'license-utilization',
          dayOfMonth: 1,
          recipients: ['manager@test.com']
        })
      });

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.schedule).toHaveProperty('id');
      expect(data.schedule.name).toBe('Monthly License Report');
    });

    test('validates frequency values', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/reports/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Bad Report',
          frequency: 'invalid',
          reportType: 'usage-summary',
          recipients: ['admin@test.com']
        })
      });

      expect(response.status).toBe(400);
      expect(data.error).toContain('frequency');
    });

    test('validates reportType values', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/reports/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Bad Report',
          frequency: 'weekly',
          reportType: 'invalid-type',
          dayOfWeek: 'monday',
          recipients: ['admin@test.com']
        })
      });

      expect(response.status).toBe(400);
      expect(data.error).toContain('reportType');
    });

    test('requires recipients array', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/reports/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: 'No Recipients Report',
          frequency: 'weekly',
          reportType: 'usage-summary',
          dayOfWeek: 'monday',
          recipients: []
        })
      });

      expect(response.status).toBe(400);
      expect(data.error).toContain('recipient');
    });

    test('requires dayOfWeek for weekly frequency', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/reports/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Weekly Report',
          frequency: 'weekly',
          reportType: 'usage-summary',
          recipients: ['admin@test.com']
        })
      });

      expect(response.status).toBe(400);
      expect(data.error).toContain('dayOfWeek');
    });
  });

  describe('DELETE /api/reports/schedules/:id', () => {
    test('deletes existing schedule', async () => {
      const app = createTestApp(accountId);
      
      // Create a schedule first
      const { data: createData } = await fetchJson(app, '/api/reports/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: 'To Delete',
          frequency: 'weekly',
          reportType: 'usage-summary',
          dayOfWeek: 'friday',
          recipients: ['admin@test.com']
        })
      });

      const scheduleId = createData.schedule.id;

      // Delete it
      const { response, data } = await fetchJson(app, `/api/reports/schedules/${scheduleId}`, {
        method: 'DELETE'
      });

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify it's gone
      const { data: listData } = await fetchJson(app, '/api/reports/schedules');
      expect(listData.schedules.length).toBe(0);
    });

    test('returns 404 for non-existent schedule', async () => {
      const app = createTestApp(accountId);
      
      const { response, data } = await fetchJson(app, '/api/reports/schedules/non-existent-id', {
        method: 'DELETE'
      });

      expect(response.status).toBe(404);
      expect(data.error).toBeDefined();
    });
  });

  describe('PUT /api/reports/schedules/:id', () => {
    test('updates existing schedule', async () => {
      const app = createTestApp(accountId);
      
      // Create a schedule first
      const { data: createData } = await fetchJson(app, '/api/reports/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Original Name',
          frequency: 'weekly',
          reportType: 'usage-summary',
          dayOfWeek: 'monday',
          recipients: ['admin@test.com']
        })
      });

      const scheduleId = createData.schedule.id;

      // Update it
      const { response, data } = await fetchJson(app, `/api/reports/schedules/${scheduleId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Updated Name',
          enabled: false
        })
      });

      expect(response.status).toBe(200);
      expect(data.schedule.name).toBe('Updated Name');
      expect(data.schedule.enabled).toBe(false);
    });
  });

  describe('GET /api/reports/types', () => {
    test('returns available report types', async () => {
      const app = createTestApp(accountId);
      const { response, data } = await fetchJson(app, '/api/reports/types');

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('types');
      expect(Array.isArray(data.types)).toBe(true);
      
      const typeIds = data.types.map(t => t.id);
      expect(typeIds).toContain('usage-summary');
      expect(typeIds).toContain('license-utilization');
    });
  });

  describe('Account Scoping', () => {
    test('schedules are account-specific', async () => {
      const otherAccount = await prisma.account.create({
        data: {
          name: 'Other Account',
          email: `other-report-${Date.now()}@test.com`,
          apiKey: crypto.randomUUID()
        }
      });

      try {
        const app1 = createTestApp(accountId);
        const app2 = createTestApp(otherAccount.id);

        // Create schedule for account 1
        await fetchJson(app1, '/api/reports/schedules', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Account 1 Report',
            frequency: 'weekly',
            reportType: 'usage-summary',
            dayOfWeek: 'monday',
            recipients: ['admin@test.com']
          })
        });

        // Account 2 should not see account 1's schedule
        const { data } = await fetchJson(app2, '/api/reports/schedules');
        expect(data.schedules.length).toBe(0);
      } finally {
        await prisma.account.delete({ where: { id: otherAccount.id } }).catch(() => {});
      }
    });
  });
});
