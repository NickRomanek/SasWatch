// Global variables
let allUsers = [];
let filteredUsers = [];
let currentUserId = null;
let m365Licenses = [];

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    loadUsers();
    loadM365Licenses();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    // Search functionality
    document.getElementById('searchInput').addEventListener('input', filterUsers);
    
    // Filter dropdowns
    document.getElementById('activityFilter').addEventListener('change', filterUsers);
    document.getElementById('licenseFilter').addEventListener('change', filterUsers);
    document.getElementById('m365LicenseFilter').addEventListener('change', filterUsers);
}

// Load all users from the API
async function loadUsers() {
    try {
        showLoading(true);
        const response = await fetch('/api/users');
        allUsers = await response.json();
        
        updateStats();
        filterUsers();
        populateUserSelect();
        
    } catch (error) {
        console.error('Error loading users:', error);
        showError('Failed to load users. Please check your Azure AD configuration.');
    } finally {
        showLoading(false);
    }
}

// Load available M365 licenses
async function loadM365Licenses() {
    try {
        const response = await fetch('/api/m365-licenses');
        m365Licenses = await response.json();
        populateM365LicenseFilter();
    } catch (error) {
        console.error('Error loading M365 licenses:', error);
    }
}

// Update statistics
function updateStats() {
    const totalUsers = allUsers.length;
    const licensedUsers = allUsers.filter(user => 
        (user.m365Licenses && user.m365Licenses.length > 0) || 
        (user.customLicenses && user.customLicenses.length > 0)
    ).length;
    
    document.getElementById('totalUsers').textContent = totalUsers;
    document.getElementById('licensedUsers').textContent = licensedUsers;
    
    // Update inactive user counts (we'll fetch these separately for better performance)
    updateInactiveStats();
}

// Update inactive user statistics
async function updateInactiveStats() {
    try {
        const [inactive30, inactive90] = await Promise.all([
            fetch('/api/users/inactive?days=30').then(r => r.json()),
            fetch('/api/users/inactive?days=90').then(r => r.json())
        ]);
        
        document.getElementById('inactive30').textContent = inactive30.length;
        document.getElementById('inactive90').textContent = inactive90.length;
    } catch (error) {
        console.error('Error loading inactive stats:', error);
    }
}

// Filter users based on search and filter criteria
function filterUsers() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const activityFilter = document.getElementById('activityFilter').value;
    const licenseFilter = document.getElementById('licenseFilter').value;
    const m365LicenseFilter = document.getElementById('m365LicenseFilter').value;
    
    filteredUsers = allUsers.filter(user => {
        // Search filter
        const matchesSearch = !searchTerm || 
            user.displayName.toLowerCase().includes(searchTerm) ||
            user.userPrincipalName.toLowerCase().includes(searchTerm);
        
        // License filter
        const hasM365Licenses = user.m365Licenses && user.m365Licenses.length > 0;
        const hasCustomLicenses = user.customLicenses && user.customLicenses.length > 0;
        const hasLicenses = hasM365Licenses || hasCustomLicenses;
        
        let matchesLicenseFilter = true;
        
        if (licenseFilter === 'licensed') {
            matchesLicenseFilter = hasLicenses;
        } else if (licenseFilter === 'unlicensed') {
            matchesLicenseFilter = !hasLicenses;
        } else if (licenseFilter === 'm365-only') {
            matchesLicenseFilter = hasM365Licenses;
        } else if (licenseFilter === 'custom-only') {
            matchesLicenseFilter = hasCustomLicenses;
        }
        
        // M365 specific license filter
        let matchesM365Filter = true;
        if (m365LicenseFilter !== 'all') {
            matchesM365Filter = hasM365Licenses && 
                user.m365Licenses.some(license => license.skuId === m365LicenseFilter);
        }
        
        return matchesSearch && matchesLicenseFilter && matchesM365Filter;
    });
    
    // Apply activity filter
    if (activityFilter !== 'all') {
        const days = activityFilter.replace('inactive', '');
        filterByActivity(days);
    } else {
        renderUsers(filteredUsers);
    }
}

// Filter users by activity (async operation)
async function filterByActivity(days) {
    try {
        const response = await fetch(`/api/users/inactive?days=${days}`);
        const inactiveUsers = await response.json();
        const inactiveUserIds = new Set(inactiveUsers.map(user => user.id));
        
        const activityFilteredUsers = filteredUsers.filter(user => 
            inactiveUserIds.has(user.id)
        );
        
        renderUsers(activityFilteredUsers);
    } catch (error) {
        console.error('Error filtering by activity:', error);
        renderUsers(filteredUsers);
    }
}

