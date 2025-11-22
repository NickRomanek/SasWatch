// Applications dashboard client-side logic with selection & merging

const APP_SYNC_BACKFILL_HOURS = 24;

let appsData = [];
let appsByKey = new Map();
let selectedAppKeys = new Set();
let currentAppContext = null;
let currentMergeSelection = [];

// Sync log functions
function getAppsSyncLogElement() {
    return document.getElementById('apps-sync-log-output');
}

function appendAppsSyncLog(message, { allowDuplicate = false } = {}) {
    if (!message) return;
    if (!allowDuplicate && appendAppsSyncLog.lastMessage === message) {
        return;
    }
    appendAppsSyncLog.lastMessage = message;

    const logEl = getAppsSyncLogElement();
    if (!logEl) return;

    const timestamp = new Date().toLocaleTimeString();
    const line = `[${timestamp}] ${message}`;
    logEl.textContent = logEl.textContent && !logEl.textContent.includes('Ready to sync')
        ? `${logEl.textContent}\n${line}`
        : line;
    logEl.scrollTop = logEl.scrollHeight;
}
appendAppsSyncLog.lastMessage = null;

function resetAppsSyncLog(initialMessage) {
    appendAppsSyncLog.lastMessage = null;
    const logEl = getAppsSyncLogElement();
    if (logEl) {
        logEl.textContent = '';
    }
    if (initialMessage) {
        appendAppsSyncLog(initialMessage, { allowDuplicate: true });
    }
}

let editModal;
let editForm;
let editAppIdInput;
let editAppSourceInput;
let editAppNameInput;
let detailModal;
let currentDetailApp = null;
let editAppVendorInput;
let editAppLicensesInput;
let editAppDetected;
let editAppDetectedWrapper;
let editAppContextBadge;
let editAppHelper;
let editAppTitle;
let hideAppButton;
let deleteAppButton;
let editAppComponentsWrapper;
let editAppComponentsList;
let editAppComponentsCount;

let mergeModal;
let mergeForm;
let mergePrimaryList;
let mergeSelectedList;
let mergeVendorInput;
let mergeNameInput;
let mergeLicensesInput;
let mergeSummary;

document.addEventListener('DOMContentLoaded', () => {
    cacheEditModalRefs();
    cacheMergeModalRefs();

    const searchInput = document.getElementById('search-apps');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
    }

    if (Array.isArray(window.initialAppsData)) {
        applyAppsDataset({
            apps: window.initialAppsData,
            stats: window.initialAppStats
        });
    }

    loadApps();
});

function cacheEditModalRefs() {
    detailModal = document.getElementById('app-detail-modal');
    editForm = document.getElementById('app-detail-edit-form');
    editAppIdInput = document.getElementById('app-detail-id');
    editAppSourceInput = document.getElementById('app-detail-source');
    editAppNameInput = document.getElementById('app-detail-name-input');
    editAppVendorInput = document.getElementById('app-detail-vendor-input');
    editAppLicensesInput = document.getElementById('app-detail-licenses-input');
    editAppDetected = document.getElementById('app-detail-detected');
    editAppDetectedWrapper = document.getElementById('app-detail-detected-wrapper');
    editAppHelper = document.getElementById('app-detail-helper');
    hideAppButton = document.getElementById('app-detail-hide-button');
    deleteAppButton = document.getElementById('app-detail-delete-button');
    editAppComponentsWrapper = document.getElementById('app-detail-components-wrapper');
    editAppComponentsList = document.getElementById('app-detail-components-list');
    editAppComponentsCount = document.getElementById('app-detail-components-count');

    if (deleteAppButton) {
        deleteAppButton.style.display = 'none';
    }

    if (editForm) {
        editForm.addEventListener('submit', handleEditSubmit);
    }

    if (detailModal) {
        detailModal.addEventListener('click', event => {
            if (event.target === detailModal) {
                closeAppDetailModal();
            }
        });
    }

    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && detailModal && detailModal.style.display === 'flex') {
            closeAppDetailModal();
        }
    });

    if (hideAppButton) {
        hideAppButton.addEventListener('click', handleHideApp);
    }

    if (deleteAppButton) {
        deleteAppButton.addEventListener('click', handleDeleteApp);
    }
}

function openAddAppModal() {
    if (!detailModal) {
        return;
    }

    currentAppContext = {
        id: null,
        sourceKey: null,
        isManual: true,
        mode: 'create'
    };

    // Set modal header
    document.getElementById('app-detail-name').textContent = 'Add Application';
    document.getElementById('app-detail-vendor').textContent = 'Manual entry';
    document.getElementById('app-detail-vendor').className = 'status-badge status-warning';
    document.getElementById('app-detail-users-count').textContent = '0';
    document.getElementById('app-detail-licenses-count').textContent = '0';
    document.getElementById('app-detail-license-status').innerHTML = '';
    document.getElementById('users-tab-count').textContent = '0';

    // Clear form fields
    editAppIdInput.value = '';
    editAppSourceInput.value = '';
    editAppNameInput.value = '';
    editAppVendorInput.value = '';
    editAppLicensesInput.value = '';
    if (editAppDetected) {
        editAppDetected.textContent = '0';
    }

    if (editAppDetectedWrapper) {
        editAppDetectedWrapper.style.display = 'none';
    }

    if (editAppComponentsWrapper) {
        editAppComponentsWrapper.style.display = 'none';
    }
    if (editAppComponentsList) {
        editAppComponentsList.innerHTML = '';
    }
    if (editAppComponentsCount) {
        editAppComponentsCount.textContent = '';
    }

    if (editAppHelper) {
        editAppHelper.textContent = 'Create a manual application entry to track licenses or placeholders that are not auto-detected.';
    }

    if (hideAppButton) {
        hideAppButton.style.display = 'none';
    }
    if (deleteAppButton) {
        deleteAppButton.style.display = 'none';
    }

    // Switch to settings tab and show modal
    switchAppDetailTab('settings');
    detailModal.style.display = 'flex';

    // Clear users table
    const usersTableBody = document.getElementById('app-detail-users-table-body');
    if (usersTableBody) {
        usersTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No users detected for this application.</td></tr>';
    }

    if (editAppNameInput) {
        setTimeout(() => {
            editAppNameInput.focus();
        }, 0);
    }
}

