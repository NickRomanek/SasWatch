// Licenses dashboard client-side logic

let licensesData = [];
let filteredLicenses = [];

// Load licenses data from API
async function loadLicensesData() {
    try {
        const response = await fetch('/api/licenses');
        const data = await response.json();
        
        if (data.success) {
            licensesData = data.licenses || [];
            filteredLicenses = [...licensesData];
            
            // Update stats
            updateStats(data.stats || {});
            
            // Render table
            renderLicensesTable();
        } else {
            console.error('Failed to load licenses:', data.error);
            showError('Failed to load license data');
        }
    } catch (error) {
        console.error('Error loading licenses:', error);
        showError('Error loading license data');
    }
}

// Update stats cards
function updateStats(stats) {
    const totalEl = document.getElementById('total-licenses');
    const assignedEl = document.getElementById('total-assigned');
    const activeEl = document.getElementById('total-active');
    const utilizationEl = document.getElementById('avg-utilization');
    
    if (totalEl) totalEl.textContent = stats.totalLicenses || 0;
    if (assignedEl) assignedEl.textContent = stats.totalAssigned || 0;
    if (activeEl) activeEl.textContent = stats.totalActive || 0;
    if (utilizationEl) utilizationEl.textContent = (stats.avgUtilization || 0) + '%';
}

