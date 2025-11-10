// Migration Script: JSON to PostgreSQL
// Migrates existing JSON data files to PostgreSQL database

const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');

const USERS_FILE = path.join(__dirname, '../data/users-data.json');
const USAGE_FILE = path.join(__dirname, '../data/usage-data.json');

async function migrateUsers() {
    console.log('\n📥 Migrating users from JSON...');
    
    if (!fs.existsSync(USERS_FILE)) {
        console.log('⚠️  No users-data.json file found, skipping user migration');
        return { imported: 0, failed: 0 };
    }
    
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    let imported = 0;
    let failed = 0;
    
    for (const user of data.users || []) {
        try {
            // Create user
            const createdUser = await prisma.user.create({
                data: {
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    adminRoles: user.adminRoles || null,
                    userGroups: user.userGroups || null,
                    licenses: user.licenses || [],
                    lastActivity: user.lastActivity ? new Date(user.lastActivity) : null,
                    activityCount: user.activityCount || 0,
                    importedAt: user.importedAt ? new Date(user.importedAt) : new Date(),
                }
            });
            
            // Create Windows username mappings
            if (user.windowsUsernames && user.windowsUsernames.length > 0) {
                for (const username of user.windowsUsernames) {
                    await prisma.windowsUsername.create({
                        data: {
                            username,
                            userId: createdUser.id
                        }
                    });
                }
            }
            
            imported++;
            console.log(`  ✓ Migrated: ${user.email} (${user.windowsUsernames?.length || 0} usernames)`);
        } catch (error) {
            failed++;
            console.error(`  ✗ Failed: ${user.email} - ${error.message}`);
        }
    }
    
    // Migrate unmapped usernames
    if (data.unmappedUsernames && data.unmappedUsernames.length > 0) {
        for (const unmapped of data.unmappedUsernames) {
            try {
                await prisma.unmappedUsername.create({
                    data: {
                        username: unmapped.username,
                        activityCount: unmapped.activityCount || 0,
                        firstSeen: unmapped.firstSeen ? new Date(unmapped.firstSeen) : new Date(),
                        lastSeen: unmapped.lastSeen ? new Date(unmapped.lastSeen) : new Date(),
                    }
                });
                console.log(`  ✓ Migrated unmapped: ${unmapped.username}`);
            } catch (error) {
                console.error(`  ✗ Failed unmapped: ${unmapped.username} - ${error.message}`);
            }
        }
    }
    
    return { imported, failed };
}

async function migrateUsageEvents() {
    console.log('\n📥 Migrating usage events from JSON...');
    
    if (!fs.existsSync(USAGE_FILE)) {
        console.log('⚠️  No usage-data.json file found, skipping usage migration');
        return { imported: 0, failed: 0 };
    }
    
    const data = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
    let imported = 0;
    let failed = 0;
    
    // Migrate Adobe events
    if (data.adobe && data.adobe.length > 0) {
        console.log(`  Migrating ${data.adobe.length} Adobe events...`);
        for (const event of data.adobe) {
            try {
                await prisma.usageEvent.create({
                    data: {
                        event: event.event,
                        url: event.url,
                        tabId: event.tabId,
                        clientId: event.clientId,
                        why: event.why,
                        when: new Date(event.when),
                        receivedAt: event.receivedAt ? new Date(event.receivedAt) : new Date(),
                        windowsUser: event.windowsUser || null,
                        userDomain: event.userDomain || null,
                        computerName: event.computerName || null,
                        source: 'adobe'
                    }
                });
                imported++;
                
                if (imported % 100 === 0) {
                    console.log(`  Progress: ${imported} events migrated...`);
                }
            } catch (error) {
                failed++;
                if (failed < 10) { // Only log first 10 errors to avoid spam
                    console.error(`  ✗ Failed event: ${error.message}`);
                }
            }
        }
    }
    
    // Migrate Wrapper events
    if (data.wrapper && data.wrapper.length > 0) {
        console.log(`  Migrating ${data.wrapper.length} Wrapper events...`);
        for (const event of data.wrapper) {
            try {
                await prisma.usageEvent.create({
                    data: {
                        event: event.event,
                        url: event.url,
                        tabId: event.tabId,
                        clientId: event.clientId,
                        why: event.why,
                        when: new Date(event.when),
                        receivedAt: event.receivedAt ? new Date(event.receivedAt) : new Date(),
                        windowsUser: event.windowsUser || null,
                        userDomain: event.userDomain || null,
                        computerName: event.computerName || null,
                        source: 'wrapper'
                    }
                });
                imported++;
                
                if (imported % 100 === 0) {
                    console.log(`  Progress: ${imported} events migrated...`);
                }
            } catch (error) {
                failed++;
                if (failed < 10) {
                    console.error(`  ✗ Failed event: ${error.message}`);
                }
            }
        }
    }
    
    return { imported, failed };
}

async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('  SubTracker: JSON to PostgreSQL Migration');
    console.log('═══════════════════════════════════════════');
    
    try {
        // Test database connection
        await prisma.$connect();
        console.log('✓ Database connection successful');
        
        // Migrate users
        const userResults = await migrateUsers();
        
        // Migrate usage events
        const eventResults = await migrateUsageEvents();
        
        // Summary
        console.log('\n═══════════════════════════════════════════');
        console.log('  Migration Summary');
        console.log('═══════════════════════════════════════════');
        console.log(`Users:        ${userResults.imported} imported, ${userResults.failed} failed`);
        console.log(`Usage Events: ${eventResults.imported} imported, ${eventResults.failed} failed`);
        console.log('═══════════════════════════════════════════\n');
        
        if (userResults.failed === 0 && eventResults.failed === 0) {
            console.log('✓ Migration completed successfully!\n');
            
            // Backup JSON files
            console.log('💾 Creating backup of JSON files...');
            const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            if (fs.existsSync(USERS_FILE)) {
                fs.copyFileSync(USERS_FILE, `${USERS_FILE}.backup-${timestamp}`);
                console.log(`  ✓ Backed up: users-data.json.backup-${timestamp}`);
            }
            if (fs.existsSync(USAGE_FILE)) {
                fs.copyFileSync(USAGE_FILE, `${USAGE_FILE}.backup-${timestamp}`);
                console.log(`  ✓ Backed up: usage-data.json.backup-${timestamp}`);
            }
            console.log('\n✓ Backups created. You can now safely delete the JSON files if desired.');
        } else {
            console.log('⚠️  Migration completed with some errors. Please review the logs above.\n');
        }
        
    } catch (error) {
        console.error('\n✗ Migration failed:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

// Run migration
main();