function cacheMergeModalRefs() {
    mergeModal = document.getElementById('app-merge-modal');
    mergeForm = document.getElementById('merge-apps-form');
    mergePrimaryList = document.getElementById('merge-primary-list');
    mergeSelectedList = document.getElementById('merge-selected-list');
    mergeVendorInput = document.getElementById('merge-app-vendor');
    mergeNameInput = document.getElementById('merge-app-name');
    mergeLicensesInput = document.getElementById('merge-app-licenses');
    mergeSummary = document.getElementById('merge-summary');

    if (mergeForm) {
        mergeForm.addEventListener('submit', handleMergeSubmit);
    }

    if (mergeModal) {
        mergeModal.addEventListener('click', event => {
            if (event.target === mergeModal) {
                closeMergeAppsModal();
            }
        });
    }
}

async function loadApps() {
    try {
        const response = await fetch('/api/apps');
        if (!response.ok) {
            throw new Error('Failed to fetch apps');
        }

        const data = await response.json();
        applyAppsDataset(data);
    } catch (error) {
        console.error('Error loading apps:', error);
        showToast('Failed to load applications. Refresh the page to try again.', 'error');
        applyAppsDataset({ apps: [], stats: {} });
    }
}

function applyAppsDataset(data = {}) {
    appsData = Array.isArray(data.apps) ? data.apps : [];
    rebuildAppMaps();
    pruneSelection();
    updateStats(data.stats || {});
    renderAppsTable(appsData);
    updateAppsSelectionUI();
}

function rebuildAppMaps() {
    appsByKey.clear();
    appsData.forEach(app => {
        appsByKey.set(getAppKey(app), app);
    });
}

function pruneSelection() {
    selectedAppKeys = new Set(Array.from(selectedAppKeys).filter(key => appsByKey.has(key)));
}

function updateStats(stats) {
    setText('total-apps', stats.totalApps || 0);
    setText('total-unused', stats.totalUnused || 0);
    setText('total-licenses', stats.totalLicenses || 0);
    setText('apps-count', stats.totalApps || 0);
}

