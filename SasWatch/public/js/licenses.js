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
        const lastActivity = license.lastActivity 
            ? new Date(license.lastActivity).toLocaleDateString()
            : 'Never';
        
        const truncatedName = truncateText(license.name, 28);
        const needsTooltip = license.name.length > 28;
        
        return `
            <tr>
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
                <td>${lastActivity}</td>
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
    
    // Load initial data
    loadLicensesData();
});

