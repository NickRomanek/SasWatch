// ============================================================================
// SubTracker Enhanced - Multi-Tab License Management Application
// ============================================================================

// Global State
let allUsers = [];
let filteredUsers = [];
let m365Licenses = [];
let appActivity = [];
let currentTab = 'dashboard';
let charts = {};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('SubTracker Enhanced initializing...');
    initializeApp();
});

async function initializeApp() {
    setupEventListeners();
    await Promise.all([
        loadUsers(),
        loadM365Licenses(),
        loadAppActivity()
    ]);
    renderDashboard();
}

function setupEventListeners() {
    // Search and filters
    const searchInput = document.getElementById('searchInput');
    const activityFilter = document.getElementById('activityFilter');
    const licenseFilter = document.getElementById('licenseFilter');
    const m365LicenseFilter = document.getElementById('m365LicenseFilter');
    
    if (searchInput) searchInput.addEventListener('input', filterUsers);
    if (activityFilter) activityFilter.addEventListener('change', filterUsers);
    if (licenseFilter) licenseFilter.addEventListener('change', filterUsers);
    if (m365LicenseFilter) m365LicenseFilter.addEventListener('change', filterUsers);
}

// ============================================================================
// TAB SWITCHING
// ============================================================================

function switchTab(tabName) {
    currentTab = tabName;
    
    // Hide all views
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('usersView').style.display = 'none';
    document.getElementById('appsView').style.display = 'none';
    
    // Remove active class from all tabs
    document.getElementById('dashboardTab').classList.remove('active');
    document.getElementById('usersTab').classList.remove('active');
    document.getElementById('appsTab').classList.remove('active');
    
    // Show selected view and activate tab
    if (tabName === 'dashboard') {
        document.getElementById('dashboardView').style.display = 'block';
        document.getElementById('dashboardTab').classList.add('active');
        renderDashboard();
    } else if (tabName === 'users') {
        document.getElementById('usersView').style.display = 'block';
        document.getElementById('usersTab').classList.add('active');
        filterUsers();
    } else if (tabName === 'apps') {
        document.getElementById('appsView').style.display = 'block';
        document.getElementById('appsTab').classList.add('active');
        renderAppActivity();
    }
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        if (!response.ok) throw new Error('Failed to fetch users');
        allUsers = await response.json();
        console.log(`Loaded ${allUsers.length} users`);
        populateUserSelect();
        return allUsers;
    } catch (error) {
        console.error('Error loading users:', error);
        showNotification('Failed to load users', 'error');
        return [];
    }
}

async function loadM365Licenses() {
    try {
        const response = await fetch('/api/m365-licenses');
        if (!response.ok) throw new Error('Failed to fetch licenses');
        m365Licenses = await response.json();
        console.log(`Loaded ${m365Licenses.length} M365 licenses`);
        populateM365LicenseFilter();
        return m365Licenses;
    } catch (error) {
        console.error('Error loading M365 licenses:', error);
        return [];
    }
}

async function loadAppActivity() {
    try {
        const response = await fetch('/api/app-activity');
        if (response.ok) {
            appActivity = await response.json();
            console.log(`Loaded ${appActivity.length} apps`);
        }
        return appActivity;
    } catch (error) {
        console.error('Error loading app activity:', error);
        return [];
    }
}

// ============================================================================
// DASHBOARD RENDERING
// ============================================================================

function renderDashboard() {
    updateDashboardStats();
    renderCharts();
    loadRecentSignIns();
}