function renderAppsTable(apps) {
    const tbody = document.getElementById('apps-table-body');
    if (!tbody) {
        return;
    }

    const size = Array.isArray(apps) ? apps.length : 0;
    setText('apps-count', size);

    if (size === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    ${appsData.length === 0
                        ? 'No applications detected yet. Activity will populate this view automatically.'
                        : 'No applications match your search.'}
                </td>
            </tr>
        `;
        attachAppsTableHandlers();
        return;
    }

    tbody.innerHTML = apps.map(app => {
        const key = getAppKey(app);
        const isChecked = selectedAppKeys.has(key) ? 'checked' : '';
        const unusedMeta = getUnusedMeta(app);

        return `
        <tr data-app-key="${escapeHtml(key)}">
            <td>
                <input type="checkbox"
                    class="app-select-checkbox"
                    data-app-key="${escapeHtml(key)}"
                    data-app-id="${escapeHtml(app.id || '')}"
                    data-app-source="${escapeHtml(app.sourceKey || '')}"
                    data-app-name="${escapeHtml(app.name)}"
                    data-app-vendor="${escapeHtml(app.vendor)}"
                    data-app-detected="${app.detectedUsers ?? 0}"
                    data-app-licenses="${app.licensesOwned ?? 0}"
                    ${isChecked}>
            </td>
            <td>
                <a href="#" onclick="openAppDetailModal('${escapeHtml(app.id || '')}', '${escapeHtml(app.sourceKey || '')}', event)" 
                   class="app-name-link" 
                   style="color: var(--text-primary); text-decoration: none; font-weight: 500; cursor: pointer;"
                   title="Click to view details">
                    ${escapeHtml(app.name)}
                </a>
            </td>
            <td>${escapeHtml(app.vendor)}</td>
            <td>${app.detectedUsers ?? 0}</td>
            <td>${app.licensesOwned ?? 0}</td>
            <td>
                <span class="${unusedMeta.badgeClass}">
                    <span>${unusedMeta.icon}</span>
                    <span>${unusedMeta.label}</span>
                </span>
            </td>
        </tr>
        `;
    }).join('');

    attachAppsTableHandlers();
}

function attachAppsTableHandlers() {
    const selectAll = document.getElementById('apps-select-all');
    if (selectAll) {
        selectAll.onchange = handleAppSelectAllChange;
        const total = appsByKey.size;
        const selected = selectedAppKeys.size;
        const shouldCheck = total > 0 && selected === total;
        if (selectAll.checked !== shouldCheck) {
            selectAll.checked = shouldCheck;
        }
        selectAll.indeterminate = selected > 0 && selected < total;
    }

    document.querySelectorAll('.app-select-checkbox').forEach(cb => {
        cb.onchange = handleAppCheckboxChange;
    });
}

let isUpdatingSelectionUI = false;
let isBulkChangingCheckboxes = false;

function handleAppCheckboxChange(event) {
    if (isBulkChangingCheckboxes) {
        return;
    }

    const checkbox = event.target;
    const key = checkbox.dataset.appKey;
    if (!key) return;

    if (checkbox.checked) {
        selectedAppKeys.add(key);
    } else {
        selectedAppKeys.delete(key);
    }

    updateAppsSelectionUI();
}

function handleAppSelectAllChange(event) {
    const checked = event.target.checked;
    const checkboxes = document.querySelectorAll('.app-select-checkbox');

    isBulkChangingCheckboxes = true;
    try {
        if (checked) {
            checkboxes.forEach(cb => {
                if (!cb.dataset.appKey) return;
                if (!cb.checked) {
                    cb.checked = true;
                }
                selectedAppKeys.add(cb.dataset.appKey);
            });
        } else {
            checkboxes.forEach(cb => {
                if (cb.checked) {
                    cb.checked = false;
                }
            });
            selectedAppKeys.clear();
        }
    } finally {
        isBulkChangingCheckboxes = false;
    }

    updateAppsSelectionUI();
}

function updateAppsSelectionUI() {
    if (isUpdatingSelectionUI) return;
    isUpdatingSelectionUI = true;

    const bulkActions = document.getElementById('apps-bulk-actions');
    const selectedCountLabel = document.getElementById('apps-selected-count');
    const selectAll = document.getElementById('apps-select-all');
    const deleteButton = document.getElementById('delete-all-apps-btn');
    const selectedCount = selectedAppKeys.size;

    if (bulkActions) {
        bulkActions.style.display = selectedCount > 0 ? 'flex' : 'none';
    }

    if (selectedCountLabel) {
        selectedCountLabel.textContent = `${selectedCount} selected`;
    }

    if (deleteButton && deleteButton.dataset.busy !== 'true') {
        if (selectedCount > 0) {
            deleteButton.innerHTML = '🗑️ Delete Selected';
            deleteButton.title = 'Delete selected applications';
        } else {
            deleteButton.innerHTML = '🗑️ Delete All';
            deleteButton.title = 'Delete all manual applications and overrides';
        }
    }

    if (selectAll) {
        const total = appsByKey.size;
        const shouldCheck = selectedCount > 0 && selectedCount === total;
        const shouldIndeterminate = selectedCount > 0 && selectedCount < total;

        if (selectAll.checked !== shouldCheck) {
            selectAll.checked = shouldCheck;
        }
        selectAll.indeterminate = shouldIndeterminate;
    }

    isUpdatingSelectionUI = false;
}

function clearAppSelection(silent = false) {
    selectedAppKeys.clear();
    if (!silent) {
        isBulkChangingCheckboxes = true;
        try {
            document.querySelectorAll('.app-select-checkbox').forEach(cb => {
                if (cb.checked) {
                    cb.checked = false;
                }
            });
        } finally {
            isBulkChangingCheckboxes = false;
        }
    }
    updateAppsSelectionUI();
}

function handleSearch(event) {
    const query = event.target.value.trim().toLowerCase();
    if (!query) {
        renderAppsTable(appsData);
        updateAppsSelectionUI();
        return;
    }

    const filtered = appsData.filter(app => {
        const unusedMeta = getUnusedMeta(app);
        return (
            app.vendor.toLowerCase().includes(query) ||
            app.name.toLowerCase().includes(query) ||
            unusedMeta.label.toLowerCase().includes(query)
        );
    });

    renderAppsTable(filtered);
}

async function handleEditSubmit(event) {
    event.preventDefault();

    if (!currentAppContext) {
        closeAppDetailModal();
        return;
    }

    const vendor = (editAppVendorInput.value || '').trim();
    const name = (editAppNameInput.value || '').trim();
    const licensesOwned = parseInt(editAppLicensesInput.value, 10);

    if (!vendor || !name) {
        showToast('Vendor and application name are required.', 'error');
        return;
    }

    const payload = {
        vendor,
        name,
        licensesOwned: Number.isNaN(licensesOwned) ? 0 : Math.max(0, licensesOwned)
    };

    let url;
    let method;
    let body;
    const isCreate = currentAppContext.mode === 'create';

    if (isCreate) {
        url = '/api/apps';
        method = 'POST';
        body = JSON.stringify(payload);
    } else if (currentAppContext.id) {
        url = `/api/apps/${currentAppContext.id}`;
        method = 'PUT';
        body = JSON.stringify(payload);
    } else if (currentAppContext.sourceKey) {
        url = '/api/apps/override';
        method = 'POST';
        body = JSON.stringify({ ...payload, sourceKey: currentAppContext.sourceKey });
    } else {
        showToast('Unable to determine app context.', 'error');
        return;
    }

    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to save application');
        }

        showToast(isCreate ? 'Application added successfully.' : 'Application updated successfully.', 'success');
        closeAppDetailModal();
        await loadApps();
    } catch (error) {
        console.error('Error saving application:', error);
        showToast(error.message || 'Failed to save application', 'error');
    }
}

function findApp(appId, sourceKey) {
    const key = appId ? `manual:${appId}` : sourceKey ? `auto:${sourceKey}` : null;
    if (key && appsByKey.has(key)) {
        return appsByKey.get(key);
    }
    return appsData.find(app => {
        if (appId && app.id) {
            return app.id === appId;
        }
        if (!appId && sourceKey) {
            return (app.sourceKey || '') === sourceKey;
        }
        return false;
    });
}

// ✅ Backwards compatibility: Redirect to detail modal on settings tab
function openAppEditModal(appId, sourceKey) {
    // Open detail modal and switch to settings tab
    openAppDetailModal(appId, sourceKey).then(() => {
        switchAppDetailTab('settings');
    }).catch(error => {
        console.error('Error opening app detail:', error);
        showToast('Unable to open application details.', 'error');
    });
}

function closeAppEditModal() {
    // Redirect to detail modal close
    closeAppDetailModal();
}

// ✅ NEW: App Detail Modal Functions
async function openAppDetailModal(appId, sourceKey, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (!detailModal) {
        console.error('Detail modal not found');
        return Promise.reject(new Error('Detail modal not found'));
    }

    // Show loading state
    detailModal.style.display = 'flex';
    const usersTableBody = document.getElementById('app-detail-users-table-body');
    if (usersTableBody) {
        usersTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem;"><div class="loading">Loading application details...</div></td></tr>';
    }

    // Switch to Users tab
    switchAppDetailTab('users');

    try {
        // Fetch app details from API
        const params = new URLSearchParams();
        if (appId) params.append('id', appId);
        if (sourceKey) params.append('sourceKey', sourceKey);

        const response = await fetch(`/api/apps/detail?${params.toString()}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Failed to load app details`);
        }

        const appDetail = await response.json();
        currentDetailApp = appDetail;

        // Populate header
        document.getElementById('app-detail-name').textContent = appDetail.name || 'Unknown Application';
        document.getElementById('app-detail-vendor').textContent = appDetail.vendor || 'Uncategorized';
        document.getElementById('app-detail-users-count').textContent = appDetail.totalUsers || appDetail.detectedUsers || 0;
        document.getElementById('app-detail-licenses-count').textContent = appDetail.licensesOwned || 0;
        document.getElementById('users-tab-count').textContent = appDetail.totalUsers || appDetail.detectedUsers || 0;

        // Calculate license status
        const unusedLicenses = (appDetail.licensesOwned || 0) - (appDetail.totalUsers || appDetail.detectedUsers || 0);
        const licenseStatusBadge = document.getElementById('app-detail-license-status');
        if (licenseStatusBadge) {
            if (unusedLicenses > 0) {
                licenseStatusBadge.className = 'stat-badge status-success';
                licenseStatusBadge.innerHTML = `<span class="stat-icon">🪑</span>${unusedLicenses} unused`;
            } else if (unusedLicenses < 0) {
                licenseStatusBadge.className = 'stat-badge status-danger';
                licenseStatusBadge.innerHTML = `<span class="stat-icon">⚠️</span>${Math.abs(unusedLicenses)} short`;
            } else {
                licenseStatusBadge.className = 'stat-badge status-neutral';
                licenseStatusBadge.innerHTML = '<span class="stat-icon">✅</span>Balanced';
            }
        }

        // Populate users table
        renderAppDetailUsers(appDetail.userDetails || []);

        // Populate settings tab with edit form data
        populateAppDetailSettings(appDetail);

        return appDetail;
    } catch (error) {
        console.error('Error loading app details:', error);
        if (usersTableBody) {
            usersTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-danger);">Failed to load application details: ${error.message}</td></tr>`;
        }
        showToast('Failed to load application details', 'error');
        throw error;
    }
}

