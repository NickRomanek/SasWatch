// Users Page JavaScript

let currentSort = { column: 'lastActivity', direction: 'desc' };
let filteredUsers = [...usersData];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    setupUploadHandlers();

    // Show skeleton loaders while initializing
    if (usersData && usersData.length > 0) {
        showSkeletonLoaders();
        // Delay actual rendering slightly for skeleton effect
        setTimeout(() => {
            renderUsersTable();
        }, 300);
    } else {
        renderUsersTable();
    }

    setupFilters();
    setupSearch();
});

// ============================================
// CSV Upload Handlers
// ============================================

function setupUploadHandlers() {
    const dropzone = document.getElementById('upload-dropzone');
    const fileInput = document.getElementById('csv-file-input');
    
    if (!dropzone || !fileInput) return;
    
    // Click to browse
    dropzone.addEventListener('click', () => {
        fileInput.click();
    });
    
    // Drag and drop
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });
    
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    });
    
    // File input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileUpload(e.target.files[0]);
        }
    });
}

async function handleFileUpload(file) {
    if (!file.name.endsWith('.csv')) {
        Toast.error('Please upload a CSV file');
        return;
    }

    const formData = new FormData();
    formData.append('csvFile', file);

    // Show progress
    document.getElementById('upload-dropzone').style.display = 'none';
    document.getElementById('upload-progress').style.display = 'block';
    document.getElementById('upload-status').textContent = 'Uploading...';
    document.getElementById('upload-status').style.color = '';

    try {
        const response = await fetch('/api/users/import', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            document.getElementById('upload-status').textContent =
                `✓ Success! Imported ${result.imported} new users, updated ${result.updated} existing users.`;
            document.getElementById('upload-status').style.color = 'var(--success)';

            Toast.success(`Imported ${result.imported} new users, updated ${result.updated} existing users`);

            // Reload page after 2 seconds
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            throw new Error(result.error || 'Upload failed');
        }
    } catch (error) {
        console.error('Upload error:', error);
        document.getElementById('upload-status').textContent = `✗ Error: ${error.message}`;
        document.getElementById('upload-status').style.color = 'var(--danger)';

        Toast.error('Upload failed: ' + error.message);

        // Reset after 3 seconds
        setTimeout(() => {
            document.getElementById('upload-dropzone').style.display = 'block';
            document.getElementById('upload-progress').style.display = 'none';
        }, 3000);
    }
}

// ============================================
// Delete All Users
// ============================================

async function deleteAllUsers() {
    const confirmed = await ConfirmModal.show({
        title: 'Delete All Users?',
        message: 'This will remove all imported user data and mappings. Activity history will be preserved.',
        confirmText: 'Delete All',
        cancelText: 'Cancel',
        type: 'danger'
    });

    if (!confirmed) return;

    try {
        const response = await fetch('/api/users', {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            Toast.success('All users deleted successfully');
            setTimeout(() => window.location.reload(), 1500);
        } else {
            throw new Error(result.error || 'Delete failed');
        }
    } catch (error) {
        console.error('Delete error:', error);
        Toast.error('Error: ' + error.message);
    }
}

// ============================================
// Username Mapping
// ============================================

async function mapUsername(username) {
    const select = document.querySelector(`select[data-username="${username}"]`);
    const email = select.value;

    if (!email) {
        Toast.warning('Please select a user to map to');
        return;
    }

    const button = event.target;
    addButtonSpinner(button, button.innerHTML);

    try {
        const response = await fetch('/api/users/mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email })
        });

        const result = await response.json();

        if (result.success) {
            Toast.success(`Mapped ${username} to ${email} • ${result.retroactiveActivity} retroactive events`);
            setTimeout(() => window.location.reload(), 1500);
        } else {
            throw new Error(result.error || 'Mapping failed');
        }
    } catch (error) {
        console.error('Mapping error:', error);
        Toast.error('Error: ' + error.message);
    } finally {
        removeButtonSpinner(button);
    }
}

// ============================================
// Users Table Rendering
// ============================================

