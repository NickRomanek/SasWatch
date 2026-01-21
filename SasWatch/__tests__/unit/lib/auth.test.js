/**
 * Unit tests for authentication module
 * Tests password hashing, member creation, and authentication
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

// Import auth functions - we need to use dynamic import for CommonJS module
const auth = await import('../../../lib/auth.js');
const { hashPassword, comparePassword, createMember, authenticateMember } = auth;

const prisma = new PrismaClient();

describe('Authentication Module', () => {
  let testAccountId;
  let testMemberId;

  beforeEach(async () => {
    // Create a test account for each test
    const account = await prisma.account.create({
      data: {
        name: 'Test Account',
        email: `test-${Date.now()}@example.com`,
        apiKey: crypto.randomUUID(),
      },
    });
    testAccountId = account.id;
  });

  afterEach(async () => {
    // Cleanup: Delete test data
    if (testMemberId) {
      await prisma.accountMember.deleteMany({ where: { id: testMemberId } }).catch(() => {});
    }
    if (testAccountId) {
      await prisma.accountMember.deleteMany({ where: { accountId: testAccountId } }).catch(() => {});
      await prisma.account.delete({ where: { id: testAccountId } }).catch(() => {});
    }
  });

  describe('Password Hashing', () => {
    test('should hash password successfully', async () => {
      const password = 'TestPassword123!';
      const hash = await hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50); // bcrypt hashes are long
    });

    test('should verify correct password', async () => {
      const password = 'TestPassword123!';
      const hash = await hashPassword(password);
      const isValid = await comparePassword(password, hash);
      
      expect(isValid).toBe(true);
    });

    test('should reject incorrect password', async () => {
      const password = 'TestPassword123!';
      const wrongPassword = 'WrongPassword123!';
      const hash = await hashPassword(password);
      const isValid = await comparePassword(wrongPassword, hash);
      
      expect(isValid).toBe(false);
    });

    test('should produce different hashes for same password', async () => {
      const password = 'TestPassword123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      
      // bcrypt uses random salt, so hashes should differ
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Member Creation', () => {
    test('should create member with valid data', async () => {
      const memberData = {
        email: `member-${Date.now()}@example.com`,
        name: 'Test Member',
        password: 'SecurePassword123!',
        role: 'viewer',
      };

      const member = await createMember(testAccountId, memberData);
      
      expect(member).toBeDefined();
      expect(member.email).toBe(memberData.email.toLowerCase());
      expect(member.name).toBe('Test Member');
      expect(member.role).toBe('viewer');
      expect(member.accountId).toBe(testAccountId);
      expect(member.password).not.toBe(memberData.password); // Should be hashed
      
      testMemberId = member.id;
    });

    test('should reject duplicate email', async () => {
      const memberData = {
        email: `duplicate-${Date.now()}@example.com`,
        name: 'First Member',
        password: 'Password123!',
      };

      const member = await createMember(testAccountId, memberData);
      testMemberId = member.id;
      
      // Try to create another member with same email
      await expect(
        createMember(testAccountId, { ...memberData, name: 'Second Member' })
      ).rejects.toThrow('A member with this email already exists');
    });

    test('should reject invalid account ID', async () => {
      const memberData = {
        email: `member-${Date.now()}@example.com`,
        name: 'Test Member',
        password: 'Password123!',
      };

      await expect(
        createMember('non-existent-account-id', memberData)
      ).rejects.toThrow('Account not found');
    });
  });
});
