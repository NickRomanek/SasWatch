/**
 * Playwright Auth Setup
 * 
 * This file creates authenticated browser state that can be reused
 * across tests to avoid logging in for every test.
 * 
 * Usage: Add to playwright.config.js as a setup project
 */

import { test as setup, expect } from '@playwright/test';
import path from 'path';

const TEST_EMAIL = process.env.TEST_EMAIL || 'nick@romatekai.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password';

const authFile = path.join(__dirname, '../../../.playwright/.auth/user.json');

// Ensure directory exists
import fs from 'fs';
const authDir = path.dirname(authFile);
if (!fs.existsSync(authDir)) {
  fs.mkdirSync(authDir, { recursive: true });
}

// Increase timeout for auth setup (rate limiting may cause delays)
setup.setTimeout(60000);

setup('authenticate', async ({ page }) => {
  // Retry login with exponential backoff in case of rate limiting
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    attempts++;
    
    // Go to login page
    await page.goto('/login');
    
    // Check for rate limit message
    const rateLimitMessage = page.locator('text=Too many login attempts');
    if (await rateLimitMessage.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log(`Rate limited, waiting before retry (attempt ${attempts}/${maxAttempts})...`);
      await page.waitForTimeout(15000); // Wait 15 seconds
      continue;
    }
    
    // Fill in credentials
    await page.locator('#email').fill(TEST_EMAIL);
    await page.locator('#password').fill(TEST_PASSWORD);
    
    // Submit form
    await page.locator('button[type="submit"]').click();
    
    // Wait for either redirect to dashboard or stay on login page
    try {
      await expect(page).toHaveURL('/', { timeout: 10000 });
      // Success - save authenticated state
      await page.context().storageState({ path: authFile });
      return;
    } catch {
      // Check if rate limited after submission
      if (await rateLimitMessage.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`Rate limited after login attempt ${attempts}, waiting...`);
        await page.waitForTimeout(15000);
        continue;
      }
      throw new Error(`Login failed on attempt ${attempts}`);
    }
  }
  
  throw new Error(`Authentication failed after ${maxAttempts} attempts (likely rate limited)`);
});
