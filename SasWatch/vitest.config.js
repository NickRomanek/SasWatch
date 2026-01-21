import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',
    
    // Support globals (describe, test, expect, etc.)
    globals: true,
    
    // Test file patterns
    include: ['__tests__/**/*.test.js'],
    exclude: ['node_modules', 'dist', '.git'],
    
    // Pool configuration for better compatibility
    pool: 'forks',
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '__tests__/',
        '**/*.config.js',
        '**/dist/',
        '**/coverage/',
        'scripts/',
        '*.js', // Exclude root level files
        '**/prisma/**',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
    
    // Global test timeout
    testTimeout: 10000,
    
    // Setup files
    setupFiles: ['__tests__/setup.js'],
    
    // Reporter configuration
    reporters: ['verbose'],
    
    // Watch mode configuration
    watch: false, // Disable watch by default (use npm run test:watch)
  },
});
