#!/usr/bin/env node
// Checks if SESSION_SECRET exists, generates if missing
// Run automatically before server starts

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, 'env.example');

// Check if .env exists
if (!fs.existsSync(envPath)) {
    console.log('⚠️  No .env file found. Creating from env.example...');
    
    if (fs.existsSync(envExamplePath)) {
        let envContent = fs.readFileSync(envExamplePath, 'utf8');
        
        // Generate new SESSION_SECRET
        const secret = crypto.randomBytes(32).toString('hex');
        envContent = envContent.replace(/^SESSION_SECRET=$/m, `SESSION_SECRET=${secret}`);
        
        fs.writeFileSync(envPath, envContent);
        console.log('✅ Created .env with SESSION_SECRET');
        console.log(`   SECRET: ${secret}\n`);
    } else {
        console.error('❌ env.example not found!');
        process.exit(1);
    }
} else {
    // .env exists, check if SESSION_SECRET is set
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    if (/^SESSION_SECRET=\s*$/m.test(envContent)) {
        // SESSION_SECRET is empty, generate and add it
        console.log('⚠️  SESSION_SECRET is empty. Generating...');
        
        const secret = crypto.randomBytes(32).toString('hex');
        const updatedContent = envContent.replace(/^SESSION_SECRET=\s*$/m, `SESSION_SECRET=${secret}`);
        
        fs.writeFileSync(envPath, updatedContent);
        console.log('✅ Added SESSION_SECRET to .env');
        console.log(`   SECRET: ${secret}\n`);
    } else if (/^SESSION_SECRET=.+$/m.test(envContent)) {
        // SESSION_SECRET exists and has a value
        const match = envContent.match(/^SESSION_SECRET=(.+)$/m);
        const secretLength = match ? match[1].trim().length : 0;
        
        if (secretLength < 32) {
            console.warn(`⚠️  WARNING: SESSION_SECRET is only ${secretLength} characters (should be 32+)`);
            console.warn('   Consider regenerating with: npm run generate-secret\n');
        } else {
            console.log('✅ SESSION_SECRET configured (' + secretLength + ' chars)\n');
        }
    } else {
        // SESSION_SECRET not found in file at all, add it
        console.log('⚠️  SESSION_SECRET missing from .env. Adding...');
        
        const secret = crypto.randomBytes(32).toString('hex');
        const updatedContent = envContent + `\nSESSION_SECRET=${secret}\n`;
        
        fs.writeFileSync(envPath, updatedContent);
        console.log('✅ Added SESSION_SECRET to .env');
        console.log(`   SECRET: ${secret}\n`);
    }
}

console.log('🔐 Security check complete. Starting server...\n');

