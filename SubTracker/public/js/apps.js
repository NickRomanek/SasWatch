// Applications dashboard client-side logic

let appsData = [];
let currentAppContext = null;

let editModal;
let editForm;
let editAppIdInput;
let editAppSourceInput;
let editAppNameInput;
let editAppVendorInput;
let editAppLicensesInput;
let editAppDetected;
let editAppContextBadge;
let editAppHelper;
let editAppTitle;
let hideAppButton;
let deleteAppButton;

document.addEventListener('DOMContentLoaded', () => {
    loadApps();

    const searchInput = document.getElementById('search-apps');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
    }

    editModal = document.getElementById('app-edit-modal');
    editForm = document.getElementById('edit-app-form');
    editAppIdInput = document.getElementById('edit-app-id');
    editAppSourceInput = document.getElementById('edit-app-source');
    editAppNameInput = document.getElementById('edit-app-name');
    editAppVendorInput = document.getElementById('edit-app-vendor');
    editAppLicensesInput = document.getElementById('edit-app-licenses');
    editAppDetected = document.getElementById('edit-app-detected');
    editAppContextBadge = document.getElementById('app-edit-context');
    editAppHelper = document.getElementById('edit-app-helper');
    editAppTitle = document.getElementById('app-edit-title');
    hideAppButton = document.getElementById('hide-app-button');
    deleteAppButton = document.getElementById('delete-app-button');

    if (deleteAppButton) {
        deleteAppButton.style.display = 'none';
    }

    if (editForm) {
        editForm.addEventListener('submit', handleEditSubmit);
    }

    if (editModal) {
        editModal.addEventListener('click', event => {
            if (event.target === editModal) {
                closeAppEditModal();
            }
        });
    }

    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && editModal && editModal.style.display === 'flex') {
            closeAppEditModal();
        }
    });

    if (hideAppButton) {
        hideAppButton.addEventListener('click', handleHideApp);
    }

    if (deleteAppButton) {
        deleteAppButton.addEventListener('click', handleDeleteApp);
    }
});

async function loadApps() {
    try {
        const response = await fetch('/api/apps');
        if (!response.ok) {
            throw new Error('Failed to fetch apps');
        }

        const data = await response.json();
        appsData = data.apps || [];

        updateStats(data.stats || {});
        renderAppsTable(appsData);
    } catch (error) {
        console.error('Error loading apps:', error);
        showToast('Failed to load applications. Refresh the page to try again.', 'error');
        renderAppsTable([]);
    }
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
                <td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    ${appsData.length === 0
                        ? 'No applications detected yet. Activity will populate this view automatically.'
                        : 'No applications match your search.'}
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = apps.map(app => {
        const { badgeClass, icon, label } = getUnusedMeta(app);

        return `
        <tr>
            <td>${escapeHtml(app.name)}</td>
            <td>${escapeHtml(app.vendor)}</td>
            <td>${app.detectedUsers ?? 0}</td>
            <td>${app.licensesOwned ?? 0}</td>
            <td>
                <span class="${badgeClass}">
                    <span>${icon}</span>
                    <span>${label}</span>
                </span>
            </td>
            <td>
                <button class="btn btn-icon" onclick="openAppEditModal('${app.id || ''}', '${app.sourceKey || ''}')" title="Edit application">
                    ✏️
                </button>
            </td>
        </tr>
        `;
    }).join('');
}

function handleSearch(event) {
    const query = event.target.value.trim().toLowerCase();
    if (!query) {
        renderAppsTable(appsData);
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
        closeAppEditModal();
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

    if (currentAppContext.id) {
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

        showToast('Application updated successfully.', 'success');
        closeAppEditModal();
        await loadApps();
    } catch (error) {
        console.error('Error saving application:', error);
        showToast(error.message || 'Failed to save application', 'error');
    }
}

function findApp(appId, sourceKey) {
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

function openAppEditModal(appId, sourceKey) {
    if (!editModal) {
        return;
    }

    const app = findApp(appId, sourceKey);
    if (!app) {
        showToast('Unable to find application details.', 'error');
        return;
    }

    currentAppContext = {
        id: app.id || null,
        sourceKey: app.sourceKey || null,
        isManual: !!app.isManual,
        vendor: app.vendor,
        name: app.name,
        licensesOwned: app.licensesOwned ?? 0
    };

    editAppIdInput.value = app.id || '';
    editAppSourceInput.value = app.sourceKey || '';
    editAppNameInput.value = app.name || '';
    editAppVendorInput.value = app.vendor || '';
    editAppLicensesInput.value = app.licensesOwned ?? 0;
    editAppDetected.textContent = app.detectedUsers ?? 0;

    const unusedMeta = getUnusedMeta(app);

    if (app.isManual) {
        editAppContextBadge.textContent = 'Manual entry';
        editAppContextBadge.className = 'status-badge status-warning';
        editAppHelper.textContent = `This application was added manually. Update the name, vendor, or license count as needed. Currently ${formatUnusedSummary(unusedMeta)}.`;
        editAppTitle.textContent = 'Edit Application';
        if (deleteAppButton) {
            deleteAppButton.style.display = 'inline-flex';
        }
    } else {
        editAppContextBadge.textContent = 'Auto-detected';
        editAppContextBadge.className = 'status-badge status-success';
        editAppHelper.textContent = `This application was detected from recent activity. Changes here update how it appears in reports and dashboards. Currently ${formatUnusedSummary(unusedMeta)}.`;
        editAppTitle.textContent = 'Edit Detected Application';
        if (deleteAppButton) {
            deleteAppButton.style.display = 'none';
        }
    }

    if (hideAppButton) {
        hideAppButton.style.display = 'inline-flex';
    }

    editModal.style.display = 'flex';
}

function closeAppEditModal() {
    if (editModal) {
        editModal.style.display = 'none';
    }
    currentAppContext = null;
}

window.openAppEditModal = openAppEditModal;
window.closeAppEditModal = closeAppEditModal;

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
        closeAppEditModal();
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
        closeAppEditModal();
        await loadApps();
    } catch (error) {
        console.error('Delete app error:', error);
        showToast(error.message || 'Failed to delete application', 'error');
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

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        border-radius: 0.5rem;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: #ffffff;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
        z-index: 1200;
        animation: fadeIn 0.2s ease-out;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.2s ease-in forwards';
        setTimeout(() => toast.remove(), 200);
    }, 2800);
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