// Render licenses table
function renderLicensesTable() {
    const tbody = document.getElementById('licenses-table-body');
    if (!tbody) return;
    
    if (filteredLicenses.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    No licenses found. Licenses are automatically detected from user data.
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = filteredLicenses.map(license => {
        const truncatedName = truncateText(license.name, 28);
        const needsTooltip = license.name.length > 28;
        const totalCost = license.totalCost || 0;
        const costDisplay = totalCost > 0 
            ? `$${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : '<span style="color: var(--text-secondary);">—</span>';
        
        // Escape values for onclick handler
        const escapedName = escapeHtml(license.name).replace(/'/g, "\\'");
        const escapedVendor = escapeHtml(license.vendor).replace(/'/g, "\\'");
        
        return `
            <tr style="cursor: pointer;" onclick="openLicenseDetailModal('${escapedName}', '${escapedVendor}', event)">
                <td><strong>${escapeHtml(license.vendor)}</strong></td>
                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" ${needsTooltip ? `title="${escapeHtml(license.name)}"` : ''}>
                    ${escapeHtml(truncatedName)}
                </td>
                <td style="text-align: center;">${license.totalOwned > 0 ? license.totalOwned : '<span style="color: var(--text-secondary);">—</span>'}</td>
                <td style="text-align: center;">${license.assigned}</td>
                <td style="text-align: center;">${license.active}</td>
                <td style="text-align: center;">
                    ${license.available > 0 ? `<span style="color: var(--success-color, #4caf50);">${license.available}</span>` : 
                      license.available < 0 ? `<span style="color: var(--error-color, #f44336);">${Math.abs(license.available)} over</span>` : '0'}
                </td>
                <td style="text-align: right;">${costDisplay}</td>
            </tr>
        `;
    }).join('');
}

// Filter licenses by search and vendor
function filterLicenses() {
    const searchInput = document.getElementById('search-licenses');
    const vendorFilter = document.getElementById('vendor-filter');
    
    const searchTerm = (searchInput?.value || '').toLowerCase();
    const vendorFilterValue = vendorFilter?.value || '';
    
    filteredLicenses = licensesData.filter(license => {
        const matchesSearch = !searchTerm || 
            license.name.toLowerCase().includes(searchTerm) ||
            license.vendor.toLowerCase().includes(searchTerm);
        
        const matchesVendor = !vendorFilterValue || license.vendor === vendorFilterValue;
        
        return matchesSearch && matchesVendor;
    });
    
    renderLicensesTable();
}

// Show error message
function showError(message) {
    const tbody = document.getElementById('licenses-table-body');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: var(--error-color, #f44336);">
                    ${escapeHtml(message)}
                </td>
            </tr>
        `;
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Truncate text with ellipsis
function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// License detail modal functions
let currentLicenseContext = null;

async function openLicenseDetailModal(licenseName, vendor, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const modal = document.getElementById('license-detail-modal');
    if (!modal) {
        console.error('License detail modal not found');
        return;
    }

    // Find license data
    const license = licensesData.find(l => l.name === licenseName && l.vendor === vendor);
    if (!license) {
        console.error('License not found:', licenseName);
        return;
    }

    currentLicenseContext = license;

    // Show modal with slide-in animation
    modal.style.display = 'flex';
    const modalContent = modal.querySelector('.app-detail-modal-large');
    if (modalContent) {
        modalContent.style.animation = 'slideInRightPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
    }

    // Populate modal
    document.getElementById('license-detail-name').textContent = license.name || 'Unknown License';
    document.getElementById('license-detail-vendor').textContent = license.vendor || 'Uncategorized';
    document.getElementById('license-detail-assigned').textContent = license.assigned || 0;
    document.getElementById('license-detail-active').textContent = license.active || 0;
    document.getElementById('license-detail-owned').textContent = license.totalOwned || 0;
    document.getElementById('license-detail-name-input').value = license.name || '';
    
    // Populate pricing fields
    const totalLicensesInput = document.getElementById('license-detail-total-licenses-input');
    const costPerInput = document.getElementById('license-detail-cost-per-input');
    const totalCostInput = document.getElementById('license-detail-cost-input');
    
    if (totalLicensesInput) totalLicensesInput.value = license.totalLicenses || '';
    if (costPerInput) costPerInput.value = license.costPerLicense || '';
    if (totalCostInput) totalCostInput.value = license.totalCost || '';
    
    // Set up auto-calculation listeners
    setupLicenseCostCalculation();
}

function closeLicenseDetailModal() {
    const modal = document.getElementById('license-detail-modal');
    if (!modal) return;

    // Remove backdrop instantly
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) {
        backdrop.style.opacity = '0';
        backdrop.style.transition = 'none';
    }

    // Slide-out animation
    const modalContent = modal.querySelector('.app-detail-modal-large');
    if (modalContent) {
        modalContent.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => {
            modal.style.display = 'none';
            // Reset for next open
            if (backdrop) {
                backdrop.style.opacity = '';
                backdrop.style.transition = '';
            }
            if (modalContent) {
                modalContent.style.animation = 'slideInRightPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
            }
        }, 300);
    } else {
        modal.style.display = 'none';
    }

    currentLicenseContext = null;
}

// Set up auto-calculation for license cost fields
function setupLicenseCostCalculation() {
    const totalLicensesInput = document.getElementById('license-detail-total-licenses-input');
    const costPerInput = document.getElementById('license-detail-cost-per-input');
    const totalCostInput = document.getElementById('license-detail-cost-input');
    
    if (!totalLicensesInput || !costPerInput || !totalCostInput) return;
    
    // Remove existing listeners to avoid duplicates
    const newTotalLicenses = totalLicensesInput.cloneNode(true);
    const newCostPer = costPerInput.cloneNode(true);
    const newTotalCost = totalCostInput.cloneNode(true);
    
    totalLicensesInput.parentNode.replaceChild(newTotalLicenses, totalLicensesInput);
    costPerInput.parentNode.replaceChild(newCostPer, costPerInput);
    totalCostInput.parentNode.replaceChild(newTotalCost, totalCostInput);
    
    let isCalculating = false; // Prevent infinite loops
    
    // Calculate total cost when licenses or cost per changes
    function calculateTotalCost() {
        if (isCalculating) return;
        isCalculating = true;
        
        const licenses = parseFloat(newTotalLicenses.value) || 0;
        const costPer = parseFloat(newCostPer.value) || 0;
        
        if (licenses > 0 && costPer > 0) {
            newTotalCost.value = (licenses * costPer).toFixed(2);
        } else if (licenses === 0 || costPer === 0) {
            // Clear total cost if either field is cleared
            if (!newTotalCost.value || parseFloat(newTotalCost.value) === 0) {
                newTotalCost.value = '';
            }
        }
        
        isCalculating = false;
    }
    
    // Calculate cost per when total cost and licenses change
    function calculateCostPer() {
        if (isCalculating) return;
        isCalculating = true;
        
        const licenses = parseFloat(newTotalLicenses.value) || 0;
        const totalCost = parseFloat(newTotalCost.value) || 0;
        
        if (licenses > 0 && totalCost > 0) {
            newCostPer.value = (totalCost / licenses).toFixed(2);
        } else if (licenses === 0 || totalCost === 0) {
            // Clear cost per if either field is cleared
            if (!newCostPer.value || parseFloat(newCostPer.value) === 0) {
                newCostPer.value = '';
            }
        }
        
        isCalculating = false;
    }
    
    // Calculate licenses when total cost and cost per change
    function calculateLicenses() {
        if (isCalculating) return;
        isCalculating = true;
        
        const costPer = parseFloat(newCostPer.value) || 0;
        const totalCost = parseFloat(newTotalCost.value) || 0;
        
        if (costPer > 0 && totalCost > 0) {
            newTotalLicenses.value = Math.round(totalCost / costPer);
        } else if (costPer === 0 || totalCost === 0) {
            // Clear licenses if either field is cleared
            if (!newTotalLicenses.value || parseFloat(newTotalLicenses.value) === 0) {
                newTotalLicenses.value = '';
            }
        }
        
        isCalculating = false;
    }
    
    newTotalLicenses.addEventListener('input', () => {
        if (parseFloat(newCostPer.value) > 0) {
            calculateTotalCost();
        } else if (parseFloat(newTotalCost.value) > 0) {
            calculateCostPer();
        }
    });
    
    newCostPer.addEventListener('input', () => {
        if (parseFloat(newTotalLicenses.value) > 0) {
            calculateTotalCost();
        } else if (parseFloat(newTotalCost.value) > 0) {
            calculateLicenses();
        }
    });
    
    newTotalCost.addEventListener('input', () => {
        if (parseFloat(newTotalLicenses.value) > 0) {
            calculateCostPer();
        } else if (parseFloat(newCostPer.value) > 0) {
            calculateLicenses();
        }
    });
}

// Handle form submission
async function handleLicenseCostUpdate(event) {
    event.preventDefault();

    if (!currentLicenseContext) {
        showError('No license selected');
        return;
    }

    const totalLicensesInput = document.getElementById('license-detail-total-licenses-input');
    const costPerInput = document.getElementById('license-detail-cost-per-input');
    const totalCostInput = document.getElementById('license-detail-cost-input');
    
    const totalLicenses = totalLicensesInput?.value || '';
    const costPerLicense = costPerInput?.value || '';
    const totalCost = totalCostInput?.value || '';

    try {
        const response = await fetch('/api/licenses/cost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                licenseName: currentLicenseContext.name,
                totalLicenses: totalLicenses,
                costPerLicense: costPerLicense,
                totalCost: totalCost
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}: Failed to update license cost`);
        }

        const result = await response.json();
        
        // Update local data with returned values
        if (result.data) {
            currentLicenseContext.totalCost = result.data.totalCost;
            currentLicenseContext.costPerLicense = result.data.costPerLicense;
            currentLicenseContext.totalLicenses = result.data.totalLicenses;
            
            const licenseIndex = licensesData.findIndex(l => 
                l.name === currentLicenseContext.name && l.vendor === currentLicenseContext.vendor
            );
            if (licenseIndex >= 0) {
                licensesData[licenseIndex].totalCost = result.data.totalCost;
                licensesData[licenseIndex].costPerLicense = result.data.costPerLicense;
                licensesData[licenseIndex].totalLicenses = result.data.totalLicenses;
            }
        } else {
            // Remove cost data
            currentLicenseContext.totalCost = null;
            currentLicenseContext.costPerLicense = null;
            currentLicenseContext.totalLicenses = null;
            
            const licenseIndex = licensesData.findIndex(l => 
                l.name === currentLicenseContext.name && l.vendor === currentLicenseContext.vendor
            );
            if (licenseIndex >= 0) {
                licensesData[licenseIndex].totalCost = null;
                licensesData[licenseIndex].costPerLicense = null;
                licensesData[licenseIndex].totalLicenses = null;
            }
        }

        // Re-render table
        filterLicenses();

        // Show success message
        if (window.Toast && typeof window.Toast.success === 'function') {
            window.Toast.success('License pricing updated successfully');
        }

        closeLicenseDetailModal();
    } catch (error) {
        console.error('Error updating license cost:', error);
        if (window.Toast && typeof window.Toast.error === 'function') {
            window.Toast.error(error.message || 'Failed to update license cost');
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Set up search filter
    const searchInput = document.getElementById('search-licenses');
    if (searchInput) {
        searchInput.addEventListener('input', filterLicenses);
    }
    
    // Set up vendor filter
    const vendorFilter = document.getElementById('vendor-filter');
    if (vendorFilter) {
        vendorFilter.addEventListener('change', filterLicenses);
    }

    // Set up license detail form
    const licenseForm = document.getElementById('license-detail-edit-form');
    if (licenseForm) {
        licenseForm.addEventListener('submit', handleLicenseCostUpdate);
    }
    
    // Load initial data
    loadLicensesData();
});

// Expose functions globally
window.openLicenseDetailModal = openLicenseDetailModal;
window.closeLicenseDetailModal = closeLicenseDetailModal;