// Render users in the table
function renderUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    
    if (users.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted">
                    <i class="fas fa-users fa-2x mb-2"></i>
                    <p>No users found matching the current filters.</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = users.map(user => {
        const lastSignIn = user.lastSignInDateTime ? 
            new Date(user.lastSignInDateTime).toLocaleDateString() : 'Never';
        
        const isActive = user.lastSignInDateTime && 
            (new Date() - new Date(user.lastSignInDateTime)) < (30 * 24 * 60 * 60 * 1000);
        
        const rowClass = isActive ? 'active-user' : 'inactive-user';
        
        return `
            <tr class="${rowClass}">
                <td>
                    <div class="d-flex align-items-center">
                        <div class="avatar-circle me-2">
                            <i class="fas fa-user"></i>
                        </div>
                        <div>
                            <strong>${user.displayName}</strong>
                            <br>
                            <small class="text-muted">${user.accountEnabled ? 'Enabled' : 'Disabled'}</small>
                        </div>
                    </div>
                </td>
                <td>${user.userPrincipalName}</td>
                <td>
                    <span class="badge ${user.accountEnabled ? 'bg-success' : 'bg-secondary'}">
                        ${user.accountEnabled ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>${lastSignIn}</td>
                <td>
                    ${user.m365Licenses ? user.m365Licenses.map(license => 
                        `<span class="badge bg-success license-badge me-1" title="M365: ${license.servicePlans ? license.servicePlans.length : 0} services">${license.skuPartNumber}</span>`
                    ).join('') : ''}
                    ${user.customLicenses ? user.customLicenses.map(license => 
                        `<span class="badge bg-primary license-badge me-1" title="Custom SaaS">${license.productName}</span>`
                    ).join('') : ''}
                    ${(!user.m365Licenses || user.m365Licenses.length === 0) && (!user.customLicenses || user.customLicenses.length === 0) ? 
                        '<span class="text-muted">No licenses</span>' : ''}
                </td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary" onclick="viewUserDetails('${user.id}')" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-outline-success" onclick="quickAssignLicense('${user.id}')" title="Assign License">
                            <i class="fas fa-plus"></i>
                        </button>
                        ${(user.customLicenses && user.customLicenses.length > 0) ? 
                            `<button class="btn btn-outline-danger" onclick="removeLicense('${user.id}')" title="Remove Custom License">
                                <i class="fas fa-trash"></i>
                            </button>` : ''
                        }
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Populate user select dropdown
function populateUserSelect() {
    const select = document.getElementById('userSelect');
    select.innerHTML = '<option value="">Choose a user...</option>';
    
    allUsers.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.displayName} (${user.userPrincipalName})`;
        select.appendChild(option);
    });
}

// Populate M365 license filter dropdown
function populateM365LicenseFilter() {
    const select = document.getElementById('m365LicenseFilter');
    select.innerHTML = '<option value="all">All M365 Licenses</option>';
    
    m365Licenses.forEach(license => {
        const option = document.createElement('option');
        option.value = license.skuId;
        option.textContent = `${license.skuPartNumber} (${license.consumedUnits}/${license.prepaidUnits.enabled})`;
        select.appendChild(option);
    });
}