async function updateDashboardStats() {
    const totalUsers = allUsers.length;
    const licensedUsers = allUsers.filter(u => 
        (u.m365Licenses && u.m365Licenses.length > 0) || 
        (u.customLicenses && u.customLicenses.length > 0)
    ).length;
    
    // Update basic stats
    document.getElementById('totalUsers').textContent = totalUsers;
    document.getElementById('licensedUsers').textContent = licensedUsers;
    
    // Calculate percentages
    const licensedPercent = totalUsers > 0 ? Math.round((licensedUsers / totalUsers) * 100) : 0;
    document.getElementById('licensedPercent').textContent = `${licensedPercent}% licensed`;
    
    // User trend (mock for now - would need historical data)
    document.getElementById('userTrend').textContent = '↗ +2 this week';
    
    // Load inactive stats
    try {
        const [inactive30, inactive60, inactive90] = await Promise.all([
            fetch('/api/users/inactive?days=30').then(r => r.json()),
            fetch('/api/users/inactive?days=60').then(r => r.json()),
            fetch('/api/users/inactive?days=90').then(r => r.json())
        ]);
        
        document.getElementById('inactive30').textContent = inactive30.length;
        document.getElementById('inactive60').textContent = inactive60.length;
        document.getElementById('inactive90').textContent = inactive90.length;
    } catch (error) {
        console.error('Error loading inactive stats:', error);
    }
    
    // MFA Status (mock - would need real MFA data from Graph API)
    const mfaEnabled = Math.floor(totalUsers * 0.75); // Simulated
    const mfaPercent = totalUsers > 0 ? Math.round((mfaEnabled / totalUsers) * 100) : 0;
    document.getElementById('mfaEnabled').textContent = `${mfaPercent}%`;
    document.getElementById('mfaPercent').textContent = `${mfaEnabled} of ${totalUsers} users`;
}

function renderCharts() {
    renderLicenseChart();
    renderActivityChart();
}