function showSkeletonLoaders() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><div class="skeleton skeleton-text" style="width: 150px;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 200px;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 180px;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 120px;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 60px;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 100px;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 40px;"></div></td>
        `;
        tbody.appendChild(row);
    }
}

function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (filteredUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-secondary);">No users match the current filters</td></tr>';
        return;
    }
    
    filteredUsers.forEach(user => {
        const row = document.createElement('tr');
        row.className = getStatusClass(user);
        
        row.innerHTML = `
            <td><strong>${user.firstName} ${user.lastName}</strong></td>
            <td>${user.email}</td>
            <td>${renderLicenses(getDisplayLicenses(user))}</td>
            <td>${renderLastActivity(user.lastActivity)}</td>
            <td>
                <a href="/user/${encodeURIComponent(user.email)}/activity" class="activity-count-link" title="View activity details">
                    <span class="activity-count">${user.activityCount || 0}</span>
                </a>
            </td>
            <td>${renderStatusBadge(user)}</td>
            <td>
                <button class="btn btn-icon" onclick="editUserByEmail('${user.email.replace(/'/g, "\\'")}')" title="Edit user">
                    ✏️
                </button>
            </td>
        `;
        
        tbody.appendChild(row);
    });
    
    // Update count
    document.getElementById('user-count').textContent = filteredUsers.length;
}

function getDisplayLicenses(user) {
    if (user.entraLicenses && user.entraLicenses.length > 0) {
        return user.entraLicenses;
    }
    return user.licenses;
}

function renderLicenses(licenses) {
    if (!licenses || licenses.length === 0) {
        return '<span class="license-badge license-none">No License</span>';
    }

    return licenses.map(license => {
        // Clean up license name by removing (DIRECT - ...) suffix
        const cleanLicense = license.replace(/\s*\(DIRECT\s*-\s*[A-Z0-9]+\)/gi, '').trim();
        const className = getLicenseClass(cleanLicense);
        return `<span class="license-badge ${className}">${cleanLicense}</span>`;
    }).join(' ');
}

function getLicenseClass(license) {
    if (license.includes('Acrobat')) return 'license-acrobat';
    if (license.includes('Creative Cloud')) return 'license-cc';
    if (license.includes('Photoshop')) return 'license-photoshop';
    if (license.includes('Illustrator')) return 'license-illustrator';
    return 'license-other';
}

function renderLastActivity(lastActivity) {
    if (!lastActivity) {
        return '<span class="activity-never">Never</span>';
    }
    
    const date = new Date(lastActivity);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 60) {
        return `<span class="activity-recent">${diffMinutes} minutes ago</span>`;
    } else if (diffHours < 24) {
        return `<span class="activity-recent">${diffHours} hours ago</span>`;
    } else if (diffDays < 7) {
        return `<span class="activity-recent">${diffDays} days ago</span>`;
    } else if (diffDays < 30) {
        return `<span class="activity-inactive">${diffDays} days ago</span>`;
    } else {
        return `<span class="activity-old">${date.toLocaleDateString()}</span>`;
    }
}

function renderStatusBadge(user) {
    const status = getUserStatus(user);
    const badges = {
        active: '<span class="status-badge status-active">✓ Active in Entra</span>',
        inactive: '<span class="status-badge status-inactive">⚠ Inactive in Entra</span>',
        unknown: '<span class="status-badge status-neutral">Pending Sync</span>'
    };
    return badges[status] || '<span class="status-badge status-neutral">Pending Sync</span>';
}

function getUserStatus(user) {
    if (user.entraAccountEnabled === true) {
        return 'active';
    }
    if (user.entraAccountEnabled === false) {
        return 'inactive';
    }
    return 'unknown';
}

function getStatusClass(user) {
    const status = getUserStatus(user);
    return `user-row status-${status}`;
}

// ============================================
// Filtering and Sorting
// ============================================

function setupFilters() {
    const licenseFilter = document.getElementById('license-filter');
    const statusFilter = document.getElementById('status-filter');
    
    if (licenseFilter) {
        licenseFilter.addEventListener('change', applyFilters);
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', applyFilters);
    }
}

function setupSearch() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', applyFilters);
    }
}

function applyFilters() {
    const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || '';
    const licenseFilter = document.getElementById('license-filter')?.value || '';
    const statusFilter = document.getElementById('status-filter')?.value || '';
    
    filteredUsers = usersData.filter(user => {
        // Search filter
        const matchesSearch = !searchTerm || 
            user.firstName.toLowerCase().includes(searchTerm) ||
            user.lastName.toLowerCase().includes(searchTerm) ||
            user.email.toLowerCase().includes(searchTerm);
        
        // License filter
        let matchesLicense = true;
        if (licenseFilter) {
            if (licenseFilter === 'no-license') {
                const displayLicenses = getDisplayLicenses(user);
                matchesLicense = !displayLicenses || displayLicenses.length === 0;
            } else {
                const displayLicenses = getDisplayLicenses(user) || [];
                matchesLicense = displayLicenses.some(l => l.toLowerCase().includes(licenseFilter.toLowerCase()));
            }
        }
        
        // Status filter
        let matchesStatus = true;
        if (statusFilter) {
            matchesStatus = getUserStatus(user) === statusFilter;
        }
        
        return matchesSearch && matchesLicense && matchesStatus;
    });
    
    renderUsersTable();
}

function sortTable(column) {
    if (currentSort.column === column) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        currentSort.direction = 'asc';
    }
    
    filteredUsers.sort((a, b) => {
        let aVal, bVal;
        
        switch (column) {
            case 'name':
                aVal = `${a.firstName} ${a.lastName}`.toLowerCase();
                bVal = `${b.firstName} ${b.lastName}`.toLowerCase();
                break;
            case 'email':
                aVal = a.email.toLowerCase();
                bVal = b.email.toLowerCase();
                break;
            case 'licenses':
                aVal = getDisplayLicenses(a)?.length || 0;
                bVal = getDisplayLicenses(b)?.length || 0;
                break;
            case 'lastActivity':
                aVal = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
                bVal = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
                break;
            case 'activityCount':
                aVal = a.activityCount || 0;
                bVal = b.activityCount || 0;
                break;
            default:
                return 0;
        }
        
        if (aVal < bVal) return currentSort.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });
    
    renderUsersTable();
}

// ============================================
// Edit User Functionality
// ============================================

function editUserByEmail(email) {
    // Find user in usersData array
    const user = usersData.find(u => u.email === email);
    if (!user) {
        alert('User not found');
        return;
    }
    editUser(user);
}

function editUser(user) {
    // Create edit modal
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'edit-user-modal';
    
    const licensesHTML = user.licenses && user.licenses.length > 0 
        ? user.licenses.map((license, idx) => `
            <div class="license-input-group">
                <input type="text" class="form-input license-input" value="${license}" data-index="${idx}">
                <button type="button" class="btn btn-icon btn-danger" onclick="removeLicense(${idx})">🗑️</button>
            </div>
        `).join('')
        : '<p class="no-licenses-text">No licenses assigned</p>';
    
    const usernamesHTML = user.windowsUsernames && user.windowsUsernames.length > 0
        ? user.windowsUsernames.map((username, idx) => `
            <div class="username-input-group">
                <input type="text" class="form-input username-input" value="${username}" data-index="${idx}">
                <button type="button" class="btn btn-icon btn-danger" onclick="removeUsername(${idx})">🗑️</button>
            </div>
        `).join('')
        : '';
    
    modal.innerHTML = `
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h2>✏️ Edit User</h2>
                <button class="modal-close" onclick="closeEditModal()">×</button>
            </div>
            <form id="edit-user-form" data-original-email="${user.email.replace(/"/g, '&quot;')}">
                <div class="modal-body">
                    <div class="form-row">
                        <div class="form-group">
                            <label for="edit-firstName">First Name <span class="required">*</span></label>
                            <input type="text" id="edit-firstName" class="form-input" value="${user.firstName}" required>
                        </div>
                        <div class="form-group">
                            <label for="edit-lastName">Last Name <span class="required">*</span></label>
                            <input type="text" id="edit-lastName" class="form-input" value="${user.lastName}" required>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label for="edit-email">Email <span class="required">*</span></label>
                        <input type="email" id="edit-email" class="form-input" value="${user.email}" required>
                        <span class="label-hint">Changing email will update all username mappings</span>
                    </div>
                    
                    <div class="form-group">
                        <div class="form-group-header">
                            <label>Licenses</label>
                            <button type="button" class="btn btn-secondary btn-compact" onclick="addLicense()">➕ Add License</button>
                        </div>
                        <div id="licenses-container">
                            ${licensesHTML}
                        </div>
                    </div>

                    <div class="form-group" id="windows-usernames-section">
                        <div class="form-group-header">
                            <label>Windows Usernames</label>
                            <button type="button" class="btn btn-secondary btn-compact" onclick="addUsername()">➕ Add Username</button>
                        </div>
                        <div id="usernames-container">
                            ${usernamesHTML}
                        </div>
                        <p class="form-helper-text">Optional: manage alternate workstation logins mapped to this user.</p>
                    </div>

                    <div class="form-info">
                        <p><strong>Activity Count:</strong> ${user.activityCount || 0} events</p>
                        <p><strong>Last Activity:</strong> ${user.lastActivity ? new Date(user.lastActivity).toLocaleString() : 'Never'}</p>
                        <p><strong>Imported:</strong> ${user.importedAt ? new Date(user.importedAt).toLocaleString() : 'Unknown'}</p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeEditModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">💾 Save Changes</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Attach form submit handler
    const form = document.getElementById('edit-user-form');
    form.addEventListener('submit', saveUserEdit);
}

