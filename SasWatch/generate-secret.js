#!/usr/bin/env node
// Helper script to generate a secure SESSION_SECRET
// Run with: npm run generate-secret

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

console.log('\n🔐 SasWatch Security Setup Helper\n');
console.log('═══════════════════════════════════════════════════════════\n');

// Generate secure random secret
const secret = crypto.randomBytes(32).toString('hex');

console.log('✅ Generated secure SESSION_SECRET:\n');
console.log(`   ${secret}\n`);
console.log('═══════════════════════════════════════════════════════════\n');

// Check if .env exists
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, 'env.example');

if (!fs.existsSync(envPath)) {
    console.log('📄 No .env file found. Creating from env.example...\n');
    
    if (fs.existsSync(envExamplePath)) {
        // Copy env.example to .env
        let envContent = fs.readFileSync(envExamplePath, 'utf8');
        
        // Replace empty SESSION_SECRET with generated one
        envContent = envContent.replace(
            /^SESSION_SECRET=$/m, 
            `SESSION_SECRET=${secret}`
        );
        
        fs.writeFileSync(envPath, envContent);
        console.log('✅ Created .env file with SESSION_SECRET configured\n');
    } else {
        console.log('⚠️  env.example not found. Please create .env manually.\n');
    }
} else {
    console.log('📄 .env file already exists.\n');
    
    // Check if SESSION_SECRET is set
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    if (/^SESSION_SECRET=\s*$/m.test(envContent)) {
        console.log('⚠️  SESSION_SECRET is empty in .env file\n');
        console.log('   Do you want to update it? (yes/no)\n');
        
        // In a real implementation, you'd prompt for input
        // For now, just show instructions
        console.log('   To update manually, edit .env and set:\n');
        console.log(`   SESSION_SECRET=${secret}\n`);
    } else if (/^SESSION_SECRET=(.+)$/m.test(envContent)) {
        console.log('✅ SESSION_SECRET is already configured in .env\n');
        console.log('   If you want to rotate it (recommended every 90 days):\n');
        console.log(`   Replace with: ${secret}\n`);
    }
}

console.log('═══════════════════════════════════════════════════════════\n');
console.log('📋 Next Steps:\n');
console.log('   1. Copy the secret above to your .env file');
console.log('   2. Set SESSION_SECRET=<your-secret>');
console.log('   3. NEVER commit your .env file to git');
console.log('   4. Start the server with: npm start\n');
console.log('   For production deployment, set this in your hosting');
console.log('   platform\'s environment variables (Railway, Azure, etc.)\n');
console.log('═══════════════════════════════════════════════════════════\n');

