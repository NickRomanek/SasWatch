// Test setup file - runs before all tests
import { beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Set test environment variables
process.env.NODE_ENV = 'test';
// Use existing Docker setup: postgres:password@localhost:5432 (matches docker-compose.yml)
// Default to saswatch_test database (will be created if needed)
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/saswatch_test';
process.env.SESSION_SECRET = 'test-secret-for-testing-only-min-32-chars-long';
process.env.API_URL = 'http://localhost:3000';

beforeAll(async () => {
  // Verify database connection
  try {
    await prisma.$connect();
    console.log('Test database connected');
  } catch (error) {
    console.error('Failed to connect to test database:', error);
    throw error;
  }
});

afterAll(async () => {
  // Cleanup: disconnect from database
  await prisma.$disconnect();
});
