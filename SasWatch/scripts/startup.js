#!/usr/bin/env node
/**
 * Startup script that ensures migrations run before server starts
 * This is more reliable than using && chains in package.json
 */

const { execSync } = require('child_process');
const path = require('path');

function runCommand(command, description, continueOnError = false) {
    console.log(`[Startup] ${description}...`);
    try {
        execSync(command, { stdio: 'inherit', cwd: __dirname + '/..' });
        console.log(`[Startup] ✓ ${description} completed`);
        return true;
    } catch (error) {
        if (continueOnError) {
            console.error(`[Startup] ⚠️  ${description} had issues, but continuing...`);
            return false;
        } else {
            console.error(`[Startup] ✗ ${description} failed`);
            throw error;
        }
    }
}

async function main() {
    try {
        console.log('[Startup] ============================================');
        console.log('[Startup] Starting SasWatch Server');
        console.log('[Startup] ============================================');
        
        // Step 1: Check session secret
        runCommand('node check-session-secret.js', 'Checking session secret');
        
        // Step 2: Run Prisma migrations
        // In production, we MUST not continue if migrations fail, otherwise Prisma will
        // crash at runtime with missing columns/tables (e.g. after schema changes).
        // If migrate deploy fails with baseline errors (P3005), fall back to a safe
        // prisma db push (additive-only) to align schema.
        const isProduction = process.env.NODE_ENV === 'production';
        try {
            runCommand(
                'npx prisma migrate deploy',
                'Running Prisma migrations',
                !isProduction // only continue on error outside production
            );
        } catch (err) {
            const msg = [
                err?.message || '',
                err?.stderr?.toString?.() || '',
                err?.stdout?.toString?.() || ''
            ].join('\n');
            const isBaselineError = msg.includes('P3005') || msg.includes('database schema is not empty');
            if (isProduction) {
                console.warn('[Startup] ⚠️ migrate deploy failed. Attempting fallback prisma db push (baseline-safe).');
                if (!isBaselineError) {
                    console.warn('[Startup] Note: error did not match P3005; still attempting db push to unblock startup.');
                }
                runCommand(
                    'npx prisma db push --skip-generate',
                    'Running Prisma db push (baseline fallback)'
                );
            } else {
                throw err;
            }
        }
        
        // Step 3: Start server
        console.log('[Startup] ============================================');
        console.log('[Startup] Starting server...');
        console.log('[Startup] ============================================');
        runCommand('node server.js', 'Starting server');
        
    } catch (error) {
        console.error('[Startup] Fatal error during startup:', error.message);
        process.exit(1);
    }
}

main();

