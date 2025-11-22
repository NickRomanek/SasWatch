// Users Page JavaScript

let currentSort = { column: 'lastActivity', direction: 'desc' };
let filteredUsers = [...usersData];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    setupUploadHandlers();

    // Apply initial filters (including hidden users filter)
    applyFilters();

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
        row.style.cursor = 'pointer';
        row.title = 'Click to edit user';
        
        // ✅ Make row clickable (but not when clicking checkbox or links)
        row.addEventListener('click', (e) => {
            // Don't trigger if clicking checkbox, links, or buttons
            if (e.target.closest('input[type="checkbox"]') || 
                e.target.closest('a') || 
                e.target.closest('button')) {
                return;
            }
            editUser(user);
        });
        
        row.innerHTML = `
            <td>
                <input type="checkbox" class="user-checkbox" data-email="${user.email.replace(/"/g, '&quot;')}" onchange="handleCheckboxChange()">
            </td>
            <td><strong>${user.firstName} ${user.lastName}</strong></td>
            <td>${renderEmail(user.email)}</td>
            <td>${renderLicenses(getDisplayLicenses(user))}</td>
            <td>${renderLastActivity(user.lastActivity)}</td>
            <td>
                <a href="/user/${encodeURIComponent(user.email)}/activity" class="activity-count-link" title="View activity details">
                    <span class="activity-count">${user.activityCount || 0}</span>
                </a>
            </td>
            <td>${renderStatusBadge(user)}</td>
        `;
        
        tbody.appendChild(row);
    });
    
    // Setup select all checkbox
    setupSelectAllCheckbox();
    
    // Update count
    const userCount = filteredUsers.length;
    const userCountElement = document.getElementById('user-count');
    const headerUserCountElement = document.getElementById('header-user-count');
    if (userCountElement) {
        userCountElement.textContent = userCount;
    }
    if (headerUserCountElement) {
        headerUserCountElement.textContent = userCount;
    }
}

function getDisplayLicenses(user) {
    // ✅ Merge both Adobe licenses (user.licenses) and Microsoft licenses (user.entraLicenses)
    const adobeLicenses = Array.isArray(user.licenses) ? user.licenses : [];
    const entraLicenses = Array.isArray(user.entraLicenses) ? user.entraLicenses : [];
    
    // Combine and deduplicate
    const allLicenses = [...adobeLicenses, ...entraLicenses];
    const uniqueLicenses = [...new Set(allLicenses.map(l => String(l).trim()))].filter(l => l.length > 0);
    
    return uniqueLicenses;
}

function renderLicenses(licenses) {
    if (!licenses || licenses.length === 0) {
        return '<span class="license-badge license-none">No License</span>';
    }

    // Clean up license names
    const cleanedLicenses = licenses.map(license => {
        return license.replace(/\s*\(DIRECT\s*-\s*[A-Z0-9]+\)/gi, '').trim();
    });

    const maxVisible = 3;
    const hasMore = cleanedLicenses.length > maxVisible;
    const visibleLicenses = hasMore ? cleanedLicenses.slice(0, maxVisible) : cleanedLicenses;
    const hiddenLicenses = hasMore ? cleanedLicenses.slice(maxVisible) : [];

    // Generate unique ID for this license set
    const licenseId = 'licenses-' + Math.random().toString(36).substr(2, 9);

    let html = '<div class="licenses-container">';
    html += '<div class="licenses-visible">';
    html += visibleLicenses.map(license => {
        const className = getLicenseClass(license);
        return `<span class="license-badge ${className}">${license}</span>`;
    }).join(' ');
    html += '</div>';

    if (hasMore) {
        html += `<div class="licenses-hidden" id="${licenseId}-hidden" style="display: none; flex-direction: column;">`;
        html += hiddenLicenses.map(license => {
            const className = getLicenseClass(license);
            return `<span class="license-badge ${className}">${license}</span>`;
        }).join(' ');
        html += '</div>';
        html += `<button class="license-expand-btn" onclick="toggleLicenses('${licenseId}')" type="button" title="Show ${hiddenLicenses.length} more licenses">+${hiddenLicenses.length} more</button>`;
    }

    html += '</div>';
    return html;
}