function renderLicenseChart() {
    const ctx = document.getElementById('licenseChart');
    if (!ctx) return;
    
    // Destroy existing chart
    if (charts.license) charts.license.destroy();
    
    // Count license types
    const licenseCounts = {
        'M365 Licensed': allUsers.filter(u => u.m365Licenses && u.m365Licenses.length > 0).length,
        'Custom SaaS': allUsers.filter(u => u.customLicenses && u.customLicenses.length > 0).length,
        'No Licenses': allUsers.filter(u => 
            (!u.m365Licenses || u.m365Licenses.length === 0) && 
            (!u.customLicenses || u.customLicenses.length === 0)
        ).length
    };
    
    charts.license = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(licenseCounts),
            datasets: [{
                data: Object.values(licenseCounts),
                backgroundColor: [
                    'rgba(102, 126, 234, 0.8)',
                    'rgba(240, 147, 251, 0.8)',
                    'rgba(200, 200, 200, 0.8)'
                ],
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

function renderActivityChart() {
    const ctx = document.getElementById('activityChart');
    if (!ctx) return;
    
    // Destroy existing chart
    if (charts.activity) charts.activity.destroy();
    
    // Generate mock activity data for last 7 days
    const days = [];
    const signIns = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        days.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        signIns.push(Math.floor(Math.random() * 20) + 10); // Mock data
    }
    
    charts.activity = new Chart(ctx, {
        type: 'line',
        data: {
            labels: days,
            datasets: [{
                label: 'Sign-Ins',
                data: signIns,
                borderColor: 'rgba(102, 126, 234, 1)',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 5
                    }
                }
            }
        }
    });
}

async function loadRecentSignIns() {
    const tbody = document.getElementById('recentSignInsTable');
    if (!tbody) return;
    
    try {
        // Get recent sign-ins across all users
        const response = await fetch('/api/recent-signins?limit=10');
        if (!response.ok) throw new Error('Failed to fetch recent sign-ins');
        
        const signIns = await response.json();
        
        if (signIns.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No recent sign-ins</td></tr>';
            return;
        }
        
        tbody.innerHTML = signIns.map(signIn => {
            const user = allUsers.find(u => u.id === signIn.userId) || {};
            const timeAgo = getRelativeTime(signIn.createdDateTime);
            const status = signIn.status.errorCode === 0 ? 
                '<span class="badge bg-success">Success</span>' : 
                '<span class="badge bg-danger">Failed</span>';
            
            return `
                <tr>
                    <td>
                        <div class="d-flex align-items-center">
                            <div class="user-avatar me-2">${getInitials(user.displayName || 'Unknown')}</div>
                            <div>
                                <div class="fw-bold">${user.displayName || 'Unknown User'}</div>
                                <small class="text-muted">${user.userPrincipalName || ''}</small>
                            </div>
                        </div>
                    </td>
                    <td>${signIn.appDisplayName || 'Unknown App'}</td>
                    <td>
                        <span class="relative-time">${timeAgo}</span>
                        <br><small class="text-muted">${new Date(signIn.createdDateTime).toLocaleString()}</small>
                    </td>
                    <td>${signIn.location?.city || 'Unknown'}, ${signIn.location?.countryOrRegion || ''}</td>
                    <td>${status}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading recent sign-ins:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Unable to load recent activity</td></tr>';
    }
}

// ============================================================================
// USERS & LICENSES VIEW
// ============================================================================

function filterUsers() {
    const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const activityFilter = document.getElementById('activityFilter')?.value || 'all';
    const licenseFilter = document.getElementById('licenseFilter')?.value || 'all';
    const m365LicenseFilter = document.getElementById('m365LicenseFilter')?.value || 'all';
    
    filteredUsers = allUsers.filter(user => {
        // Search filter
        const matchesSearch = !searchTerm || 
            user.displayName.toLowerCase().includes(searchTerm) ||
            user.userPrincipalName.toLowerCase().includes(searchTerm);
        
        // License filter
        const hasM365 = user.m365Licenses && user.m365Licenses.length > 0;
        const hasCustom = user.customLicenses && user.customLicenses.length > 0;
        const hasAny = hasM365 || hasCustom;
        
        let matchesLicense = true;
        if (licenseFilter === 'licensed') matchesLicense = hasAny;
        else if (licenseFilter === 'unlicensed') matchesLicense = !hasAny;
        else if (licenseFilter === 'm365-only') matchesLicense = hasM365;
        else if (licenseFilter === 'custom-only') matchesLicense = hasCustom;
        
        // M365 specific license
        let matchesM365 = true;
        if (m365LicenseFilter !== 'all') {
            matchesM365 = hasM365 && user.m365Licenses.some(l => l.skuId === m365LicenseFilter);
        }
        
        return matchesSearch && matchesLicense && matchesM365;
    });
    
    // Apply activity filter
    if (activityFilter !== 'all') {
        const days = parseInt(activityFilter.replace('inactive', ''));
        filterByActivity(days);
    } else {
        renderUsersTable(filteredUsers);
    }
}

async function filterByActivity(days) {
    try {
        const response = await fetch(`/api/users/inactive?days=${days}`);
        const inactiveUsers = await response.json();
        const inactiveIds = new Set(inactiveUsers.map(u => u.id));
        
        const filtered = filteredUsers.filter(u => inactiveIds.has(u.id));
        renderUsersTable(filtered);
    } catch (error) {
        console.error('Error filtering by activity:', error);
        renderUsersTable(filteredUsers);
    }
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-5">No users found</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => {
        const lastSignIn = user.lastSignInDateTime ? 
            getRelativeTime(user.lastSignInDateTime) : 'Never';
        const isActive = user.lastSignInDateTime && 
            (new Date() - new Date(user.lastSignInDateTime)) < (30 * 24 * 60 * 60 * 1000);
        const rowClass = isActive ? 'active-user' : 'inactive-user';
        
        // Generate app usage icons (mock)
        const appIcons = generateAppIcons(user);
        
        return `
            <tr class="${rowClass}">
                <td>
                    <div class="d-flex align-items-center">
                        <div class="user-avatar me-2">${getInitials(user.displayName)}</div>
                        <div>
                            <div class="fw-bold">${user.displayName}</div>
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
                <td>
                    <span class="relative-time">${lastSignIn}</span>
                    ${user.lastSignInDateTime ? 
                        `<br><small class="text-muted">${new Date(user.lastSignInDateTime).toLocaleDateString()}</small>` : ''}
                </td>
                <td>
                    <div class="app-usage-stack">${appIcons}</div>
                </td>
                <td>
                    ${renderLicenseBadges(user)}
                </td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary" onclick="openUserDrawer('${user.id}')" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-outline-success" onclick="quickAssignLicense('${user.id}')" title="Assign License">
                            <i class="fas fa-plus"></i>
                        </button>
                        ${user.customLicenses && user.customLicenses.length > 0 ? 
                            `<button class="btn btn-outline-danger" onclick="removeLicense('${user.id}')" title="Remove License">
                                <i class="fas fa-trash"></i>
                            </button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderLicenseBadges(user) {
    let badges = '';
    
    if (user.m365Licenses && user.m365Licenses.length > 0) {
        badges += user.m365Licenses.map(license => 
            `<span class="badge bg-success license-badge me-1 mb-1" title="M365: ${license.skuPartNumber}">${license.skuPartNumber}</span>`
        ).join('');
    }
    
    if (user.customLicenses && user.customLicenses.length > 0) {
        badges += user.customLicenses.map(license => 
            `<span class="badge bg-primary license-badge me-1 mb-1" title="Custom SaaS">${license.productName}</span>`
        ).join('');
    }
    
    if (!badges) {
        badges = '<span class="text-muted small">No licenses</span>';
    }
    
    return badges;
}

function generateAppIcons(user) {
    // Mock app usage - in real implementation, would come from sign-in logs
    const apps = ['Teams', 'Outlook', 'SharePoint'];
    return apps.map(app => {
        const initial = app[0];
        const color = getAppColor(app);
        return `<span class="app-icon" style="background-color: ${color};" title="${app}">${initial}</span>`;
    }).join('');
}

function getAppColor(appName) {
    const colors = {
        'Teams': '#6264A7',
        'Outlook': '#0078D4',
        'SharePoint': '#03787C',
        'OneDrive': '#0078D4',
        'Word': '#2B579A',
        'Excel': '#217346',
        'PowerPoint': '#B7472A'
    };
    return colors[appName] || '#999';
}

// ============================================================================
// APP ACTIVITY VIEW
// ============================================================================

async function renderAppActivity() {
    const tbody = document.getElementById('appsTableBody');
    if (!tbody) return;
    
    try {
        // In real implementation, this would aggregate from sign-in logs
        const response = await fetch('/api/app-activity');
        let apps = [];
        
        if (response.ok) {
            apps = await response.json();
        } else {
            // Generate mock data
            apps = generateMockAppActivity();
        }
        
        if (apps.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-5">No application data available</td></tr>';
            return;
        }
        
        tbody.innerHTML = apps.map(app => {
            const trendIcon = app.trend === 'up' ? '📈' : app.trend === 'down' ? '📉' : '━';
            const lastActivity = getRelativeTime(app.lastActivity);
            
            return `
                <tr>
                    <td>
                        <div class="d-flex align-items-center">
                            <span class="app-icon me-2" style="background-color: ${getAppColor(app.name)};">${app.name[0]}</span>
                            <strong>${app.name}</strong>
                        </div>
                    </td>
                    <td>
                        <strong>${app.activeUsers}</strong> / ${allUsers.length}
                        <div class="progress mt-1" style="height: 4px;">
                            <div class="progress-bar bg-success" style="width: ${(app.activeUsers / allUsers.length * 100)}%"></div>
                        </div>
                    </td>
                    <td>${app.totalSignIns.toLocaleString()}</td>
                    <td>
                        <span class="relative-time">${lastActivity}</span>
                    </td>
                    <td><span style="font-size: 1.2rem;">${trendIcon}</span></td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" onclick="viewAppDetails('${app.name}')">
                            <i class="fas fa-chart-bar"></i> Details
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error rendering app activity:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-5">Error loading application data</td></tr>';
    }
}

function generateMockAppActivity() {
    const apps = [
        { name: 'Microsoft Teams', activeUsers: 15, totalSignIns: 245, lastActivity: new Date(Date.now() - 2 * 60 * 60 * 1000), trend: 'up' },
        { name: 'Outlook', activeUsers: 16, totalSignIns: 389, lastActivity: new Date(Date.now() - 1 * 60 * 60 * 1000), trend: 'up' },
        { name: 'SharePoint', activeUsers: 12, totalSignIns: 156, lastActivity: new Date(Date.now() - 5 * 60 * 60 * 1000), trend: 'stable' },
        { name: 'OneDrive', activeUsers: 14, totalSignIns: 201, lastActivity: new Date(Date.now() - 3 * 60 * 60 * 1000), trend: 'up' },
        { name: 'Word', activeUsers: 8, totalSignIns: 92, lastActivity: new Date(Date.now() - 24 * 60 * 60 * 1000), trend: 'down' },
        { name: 'Excel', activeUsers: 7, totalSignIns: 78, lastActivity: new Date(Date.now() - 12 * 60 * 60 * 1000), trend: 'stable' },
        { name: 'PowerPoint', activeUsers: 5, totalSignIns: 34, lastActivity: new Date(Date.now() - 48 * 60 * 60 * 1000), trend: 'down' }
    ];
    return apps;
}

// ============================================================================
// USER DRAWER (DETAILED VIEW)
// ============================================================================

async function openUserDrawer(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    
    const drawer = document.getElementById('userDrawer');
    const overlay = document.getElementById('drawerOverlay');
    const content = document.getElementById('userDrawerContent');
    
    // Show loading
    content.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';
    drawer.classList.add('open');
    overlay.classList.add('show');
    
    try {
        // Load user's sign-in history
        const response = await fetch(`/api/users/${userId}/signins?days=30`);
        const signIns = await response.json();
        
        content.innerHTML = renderUserDrawerContent(user, signIns);
    } catch (error) {
        console.error('Error loading user details:', error);
        content.innerHTML = '<div class="alert alert-danger">Failed to load user details</div>';
    }
}

function renderUserDrawerContent(user, signIns) {
    return `
        <div class="user-profile mb-4 text-center">
            <div class="user-avatar mx-auto mb-3" style="width: 80px; height: 80px; font-size: 2rem;">
                ${getInitials(user.displayName)}
            </div>
            <h4 class="mb-1">${user.displayName}</h4>
            <p class="text-muted">${user.userPrincipalName}</p>
            <span class="badge ${user.accountEnabled ? 'bg-success' : 'bg-secondary'}">
                ${user.accountEnabled ? 'Active Account' : 'Disabled Account'}
            </span>
        </div>
        
        <div class="row mb-4">
            <div class="col-6">
                <div class="card bg-light">
                    <div class="card-body text-center p-3">
                        <i class="fas fa-sign-in-alt text-primary fa-2x mb-2"></i>
                        <h5 class="mb-0">${signIns.length}</h5>
                        <small class="text-muted">Sign-ins (30 days)</small>
                    </div>
                </div>
            </div>
            <div class="col-6">
                <div class="card bg-light">
                    <div class="card-body text-center p-3">
                        <i class="fas fa-clock text-info fa-2x mb-2"></i>
                        <h5 class="mb-0">${user.lastSignInDateTime ? getRelativeTime(user.lastSignInDateTime) : 'Never'}</h5>
                        <small class="text-muted">Last Sign-In</small>
                    </div>
                </div>
            </div>
        </div>
        
        <h6 class="mb-3"><i class="fas fa-key me-2"></i>Microsoft 365 Licenses</h6>
        <div class="mb-4">
            ${user.m365Licenses && user.m365Licenses.length > 0 ? 
                user.m365Licenses.map(license => `
                    <div class="d-flex justify-content-between align-items-center mb-2 p-2 bg-light rounded">
                        <span class="badge bg-success">${license.skuPartNumber}</span>
                        <small class="text-muted">${license.servicePlans ? license.servicePlans.length : 0} services</small>
                    </div>
                `).join('') :
                '<p class="text-muted">No M365 licenses assigned</p>'
            }
        </div>
        
        <h6 class="mb-3"><i class="fas fa-box me-2"></i>Custom SaaS Licenses</h6>
        <div class="mb-4">
            ${user.customLicenses && user.customLicenses.length > 0 ? 
                user.customLicenses.map(license => `
                    <div class="d-flex justify-content-between align-items-center mb-2 p-2 bg-light rounded">
                        <span class="badge bg-primary">${license.productName}</span>
                        <small class="text-muted">${new Date(license.assignedDate).toLocaleDateString()}</small>
                    </div>
                `).join('') :
                '<p class="text-muted">No custom licenses assigned</p>'
            }
        </div>
        
        <h6 class="mb-3"><i class="fas fa-history me-2"></i>Recent Sign-In Activity</h6>
        <div class="list-group">
            ${signIns.slice(0, 10).map(signIn => `
                <div class="list-group-item">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${signIn.appDisplayName || 'Unknown App'}</strong>
                            <br>
                            <small class="text-muted">${new Date(signIn.createdDateTime).toLocaleString()}</small>
                        </div>
                        <span class="badge ${signIn.status.errorCode === 0 ? 'bg-success' : 'bg-danger'}">
                            ${signIn.status.errorCode === 0 ? 'Success' : 'Failed'}
                        </span>
                    </div>
                </div>
            `).join('')}
            ${signIns.length === 0 ? '<p class="text-muted">No recent activity</p>' : ''}
        </div>
    `;
}

function closeUserDrawer() {
    document.getElementById('userDrawer').classList.remove('open');
    document.getElementById('drawerOverlay').classList.remove('show');
}

// ============================================================================
// LICENSE MANAGEMENT
// ============================================================================

async function assignLicense() {
    const userId = document.getElementById('userSelect').value;
    const productName = document.getElementById('productName').value;
    const assignedDate = document.getElementById('assignedDate').value;
    
    if (!userId || !productName) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/users/${userId}/licenses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                productName,
                assignedDate: assignedDate || new Date().toISOString()
            })
        });
        
        if (!response.ok) throw new Error('Failed to assign license');
        
        showNotification('License assigned successfully', 'success');
        document.getElementById('assignLicenseForm').reset();
        bootstrap.Modal.getInstance(document.getElementById('assignLicenseModal')).hide();
        await loadUsers();
        filterUsers();
    } catch (error) {
        console.error('Error assigning license:', error);
        showNotification('Failed to assign license', 'error');
    }
}