function closeEditModal() {
    const modal = document.getElementById('edit-user-modal');
    if (modal) {
        modal.remove();
    }
}

function addLicense() {
    const container = document.getElementById('licenses-container');
    const noLicensesText = container.querySelector('.no-licenses-text');
    if (noLicensesText) {
        noLicensesText.remove();
    }
    
    const newIndex = container.querySelectorAll('.license-input-group').length;
    const div = document.createElement('div');
    div.className = 'license-input-group';
    div.innerHTML = `
        <input type="text" class="form-input license-input" placeholder="Enter license name" data-index="${newIndex}">
        <button type="button" class="btn btn-icon btn-danger" onclick="removeLicenseElement(this)">🗑️</button>
    `;
    container.appendChild(div);
}

function removeLicenseElement(button) {
    button.closest('.license-input-group').remove();
    
    // Show "no licenses" text if all removed
    const container = document.getElementById('licenses-container');
    if (container.querySelectorAll('.license-input-group').length === 0) {
        container.innerHTML = '<p class="no-licenses-text">No licenses assigned</p>';
    }
}

function addUsername() {
    const container = document.getElementById('usernames-container');
    const newIndex = container.querySelectorAll('.username-input-group').length;
    const div = document.createElement('div');
    div.className = 'username-input-group';
    div.innerHTML = `
        <input type="text" class="form-input username-input" placeholder="Enter Windows username" data-index="${newIndex}">
        <button type="button" class="btn btn-icon btn-danger" onclick="removeUsernameElement(this)">🗑️</button>
    `;
    container.appendChild(div);
}

