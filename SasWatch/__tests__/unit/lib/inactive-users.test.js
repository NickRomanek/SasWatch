/**
 * Unit tests for getInactiveUsers function
 * Tests identification of users with no activity in X days
 * Useful for license optimization
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

// Import database functions - dynamic import for CommonJS
const db = await import('../../../lib/database-multitenant.js');

const prisma = new PrismaClient();

describe('getInactiveUsers - License Optimization', () => {
  let testAccountId;
  let accountBId;
  const createdUserIds = [];

  beforeEach(async () => {
    // Create test account
    const account = await prisma.account.create({
      data: {
        name: 'Test Account - Inactive Users',
        email: `inactive-test-${Date.now()}@example.com`,
        apiKey: crypto.randomUUID(),
      },
    });
    testAccountId = account.id;

    // Create second account for isolation testing
    const accountB = await prisma.account.create({
      data: {
        name: 'Account B',
        email: `account-b-${Date.now()}@example.com`,
        apiKey: crypto.randomUUID(),
      },
    });
    accountBId = accountB.id;
  });

  afterEach(async () => {
    // Cleanup: Delete test data
    for (const userId of createdUserIds) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    createdUserIds.length = 0;

    if (testAccountId) {
      await prisma.user.deleteMany({ where: { accountId: testAccountId } }).catch(() => {});
      await prisma.account.delete({ where: { id: testAccountId } }).catch(() => {});
    }
    if (accountBId) {
      await prisma.user.deleteMany({ where: { accountId: accountBId } }).catch(() => {});
      await prisma.account.delete({ where: { id: accountBId } }).catch(() => {});
    }
  });

  test('should return users with no activity in 30 days (default)', async () => {
    const now = new Date();
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    // Create inactive user (40 days ago)
    const inactiveUser = await db.createUser(testAccountId, {
      email: `inactive-${Date.now()}@test.com`,
      firstName: 'Inactive',
      lastName: 'User',
      licenses: ['Photoshop'],
    });
    createdUserIds.push(inactiveUser.id);
    await prisma.user.update({
      where: { id: inactiveUser.id },
      data: { lastActivity: fortyDaysAgo },
    });

    // Create active user (10 days ago)
    const activeUser = await db.createUser(testAccountId, {
      email: `active-${Date.now()}@test.com`,
      firstName: 'Active',
      lastName: 'User',
      licenses: ['Illustrator'],
    });
    createdUserIds.push(activeUser.id);
    await prisma.user.update({
      where: { id: activeUser.id },
      data: { lastActivity: tenDaysAgo },
    });

    const inactiveUsers = await db.getInactiveUsers(testAccountId);

    expect(inactiveUsers).toHaveLength(1);
    expect(inactiveUsers[0].email).toContain('inactive');
  });

  test('should include users with null lastActivity', async () => {
    // Create user with null lastActivity (never logged in)
    const neverActiveUser = await db.createUser(testAccountId, {
      email: `never-active-${Date.now()}@test.com`,
      firstName: 'Never',
      lastName: 'Active',
      licenses: ['Photoshop'],
    });
    createdUserIds.push(neverActiveUser.id);

    // Create active user
    const activeUser = await db.createUser(testAccountId, {
      email: `active-${Date.now()}@test.com`,
      firstName: 'Active',
      lastName: 'User',
      licenses: ['Illustrator'],
    });
    createdUserIds.push(activeUser.id);
    await prisma.user.update({
      where: { id: activeUser.id },
      data: { lastActivity: new Date() },
    });

    const inactiveUsers = await db.getInactiveUsers(testAccountId);

    expect(inactiveUsers).toHaveLength(1);
    expect(inactiveUsers[0].email).toContain('never-active');
  });

  test('should respect accountId scoping (multi-tenant isolation)', async () => {
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    // Create inactive user in Account A
    const inactiveUserA = await db.createUser(testAccountId, {
      email: `inactive-a-${Date.now()}@test.com`,
      firstName: 'Inactive',
      lastName: 'A',
      licenses: ['Photoshop'],
    });
    createdUserIds.push(inactiveUserA.id);
    await prisma.user.update({
      where: { id: inactiveUserA.id },
      data: { lastActivity: fortyDaysAgo },
    });

    // Create inactive user in Account B
    const inactiveUserB = await db.createUser(accountBId, {
      email: `inactive-b-${Date.now()}@test.com`,
      firstName: 'Inactive',
      lastName: 'B',
      licenses: ['Photoshop'],
    });
    createdUserIds.push(inactiveUserB.id);
    await prisma.user.update({
      where: { id: inactiveUserB.id },
      data: { lastActivity: fortyDaysAgo },
    });

    // Account A should only see its own inactive users
    const inactiveUsersA = await db.getInactiveUsers(testAccountId);
    const inactiveUsersB = await db.getInactiveUsers(accountBId);

    expect(inactiveUsersA).toHaveLength(1);
    expect(inactiveUsersA[0].email).toContain('inactive-a');

    expect(inactiveUsersB).toHaveLength(1);
    expect(inactiveUsersB[0].email).toContain('inactive-b');
  });

  test('should calculate daysSinceActivity correctly', async () => {
    const daysAgo = 45;
    const pastDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

    const user = await db.createUser(testAccountId, {
      email: `days-test-${Date.now()}@test.com`,
      firstName: 'Days',
      lastName: 'Test',
      licenses: ['Photoshop'],
    });
    createdUserIds.push(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActivity: pastDate },
    });

    const inactiveUsers = await db.getInactiveUsers(testAccountId);

    expect(inactiveUsers).toHaveLength(1);
    // Allow for 1 day variance due to test execution time
    expect(inactiveUsers[0].daysSinceActivity).toBeGreaterThanOrEqual(daysAgo - 1);
    expect(inactiveUsers[0].daysSinceActivity).toBeLessThanOrEqual(daysAgo + 1);
  });

  test('should allow custom daysInactive threshold', async () => {
    const now = new Date();
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    // Create user inactive for 15 days
    const user15Days = await db.createUser(testAccountId, {
      email: `fifteen-days-${Date.now()}@test.com`,
      firstName: 'Fifteen',
      lastName: 'Days',
      licenses: ['Photoshop'],
    });
    createdUserIds.push(user15Days.id);
    await prisma.user.update({
      where: { id: user15Days.id },
      data: { lastActivity: fifteenDaysAgo },
    });

    // Create user inactive for 5 days
    const user5Days = await db.createUser(testAccountId, {
      email: `five-days-${Date.now()}@test.com`,
      firstName: 'Five',
      lastName: 'Days',
      licenses: ['Illustrator'],
    });
    createdUserIds.push(user5Days.id);
    await prisma.user.update({
      where: { id: user5Days.id },
      data: { lastActivity: fiveDaysAgo },
    });

    // With 10-day threshold, only the 15-day user should be returned
    const inactiveUsers10Days = await db.getInactiveUsers(testAccountId, 10);
    expect(inactiveUsers10Days).toHaveLength(1);
    expect(inactiveUsers10Days[0].email).toContain('fifteen-days');

    // With 3-day threshold, both users should be returned
    const inactiveUsers3Days = await db.getInactiveUsers(testAccountId, 3);
    expect(inactiveUsers3Days).toHaveLength(2);
  });

  test('should return user details in standard format', async () => {
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    const user = await db.createUser(testAccountId, {
      email: `format-test-${Date.now()}@test.com`,
      firstName: 'Format',
      lastName: 'Test',
      licenses: ['Photoshop', 'Illustrator'],
    });
    createdUserIds.push(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActivity: fortyDaysAgo },
    });

    const inactiveUsers = await db.getInactiveUsers(testAccountId);

    expect(inactiveUsers).toHaveLength(1);
    const returnedUser = inactiveUsers[0];

    // Verify standard format fields
    expect(returnedUser).toHaveProperty('email');
    expect(returnedUser).toHaveProperty('firstName');
    expect(returnedUser).toHaveProperty('lastName');
    expect(returnedUser).toHaveProperty('licenses');
    expect(returnedUser).toHaveProperty('lastActivity');
    expect(returnedUser).toHaveProperty('daysSinceActivity');

    expect(returnedUser.firstName).toBe('Format');
    expect(returnedUser.lastName).toBe('Test');
    expect(Array.isArray(returnedUser.licenses)).toBe(true);
    expect(returnedUser.licenses).toContain('Photoshop');
    expect(returnedUser.licenses).toContain('Illustrator');
  });

  test('should return empty array when no inactive users', async () => {
    // Create only active users
    const activeUser = await db.createUser(testAccountId, {
      email: `active-${Date.now()}@test.com`,
      firstName: 'Active',
      lastName: 'User',
      licenses: ['Photoshop'],
    });
    createdUserIds.push(activeUser.id);
    await prisma.user.update({
      where: { id: activeUser.id },
      data: { lastActivity: new Date() },
    });

    const inactiveUsers = await db.getInactiveUsers(testAccountId);

    expect(inactiveUsers).toHaveLength(0);
    expect(Array.isArray(inactiveUsers)).toBe(true);
  });
});
