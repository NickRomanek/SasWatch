// Azure Sync JavaScript
// Handles UI interactions for Azure security group synchronization

let azureConfig = null;
let inactivePreviewData = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Check if Azure Sync is enabled
    const enabled = await checkAzureSyncEnabled();
    if (!enabled) {
        hideAzureSyncSection();
        return;
    }
    
    checkAzureConnection();
    loadAzureConfig();
    loadSyncHistory();
});

// Check if Azure Sync feature is enabled
async function checkAzureSyncEnabled() {
    try {
        const response = await fetch('/api/azure/enabled');
        const result = await response.json();
        return result.enabled;
    } catch (error) {
        console.error('Failed to check Azure Sync status:', error);
        return false;
    }
}

// Hide the entire Azure Sync section
function hideAzureSyncSection() {
    const section = document.querySelector('.azure-sync-section');
    if (section) {
        section.style.display = 'none';
    }
}

// ============================================
// Connection and Configuration
// ============================================

async function checkAzureConnection() {
    const statusEl = document.getElementById('connection-status');
    const indicatorEl = document.querySelector('.status-indicator');
    
    try {
        const response = await fetch('/api/azure/test-connection');
        const result = await response.json();
        
        if (result.success && result.connected) {
            statusEl.textContent = '✓ Connected to Microsoft Graph API';
            statusEl.className = 'status-text status-connected';
            indicatorEl.className = 'status-indicator connected';
        } else {
            statusEl.textContent = '✗ Not connected - Check credentials and permissions';
            statusEl.className = 'status-text status-disconnected';
            indicatorEl.className = 'status-indicator disconnected';
        }
    } catch (error) {
        console.error('Connection test failed:', error);
        statusEl.textContent = '✗ Connection failed';
        statusEl.className = 'status-text status-disconnected';
        indicatorEl.className = 'status-indicator disconnected';
    }
}

