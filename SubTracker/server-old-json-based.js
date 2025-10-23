const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const RECEIVER_URL = process.env.RECEIVER_URL || 'http://localhost:8080';
const DATA_FILE = path.join(__dirname, 'data', 'usage-data.json');
const USERS_FILE = path.join(__dirname, 'data', 'users-data.json');

// Configure multer for CSV uploads
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Helper function to read usage data
function getUsageData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const fileData = fs.readFileSync(DATA_FILE, 'utf-8');
            return JSON.parse(fileData);
        }
    } catch (error) {
        console.error('Error reading usage data:', error);
    }
    return { adobe: [], wrapper: [] };
}

// Helper function to read users data
function getUsersData() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const fileData = fs.readFileSync(USERS_FILE, 'utf-8');
            return JSON.parse(fileData);
        }
    } catch (error) {
        console.error('Error reading users data:', error);
    }
    return { users: [], usernameMappings: {}, unmappedUsernames: [] };
}

// Helper function to save users data
function saveUsersData(data) {
    try {
        const dir = path.dirname(USERS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving users data:', error);
        throw error;
    }
}

// Parse licenses from CSV field
function parseLicenses(teamProducts) {
    if (!teamProducts || teamProducts.trim() === '') return [];
    
    return teamProducts
        .split(',')
        .map(license => license.trim())
        .map(license => license.replace(/\s*\(DIRECT.*?\)/g, '').trim())
        .filter(license => license.length > 0);
}

// Parse CSV data (handles quoted fields with commas)
function parseCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
        throw new Error('CSV file is empty or invalid');
    }
    
    // Parse a CSV line respecting quotes
    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }
    
    const headers = parseCSVLine(lines[0]);
    const users = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        
        if (values.length < headers.length) continue; // Skip incomplete rows
        
        const user = {};
        headers.forEach((header, index) => {
            user[header] = values[index] || '';
        });
        
        // Only add if email exists
        if (user['Email']) {
            users.push(user);
        }
    }
    
    return users;
}

// Routes
app.get('/', (req, res) => {
    const usersData = getUsersData();
    res.render('users', { 
        title: 'SubTracker - Users',
        users: usersData.users,
        unmappedUsernames: usersData.unmappedUsernames || []
    });
});

// Recent Activity page
app.get('/activity', (req, res) => {
    const data = getUsageData();
    res.render('index', { 
        title: 'SubTracker - Recent Activity',
        adobeCount: data.adobe.length,
        wrapperCount: data.wrapper.length
    });
});

// Get all usage data
app.get('/api/usage', (req, res) => {
    const data = getUsageData();
    res.json(data);
});

// Get recent usage data
app.get('/api/usage/recent', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const data = getUsageData();
    
    res.json({
        adobe: data.adobe.slice(-limit).reverse(),
        wrapper: data.wrapper.slice(-limit).reverse(),
        total: {
            adobe: data.adobe.length,
            wrapper: data.wrapper.length
        }
    });
});

// Get usage statistics
app.get('/api/stats', (req, res) => {
    const data = getUsageData();
    
    // Calculate stats
    const adobeStats = calculateStats(data.adobe);
    const wrapperStats = calculateStats(data.wrapper);
    
    res.json({
        adobe: adobeStats,
        wrapper: wrapperStats
    });
});

function calculateStats(records) {
    if (records.length === 0) {
        return {
            total: 0,
            today: 0,
            thisWeek: 0,
            uniqueClients: 0,
            recentActivity: []
        };
    }
    
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const today = records.filter(r => new Date(r.receivedAt || r.when) >= todayStart).length;
    const thisWeek = records.filter(r => new Date(r.receivedAt || r.when) >= weekStart).length;
    
    const clientIds = new Set(records.map(r => r.clientId).filter(Boolean));
    
    // Get recent activity (last 10)
    const recentActivity = records.slice(-10).reverse().map(r => ({
        timestamp: r.receivedAt || r.when,
        url: r.url,
        clientId: r.clientId,
        event: r.event
    }));
    
    return {
        total: records.length,
        today,
        thisWeek,
        uniqueClients: clientIds.size,
        recentActivity
    };
}