function renderAppDetailUsers(userDetails) {
    const usersTableBody = document.getElementById('app-detail-users-table-body');
    if (!usersTableBody) return;

    if (!userDetails || userDetails.length === 0) {
        usersTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No users detected for this application.</td></tr>';
        return;
    }

    usersTableBody.innerHTML = userDetails.map(user => {
        const sourceBadge = user.source === 'entra' ? 'status-success' : user.source === 'adobe' ? 'status-info' : 'status-neutral';
        
        // Format licenses - show first 2, then "+X more" if there are more
        const licenses = Array.isArray(user.licenses) ? user.licenses : [];
        let licensesDisplay = '';
        if (licenses.length === 0) {
            licensesDisplay = '<span style="color: var(--text-secondary);">—</span>';
        } else if (licenses.length <= 2) {
            licensesDisplay = licenses.map(l => `<span class="license-badge">${escapeHtml(l)}</span>`).join(' ');
        } else {
            const firstTwo = licenses.slice(0, 2);
            const remaining = licenses.length - 2;
            licensesDisplay = firstTwo.map(l => `<span class="license-badge">${escapeHtml(l)}</span>`).join(' ') +
                ` <span style="color: var(--text-secondary); font-size: 0.85rem;">+${remaining} more</span>`;
        }
        
        return `
            <tr>
                <td title="${escapeHtml(user.displayName || 'Unknown User')}">${escapeHtml(user.displayName || 'Unknown User')}</td>
                <td title="${user.email ? escapeHtml(user.email) : ''}">${user.email ? escapeHtml(user.email) : '<span style="color: var(--text-secondary);">—</span>'}</td>
                <td>${user.lastSeenFormatted || formatRelativeTime(user.lastSeen)}</td>
                <td title="${escapeHtml(user.device || 'Unknown Device')}">${escapeHtml(user.device || 'Unknown Device')}</td>
                <td title="${licenses.map(l => escapeHtml(l)).join(', ')}">${licensesDisplay}</td>
                <td><span class="status-badge ${sourceBadge}">${user.source || 'unknown'}</span></td>
            </tr>
        `;
    }).join('');
}