function quickAssignLicense(userId) {
    document.getElementById('userSelect').value = userId;
    new bootstrap.Modal(document.getElementById('assignLicenseModal')).show();
}

async function removeLicense(userId) {
    if (!confirm('Remove all custom licenses for this user?')) return;
    
    try {
        const user = allUsers.find(u => u.id === userId);
        if (user && user.customLicenses) {
            for (let i = user.customLicenses.length - 1; i >= 0; i--) {
                await fetch(`/api/users/${userId}/licenses/${i}`, { method: 'DELETE' });
            }
        }
        
        showNotification('Licenses removed successfully', 'success');
        await loadUsers();
        filterUsers();
    } catch (error) {
        console.error('Error removing license:', error);
        showNotification('Failed to remove license', 'error');
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getInitials(name) {
    if (!name) return '??';
    const parts = name.split(' ');
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

function getRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

function populateUserSelect() {
    const select = document.getElementById('userSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">Choose a user...</option>';
    allUsers.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.displayName} (${user.userPrincipalName})`;
        select.appendChild(option);
    });
}

function populateM365LicenseFilter() {
    const select = document.getElementById('m365LicenseFilter');
    if (!select) return;
    
    select.innerHTML = '<option value="all">All M365 Licenses</option>';
    m365Licenses.forEach(license => {
        const option = document.createElement('option');
        option.value = license.skuId;
        option.textContent = `${license.skuPartNumber} (${license.consumedUnits}/${license.prepaidUnits.enabled})`;
        select.appendChild(option);
    });
}

function showNotification(message, type = 'info') {
    // Simple alert for now - could be enhanced with toast notifications
    if (type === 'error') {
        alert('Error: ' + message);
    } else {
        alert(message);
    }
}

function filterInactiveUsers(days) {
    switchTab('users');
    setTimeout(() => {
        document.getElementById('activityFilter').value = `inactive${days}`;
        filterUsers();
    }, 100);
}

async function refreshData() {
    await loadUsers();
    filterUsers();
    showNotification('Data refreshed', 'success');
}

async function refreshDashboard() {
    await Promise.all([loadUsers(), loadM365Licenses()]);
    renderDashboard();
    showNotification('Dashboard refreshed', 'success');
}

async function refreshAppActivity() {
    await loadAppActivity();
    renderAppActivity();
}

function viewAppDetails(appName) {
    alert(`Detailed analytics for ${appName} would be shown here.\n\nThis would include:\n- User adoption over time\n- Peak usage hours\n- License utilization\n- Cost per active user`);
}

// Export functions for HTML onclick handlers
window.switchTab = switchTab;
window.filterInactiveUsers = filterInactiveUsers;
window.openUserDrawer = openUserDrawer;
window.closeUserDrawer = closeUserDrawer;
window.assignLicense = assignLicense;
window.quickAssignLicense = quickAssignLicense;
window.removeLicense = removeLicense;
window.refreshData = refreshData;
window.refreshDashboard = refreshDashboard;
window.refreshAppActivity = refreshAppActivity;
window.viewAppDetails = viewAppDetails;