// Assign license to user
async function assignLicense() {
    const userId = document.getElementById('userSelect').value;
    const productName = document.getElementById('productName').value;
    const assignedDate = document.getElementById('assignedDate').value;
    
    if (!userId || !productName) {
        showError('Please fill in all required fields.');
        return;
    }
    
    try {
        const response = await fetch(`/api/users/${userId}/licenses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                productName,
                assignedDate: assignedDate || new Date().toISOString()
            })
        });
        
        if (response.ok) {
            showSuccess('License assigned successfully!');
            document.getElementById('assignLicenseForm').reset();
            bootstrap.Modal.getInstance(document.getElementById('assignLicenseModal')).hide();
            loadUsers(); // Refresh the data
        } else {
            throw new Error('Failed to assign license');
        }
    } catch (error) {
        console.error('Error assigning license:', error);
        showError('Failed to assign license. Please try again.');
    }
}

// Quick assign license (pre-select user)
function quickAssignLicense(userId) {
    document.getElementById('userSelect').value = userId;
    bootstrap.Modal.getInstance(document.getElementById('assignLicenseModal')).show();
}

// Remove license from user
async function removeLicense(userId) {
    if (!confirm('Are you sure you want to remove all licenses for this user?')) {
        return;
    }
    
    try {
        // For simplicity, we'll remove all custom licenses for the user
        const user = allUsers.find(u => u.id === userId);
        if (user && user.customLicenses && user.customLicenses.length > 0) {
            for (let i = user.customLicenses.length - 1; i >= 0; i--) {
                const response = await fetch(`/api/users/${userId}/licenses/${i}`, {
                    method: 'DELETE'
                });
                
                if (!response.ok) {
                    throw new Error('Failed to remove license');
                }
            }
            
            showSuccess('Licenses removed successfully!');
            loadUsers(); // Refresh the data
        }
    } catch (error) {
        console.error('Error removing license:', error);
        showError('Failed to remove license. Please try again.');
    }
}

// View user details and sign-in activity
async function viewUserDetails(userId) {
    try {
        const user = allUsers.find(u => u.id === userId);
        if (!user) return;
        
        // Load sign-in activity
        const response = await fetch(`/api/users/${userId}/signins?days=90`);
        const signIns = await response.json();
        
        const modalContent = document.getElementById('userDetailsContent');
        modalContent.innerHTML = `
            <div class="row">
                <div class="col-md-6">
                    <h6>User Information</h6>
                    <table class="table table-sm">
                        <tr><td><strong>Name:</strong></td><td>${user.displayName}</td></tr>
                        <tr><td><strong>Email:</strong></td><td>${user.userPrincipalName}</td></tr>
                        <tr><td><strong>Status:</strong></td><td>
                            <span class="badge ${user.accountEnabled ? 'bg-success' : 'bg-secondary'}">
                                ${user.accountEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                        </td></tr>
                        <tr><td><strong>Last Sign-In:</strong></td><td>
                            ${user.lastSignInDateTime ? new Date(user.lastSignInDateTime).toLocaleString() : 'Never'}
                        </td></tr>
                    </table>
                </div>
                <div class="col-md-6">
                    <h6>Microsoft 365 Licenses</h6>
                    ${user.m365Licenses && user.m365Licenses.length > 0 ? 
                        user.m365Licenses.map(license => `
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <span class="badge bg-success">${license.skuPartNumber}</span>
                                <small class="text-muted">${license.servicePlans ? license.servicePlans.length : 0} services</small>
                            </div>
                        `).join('') :
                        '<p class="text-muted">No M365 licenses assigned</p>'
                    }
                    
                    <h6 class="mt-3">Custom SaaS Licenses</h6>
                    ${user.customLicenses && user.customLicenses.length > 0 ? 
                        user.customLicenses.map(license => `
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <span class="badge bg-primary">${license.productName}</span>
                                <small class="text-muted">${new Date(license.assignedDate).toLocaleDateString()}</small>
                            </div>
                        `).join('') :
                        '<p class="text-muted">No custom licenses assigned</p>'
                    }
                </div>
            </div>
            
            <hr>
            
            <h6>Recent Sign-In Activity (Last 90 Days)</h6>
            <div class="table-responsive">
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>App</th>
                            <th>IP Address</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${signIns.length > 0 ? 
                            signIns.slice(0, 10).map(signIn => `
                                <tr>
                                    <td>${new Date(signIn.createdDateTime).toLocaleString()}</td>
                                    <td>${signIn.appDisplayName || 'N/A'}</td>
                                    <td>${signIn.ipAddress || 'N/A'}</td>
                                    <td>
                                        <span class="badge ${signIn.status.errorCode === 0 ? 'bg-success' : 'bg-danger'}">
                                            ${signIn.status.errorCode === 0 ? 'Success' : 'Failed'}
                                        </span>
                                    </td>
                                </tr>
                            `).join('') :
                            '<tr><td colspan="4" class="text-center text-muted">No recent sign-in activity</td></tr>'
                        }
                    </tbody>
                </table>
            </div>
        `;
        
        bootstrap.Modal.getInstance(document.getElementById('userDetailsModal')).show();
    } catch (error) {
        console.error('Error loading user details:', error);
        showError('Failed to load user details.');
    }
}

// Refresh data
function refreshData() {
    loadUsers();
}

// Utility functions
function showLoading(show) {
    const tbody = document.getElementById('usersTableBody');
    if (show) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <p class="mt-2">Loading users...</p>
                </td>
            </tr>
        `;
    }
}

function showError(message) {
    // Create a simple alert - you could enhance this with a proper notification system
    alert('Error: ' + message);
}

function showSuccess(message) {
    // Create a simple alert - you could enhance this with a proper notification system
    alert('Success: ' + message);
}