function formatRelativeTime(isoDate) {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

function populateAppDetailSettings(appDetail) {
    if (!appDetail) return;

    editAppIdInput.value = appDetail.id || '';
    editAppSourceInput.value = appDetail.sourceKey || '';
    editAppNameInput.value = appDetail.name || '';
    editAppVendorInput.value = appDetail.vendor || '';
    editAppLicensesInput.value = appDetail.licensesOwned || 0;
    if (editAppDetected) {
        editAppDetected.textContent = appDetail.detectedUsers || 0;
    }
    if (editAppDetectedWrapper) {
        editAppDetectedWrapper.style.display = 'flex';
    }

    // Store context for edit operations
    currentAppContext = {
        id: appDetail.id || null,
        sourceKey: appDetail.sourceKey || null,
        isManual: !!appDetail.isManual,
        vendor: appDetail.vendor,
        name: appDetail.name,
        licensesOwned: appDetail.licensesOwned ?? 0
    };

    const unusedMeta = getUnusedMeta(appDetail);
    renderAppComponents(appDetail);

    if (appDetail.isManual) {
        if (editAppHelper) {
            editAppHelper.textContent = `This application was added manually. Update the name, vendor, or license count as needed. Currently ${formatUnusedSummary(unusedMeta)}.`;
        }
        if (deleteAppButton) {
            deleteAppButton.style.display = 'inline-flex';
        }
    } else {
        if (editAppHelper) {
            editAppHelper.textContent = `This application was detected from recent activity. Changes here update how it appears in reports and dashboards. Currently ${formatUnusedSummary(unusedMeta)}.`;
        }
        if (deleteAppButton) {
            deleteAppButton.style.display = 'none';
        }
    }

    if (hideAppButton) {
        hideAppButton.style.display = 'inline-flex';
    }
}

function switchAppDetailTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        if (tab.id.startsWith('app-detail-')) {
            tab.style.display = 'none';
            tab.classList.remove('active');
        }
    });

    // Remove active class from all buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected tab
    const selectedTab = document.getElementById(`app-detail-${tabName}-tab`);
    const selectedButton = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);

    if (selectedTab) {
        selectedTab.style.display = 'block';
        selectedTab.classList.add('active');
    }
    if (selectedButton) {
        selectedButton.classList.add('active');
    }
}

function closeAppDetailModal() {
    if (detailModal) {
        detailModal.style.display = 'none';
    }
    currentDetailApp = null;
    currentAppContext = null;
    if (editAppComponentsWrapper) {
        editAppComponentsWrapper.style.display = 'none';
    }
    if (editAppComponentsList) {
        editAppComponentsList.innerHTML = '';
    }
}

window.openAppDetailModal = openAppDetailModal;
window.closeAppDetailModal = closeAppDetailModal;
window.switchAppDetailTab = switchAppDetailTab;
window.openAppEditModal = openAppEditModal;
window.closeAppEditModal = closeAppEditModal;
window.openAddAppModal = openAddAppModal;
window.syncApplications = syncApplications;
window.deleteAllApplications = deleteAllApplications;
window.openMergeAppsModal = openMergeAppsModal;
window.closeMergeAppsModal = closeMergeAppsModal;

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value;
    }
}

async function handleHideApp() {
    if (!currentAppContext) {
        return;
    }

    if (!confirm('Hide this application from the list?')) {
        return;
    }

    const payload = currentAppContext.id
        ? { id: currentAppContext.id }
        : {
            sourceKey: currentAppContext.sourceKey,
            vendor: currentAppContext.vendor,
            name: currentAppContext.name,
            licensesOwned: currentAppContext.licensesOwned ?? 0
        };

    try {
        const response = await fetch('/api/apps/hide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to hide application');
        }

        showToast('Application hidden from list.', 'success');
        closeAppDetailModal();
        await loadApps();
    } catch (error) {
        console.error('Hide app error:', error);
        showToast(error.message || 'Failed to hide application', 'error');
    }
}

async function handleDeleteApp() {
    if (!currentAppContext || !currentAppContext.id) {
        return;
    }

    if (!confirm('Delete this application? This cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/apps/${currentAppContext.id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to delete application');
        }

        showToast('Application deleted.', 'success');
        closeAppDetailModal();
        await loadApps();
    } catch (error) {
        console.error('Delete app error:', error);
        showToast(error.message || 'Failed to delete application', 'error');
    }
}