async function loadAzureConfig() {
    try {
        const response = await fetch('/api/azure/config');
        azureConfig = await response.json();
        
        // Populate form fields
        document.getElementById('inactive-threshold').value = azureConfig.inactiveDaysThreshold;
        document.getElementById('auto-sync-enabled').checked = azureConfig.autoSyncEnabled;
        
        // Update group status
        if (azureConfig.activeGroupId) {
            document.getElementById('active-group-status').innerHTML = 
                `<span class="status-badge status-success">✓ Created (ID: ${azureConfig.activeGroupId.substring(0, 8)}...)</span>`;
            document.getElementById('active-group-name').disabled = true;
        }
        
        if (azureConfig.inactiveGroupId) {
            document.getElementById('inactive-group-status').innerHTML = 
                `<span class="status-badge status-success">✓ Created (ID: ${azureConfig.inactiveGroupId.substring(0, 8)}...)</span>`;
            document.getElementById('inactive-group-name').disabled = true;
        }
        
        // Update preview
        await updateInactivePreview();
        
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

async function saveAzureConfig() {
    const threshold = parseInt(document.getElementById('inactive-threshold').value);
    const autoSync = document.getElementById('auto-sync-enabled').checked;
    
    if (threshold < 30 || threshold > 365) {
        alert('Inactive threshold must be between 30 and 365 days');
        return;
    }
    
    try {
        const response = await fetch('/api/azure/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inactiveDaysThreshold: threshold,
                autoSyncEnabled: autoSync
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            azureConfig = result.config;
            showNotification('✓ Settings saved successfully', 'success');
            await updateInactivePreview();
        } else {
            throw new Error('Failed to save settings');
        }
    } catch (error) {
        console.error('Save config error:', error);
        showNotification('✗ Failed to save settings: ' + error.message, 'error');
    }
}

// ============================================
// Group Management
// ============================================

async function createActiveGroup() {
    const groupName = document.getElementById('active-group-name').value || 'Adobe-Active-Users';
    const button = event.target;
    
    if (!confirm(`Create security group "${groupName}" and add all imported users?`)) {
        return;
    }
    
    button.disabled = true;
    button.textContent = 'Creating...';
    
    try {
        const response = await fetch('/api/azure/groups/create-active', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                groupName,
                description: 'Users with active Adobe licenses being monitored'
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(
                `✓ Created "${result.group.displayName}" with ${result.usersAdded} users`,
                'success'
            );
            
            if (result.failedUsers.length > 0) {
                console.warn('Failed users:', result.failedUsers);
                showNotification(
                    `⚠ ${result.failedUsers.length} users could not be added. Check console for details.`,
                    'warning'
                );
            }
            
            await loadAzureConfig();
        } else {
            throw new Error(result.error || 'Failed to create group');
        }
    } catch (error) {
        console.error('Create group error:', error);
        showNotification('✗ Failed to create group: ' + error.message, 'error');
        button.disabled = false;
        button.textContent = 'Create Active Group';
    }
}

async function createInactiveGroup() {
    const groupName = document.getElementById('inactive-group-name').value || 'Adobe-Inactive-Users';
    const button = event.target;
    
    if (!confirm(`Create security group "${groupName}" for inactive users?`)) {
        return;
    }
    
    button.disabled = true;
    button.textContent = 'Creating...';
    
    try {
        const response = await fetch('/api/azure/groups/create-inactive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                groupName,
                description: 'Users with inactive Adobe licenses to be removed'
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(
                `✓ Created "${result.group.displayName}"`,
                'success'
            );
            await loadAzureConfig();
        } else {
            throw new Error(result.error || 'Failed to create group');
        }
    } catch (error) {
        console.error('Create group error:', error);
        showNotification('✗ Failed to create group: ' + error.message, 'error');
        button.disabled = false;
        button.textContent = 'Create Inactive Group';
    }
}

// ============================================
// Inactive Users Management
// ============================================

async function updateInactivePreview() {
    const previewEl = document.getElementById('inactive-preview');
    
    try {
        const threshold = azureConfig?.inactiveDaysThreshold || 90;
        const response = await fetch(`/api/azure/users/preview-inactive?days=${threshold}`);
        inactivePreviewData = await response.json();
        
        previewEl.innerHTML = `
            <strong>${inactivePreviewData.inactiveCount}</strong> users inactive for ${threshold}+ days
            <span class="preview-detail">(${inactivePreviewData.activeCount} active)</span>
        `;
    } catch (error) {
        console.error('Preview error:', error);
        previewEl.textContent = 'Error loading preview';
    }
}

async function previewInactive() {
    if (!inactivePreviewData || inactivePreviewData.inactiveCount === 0) {
        alert('No inactive users to preview');
        return;
    }
    
    // Create modal with user list
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Inactive Users Preview</h2>
                <button class="modal-close" onclick="this.closest('.modal').remove()">×</button>
            </div>
            <div class="modal-body">
                <p>The following <strong>${inactivePreviewData.inactiveCount}</strong> users have been inactive for more than <strong>${inactivePreviewData.inactiveDays}</strong> days:</p>
                <table class="preview-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Last Activity</th>
                            <th>Days Inactive</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${inactivePreviewData.inactiveUsers.map(user => `
                            <tr>
                                <td>${user.firstName} ${user.lastName}</td>
                                <td>${user.email}</td>
                                <td>${user.lastActivity ? new Date(user.lastActivity).toLocaleDateString() : 'Never'}</td>
                                <td>${user.daysSinceActivity}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Close</button>
                <button class="btn btn-primary" onclick="this.closest('.modal').remove(); moveInactive();">Proceed to Move</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

async function moveInactive() {
    if (!azureConfig.activeGroupId || !azureConfig.inactiveGroupId) {
        alert('Please create both Active and Inactive groups first');
        return;
    }
    
    if (!inactivePreviewData || inactivePreviewData.inactiveCount === 0) {
        alert('No inactive users to move');
        return;
    }
    
    const confirmMsg = `Move ${inactivePreviewData.inactiveCount} inactive users from Active to Inactive group?\n\n` +
                       `This will:\n` +
                       `- Remove them from the Active group\n` +
                       `- Add them to the Inactive group\n` +
                       `- Trigger Intune to deploy the uninstall script\n\n` +
                       `This action cannot be easily undone.`;
    
    if (!confirm(confirmMsg)) {
        return;
    }
    
    const button = event.target;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Moving users...';
    
    try {
        const response = await fetch('/api/azure/users/move-inactive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dryRun: false
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(
                `✓ Successfully moved ${result.movedCount} users to inactive group`,
                'success'
            );
            
            if (result.errors.length > 0) {
                console.warn('Errors during move:', result.errors);
                showNotification(
                    `⚠ ${result.errors.length} users encountered errors. Check console for details.`,
                    'warning'
                );
            }
            
            // Refresh data
            await loadAzureConfig();
            loadSyncHistory();
        } else {
            throw new Error(result.error || 'Failed to move users');
        }
    } catch (error) {
        console.error('Move users error:', error);
        showNotification('✗ Failed to move users: ' + error.message, 'error');
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
}

// ============================================
// Sync History
// ============================================

async function loadSyncHistory() {
    try {
        const response = await fetch('/api/azure/config');
        const config = await response.json();
        
        const resultsEl = document.getElementById('sync-results');
        
        if (config.lastSyncResults) {
            const result = config.lastSyncResults;
            const date = new Date(result.date).toLocaleString();
            const dryRunLabel = result.dryRun ? ' (Dry Run)' : '';
            
            resultsEl.innerHTML = `
                <div class="sync-result-item">
                    <div class="sync-result-header">
                        <strong>Last Sync:</strong> ${date}${dryRunLabel}
                        ${result.auto ? '<span class="sync-badge">AUTO</span>' : '<span class="sync-badge">MANUAL</span>'}
                    </div>
                    <div class="sync-result-details">
                        <span class="sync-stat">Users Moved: <strong>${result.movedCount}</strong></span>
                        ${result.errors && result.errors.length > 0 ? 
                            `<span class="sync-stat sync-error">Errors: <strong>${result.errors.length}</strong></span>` : 
                            ''}
                    </div>
                </div>
            `;
        } else {
            resultsEl.innerHTML = '<p class="no-sync-history">No sync history yet</p>';
        }
    } catch (error) {
        console.error('Failed to load sync history:', error);
    }
}

// ============================================
// UI Helpers
// ============================================

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Fade in
    setTimeout(() => notification.classList.add('show'), 10);
    
    // Remove after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