function toggleLicenses(licenseId) {
    const hiddenDiv = document.getElementById(licenseId + '-hidden');
    if (!hiddenDiv) return;
    
    // Find the button and visible container
    const container = hiddenDiv.parentElement;
    const btn = container?.querySelector('.license-expand-btn');
    const visibleDiv = container?.querySelector('.licenses-visible');
    
    if (!btn || !visibleDiv) return;

    const isExpanded = hiddenDiv.style.display !== 'none';
    
    if (isExpanded) {
        // Collapse: hide hidden licenses, make visible licenses horizontal
        hiddenDiv.style.display = 'none';
        visibleDiv.style.flexDirection = 'row';
        visibleDiv.style.flexWrap = 'wrap';
        const count = hiddenDiv.querySelectorAll('.license-badge').length;
        btn.textContent = `+${count} more`;
        btn.title = `Show ${count} more licenses`;
    } else {
        // Expand: show hidden licenses, make all licenses vertical
        hiddenDiv.style.display = 'flex';
        hiddenDiv.style.flexDirection = 'column';
        visibleDiv.style.flexDirection = 'column';
        visibleDiv.style.flexWrap = 'nowrap';
        btn.textContent = 'Show less';
        btn.title = 'Hide additional licenses';
    }
}

function getLicenseClass(license) {
    if (license.includes('Acrobat')) return 'license-acrobat';
    if (license.includes('Creative Cloud')) return 'license-cc';
    if (license.includes('Photoshop')) return 'license-photoshop';
    if (license.includes('Illustrator')) return 'license-illustrator';
    return 'license-other';
}