async function syncApplications(event) {
    const button = event?.currentTarget || null;
    const previousLabel = button ? button.innerHTML : null;

    if (button) {
        button.disabled = true;
        button.innerHTML = '⏳ Syncing…';
    }

    resetAppsSyncLog('Apps sync requested');
    appendAppsSyncLog(`> POST /api/apps/sync (backfillHours: ${APP_SYNC_BACKFILL_HOURS})`, { allowDuplicate: true });

    const syncToast = createOrRefreshSyncToast('Syncing applications from recent activity…');

    try {
        const response = await fetch('/api/apps/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backfillHours: APP_SYNC_BACKFILL_HOURS })
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok || payload.success === false) {
            appendAppsSyncLog(`Sync failed: HTTP ${response.status}`, { allowDuplicate: true });
            if (payload.error) {
                appendAppsSyncLog(`Error: ${payload.error}`, { allowDuplicate: true });
            }
            throw new Error(payload.error || 'Failed to sync applications');
        }

        appendAppsSyncLog(`HTTP ${response.status} OK`, { allowDuplicate: true });
        
        // Log sync details
        const sync = payload.sync || {};
        if (sync.signInEventsInDb !== undefined) {
            appendAppsSyncLog(`Sign-in events in database: ${sync.signInEventsInDb}`, { allowDuplicate: true });
        }
        if (sync.reason) {
            appendAppsSyncLog(`Method: ${sync.reason}`, { allowDuplicate: true });
        }
        if (sync.message) {
            appendAppsSyncLog(`${sync.message}`, { allowDuplicate: true });
        }
        
        // Log apps data
        const apps = payload.apps || [];
        appendAppsSyncLog(`Applications found: ${apps.length}`, { allowDuplicate: true });
        if (apps.length > 0) {
            appendAppsSyncLog(`App names: ${apps.map(a => a.name).join(', ')}`, { allowDuplicate: true });
        } else if (sync.signInEventsInDb === 0) {
            appendAppsSyncLog(`⚠️ No sign-in events in database. Sync from Activity page first!`, { allowDuplicate: true });
        }

        applyAppsDataset(payload);
        clearAppSelection(true);

        dismissSyncToast();

        if (sync.error && sync.reason === 'graph-throttled') {
            appendAppsSyncLog('Warning: Microsoft Graph throttled (HTTP 429)', { allowDuplicate: true });
            showToast('Microsoft Graph throttled requests (HTTP 429). Showing cached data.', 'warning');
        } else if (sync.reason === 'throttled') {
            appendAppsSyncLog('Using recently cached data', { allowDuplicate: true });
            showToast('Microsoft Graph recently synced. Using cached data.', 'info');
        } else if (sync.synced) {
            const count = sync.count || 0;
            appendAppsSyncLog(`✓ Sync completed successfully`, { allowDuplicate: true });
            showToast(`Applications synced from recent activity (${count} sign-ins processed).`, 'success');
        } else if (sync.error) {
            appendAppsSyncLog(`Error: ${sync.message || 'Graph sync failed'}`, { allowDuplicate: true });
            showToast(sync.message || 'Microsoft Graph sync failed. Showing cached data.', 'error');
        } else {
            appendAppsSyncLog('Loaded from cached data', { allowDuplicate: true });
            showToast('Applications refreshed from cached data.', 'info');
        }
        
        appendAppsSyncLog('Apps sync completed.', { allowDuplicate: true });
    } catch (error) {
        console.error('Apps sync error:', error);
        appendAppsSyncLog(`Fatal error: ${error.message}`, { allowDuplicate: true });
        dismissSyncToast();
        showToast(error.message || 'Failed to sync applications', 'error');
        await loadApps();
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = previousLabel;
        }
    }
}

async function deleteAllApplications(event) {
    if (selectedAppKeys.size > 0) {
        await deleteSelectedApplications(event);
        return;
    }

    const confirmed = await Toast.confirm(
        'This removes every manual application and hides auto-detected entries for all users. You can repopulate the list by running another sync.',
        {
            title: 'Delete All Applications?',
            confirmText: 'Delete All',
            cancelText: 'Cancel',
            type: 'danger'
        }
    );

    if (!confirmed) {
        return;
    }

    const button = event?.currentTarget || null;
    const previousLabel = button ? button.innerHTML : null;

    if (button) {
        button.disabled = true;
        button.dataset.busy = 'true';
        button.dataset.originalLabel = previousLabel;
        button.innerHTML = '🗑️ Deleting…';
    }

    try {
        const response = await fetch('/api/apps', {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to delete applications');
        }

        showToast('All applications cleared. Run sync to repopulate from activity.', 'success');
        clearAppSelection(true);
        applyAppsDataset({ apps: [], stats: {} });
    } catch (error) {
        console.error('Delete all apps error:', error);
        showToast(error.message || 'Failed to delete applications', 'error');
    } finally {
        if (button) {
            button.disabled = false;
            delete button.dataset.busy;
            const fallback = button.dataset.originalLabel || '🗑️ Delete All';
            button.innerHTML = fallback;
            delete button.dataset.originalLabel;
        }
        updateAppsSelectionUI();
    }
}

async function deleteSelectedApplications(event) {
    const entries = buildDeletionEntriesFromSelection();
    if (entries.length === 0) {
        showToast('Select at least one application to delete.', 'warning');
        return;
    }

    const count = entries.length;

    const confirmed = await Toast.confirm(
        `This will remove ${count === 1 ? 'the selected application' : `${count} selected applications`} from the list. Auto-detected entries are hidden (can be restored later), and manual apps are permanently deleted.`,
        {
            title: count === 1 ? 'Delete Selected Application?' : `Delete ${count} Applications?`,
            confirmText: count === 1 ? 'Delete' : `Delete ${count}`,
            cancelText: 'Cancel',
            type: 'danger'
        }
    );

    if (!confirmed) {
        return;
    }

    const button = event?.currentTarget || document.getElementById('delete-all-apps-btn');
    const previousLabel = button ? button.innerHTML : null;

    if (button) {
        button.disabled = true;
        button.dataset.busy = 'true';
        button.dataset.originalLabel = previousLabel;
        button.innerHTML = '🗑️ Deleting…';
    }

    try {
        const response = await fetch('/api/apps/bulk', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries })
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok || payload.success === false) {
            const errorMessage = payload.error || 'Failed to delete selected applications';
            showToast(errorMessage, response.ok ? 'warning' : 'error');

            if (Array.isArray(payload.errors) && payload.errors.length > 0) {
                console.warn('Bulk delete applications warnings:', payload.errors);
            }
        } else {
            const manualDeleted = payload.manualDeleted ?? 0;
            const hiddenCount = payload.overridesHidden ?? 0;
            const totalHandled = manualDeleted + hiddenCount;
            const summaryParts = [];
            if (manualDeleted > 0) summaryParts.push(`${manualDeleted} manual`);
            if (hiddenCount > 0) summaryParts.push(`${hiddenCount} detected`);
            const summary = summaryParts.length > 0 ? summaryParts.join(' & ') : `${totalHandled} application${totalHandled === 1 ? '' : 's'}`;
            showToast(`Removed ${summary} from the list.`, 'success');
        }

        clearAppSelection(true);
        await loadApps();
    } catch (error) {
        console.error('Bulk delete applications error:', error);
        showToast(error.message || 'Failed to delete selected applications', 'error');
    } finally {
        if (button) {
            button.disabled = false;
            delete button.dataset.busy;
            const fallback = button.dataset.originalLabel || (selectedAppKeys.size > 0 ? '🗑️ Delete Selected' : '🗑️ Delete All');
            button.innerHTML = fallback;
            delete button.dataset.originalLabel;
        }
        updateAppsSelectionUI();
    }
}