// Clear all data (useful for testing)
app.delete('/api/usage', (req, res) => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ adobe: [], wrapper: [] }, null, 2));
        res.json({ success: true, message: 'Data cleared successfully' });
    } catch (error) {
        console.error('Error clearing data:', error);
        res.status(500).json({ error: 'Failed to clear data' });
    }
});

// ============================================
// User Management API Endpoints
// ============================================

// Import users from CSV
app.post('/api/users/import', upload.single('csvFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const csvText = req.file.buffer.toString('utf-8');
        const csvUsers = parseCSV(csvText);
        
        // Get existing users data
        const usersData = getUsersData();
        const existingUsersMap = new Map(usersData.users.map(u => [u.email, u]));
        
        const importedUsers = [];
        const updatedUsers = [];
        
        csvUsers.forEach(csvUser => {
            const email = csvUser['Email'];
            const licenses = parseLicenses(csvUser['Team Products']);
            const username = email.split('@')[0]; // Extract username from email
            
            const userObj = {
                email,
                firstName: csvUser['First Name'] || '',
                lastName: csvUser['Last Name'] || '',
                adminRoles: csvUser['Admin Roles'] || '',
                userGroups: csvUser['User Groups'] || '',
                licenses,
                windowsUsernames: [username],
                lastActivity: null,
                activityCount: 0,
                importedAt: new Date().toISOString()
            };
            
            // Check if user already exists
            const existingUser = existingUsersMap.get(email);
            if (existingUser) {
                // Merge: update licenses but keep activity data
                userObj.lastActivity = existingUser.lastActivity;
                userObj.activityCount = existingUser.activityCount;
                userObj.windowsUsernames = existingUser.windowsUsernames || [username];
                userObj.importedAt = existingUser.importedAt;
                updatedUsers.push(email);
            } else {
                importedUsers.push(email);
            }
            
            existingUsersMap.set(email, userObj);
        });
        
        // Convert map back to array
        usersData.users = Array.from(existingUsersMap.values());
        
        // Rebuild username mappings
        usersData.usernameMappings = {};
        usersData.users.forEach(user => {
            user.windowsUsernames.forEach(username => {
                usersData.usernameMappings[username] = user.email;
            });
        });
        
        // Initialize unmappedUsernames if not exists
        if (!usersData.unmappedUsernames) {
            usersData.unmappedUsernames = [];
        }
        
        saveUsersData(usersData);
        
        res.json({
            success: true,
            imported: importedUsers.length,
            updated: updatedUsers.length,
            total: usersData.users.length
        });
    } catch (error) {
        console.error('Error importing users:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all users
app.get('/api/users', (req, res) => {
    try {
        const usersData = getUsersData();
        res.json(usersData);
    } catch (error) {
        console.error('Error getting users:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// Get activity for specific user
app.get('/api/users/:email/activity', (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email);
        const usageData = getUsageData();
        const usersData = getUsersData();
        
        // Find user
        const user = usersData.users.find(u => u.email === email);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Find all activity for this user's mapped usernames
        const activity = usageData.wrapper.filter(record => {
            return user.windowsUsernames.includes(record.windowsUser);
        });
        
        res.json({
            user,
            activity: activity.reverse()
        });
    } catch (error) {
        console.error('Error getting user activity:', error);
        res.status(500).json({ error: 'Failed to get user activity' });
    }
});

// Update user information
app.put('/api/users/update', (req, res) => {
    try {
        const { oldEmail, email, firstName, lastName, windowsUsernames, licenses, adminRoles, userGroups } = req.body;
        
        if (!email || !firstName || !lastName) {
            return res.status(400).json({ error: 'Email, first name, and last name are required' });
        }
        
        const usersData = getUsersData();
        
        // Find user by old email
        const userIndex = usersData.users.findIndex(u => u.email === oldEmail);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Check if new email already exists (if email changed)
        if (email !== oldEmail) {
            const emailExists = usersData.users.some(u => u.email === email);
            if (emailExists) {
                return res.status(400).json({ error: 'Email already exists' });
            }
        }
        
        // Update user data
        const user = usersData.users[userIndex];
        user.email = email;
        user.firstName = firstName;
        user.lastName = lastName;
        
        if (windowsUsernames && Array.isArray(windowsUsernames)) {
            user.windowsUsernames = windowsUsernames;
        }
        
        if (licenses && Array.isArray(licenses)) {
            user.licenses = licenses;
        }
        
        // Update optional fields
        if (adminRoles !== undefined) {
            user.adminRoles = adminRoles;
        }
        
        if (userGroups !== undefined) {
            user.userGroups = userGroups;
        }
        
        // Update username mappings if email changed
        if (email !== oldEmail) {
            // Remove old mappings
            Object.keys(usersData.usernameMappings).forEach(username => {
                if (usersData.usernameMappings[username] === oldEmail) {
                    delete usersData.usernameMappings[username];
                }
            });
            
            // Add new mappings
            user.windowsUsernames.forEach(username => {
                usersData.usernameMappings[username] = email;
            });
        }
        
        saveUsersData(usersData);
        
        res.json({
            success: true,
            user,
            message: 'User updated successfully'
        });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Manual username mapping
app.post('/api/users/mapping', (req, res) => {
    try {
        const { username, email } = req.body;
        
        if (!username || !email) {
            return res.status(400).json({ error: 'Username and email are required' });
        }
        
        const usersData = getUsersData();
        
        // Find user
        const user = usersData.users.find(u => u.email === email);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Add username to user's mapped usernames
        if (!user.windowsUsernames.includes(username)) {
            user.windowsUsernames.push(username);
        }
        
        // Add to mappings
        usersData.usernameMappings[username] = email;
        
        // Remove from unmapped list
        usersData.unmappedUsernames = usersData.unmappedUsernames.filter(
            u => u.username !== username
        );
        
        // Retroactively update activity
        const usageData = getUsageData();
        const userActivity = usageData.wrapper.filter(r => r.windowsUser === username);
        
        if (userActivity.length > 0) {
            user.activityCount = (user.activityCount || 0) + userActivity.length;
            user.lastActivity = userActivity[userActivity.length - 1].when || 
                               userActivity[userActivity.length - 1].receivedAt;
        }
        
        saveUsersData(usersData);
        
        res.json({
            success: true,
            message: `Mapped ${username} to ${email}`,
            retroactiveActivity: userActivity.length
        });
    } catch (error) {
        console.error('Error mapping username:', error);
        res.status(500).json({ error: 'Failed to map username' });
    }
});

// Clear user data
app.delete('/api/users', (req, res) => {
    try {
        const emptyData = { users: [], usernameMappings: {}, unmappedUsernames: [] };
        saveUsersData(emptyData);
        res.json({ success: true, message: 'Users data cleared successfully' });
    } catch (error) {
        console.error('Error clearing users:', error);
        res.status(500).json({ error: 'Failed to clear users' });
    }
});

// ============================================
// Microsoft Graph API Integration
// ============================================

// Feature flag for Azure Sync
const AZURE_SYNC_ENABLED = process.env.ENABLE_AZURE_SYNC === 'true';

let cca, cron, ConfidentialClientApplication, Client;

if (AZURE_SYNC_ENABLED) {
    ConfidentialClientApplication = require('@azure/msal-node').ConfidentialClientApplication;
    Client = require('@microsoft/microsoft-graph-client').Client;
    cron = require('node-cron');
}

const AZURE_CONFIG_FILE = path.join(__dirname, 'data', 'azure-sync-config.json');

// MSAL configuration (only if Azure Sync is enabled)
if (AZURE_SYNC_ENABLED) {
const msalConfig = {
    auth: {
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`
    },
    system: {
        loggerOptions: {
            loggerCallback(loglevel, message, containsPii) {
                console.log(message);
            },
            piiLoggingEnabled: false,
            logLevel: 3,
        }
    }
};

    cca = new ConfidentialClientApplication(msalConfig);
}

// Helper: Get Graph API Client
async function getGraphClient() {
    if (!AZURE_SYNC_ENABLED) {
        throw new Error('Azure Sync is disabled. Set ENABLE_AZURE_SYNC=true in .env to enable.');
    }
    try {
        const clientCredentialRequest = {
            scopes: ['https://graph.microsoft.com/.default'],
        };
        const response = await cca.acquireTokenByClientCredential(clientCredentialRequest);
        return Client.init({
            authProvider: (done) => {
                done(null, response.accessToken);
            }
        });
    } catch (error) {
        console.error('Error getting Graph client:', error);
        throw error;
    }
}

// Helper: Load Azure Sync Configuration
function loadAzureSyncConfig() {
    try {
        if (fs.existsSync(AZURE_CONFIG_FILE)) {
            const fileData = fs.readFileSync(AZURE_CONFIG_FILE, 'utf-8');
            return JSON.parse(fileData);
        }
    } catch (error) {
        console.error('Error reading Azure sync config:', error);
    }
    // Return default config if file doesn't exist
    return {
        inactiveDaysThreshold: 90,
        activeGroupId: null,
        inactiveGroupId: null,
        autoSyncEnabled: false,
        autoSyncSchedule: '0 0 * * 0',
        lastSyncDate: null,
        lastSyncResults: null
    };
}

// Helper: Save Azure Sync Configuration
function saveAzureSyncConfig(config) {
    try {
        const dir = path.dirname(AZURE_CONFIG_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(AZURE_CONFIG_FILE, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving Azure sync config:', error);
        throw error;
    }
}

// ============================================
// Azure Sync API Endpoints
// ============================================

// Check if Azure Sync is enabled
app.get('/api/azure/enabled', (req, res) => {
    res.json({ enabled: AZURE_SYNC_ENABLED });
});

// Test Graph API connection and permissions
app.get('/api/azure/test-connection', async (req, res) => {
    if (!AZURE_SYNC_ENABLED) {
        return res.status(503).json({
            success: false,
            connected: false,
            error: 'Azure Sync is disabled',
            message: 'Azure Sync feature is currently disabled. Set ENABLE_AZURE_SYNC=true in .env to enable.'
        });
    }
    
    try {
        const graphClient = await getGraphClient();
        
        // Test reading users
        await graphClient.api('/users').top(1).select('id,mail').get();
        
        // Test reading groups
        await graphClient.api('/groups').top(1).select('id,displayName').get();
        
        res.json({
            success: true,
            connected: true,
            message: 'Graph API connected successfully',
            permissions: ['User.Read.All', 'Group.ReadWrite.All']
        });
    } catch (error) {
        console.error('Graph API connection test failed:', error);
        res.status(500).json({
            success: false,
            connected: false,
            error: error.message,
            message: 'Failed to connect to Graph API. Check permissions and credentials.'
        });
    }
});

// Get Azure sync configuration
app.get('/api/azure/config', (req, res) => {
    if (!AZURE_SYNC_ENABLED) {
        return res.status(503).json({ error: 'Azure Sync is disabled' });
    }
    try {
        const config = loadAzureSyncConfig();
        res.json(config);
    } catch (error) {
        console.error('Error getting Azure config:', error);
        res.status(500).json({ error: 'Failed to load configuration' });
    }
});

// Update Azure sync configuration
app.put('/api/azure/config', (req, res) => {
    if (!AZURE_SYNC_ENABLED) {
        return res.status(503).json({ error: 'Azure Sync is disabled' });
    }
    try {
        const config = loadAzureSyncConfig();
        
        // Update allowed fields
        if (req.body.inactiveDaysThreshold !== undefined) {
            config.inactiveDaysThreshold = parseInt(req.body.inactiveDaysThreshold);
        }
        if (req.body.autoSyncEnabled !== undefined) {
            config.autoSyncEnabled = req.body.autoSyncEnabled;
        }
        if (req.body.autoSyncSchedule !== undefined) {
            config.autoSyncSchedule = req.body.autoSyncSchedule;
        }
        
        saveAzureSyncConfig(config);
        
        // Reschedule auto-sync if enabled
        scheduleAutoSync();
        
        res.json({
            success: true,
            config
        });
    } catch (error) {
        console.error('Error updating Azure config:', error);
        res.status(500).json({ error: 'Failed to update configuration' });
    }
});

// Create Active Users Group
app.post('/api/azure/groups/create-active', async (req, res) => {
    if (!AZURE_SYNC_ENABLED) {
        return res.status(503).json({ error: 'Azure Sync is disabled' });
    }
    try {
        const { groupName, description } = req.body;
        const usersData = getUsersData();
        
        if (usersData.users.length === 0) {
            return res.status(400).json({ 
                error: 'No users imported. Please import Adobe users first.' 
            });
        }
        
        const graphClient = await getGraphClient();
        
        // Create the security group
        const newGroup = await graphClient.api('/groups').post({
            displayName: groupName || 'Adobe-Active-Users',
            description: description || 'Users with active Adobe licenses being monitored',
            mailNickname: (groupName || 'AdobeActiveUsers').replace(/[^a-zA-Z0-9]/g, ''),
            securityEnabled: true,
            mailEnabled: false,
            groupTypes: []
        });
        
        console.log(`Created group: ${newGroup.displayName} (${newGroup.id})`);
        
        // Save group ID to config
        const config = loadAzureSyncConfig();
        config.activeGroupId = newGroup.id;
        saveAzureSyncConfig(config);
        
        // Add all licensed users to the group
        let addedCount = 0;
        let failedUsers = [];
        
        for (const user of usersData.users) {
            try {
                // Get Azure AD user ID from email
                const azureUser = await graphClient.api('/users')
                    .filter(`mail eq '${user.email}' or userPrincipalName eq '${user.email}'`)
                    .select('id,mail,userPrincipalName')
                    .get();
                
                if (azureUser.value && azureUser.value.length > 0) {
                    const userId = azureUser.value[0].id;
                    
                    // Add user to group
                    await graphClient.api(`/groups/${newGroup.id}/members/$ref`).post({
                        '@odata.id': `https://graph.microsoft.com/v1.0/users/${userId}`
                    });
                    
                    addedCount++;
                    console.log(`Added ${user.email} to group`);
                } else {
                    failedUsers.push({ email: user.email, reason: 'User not found in Azure AD' });
                }
                
                // Rate limiting: wait 100ms between requests
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`Failed to add ${user.email}:`, error.message);
                failedUsers.push({ email: user.email, reason: error.message });
            }
        }
        
        res.json({
            success: true,
            group: {
                id: newGroup.id,
                displayName: newGroup.displayName,
                description: newGroup.description
            },
            usersAdded: addedCount,
            usersFailed: failedUsers.length,
            failedUsers: failedUsers,
            total: usersData.users.length
        });
        
    } catch (error) {
        console.error('Error creating active group:', error);
        res.status(500).json({ 
            error: error.message,
            details: error.body || error
        });
    }
});

// Create Inactive Users Group
app.post('/api/azure/groups/create-inactive', async (req, res) => {
    if (!AZURE_SYNC_ENABLED) {
        return res.status(503).json({ error: 'Azure Sync is disabled' });
    }
    try {
        const { groupName, description } = req.body;
        const graphClient = await getGraphClient();
        
        // Create the security group (empty initially)
        const newGroup = await graphClient.api('/groups').post({
            displayName: groupName || 'Adobe-Inactive-Users',
            description: description || 'Users with inactive Adobe licenses to be removed',
            mailNickname: (groupName || 'AdobeInactiveUsers').replace(/[^a-zA-Z0-9]/g, ''),
            securityEnabled: true,
            mailEnabled: false,
            groupTypes: []
        });
        
        console.log(`Created group: ${newGroup.displayName} (${newGroup.id})`);
        
        // Save group ID to config
        const config = loadAzureSyncConfig();
        config.inactiveGroupId = newGroup.id;
        saveAzureSyncConfig(config);
        
        res.json({
            success: true,
            group: {
                id: newGroup.id,
                displayName: newGroup.displayName,
                description: newGroup.description
            }
        });
        
    } catch (error) {
        console.error('Error creating inactive group:', error);
        res.status(500).json({ 
            error: error.message,
            details: error.body || error
        });
    }
});

// Preview inactive users
app.get('/api/azure/users/preview-inactive', (req, res) => {
    if (!AZURE_SYNC_ENABLED) {
        return res.status(503).json({ error: 'Azure Sync is disabled' });
    }
    try {
        const config = loadAzureSyncConfig();
        const inactiveDays = parseInt(req.query.days) || config.inactiveDaysThreshold;
        const usersData = getUsersData();
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);
        
        const inactiveUsers = usersData.users.filter(user => {
            if (!user.lastActivity) return true; // Never active
            return new Date(user.lastActivity) < cutoffDate;
        });
        
        const activeUsers = usersData.users.filter(user => {
            if (!user.lastActivity) return false;
            return new Date(user.lastActivity) >= cutoffDate;
        });
        
        res.json({
            inactiveDays,
            cutoffDate: cutoffDate.toISOString(),
            totalUsers: usersData.users.length,
            activeCount: activeUsers.length,
            inactiveCount: inactiveUsers.length,
            inactiveUsers: inactiveUsers.map(u => ({
                email: u.email,
                firstName: u.firstName,
                lastName: u.lastName,
                lastActivity: u.lastActivity,
                activityCount: u.activityCount,
                daysSinceActivity: u.lastActivity 
                    ? Math.floor((Date.now() - new Date(u.lastActivity)) / (1000 * 60 * 60 * 24))
                    : 'Never'
            }))
        });
        
    } catch (error) {
        console.error('Error previewing inactive users:', error);
        res.status(500).json({ error: 'Failed to preview inactive users' });
    }
});

// Move inactive users to inactive group
app.post('/api/azure/users/move-inactive', async (req, res) => {
    if (!AZURE_SYNC_ENABLED) {
        return res.status(503).json({ error: 'Azure Sync is disabled' });
    }
    try {
        const config = loadAzureSyncConfig();
        const { dryRun } = req.body;
        const activeGroupId = config.activeGroupId;
        const inactiveGroupId = config.inactiveGroupId;
        
        if (!activeGroupId || !inactiveGroupId) {
            return res.status(400).json({ 
                error: 'Both active and inactive groups must be created first' 
            });
        }
        
        const usersData = getUsersData();
        const graphClient = await getGraphClient();
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - config.inactiveDaysThreshold);
        
        let movedCount = 0;
        let inactiveUsers = [];
        let errors = [];
        
        // Identify inactive users
        for (const user of usersData.users) {
            const lastActivity = user.lastActivity ? new Date(user.lastActivity) : null;
            
            if (!lastActivity || lastActivity < cutoffDate) {
                // User is inactive
                try {
                    // Get Azure AD user ID
                    const azureUser = await graphClient.api('/users')
                        .filter(`mail eq '${user.email}' or userPrincipalName eq '${user.email}'`)
                        .select('id,mail,userPrincipalName')
                        .get();
                    
                    if (azureUser.value && azureUser.value.length > 0) {
                        const userId = azureUser.value[0].id;
                        
                        if (!dryRun) {
                            // Remove from active group
                            try {
                                await graphClient.api(`/groups/${activeGroupId}/members/${userId}/$ref`).delete();
                                console.log(`Removed ${user.email} from active group`);
                            } catch (e) {
                                console.log(`User ${user.email} not in active group or already removed`);
                            }
                            
                            // Add to inactive group
                            await graphClient.api(`/groups/${inactiveGroupId}/members/$ref`).post({
                                '@odata.id': `https://graph.microsoft.com/v1.0/users/${userId}`
                            });
                            
                            console.log(`Added ${user.email} to inactive group`);
                        }
                        
                        movedCount++;
                        inactiveUsers.push({
                            email: user.email,
                            lastActivity: user.lastActivity,
                            activityCount: user.activityCount
                        });
                    }
                    
                    // Rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    console.error(`Failed to move ${user.email}:`, error.message);
                    errors.push({ email: user.email, error: error.message });
                }
            }
        }
        
        // Update sync results in config
        const syncResults = {
            date: new Date().toISOString(),
            movedCount,
            inactiveUsers,
            errors,
            dryRun
        };
        
        if (!dryRun) {
            config.lastSyncDate = syncResults.date;
            config.lastSyncResults = syncResults;
            saveAzureSyncConfig(config);
        }
        
        res.json({
            success: true,
            dryRun,
            movedCount,
            inactiveUsers,
            errors,
            inactiveDays: config.inactiveDaysThreshold,
            cutoffDate: cutoffDate.toISOString()
        });
        
    } catch (error) {
        console.error('Error moving inactive users:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Auto-Sync Scheduling
// ============================================

let scheduledTask = null;

function scheduleAutoSync() {
    if (!AZURE_SYNC_ENABLED) {
        console.log('Auto-sync disabled: Azure Sync feature is disabled');
        return;
    }
    
    // Clear existing task
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }
    
    const config = loadAzureSyncConfig();
    
    if (config.autoSyncEnabled && config.autoSyncSchedule) {
        console.log(`Scheduling auto-sync with schedule: ${config.autoSyncSchedule}`);
        
        scheduledTask = cron.schedule(config.autoSyncSchedule, async () => {
            console.log('Running scheduled auto-sync...');
            
            try {
                // Only move users if both groups are configured
                if (config.activeGroupId && config.inactiveGroupId) {
                    const usersData = getUsersData();
                    const graphClient = await getGraphClient();
                    
                    const cutoffDate = new Date();
                    cutoffDate.setDate(cutoffDate.getDate() - config.inactiveDaysThreshold);
                    
                    let movedCount = 0;
                    
                    for (const user of usersData.users) {
                        const lastActivity = user.lastActivity ? new Date(user.lastActivity) : null;
                        
                        if (!lastActivity || lastActivity < cutoffDate) {
                            try {
                                const azureUser = await graphClient.api('/users')
                                    .filter(`mail eq '${user.email}' or userPrincipalName eq '${user.email}'`)
                                    .select('id')
                                    .get();
                                
                                if (azureUser.value && azureUser.value.length > 0) {
                                    const userId = azureUser.value[0].id;
                                    
                                    try {
                                        await graphClient.api(`/groups/${config.activeGroupId}/members/${userId}/$ref`).delete();
                                    } catch (e) {
                                        // User might not be in group
                                    }
                                    
                                    await graphClient.api(`/groups/${config.inactiveGroupId}/members/$ref`).post({
                                        '@odata.id': `https://graph.microsoft.com/v1.0/users/${userId}`
                                    });
                                    
                                    movedCount++;
                                }
                                
                                await new Promise(resolve => setTimeout(resolve, 100));
                            } catch (error) {
                                console.error(`Auto-sync error for ${user.email}:`, error.message);
                            }
                        }
                    }
                    
                    console.log(`Auto-sync completed. Moved ${movedCount} users to inactive group.`);
                    
                    // Save results
                    config.lastSyncDate = new Date().toISOString();
                    config.lastSyncResults = {
                        date: config.lastSyncDate,
                        movedCount,
                        auto: true
                    };
                    saveAzureSyncConfig(config);
                } else {
                    console.log('Auto-sync skipped: Groups not configured');
                }
            } catch (error) {
                console.error('Auto-sync failed:', error);
            }
        });
        
        console.log('Auto-sync scheduled successfully');
    }
}

// Initialize auto-sync on server start
scheduleAutoSync();

app.listen(PORT, () => {
    console.log(`SubTracker server running on http://localhost:${PORT}`);
    console.log(`Monitoring data from receiver at ${RECEIVER_URL}`);
    
    if (AZURE_SYNC_ENABLED) {
        console.log('Azure Sync features: ENABLED');
        const config = loadAzureSyncConfig();
        if (config.autoSyncEnabled) {
            console.log(`Auto-sync ENABLED with schedule: ${config.autoSyncSchedule}`);
        }
    } else {
        console.log('Azure Sync features: DISABLED (set ENABLE_AZURE_SYNC=true in .env to enable)');
    }
});