function removeUsernameElement(button) {
    button.closest('.username-input-group').remove();
}

async function saveUserEdit(event) {
    event.preventDefault();
    
    // Get original email from form data attribute
    const form = event.target;
    const oldEmail = form.getAttribute('data-original-email');
    
    const firstName = document.getElementById('edit-firstName').value.trim();
    const lastName = document.getElementById('edit-lastName').value.trim();
    const email = document.getElementById('edit-email').value.trim();
    const adminRoles = document.getElementById('edit-adminRoles').value.trim();
    const userGroups = document.getElementById('edit-userGroups').value.trim();
    
    // Collect licenses
    const licenseInputs = document.querySelectorAll('.license-input');
    const licenses = Array.from(licenseInputs)
        .map(input => input.value.trim())
        .filter(value => value.length > 0);
    
    // Collect usernames
    const usernameInputs = document.querySelectorAll('.username-input');
    const windowsUsernames = Array.from(usernameInputs)
        .map(input => input.value.trim())
        .filter(value => value.length > 0);
    
    if (!firstName || !lastName || !email) {
        alert('First name, last name, and email are required');
        return;
    }
    
    if (windowsUsernames.length === 0) {
        alert('At least one Windows username is required');
        return;
    }
    
    try {
        const response = await fetch('/api/users/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                oldEmail,
                email,
                firstName,
                lastName,
                windowsUsernames,
                licenses,
                adminRoles,
                userGroups
            })
        });
        
        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('Non-JSON response:', text);
            throw new Error('Server returned an error. Check console for details.');
        }
        
        const result = await response.json();
        
        if (result.success) {
            alert('✓ User updated successfully');
            closeEditModal();
            
            // Refresh the page to show updates
            window.location.reload();
        } else {
            throw new Error(result.error || 'Failed to update user');
        }
    } catch (error) {
        console.error('Update error:', error);
        alert('✗ Error: ' + error.message);
    }
}

// Auto-refresh every 30 seconds
setInterval(() => {
    fetch('/api/users')
        .then(res => res.json())
        .then(data => {
            usersData.length = 0;
            usersData.push(...data.users);
            applyFilters();
        })
        .catch(err => console.error('Auto-refresh error:', err));
}, 30000);