function buildDeletionEntriesFromSelection() {
    const entries = [];

    selectedAppKeys.forEach(key => {
        const app = appsByKey.get(key);
        if (!app) {
            return;
        }

        const idSet = new Set();
        const sourceKeySet = new Set();

        if (app.id) {
            idSet.add(app.id);
        }
        if (app.sourceKey) {
            sourceKeySet.add(app.sourceKey);
        }

        if (Array.isArray(app.components)) {
            app.components.forEach(component => {
                if (component?.type === 'manual' && component.id) {
                    idSet.add(component.id);
                }
                if (component?.sourceKey) {
                    sourceKeySet.add(component.sourceKey);
                }
            });
        }

        if (idSet.size === 0 && sourceKeySet.size === 0) {
            return;
        }

        entries.push({
            ids: Array.from(idSet),
            sourceKeys: Array.from(sourceKeySet),
            vendor: app.vendor || 'Uncategorized',
            name: app.name || 'Unknown Application',
            licensesOwned: app.licensesOwned ?? 0
        });
    });

    return entries;
}

function createOrRefreshSyncToast(message) {
    dismissSyncToast();
    return showToast(message, 'info', { id: 'app-sync-toast', duration: 0 });
}

function dismissSyncToast() {
    const existingToast = document.querySelector('#app-sync-toast');
    if (existingToast) {
        existingToast.remove();
    }
}

function getUnusedMeta(app) {
    const unused = typeof app.unusedLicenses === 'number'
        ? app.unusedLicenses
        : ((app.licensesOwned || 0) - (app.detectedUsers || 0));

    if (unused > 0) {
        return {
            unusedLicenses: unused,
            icon: '🪑',
            badgeClass: 'status-badge status-success',
            label: `${unused} unused`
        };
    }

    if (unused < 0) {
        return {
            unusedLicenses: unused,
            icon: '⚠️',
            badgeClass: 'status-badge status-danger',
            label: `${Math.abs(unused)} short`
        };
    }

    return {
        unusedLicenses: 0,
        icon: '✅',
        badgeClass: 'status-badge status-neutral',
        label: 'Balanced'
    };
}

function formatUnusedSummary(meta) {
    if (meta.unusedLicenses > 0) {
        return `${meta.unusedLicenses} licenses are available`;
    }
    if (meta.unusedLicenses < 0) {
        return `${Math.abs(meta.unusedLicenses)} more users than licenses`;
    }
    return 'all licenses are allocated';
}

function renderAppComponents(app = {}) {
    if (!editAppComponentsWrapper || !editAppComponentsList || !editAppComponentsCount) {
        return;
    }

    const components = Array.isArray(app.components) ? app.components : [];

    if (components.length <= 1) {
        editAppComponentsWrapper.style.display = 'none';
        editAppComponentsList.innerHTML = '';
        return;
    }

    editAppComponentsWrapper.style.display = 'flex';
    editAppComponentsCount.textContent = `${components.length} linked`;

    editAppComponentsList.innerHTML = components.map(component => {
        const displayName = component.originalName || component.name || 'Unknown Application';
        const displayVendor = component.originalVendor || component.vendor || 'Uncategorized';
        const typeLabel = component.type === 'manual' ? 'Manual entry' : 'Auto-detected';
        const sourceLabel = component.sourceKey ? ` · ${escapeHtml(component.sourceKey)}` : '';
        return `
            <div style="padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                <div style="font-weight: 600;">${escapeHtml(displayName)}</div>
                <div style="font-size: 0.85rem; color: var(--text-secondary);">
                    ${escapeHtml(displayVendor)} · ${typeLabel}${sourceLabel}
                </div>
            </div>
        `;
    }).join('');
}