function renderEmail(email) {
    if (!email) return '';
    const maxLength = 25;
    if (email.length <= maxLength) {
        return email;
    }
    const truncated = email.substring(0, maxLength) + '...';
    return `<span title="${email.replace(/"/g, '&quot;')}">${truncated}</span>`;
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
        return `<span class="activity-recent" title="${diffMinutes} minutes ago">${diffMinutes}m</span>`;
    } else if (diffHours < 24) {
        return `<span class="activity-recent" title="${diffHours} hours ago">${diffHours}h</span>`;
    } else if (diffDays < 7) {
        return `<span class="activity-recent" title="${diffDays} days ago">${diffDays}d</span>`;
    } else if (diffDays < 30) {
        return `<span class="activity-inactive" title="${diffDays} days ago">${diffDays}d</span>`;
    } else {
        const shortDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<span class="activity-old" title="${date.toLocaleDateString()}">${shortDate}</span>`;
    }
}

function renderStatusBadge(user) {
    const status = getUserStatus(user);
    const badges = {
        active: '<span class="status-badge status-active">Enabled</span>',
        inactive: '<span class="status-badge status-inactive">Disabled</span>',
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

// Get hidden users from localStorage
function getHiddenUsers() {
    try {
        const hidden = localStorage.getItem('hiddenUsers');
        return hidden ? JSON.parse(hidden) : [];
    } catch {
        return [];
    }
}

function applyFilters() {
    const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || '';
    const licenseFilter = document.getElementById('license-filter')?.value || '';
    const statusFilter = document.getElementById('status-filter')?.value || '';
    const hiddenUsers = getHiddenUsers();
    
    filteredUsers = usersData.filter(user => {
        // Hide filter - exclude hidden users
        if (hiddenUsers.includes(user.email)) {
            return false;
        }
        
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

// Expose applyFilters to window for modal to call
window.applyUserFilters = applyFilters;

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
    // ✅ Convert to slide-over panel (same style as apps page)
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'edit-user-modal';
    
    // ✅ Merge both Adobe licenses (user.licenses) and Microsoft licenses (user.entraLicenses) for display
    const adobeLicenses = Array.isArray(user.licenses) ? user.licenses : [];
    const entraLicenses = Array.isArray(user.entraLicenses) ? user.entraLicenses : [];
    const allLicenses = [...adobeLicenses, ...entraLicenses];
    const uniqueLicenses = [...new Set(allLicenses.map(l => String(l).trim()))].filter(l => l.length > 0);
    
    // ✅ Track which licenses are from Entra (read-only)
    const entraLicensesSet = new Set(entraLicenses.map(l => String(l).trim()));
    
    const licensesHTML = uniqueLicenses.length > 0 
        ? uniqueLicenses.map((license, idx) => {
            const isEntraLicense = entraLicensesSet.has(String(license).trim());
            const escapedLicense = String(license).replace(/"/g, '&quot;');
            return `
            <div class="license-input-group" style="margin-bottom: 0.5rem;">
                <input type="text" class="form-input license-input" value="${escapedLicense}" data-index="${idx}" ${isEntraLicense ? 'data-entra="true" readonly' : ''} ${isEntraLicense ? 'style="background: var(--bg-secondary); cursor: not-allowed;"' : ''}>
                ${isEntraLicense ? '' : `<button type="button" class="btn btn-icon btn-danger" onclick="removeLicenseElement(this)">🗑️</button>`}
            </div>
            ${isEntraLicense ? `<div style="margin-bottom: 0.5rem;"><span class="label-hint" style="font-size: 0.75rem; color: var(--text-tertiary);">Managed by Microsoft</span></div>` : ''}`;
        }).join('')
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
        <div class="modal-backdrop" onclick="closeEditModal()"></div>
        <div class="modal-content user-edit-slide-over">
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
                        <p><strong>Activity:</strong> ${user.activityCount || 0} events</p>
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
    
    // ✅ Show modal with slide-over animation
    modal.style.display = 'flex';
    
    // Attach form submit handler
    const form = document.getElementById('edit-user-form');
    form.addEventListener('submit', saveUserEdit);
    
    // ✅ Close on Escape key
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeEditModal();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

function closeEditModal() {
    const modal = document.getElementById('edit-user-modal');
    if (modal) {
        // ✅ Remove backdrop/blur instantly (no transition) while panel slides out
        const backdrop = modal.querySelector('.modal-backdrop');
        if (backdrop) {
            backdrop.style.opacity = '0';
            backdrop.style.transition = 'none'; // Instant removal
        }
        
        // ✅ Slide-out animation for panel (happens simultaneously with unblur)
        const modalContent = modal.querySelector('.user-edit-slide-over');
        if (modalContent) {
            modalContent.style.animation = 'slideOutRight 0.3s ease-out';
            setTimeout(() => {
                modal.remove();
            }, 300);
        } else {
            modal.remove();
        }
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
    const adminRolesInput = document.getElementById('edit-adminRoles');
    const userGroupsInput = document.getElementById('edit-userGroups');
    const adminRoles = adminRolesInput ? adminRolesInput.value.trim() : undefined;
    const userGroups = userGroupsInput ? userGroupsInput.value.trim() : undefined;
    
    // ✅ Collect licenses - only save editable (non-Entra) licenses
    // Entra licenses are read-only and managed by Microsoft sync
    const licenseInputs = document.querySelectorAll('.license-input:not([data-entra="true"])');
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
            if (typeof Toast !== 'undefined') {
                Toast.success('User updated successfully');
            } else {
                alert('✓ User updated successfully');
            }
            closeEditModal();
            
            // Refresh the page to show updates after notification
            setTimeout(() => {
                window.location.reload();
            }, 800);
        } else {
            throw new Error(result.error || 'Failed to update user');
        }
    } catch (error) {
        console.error('Update error:', error);
        if (typeof Toast !== 'undefined') {
            Toast.error('Failed to update user: ' + error.message);
        } else {
            alert('✗ Error: ' + error.message);
        }
    }
}

// ============================================
// User Selection and Merge Functionality
// ============================================

function setupSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    if (!selectAllCheckbox) return;
    
    selectAllCheckbox.addEventListener('change', function() {
        const checkboxes = document.querySelectorAll('.user-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = this.checked;
        });
        handleCheckboxChange();
    });
}

function handleCheckboxChange() {
    const checkboxes = document.querySelectorAll('.user-checkbox');
    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
    const deleteAllBtn = document.getElementById('delete-all-btn');
    const selectedActions = document.getElementById('selected-actions');
    
    if (checkedCount > 0) {
        // Hide "Delete All" button, show "Merge Selected" and "Delete Selected"
        if (deleteAllBtn) deleteAllBtn.style.display = 'none';
        if (selectedActions) {
            selectedActions.style.display = 'flex';
        }
    } else {
        // Show "Delete All" button, hide selection actions
        if (deleteAllBtn) deleteAllBtn.style.display = 'inline-block';
        if (selectedActions) {
            selectedActions.style.display = 'none';
        }
    }
    
    // Update select all checkbox state
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    if (selectAllCheckbox) {
        const allChecked = checkedCount === checkboxes.length && checkboxes.length > 0;
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
    }
}

function getSelectedUserEmails() {
    const checkboxes = document.querySelectorAll('.user-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.getAttribute('data-email'));
}

async function mergeSelectedUsers() {
    const selectedEmails = getSelectedUserEmails();
    
    if (selectedEmails.length < 2) {
        if (typeof Toast !== 'undefined') {
            Toast.error('Please select at least 2 users to merge');
        } else {
            alert('Please select at least 2 users to merge');
        }
        return;
    }
    
    // Find which user has Entra data (should be the target)
    const users = selectedEmails.map(email => usersData.find(u => u.email === email)).filter(Boolean);
    const entraUser = users.find(u => u.entraId || u.entraAccountEnabled !== null);
    
    if (!entraUser) {
        if (typeof Toast !== 'undefined') {
            Toast.error('At least one selected user must have Entra data to merge into');
        } else {
            alert('At least one selected user must have Entra data to merge into');
        }
        return;
    }
    
    const targetEmail = entraUser.email;
    const sourceEmails = selectedEmails.filter(email => email !== targetEmail);
    
    // Create detailed message for the merge - show all info without dropdown
    const sourceUsersInfo = sourceEmails.map(email => {
        const user = usersData.find(u => u.email === email);
        const licenses = user ? (getDisplayLicenses(user) || []).join(', ') || 'No License' : 'Unknown';
        return `<div style="padding: 8px; margin-bottom: 8px; background: var(--bg-secondary); border-radius: 6px;">
            <div style="font-weight: 500; margin-bottom: 4px;">${user ? `${user.firstName} ${user.lastName}` : email}</div>
            <div style="font-size: 0.875rem; color: var(--text-secondary);">${email}</div>
            <div style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 4px;">Licenses: ${licenses}</div>
        </div>`;
    }).join('');
    
    const targetUser = usersData.find(u => u.email === targetEmail);
    const targetLicenses = targetUser ? (getDisplayLicenses(targetUser) || []).join(', ') || 'No License' : 'Unknown';
    
    const detailsMessage = `
        <div style="text-align: left; margin-top: 16px;">
            <div style="margin-bottom: 16px; padding: 12px; background: var(--accent-light); border-left: 3px solid var(--accent-primary); border-radius: 6px;">
                <div style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 4px;">Merging into:</div>
                <div style="font-weight: 600; font-size: 1.1rem; color: var(--accent-primary); margin-bottom: 4px;">
                    ${targetUser ? `${targetUser.firstName} ${targetUser.lastName}` : targetEmail}
                </div>
                <div style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 4px;">${targetEmail}</div>
                <div style="font-size: 0.875rem; color: var(--text-secondary);">Licenses: ${targetLicenses}</div>
            </div>
            
            <div style="margin-bottom: 12px;">
                <div style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 8px;">
                    ${sourceEmails.length} user(s) will be merged:
                </div>
                ${sourceUsersInfo}
            </div>
            
            <div style="margin-top: 16px; padding: 12px; background: var(--bg-secondary); border-radius: 6px;">
                <div style="font-weight: 500; margin-bottom: 8px;">This will:</div>
                <ul style="margin-left: 20px; margin-bottom: 0; line-height: 1.8; font-size: 0.938rem;">
                    <li>Keep all data from <strong>${targetEmail}</strong></li>
                    <li>Add licenses from the other user(s)</li>
                    <li>Delete the other user(s)</li>
                </ul>
            </div>
        </div>
    `;
    
    const confirmed = await ConfirmModal.show({
        title: 'Merge Users?',
        message: detailsMessage,
        confirmText: 'Merge',
        cancelText: 'Cancel',
        type: 'warning'
    });
    
    if (!confirmed) return;
    
    try {
        const response = await fetch('/api/users/merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetEmail: targetEmail,
                sourceEmails: sourceEmails
            })
        });
        
        // Check if response is JSON before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('Non-JSON response:', text);
            throw new Error('Server returned an error. Please check the console for details.');
        }
        
        const data = await response.json();
        
        if (response.ok) {
            if (typeof Toast !== 'undefined') {
                Toast.success(`Successfully merged ${sourceEmails.length} user(s) into ${targetEmail}`);
            } else {
                alert(`✓ Successfully merged ${sourceEmails.length} user(s) into ${targetEmail}`);
            }
            
            // Reload the page to show updated data
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            throw new Error(data.error || 'Merge failed');
        }
    } catch (error) {
        console.error('Merge error:', error);
        if (typeof Toast !== 'undefined') {
            Toast.error('Failed to merge users: ' + error.message);
        } else {
            alert('✗ Error: ' + error.message);
        }
    }
}

async function deleteSelectedUsers() {
    const selectedEmails = getSelectedUserEmails();
    
    if (selectedEmails.length === 0) {
        if (typeof Toast !== 'undefined') {
            Toast.error('Please select at least one user to delete');
        } else {
            alert('Please select at least one user to delete');
        }
        return;
    }
    
    const confirmed = await ConfirmModal.show({
        title: 'Delete Selected Users?',
        message: `Delete ${selectedEmails.length} selected user(s)?\n\nThis action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        type: 'danger'
    });
    
    if (!confirmed) return;
    
    try {
        const response = await fetch('/api/users/bulk', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emails: selectedEmails })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (typeof Toast !== 'undefined') {
                Toast.success(`Successfully deleted ${selectedEmails.length} user(s)`);
            } else {
                alert(`✓ Successfully deleted ${selectedEmails.length} user(s)`);
            }
            
            // Reload the page to show updated data
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            throw new Error(data.error || 'Delete failed');
        }
    } catch (error) {
        console.error('Delete error:', error);
        if (typeof Toast !== 'undefined') {
            Toast.error('Failed to delete users: ' + error.message);
        } else {
            alert('✗ Error: ' + error.message);
        }
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

// Expose functions to window for onclick handlers
window.deleteAllUsers = deleteAllUsers;
window.deleteSelectedUsers = deleteSelectedUsers;
window.removeUsernameElement = removeUsernameElement;
window.removeLicenseElement = removeLicenseElement;

