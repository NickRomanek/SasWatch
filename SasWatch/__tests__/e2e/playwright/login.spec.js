/**
 * E2E Test: Login Flow with Playwright
 * 
 * Tests the full login flow using real browser automation.
 * Covers form submission, error handling, and authenticated navigation.
 */

import { test, expect } from '@playwright/test';

// Test credentials - use environment variables in CI
const TEST_EMAIL = process.env.TEST_EMAIL || 'nick@romatekai.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password';

test.describe('Login Page', () => {
  // These tests need a fresh (unauthenticated) context
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    // Navigate to login page before each test
    await page.goto('/login');
  });

  test('should display login form elements', async ({ page }) => {
    // Verify page title
    await expect(page).toHaveTitle(/Login.*SasWatch/);

    // Verify form elements are present
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toHaveText('Sign In');

    // Verify links are present
    await expect(page.locator('a[href="/signup"]')).toBeVisible();
    await expect(page.locator('a[href="/forgot-password"]')).toBeVisible();
  });

  test('should show validation for empty fields', async ({ page }) => {
    // Try to submit empty form
    await page.locator('button[type="submit"]').click();

    // Email field should show HTML5 validation (required)
    const emailInput = page.locator('#email');
    await expect(emailInput).toHaveAttribute('required', '');
  });

  test('should show error for invalid credentials', async ({ page }) => {
    // Fill in invalid credentials
    await page.locator('#email').fill('invalid@test.com');
    await page.locator('#password').fill('wrongpassword');
    
    // Submit the form
    await page.locator('button[type="submit"]').click();

    // Should stay on login page with error message
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('.error-message')).toBeVisible();
  });

  test('should successfully login with valid credentials', async ({ browser }) => {
    // Create fresh context to avoid rate limiting from previous tests
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.goto('/login');
    
    // Fill in valid credentials
    await page.locator('#email').fill(TEST_EMAIL);
    await page.locator('#password').fill(TEST_PASSWORD);
    
    // Submit the form
    await page.locator('button[type="submit"]').click();

    // Should redirect to dashboard (home page)
    await expect(page).toHaveURL('/');
    
    // Dashboard should be visible (verify some dashboard element)
    await expect(page.locator('body')).not.toContainText('Sign In');
    
    await context.close();
  });

  test('should navigate to signup page', async ({ page }) => {
    await page.locator('a[href="/signup"]').click();
    await expect(page).toHaveURL('/signup');
  });

  test('should navigate to forgot password page', async ({ page }) => {
    await page.locator('a[href="/forgot-password"]').click();
    await expect(page).toHaveURL('/forgot-password');
  });
});

test.describe('Authenticated Navigation', () => {
  // Uses pre-authenticated state from auth.setup.js via storageState in config
  // No need to login in beforeEach - session is already established

  test('should access users page after login', async ({ page }) => {
    await page.goto('/users');
    await expect(page).toHaveURL('/users');
    // Should not redirect to login
    await expect(page.locator('body')).not.toContainText('Log in to your account');
  });

  test('should access licenses page after login', async ({ page }) => {
    await page.goto('/licenses');
    await expect(page).toHaveURL('/licenses');
  });

  test('should access apps page after login', async ({ page }) => {
    await page.goto('/apps');
    await expect(page).toHaveURL('/apps');
  });

  test('should maintain session across page navigation', async ({ page }) => {
    // Navigate to multiple pages
    await page.goto('/users');
    await expect(page).toHaveURL('/users');
    
    await page.goto('/licenses');
    await expect(page).toHaveURL('/licenses');
    
    await page.goto('/');
    await expect(page).toHaveURL('/');
    
    // Should still be logged in
    await expect(page.locator('body')).not.toContainText('Log in to your account');
  });
});

test.describe('API Authentication', () => {
  test('should reject unauthenticated API requests', async () => {
    // Use native fetch without any cookies to test unauthenticated access
    const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseURL}/api/users/inactive`, {
      credentials: 'omit', // Explicitly omit cookies
    });
    
    const status = response.status;
    
    // API should return 401 Unauthorized for unauthenticated requests
    // If we get 200 with actual data, that's a security issue
    if (status === 200) {
      const body = await response.json();
      // If somehow 200, should at least have an error or empty data
      expect(body.error || body.count === 0).toBeTruthy();
    } else {
      expect([401, 302, 303]).toContain(status);
    }
  });

  test('should allow authenticated API requests', async ({ page }) => {
    // Uses pre-authenticated state from auth.setup.js
    // Session is already established via storageState
    
    // Navigate to any page first to ensure cookies are loaded
    await page.goto('/');
    
    // Get cookies from the page context
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name === 'connect.sid');
    
    expect(sessionCookie).toBeDefined();

    // Make API request with session cookie
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/users/inactive');
      return {
        status: res.status,
        data: await res.json()
      };
    });

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('users');
    expect(response.data).toHaveProperty('count');
  });
});