function getAppKey(app = {}) {
    if (app.id) {
        return `manual:${app.id}`;
    }
    if (app.sourceKey) {
        return `auto:${app.sourceKey}`;
    }
    return `auto:${(app.vendor || '').toLowerCase()}::${(app.name || '').toLowerCase()}`;
}

function openMergeAppsModal() {
    if (!mergeModal) {
        return;
    }

    if (selectedAppKeys.size < 2) {
        showToast('Select at least two applications to merge.', 'error');
        return;
    }

    currentMergeSelection = Array.from(selectedAppKeys)
        .map(key => appsByKey.get(key))
        .filter(Boolean);

    if (currentMergeSelection.length < 2) {
        showToast('Unable to find selected applications.', 'error');
        return;
    }

    mergePrimaryList.innerHTML = currentMergeSelection.map((app, index) => {
        const key = getAppKey(app);
        const label = `${app.name} · ${app.vendor}`;
        return `
            <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0;">
                <input type="radio" name="merge-primary" value="${escapeHtml(key)}" ${index === 0 ? 'checked' : ''}>
                <span>${escapeHtml(label)}</span>
            </label>
        `;
    }).join('');

    mergeSelectedList.innerHTML = currentMergeSelection.map(app => {
        const unusedMeta = getUnusedMeta(app);
        return `
            <div style="padding: 0.65rem 0; border-bottom: 1px solid var(--border-color);">
                <div style="font-weight: 600;">${escapeHtml(app.name)}</div>
                <div style="font-size: 0.85rem; color: var(--text-secondary);">${escapeHtml(app.vendor)}</div>
                <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 0.35rem;">
                    Detected Users: ${app.detectedUsers ?? 0} · Licenses: ${app.licensesOwned ?? 0} · ${unusedMeta.label}
                </div>
            </div>
        `;
    }).join('');

    const primaryApp = currentMergeSelection[0];
    mergeVendorInput.value = primaryApp.vendor || '';
    mergeNameInput.value = primaryApp.name || '';
    mergeLicensesInput.value = primaryApp.licensesOwned ?? '';

    mergeSummary.textContent = `${currentMergeSelection.length} applications will be merged into the selected primary application. Licenses are optional; leave blank to keep existing values.`;

    mergeModal.style.display = 'flex';
}

function closeMergeAppsModal() {
    if (mergeModal) {
        mergeModal.style.display = 'none';
    }
    currentMergeSelection = [];
}

async function handleMergeSubmit(event) {
    event.preventDefault();

    if (!currentMergeSelection || currentMergeSelection.length < 2) {
        closeMergeAppsModal();
        return;
    }

    const selectedRadio = mergePrimaryList.querySelector('input[name="merge-primary"]:checked');
    if (!selectedRadio) {
        showToast('Choose a primary application to merge into.', 'error');
        return;
    }

    const targetKey = selectedRadio.value;
    const vendor = mergeVendorInput.value.trim();
    const name = mergeNameInput.value.trim();
    const licensesOwnedRaw = mergeLicensesInput.value.trim();

    if (!vendor || !name) {
        showToast('Vendor and application name are required.', 'error');
        return;
    }

    const targetApp = appsByKey.get(targetKey);
    if (!targetApp) {
        showToast('Unable to find selected primary application.', 'error');
        return;
    }

    const sources = currentMergeSelection
        .filter(app => getAppKey(app) !== targetKey)
        .map(app => buildMergePayloadEntry(app));

    if (sources.length === 0) {
        showToast('Select at least two applications to merge.', 'error');
        return;
    }

    const body = {
        target: buildMergePayloadEntry(targetApp),
        sources,
        vendor,
        name,
        licensesOwned: licensesOwnedRaw
    };

    try {
        const response = await fetch('/api/apps/merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok || payload.success === false) {
            throw new Error(payload.error || 'Failed to merge applications');
        }

        showToast('Applications merged successfully.', 'success');
        closeMergeAppsModal();
        clearAppSelection(true);
        applyAppsDataset(payload);
    } catch (error) {
        console.error('Merge apps error:', error);
        showToast(error.message || 'Failed to merge applications', 'error');
    }
}

function buildMergePayloadEntry(app = {}) {
    return {
        id: app.id || null,
        sourceKey: app.sourceKey || null,
        licensesOwned: app.licensesOwned ?? null,
        detectedUsers: app.detectedUsers ?? 0
    };
}

function showToast(message, type = 'info', options = {}) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        border-radius: 0.5rem;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f97316' : '#3b82f6'};
        color: #ffffff;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
        z-index: 1200;
        animation: fadeIn 0.2s ease-out;
    `;

    if (options.id) {
        toast.id = options.id;
    }

    document.body.appendChild(toast);

    if (!options.duration || options.duration > 0) {
        const timeout = options.duration ?? 2800;
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.2s ease-in forwards';
            setTimeout(() => toast.remove(), 200);
        }, timeout);
    }

    return toast;
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
}

// Lightweight animation styles injected once
(function injectToastStyles() {
    if (document.getElementById('toast-animations')) {
        return;
    }

    const style = document.createElement('style');
    style.id = 'toast-animations';
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; transform: translateY(-10px); }
        }
    `;

    document.head.appendChild(style);
})();

function toggleAppsSyncLog() {
    const content = document.getElementById('apps-sync-log-content');
    const toggle = document.getElementById('apps-sync-log-toggle');
    
    if (content && toggle) {
        content.classList.toggle('expanded');
        toggle.classList.toggle('expanded');
    }
}

window.toggleAppsSyncLog = toggleAppsSyncLog;

