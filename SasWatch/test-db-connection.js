// Database Connection Test
// Quick test to verify PostgreSQL connection and basic operations

const db = require('./lib/database');

async function testConnection() {
    console.log('\n═══════════════════════════════════════');
    console.log('  Database Connection Test');
    console.log('═══════════════════════════════════════\n');
    
    try {
        // Test 1: Connection
        console.log('1️⃣  Testing database connection...');
        const stats = await db.getDatabaseStats();
        console.log('   ✓ Connected successfully!\n');
        
        // Test 2: Stats
        console.log('2️⃣  Database Statistics:');
        console.log(`   - Users: ${stats.users}`);
        console.log(`   - Usage Events: ${stats.usageEvents}`);
        console.log(`   - Unmapped Usernames: ${stats.unmappedUsernames}\n`);
        
        // Test 3: Query Users
        console.log('3️⃣  Testing user query...');
        const usersData = await db.getUsersData();
        console.log(`   ✓ Found ${usersData.users.length} users`);
        console.log(`   ✓ Found ${Object.keys(usersData.usernameMappings).length} username mappings`);
        
        if (usersData.users.length > 0) {
            const firstUser = usersData.users[0];
            console.log(`   ✓ Sample user: ${firstUser.firstName} ${firstUser.lastName} (${firstUser.email})\n`);
        } else {
            console.log('   ⚠️  No users in database yet. Run migration: npm run db:seed\n');
        }
        
        // Test 4: Query Usage Events
        console.log('4️⃣  Testing usage event query...');
        const usageData = await db.getUsageData(10);
        const totalEvents = usageData.adobe.length + usageData.wrapper.length;
        console.log(`   ✓ Found ${totalEvents} recent events`);
        console.log(`   - Adobe events: ${usageData.adobe.length}`);
        console.log(`   - Wrapper events: ${usageData.wrapper.length}\n`);
        
        if (totalEvents === 0) {
            console.log('   ⚠️  No events in database yet. Run migration: npm run db:seed\n');
        }
        
        // Summary
        console.log('═══════════════════════════════════════');
        console.log('  Test Summary');
        console.log('═══════════════════════════════════════');
        console.log('✅ Database connection: WORKING');
        console.log('✅ User queries: WORKING');
        console.log('✅ Usage queries: WORKING');
        
        if (stats.users === 0 || stats.usageEvents === 0) {
            console.log('\n📝 Next Step: Import your data with:');
            console.log('   npm run db:seed');
        } else {
            console.log('\n✅ Database is fully operational!');
        }
        
        console.log('═══════════════════════════════════════\n');
        
    } catch (error) {
        console.error('\n❌ Database test failed:\n');
        console.error('Error:', error.message);
        console.error('\nTroubleshooting:');
        console.error('1. Check DATABASE_URL in .env file');
        console.error('2. Ensure PostgreSQL is running (docker-compose up -d)');
        console.error('3. Run: npm run db:push (to create tables)');
        console.error('4. Run: npm run db:seed (to import data)\n');
        process.exit(1);
    } finally {
        await db.prisma.$disconnect();
    }
}

// Run the test
testConnection();

