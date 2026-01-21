/**
 * CRITICAL: Multi-Tenant Isolation Tests
 * 
 * These tests verify that data isolation works correctly.
 * This is the most important security feature of SasWatch.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

// Import database functions - dynamic import for CommonJS
const db = await import('../../lib/database-multitenant.js');

const prisma = new PrismaClient();

describe('Multi-Tenant Data Isolation', () => {
  let accountAId;
  let accountBId;
  let userA1Id;
  let userA2Id;
  let userB1Id;

  beforeEach(async () => {
    // Create two separate accounts
    const accountA = await prisma.account.create({
      data: {
        name: 'Account A',
        email: `account-a-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID(),
      },
    });

    const accountB = await prisma.account.create({
      data: {
        name: 'Account B',
        email: `account-b-${Date.now()}@test.com`,
        apiKey: crypto.randomUUID(),
      },
    });

    accountAId = accountA.id;
    accountBId = accountB.id;

    // Create users for Account A
    const userA1 = await db.createUser(accountAId, {
      email: `user-a1-${Date.now()}@test.com`,
      firstName: 'User',
      lastName: 'A1',
      licenses: ['Photoshop'],
    });

    const userA2 = await db.createUser(accountAId, {
      email: `user-a2-${Date.now()}@test.com`,
      firstName: 'User',
      lastName: 'A2',
      licenses: ['Illustrator'],
    });

    // Create user for Account B
    const userB1 = await db.createUser(accountBId, {
      email: `user-b1-${Date.now()}@test.com`,
      firstName: 'User',
      lastName: 'B1',
      licenses: ['Photoshop'],
    });

    userA1Id = userA1.id;
    userA2Id = userA2.id;
    userB1Id = userB1.id;
  });

  afterEach(async () => {
    // Cleanup: Delete all test data
    if (accountAId) {
      await prisma.user.deleteMany({ where: { accountId: accountAId } }).catch(() => {});
      await prisma.account.delete({ where: { id: accountAId } }).catch(() => {});
    }
    if (accountBId) {
      await prisma.user.deleteMany({ where: { accountId: accountBId } }).catch(() => {});
      await prisma.account.delete({ where: { id: accountBId } }).catch(() => {});
    }
  });

  test('Account A should only see its own users', async () => {
    // getUsersData returns { users, usernameMappings, unmappedUsernames }
    const result = await db.getUsersData(accountAId);
    const usersA = result.users;

    expect(usersA).toHaveLength(2);
    // Note: transformed users don't have accountId, they're scoped by the query
    expect(usersA.some(u => u.email.includes('user-a1'))).toBe(true);
    expect(usersA.some(u => u.email.includes('user-a2'))).toBe(true);
  });

  test('Account B should only see its own users', async () => {
    const result = await db.getUsersData(accountBId);
    const usersB = result.users;

    expect(usersB).toHaveLength(1);
    expect(usersB[0].email).toContain('user-b1');
  });

  test('Account A cannot access Account B users', async () => {
    const resultA = await db.getUsersData(accountAId);
    const resultB = await db.getUsersData(accountBId);

    // Account A's users should not contain Account B's user email
    const accountAUserEmails = resultA.users.map(u => u.email);
    const accountBUserEmails = resultB.users.map(u => u.email);

    // No overlap between the two sets
    const overlap = accountAUserEmails.filter(email => accountBUserEmails.includes(email));
    expect(overlap).toHaveLength(0);
  });

  test('Each account sees correct number of users', async () => {
    const resultA = await db.getUsersData(accountAId);
    const resultB = await db.getUsersData(accountBId);

    // Account A has 2 users
    expect(resultA.users).toHaveLength(2);
    
    // Account B has 1 user
    expect(resultB.users).toHaveLength(1);
  });
});
