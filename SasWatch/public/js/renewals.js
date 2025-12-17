// Renewals Page JavaScript
// Handles calendar, CRUD operations, and UI interactions

let calendar = null;
let subscriptions = [];
let pendingSubscriptions = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeCalendar();
    loadSubscriptions();
    loadPendingSubscriptions();
    setupDragAndDrop();
    setupBillingCycleLabel();
});

// Update cost label based on billing cycle
function updateCostLabel() {
    const billingCycleSelect = document.getElementById('sub-billing-cycle');
    const costLabel = document.getElementById('sub-cost-label');
    
    if (!billingCycleSelect || !costLabel) return;
    
    const cycle = billingCycleSelect.value;
    switch(cycle) {
        case 'monthly':
            costLabel.textContent = 'Monthly Cost ($)';
            break;
        case 'annual':
            costLabel.textContent = 'Annual Cost ($)';
            break;
        case 'multi-year':
            costLabel.textContent = 'Multi-Year Cost ($)';
            break;
        default:
            costLabel.textContent = 'Cost ($)';
    }
}

function setupBillingCycleLabel() {
    const billingCycleSelect = document.getElementById('sub-billing-cycle');
    
    if (!billingCycleSelect) return;
    
    billingCycleSelect.addEventListener('change', updateCostLabel);
    // Set initial label
    updateCostLabel();
}

// Initialize FullCalendar
function initializeCalendar() {
    const calendarEl = document.getElementById('calendar');
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'addSubscription' // Custom button for adding subscriptions
        },
        customButtons: {
            addSubscription: {
                text: '➕ Add Subscription',
                click: function() {
                    openAddModal();
                }
            }
        },
        height: 'auto',
        eventClick: function(info) {
            const subId = info.event.extendedProps.subscriptionId;
            const sub = subscriptions.find(s => s.id === subId);
            if (sub) {
                openEditModal(sub);
            }
        },
        eventDidMount: function(info) {
            // Add tooltip on hover
            const sub = info.event.extendedProps;
            if (sub.cost) {
                info.el.title = `${info.event.title}\n$${formatCost(sub.cost)} - ${sub.billingCycle}`;
            }
        },
        dateClick: function(info) {
            // Pre-fill the renewal date when clicking on a date
            openAddModal(info.dateStr);
        }
    });
    
    calendar.render();
}

// Load subscriptions from API
async function loadSubscriptions() {
    try {
        const response = await fetch('/api/renewals');
        const data = await response.json();
        
        if (data.success) {
            subscriptions = data.subscriptions || [];
            renderCalendarEvents();
            renderUpcomingList();
            renderTable();
            updateStats();
        } else {
            console.error('Failed to load subscriptions:', data.error);
            showToast('Failed to load subscriptions', 'error');
        }
    } catch (error) {
        console.error('Error loading subscriptions:', error);
        showToast('Error loading subscriptions', 'error');
    }
}

// Render events on calendar
function renderCalendarEvents() {
    // Remove existing events
    calendar.removeAllEvents();
    
    // Get current date and calculate end date (12 months from now)
    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 12);
    
    // Add subscription events
    subscriptions.forEach(sub => {
        if (sub.isArchived) return;
        
        const renewalDate = new Date(sub.renewalDate);
        const daysUntil = getDaysUntil(sub.renewalDate);
        let colorClass = 'fc-event-normal';
        if (daysUntil < 0) colorClass = 'fc-event-urgent';
        else if (daysUntil <= 14) colorClass = 'fc-event-urgent';
        else if (daysUntil <= 30) colorClass = 'fc-event-warning';
        
        // For monthly subscriptions, generate recurring events
        if (sub.billingCycle === 'monthly') {
            let currentDate = new Date(renewalDate);
            let eventCount = 0;
            const maxEvents = 12; // Show up to 12 months ahead
            
            while (currentDate <= endDate && eventCount < maxEvents) {
                const currentDaysUntil = Math.floor((currentDate - now) / (1000 * 60 * 60 * 24));
                let eventColorClass = 'fc-event-normal';
                if (currentDaysUntil < 0) eventColorClass = 'fc-event-urgent';
                else if (currentDaysUntil <= 14) eventColorClass = 'fc-event-urgent';
                else if (currentDaysUntil <= 30) eventColorClass = 'fc-event-warning';
                
                calendar.addEvent({
                    id: `${sub.id}-${eventCount}`,
                    title: sub.name,
                    start: currentDate.toISOString().split('T')[0],
                    allDay: true,
                    classNames: [eventColorClass],
                    extendedProps: {
                        subscriptionId: sub.id,
                        vendor: sub.vendor,
                        cost: sub.cost,
                        billingCycle: sub.billingCycle
                    }
                });
                
                // Move to next month
                currentDate.setMonth(currentDate.getMonth() + 1);
                eventCount++;
            }
        } else {
            // For annual, multi-year, or one-time, just show the renewal date
            calendar.addEvent({
                id: sub.id,
                title: sub.name,
                start: sub.renewalDate.split('T')[0],
                allDay: true,
                classNames: [colorClass],
                extendedProps: {
                    subscriptionId: sub.id,
                    vendor: sub.vendor,
                    cost: sub.cost,
                    billingCycle: sub.billingCycle
                }
            });
        }
        
        // Also add cancel-by date if exists
        if (sub.cancelByDate) {
            calendar.addEvent({
                id: `${sub.id}-cancel`,
                title: `⚠️ Cancel by: ${sub.name}`,
                start: sub.cancelByDate.split('T')[0],
                allDay: true,
                backgroundColor: '#f59e0b',
                borderColor: '#f59e0b',
                extendedProps: {
                    subscriptionId: sub.id
                }
            });
        }
    });
}

// Render upcoming renewals list
function renderUpcomingList() {
    const listEl = document.getElementById('upcoming-list');
    
    // Filter and sort by renewal date (next 90 days)
    const now = new Date();
    const upcoming = subscriptions
        .filter(sub => !sub.isArchived)
        .map(sub => ({
            ...sub,
            daysUntil: getDaysUntil(sub.renewalDate)
        }))
        .filter(sub => sub.daysUntil <= 90)
        .sort((a, b) => a.daysUntil - b.daysUntil);
    
    if (upcoming.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📅</div>
                <p>No renewals in the next 90 days</p>
            </div>
        `;
        return;
    }
    
    listEl.innerHTML = upcoming.map(sub => {
        let urgencyClass = 'normal';
        let badgeClass = 'normal';
        if (sub.daysUntil < 0) {
            urgencyClass = 'urgent';
            badgeClass = 'urgent';
        } else if (sub.daysUntil <= 14) {
            urgencyClass = 'urgent';
            badgeClass = 'urgent';
        } else if (sub.daysUntil <= 30) {
            urgencyClass = 'warning';
            badgeClass = 'warning';
        }
        
        const daysText = sub.daysUntil < 0 
            ? `${Math.abs(sub.daysUntil)} days overdue`
            : sub.daysUntil === 0 
                ? 'Today!'
                : `${sub.daysUntil} days`;
        
        return `
            <div class="renewal-item ${urgencyClass}" onclick="openEditModal(subscriptions.find(s => s.id === '${sub.id}'))">
                <div class="renewal-item-header">
                    <span class="renewal-item-name">${escapeHtml(sub.name)}</span>
                    <span class="renewal-item-vendor">${escapeHtml(sub.vendor)}</span>
                </div>
                <div class="renewal-item-details">
                    <span class="renewal-item-date">
                        📅 ${formatDate(sub.renewalDate)}
                        <span class="days-badge ${badgeClass}">${daysText}</span>
                    </span>
                    ${sub.cost ? `<span class="renewal-item-cost">$${formatCost(sub.cost)}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Render table view
function renderTable() {
    const tbody = document.getElementById('renewals-table-body');
    
    if (subscriptions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    No subscriptions yet. Click "Add Subscription" to get started.
                </td>
            </tr>
        `;
        return;
    }
    
    // Sort by renewal date
    const sorted = [...subscriptions]
        .filter(sub => !sub.isArchived)
        .sort((a, b) => new Date(a.renewalDate) - new Date(b.renewalDate));
    
    tbody.innerHTML = sorted.map(sub => {
        const daysUntil = getDaysUntil(sub.renewalDate);
        let badgeClass = 'normal';
        if (daysUntil < 0) badgeClass = 'urgent';
        else if (daysUntil <= 14) badgeClass = 'urgent';
        else if (daysUntil <= 30) badgeClass = 'warning';
        
        const daysText = daysUntil < 0 
            ? `${Math.abs(daysUntil)} overdue`
            : daysUntil === 0 
                ? 'Today'
                : `${daysUntil} days`;
        
        return `
            <tr>
                <td><strong>${escapeHtml(sub.name)}</strong></td>
                <td>${escapeHtml(sub.vendor)}</td>
                <td>${formatDate(sub.renewalDate)}</td>
                <td><span class="days-badge ${badgeClass}">${daysText}</span></td>
                <td>${sub.cost ? '$' + formatCost(sub.cost) : '-'}</td>
                <td>${capitalize(sub.billingCycle)}</td>
                <td>${sub.owner ? escapeHtml(sub.owner) : '-'}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="openEditModal(subscriptions.find(s => s.id === '${sub.id}'))" title="Edit">
                        ✏️
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="markRenewed('${sub.id}')" title="Mark as Renewed">
                        ✅
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Update stats cards
function updateStats() {
    const now = new Date();
    const active = subscriptions.filter(s => !s.isArchived);
    
    // Total subscriptions
    document.getElementById('stat-total').textContent = active.length;
    
    // This month
    const thisMonth = active.filter(s => {
        const date = new Date(s.renewalDate);
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).length;
    document.getElementById('stat-this-month').textContent = thisMonth;
    
    // Upcoming cost (next 90 days)
    const upcoming90 = active.filter(s => {
        const days = getDaysUntil(s.renewalDate);
        return days >= 0 && days <= 90;
    });
    const upcomingCost = upcoming90.reduce((sum, s) => sum + (parseFloat(s.cost) || 0), 0);
    document.getElementById('stat-upcoming-cost').textContent = formatCost(upcomingCost);
    
    // Past due
    const pastDue = active.filter(s => getDaysUntil(s.renewalDate) < 0).length;
    document.getElementById('stat-past-due').textContent = pastDue;
}

// View toggle
// setView function removed - always showing calendar view

// Modal functions
function openAddModal(prefilledDate = null) {
    document.getElementById('modal-title').textContent = 'Add Subscription';
    document.getElementById('subscription-id').value = '';
    document.getElementById('subscription-form').reset();
    document.getElementById('delete-btn').style.display = 'none';
    const rejectBtn = document.getElementById('reject-pending-btn');
    if (rejectBtn) rejectBtn.style.display = 'none';
    const testAlertBtn = document.getElementById('test-alert-btn');
    if (testAlertBtn) testAlertBtn.style.display = 'none';
    
    // Set default alert days
    document.querySelectorAll('input[name="alert-days"]').forEach(cb => {
        cb.checked = [60, 30, 7].includes(parseInt(cb.value));
    });
    
    // Pre-fill date if provided
    if (prefilledDate) {
        document.getElementById('sub-renewal-date').value = prefilledDate;
    }
    
    // Update cost label based on default billing cycle
    updateCostLabel();
    
    document.getElementById('subscription-modal').style.display = 'flex';
}

function openEditModal(sub) {
    document.getElementById('modal-title').textContent = 'Edit Subscription';
    document.getElementById('subscription-id').value = sub.id;
    document.getElementById('delete-btn').style.display = 'block';
    const rejectBtn = document.getElementById('reject-pending-btn');
    if (rejectBtn) rejectBtn.style.display = 'none';
    // Show test alert button for existing subscriptions
    const testAlertBtn = document.getElementById('test-alert-btn');
    if (testAlertBtn) {
        testAlertBtn.style.display = 'block';
        testAlertBtn.setAttribute('data-subscription-id', sub.id);
    }
    
    // Fill form
    document.getElementById('sub-name').value = sub.name || '';
    document.getElementById('sub-vendor').value = sub.vendor || '';
    document.getElementById('sub-renewal-date').value = sub.renewalDate ? sub.renewalDate.split('T')[0] : '';
    document.getElementById('sub-cancel-by-date').value = sub.cancelByDate ? sub.cancelByDate.split('T')[0] : '';
    document.getElementById('sub-cost').value = sub.cost || '';
    document.getElementById('sub-billing-cycle').value = sub.billingCycle || 'annual';
    document.getElementById('sub-seats').value = sub.seats || '';
    document.getElementById('sub-account-number').value = sub.accountNumber || '';
    document.getElementById('sub-owner').value = sub.owner || '';
    document.getElementById('sub-alert-email').value = sub.alertEmail || '';
    document.getElementById('sub-notes').value = sub.notes || '';
    
    // Set alert days checkboxes
    const alertDays = sub.alertDays || [60, 30, 7];
    document.querySelectorAll('input[name="alert-days"]').forEach(cb => {
        cb.checked = alertDays.includes(parseInt(cb.value));
    });
    
    // Update cost label based on billing cycle
    updateCostLabel();
    
    document.getElementById('subscription-modal').style.display = 'flex';
}

function closeModal() {
    // Clean up pending ID
    const form = document.getElementById('subscription-form');
    if (form) {
        delete form.dataset.pendingId;
    }
    // Hide reject button
    const rejectBtn = document.getElementById('reject-pending-btn');
    if (rejectBtn) {
        rejectBtn.style.display = 'none';
        rejectBtn.removeAttribute('data-pending-id');
    }
    document.getElementById('subscription-modal').style.display = 'none';
}

// Save subscription (create or update)
async function saveSubscription(event) {
    event.preventDefault();
    
    const id = document.getElementById('subscription-id').value;
    const isEdit = !!id;
    
    // Gather alert days
    const alertDays = Array.from(document.querySelectorAll('input[name="alert-days"]:checked'))
        .map(cb => parseInt(cb.value))
        .sort((a, b) => b - a);
    
    const data = {
        name: document.getElementById('sub-name').value.trim(),
        vendor: document.getElementById('sub-vendor').value.trim(),
        renewalDate: document.getElementById('sub-renewal-date').value,
        cancelByDate: document.getElementById('sub-cancel-by-date').value || null,
        cost: document.getElementById('sub-cost').value ? parseFloat(document.getElementById('sub-cost').value) : null,
        billingCycle: document.getElementById('sub-billing-cycle').value,
        seats: document.getElementById('sub-seats').value ? parseInt(document.getElementById('sub-seats').value) : null,
        accountNumber: document.getElementById('sub-account-number').value.trim() || null,
        owner: document.getElementById('sub-owner').value.trim() || null,
        alertEmail: document.getElementById('sub-alert-email').value.trim() || null,
        alertDays: alertDays.length > 0 ? alertDays : [60, 30, 7],
        notes: document.getElementById('sub-notes').value.trim() || null
    };
    
    try {
        const url = isEdit ? `/api/renewals/${id}` : '/api/renewals';
        const method = isEdit ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            closeModal();
            showToast(isEdit ? 'Subscription updated!' : 'Subscription added!', 'success');
            loadSubscriptions();
        } else {
            showToast(result.error || 'Failed to save subscription', 'error');
        }
    } catch (error) {
        console.error('Error saving subscription:', error);
        showToast('Error saving subscription', 'error');
    }
}

// Delete subscription
async function deleteSubscription() {
    const id = document.getElementById('subscription-id').value;
    if (!id) return;
    
    if (!confirm('Are you sure you want to delete this subscription?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/renewals/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            closeModal();
            showToast('Subscription deleted', 'success');
            loadSubscriptions();
        } else {
            showToast(result.error || 'Failed to delete subscription', 'error');
        }
    } catch (error) {
        console.error('Error deleting subscription:', error);
        showToast('Error deleting subscription', 'error');
    }
}

// Test alert - send a test email immediately
async function testAlert() {
    const testAlertBtn = document.getElementById('test-alert-btn');
    let subscriptionId = testAlertBtn ? testAlertBtn.getAttribute('data-subscription-id') : null;
    
    if (!subscriptionId) {
        // Try to get from subscription-id field (for existing subscriptions)
        const id = document.getElementById('subscription-id').value;
        if (!id) {
            showToast('Please save the subscription first before testing alerts', 'error');
            return;
        }
        subscriptionId = id;
    }
    
    if (!confirm('Send a test alert email for this subscription now?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/renewals/${subscriptionId}/test-alert`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message || 'Test alert sent successfully!', 'success');
            // Reload subscriptions to update lastAlertSent
            loadSubscriptions();
        } else {
            showToast(result.error || 'Failed to send test alert', 'error');
        }
    } catch (error) {
        console.error('Error sending test alert:', error);
        showToast('Error sending test alert', 'error');
    }
}

// Mark as renewed (bump renewal date by billing cycle)
async function markRenewed(id) {
    const sub = subscriptions.find(s => s.id === id);
    if (!sub) return;
    
    if (!confirm(`Mark "${sub.name}" as renewed? This will advance the renewal date by one ${sub.billingCycle} cycle.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/renewals/${id}/renew`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Subscription renewed!', 'success');
            loadSubscriptions();
        } else {
            showToast(result.error || 'Failed to renew subscription', 'error');
        }
    } catch (error) {
        console.error('Error renewing subscription:', error);
        showToast('Error renewing subscription', 'error');
    }
}

// Utility functions
function getDaysUntil(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    return Math.floor((date - now) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
}

function formatCost(cost) {
    const num = parseFloat(cost);
    if (isNaN(num)) return '0.00';
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    // Use existing toast system if available, otherwise console log
    if (typeof window.showNotification === 'function') {
        window.showNotification(message, type);
    } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
        // Simple fallback toast
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 24px;
            background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
            color: white;
            border-radius: 8px;
            z-index: 10000;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
}

// ============================================
// Pending Subscriptions Functions
// ============================================

// Load pending subscriptions from API
async function loadPendingSubscriptions() {
    try {
        const response = await fetch('/api/renewals/pending');
        const data = await response.json();
        
        if (data.success) {
            pendingSubscriptions = data.pendingSubscriptions || [];
            renderPendingCards();
            updatePendingSectionVisibility();
        } else {
            console.error('Failed to load pending subscriptions:', data.error);
        }
    } catch (error) {
        console.error('Error loading pending subscriptions:', error);
    }
}

// Update visibility of pending section and main upload zone
function updatePendingSectionVisibility() {
    const pendingSection = document.getElementById('pending-imports-section');
    const mainUploadZone = document.getElementById('main-upload-zone');
    const pendingCount = document.getElementById('pending-count');
    
    if (pendingSubscriptions.length > 0) {
        pendingSection.style.display = 'block';
        mainUploadZone.style.display = 'none';
        pendingCount.textContent = pendingSubscriptions.length;
    } else {
        pendingSection.style.display = 'none';
        mainUploadZone.style.display = 'block';
    }
}

// Render pending subscription cards
function renderPendingCards() {
    const container = document.getElementById('pending-cards');
    
    if (pendingSubscriptions.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 1rem;">
                <p>No pending imports</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = pendingSubscriptions.map(pending => {
        const confidenceClass = pending.confidence >= 0.7 ? 'high' : pending.confidence >= 0.4 ? 'medium' : 'low';
        const confidencePercent = Math.round(pending.confidence * 100);
        const sourceIcon = pending.sourceType === 'email' ? '📧' : '📄';
        const sourceText = pending.sourceType === 'email' ? 'Via Email' : 'Uploaded';
        
        return `
            <div class="pending-card" data-id="${pending.id}">
                <div class="pending-card-header">
                    <span class="pending-vendor">${escapeHtml(pending.vendor || 'Unknown Vendor')}</span>
                    <span class="pending-confidence ${confidenceClass}">${confidencePercent}% match</span>
                </div>
                <div class="pending-card-name">${escapeHtml(pending.name || 'Unknown Subscription')}</div>
                <div class="pending-card-details">
                    ${pending.cost ? `<span class="pending-card-detail">💰 $${formatCost(pending.cost)}</span>` : ''}
                    ${pending.renewalDate ? `<span class="pending-card-detail">📅 ${formatDate(pending.renewalDate)}</span>` : ''}
                    ${pending.billingCycle ? `<span class="pending-card-detail">🔄 ${capitalize(pending.billingCycle)}</span>` : ''}
                </div>
                <div class="pending-source">
                    ${sourceIcon} ${sourceText}
                    ${pending.attachmentNames && pending.attachmentNames.length > 0 ? 
                        ` · ${pending.attachmentNames.join(', ')}` : ''}
                </div>
                <div class="pending-card-actions">
                    <button class="pending-btn pending-btn-approve" onclick="approvePending('${pending.id}')">
                        ✓ Approve
                    </button>
                    <button class="pending-btn pending-btn-reject" onclick="editPending('${pending.id}')">
                        ✏️ Edit
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Approve pending subscription immediately
async function approvePending(id) {
    const pending = pendingSubscriptions.find(p => p.id === id);
    if (!pending) return;
    
    try {
        // Gather default alert days
        const alertDays = [60, 30, 7];
        
        const data = {
            name: pending.name || '',
            vendor: pending.vendor || '',
            renewalDate: pending.renewalDate ? pending.renewalDate.split('T')[0] : null,
            cancelByDate: null,
            cost: pending.cost ? parseFloat(pending.cost) : null,
            billingCycle: pending.billingCycle || 'annual',
            seats: null,
            accountNumber: pending.accountNumber || null,
            owner: null,
            alertEmail: null,
            alertDays: alertDays,
            notes: pending.rawText ? `Imported from: ${pending.attachmentNames?.join(', ') || 'document'}` : null
        };
        
        const response = await fetch(`/api/renewals/pending/${id}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Subscription approved and imported!', 'success');
            loadSubscriptions();
            loadPendingSubscriptions();
        } else {
            showToast(result.error || 'Failed to approve subscription', 'error');
        }
    } catch (error) {
        console.error('Error approving pending:', error);
        showToast('Error approving subscription', 'error');
    }
}

// Edit pending subscription (opens modal with pre-filled data)
async function editPending(id) {
    const pending = pendingSubscriptions.find(p => p.id === id);
    if (!pending) return;
    
    // Pre-fill the add/edit modal with extracted data
    document.getElementById('modal-title').textContent = 'Edit Subscription Import';
    document.getElementById('subscription-id').value = ''; // New subscription
    document.getElementById('delete-btn').style.display = 'none';
    const testAlertBtn = document.getElementById('test-alert-btn');
    if (testAlertBtn) testAlertBtn.style.display = 'none';
    
    // Show reject button for pending subscriptions
    const rejectBtn = document.getElementById('reject-pending-btn');
    if (rejectBtn) {
        rejectBtn.style.display = 'block';
        rejectBtn.setAttribute('data-pending-id', id);
    }
    
    // Fill form with pending data
    document.getElementById('sub-name').value = pending.name || '';
    document.getElementById('sub-vendor').value = pending.vendor || '';
    document.getElementById('sub-renewal-date').value = pending.renewalDate ? pending.renewalDate.split('T')[0] : '';
    document.getElementById('sub-cancel-by-date').value = '';
    document.getElementById('sub-cost').value = pending.cost || '';
    document.getElementById('sub-billing-cycle').value = pending.billingCycle || 'annual';
    document.getElementById('sub-seats').value = '';
    document.getElementById('sub-account-number').value = pending.accountNumber || '';
    document.getElementById('sub-owner').value = '';
    document.getElementById('sub-alert-email').value = '';
    document.getElementById('sub-notes').value = pending.rawText ? `Imported from: ${pending.attachmentNames?.join(', ') || 'document'}` : '';
    
    // Set default alert days
    document.querySelectorAll('input[name="alert-days"]').forEach(cb => {
        cb.checked = [60, 30, 7].includes(parseInt(cb.value));
    });
    
    // Update cost label based on billing cycle
    updateCostLabel();
    
    // Store pending ID for approval after save
    document.getElementById('subscription-form').dataset.pendingId = id;
    
    document.getElementById('subscription-modal').style.display = 'flex';
}

// Reject pending subscription
async function rejectPending(id = null) {
    // Get ID from button data attribute if not provided
    if (!id) {
        const rejectBtn = document.getElementById('reject-pending-btn');
        id = rejectBtn ? rejectBtn.getAttribute('data-pending-id') : null;
    }
    
    if (!id) return;
    
    if (!confirm('Reject this import? The extracted data will be deleted.')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/renewals/pending/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            closeModal();
            showToast('Import rejected', 'success');
            loadPendingSubscriptions();
        } else {
            showToast(result.error || 'Failed to reject import', 'error');
        }
    } catch (error) {
        console.error('Error rejecting pending:', error);
        showToast('Error rejecting import', 'error');
    }
}

// Toggle upload zone visibility
function toggleUploadZone() {
    const uploadZone = document.getElementById('upload-zone');
    uploadZone.style.display = uploadZone.style.display === 'none' ? 'block' : 'none';
}

// Handle file upload
async function handleFileUpload(files) {
    if (!files || files.length === 0) return;
    
    // Show progress
    const progressElements = [
        document.getElementById('upload-progress'),
        document.getElementById('main-upload-progress')
    ].filter(el => el);
    
    const statusElements = [
        document.getElementById('upload-status'),
        document.getElementById('main-upload-status')
    ].filter(el => el);
    
    progressElements.forEach(el => el.classList.add('active'));
    statusElements.forEach(el => el.textContent = `Processing ${files.length} file(s)...`);
    
    try {
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
        }
        
        const response = await fetch('/api/renewals/upload', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message || 'Files processed successfully!', 'success');
            loadPendingSubscriptions();
            
            // Reset file inputs
            const fileInputs = document.querySelectorAll('input[type="file"]');
            fileInputs.forEach(input => input.value = '');
            
            // Hide upload zone in pending section
            const uploadZone = document.getElementById('upload-zone');
            if (uploadZone) uploadZone.style.display = 'none';
        } else {
            showToast(result.error || 'Failed to process files', 'error');
        }
    } catch (error) {
        console.error('Error uploading files:', error);
        showToast('Error uploading files', 'error');
    } finally {
        progressElements.forEach(el => el.classList.remove('active'));
    }
}

// Setup drag and drop for upload zones
function setupDragAndDrop() {
    const uploadZones = document.querySelectorAll('.upload-zone');
    
    uploadZones.forEach(zone => {
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('dragover');
        });
        
        zone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
        });
        
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFileUpload(files);
            }
        });
    });
}

// Override saveSubscription to handle pending approval
const originalSaveSubscription = saveSubscription;
saveSubscription = async function(event) {
    event.preventDefault();
    
    const form = document.getElementById('subscription-form');
    const pendingId = form.dataset.pendingId;
    
    // If this is from a pending approval, use the approve endpoint
    if (pendingId) {
        try {
            // Gather alert days
            const alertDays = Array.from(document.querySelectorAll('input[name="alert-days"]:checked'))
                .map(cb => parseInt(cb.value))
                .sort((a, b) => b - a);
            
            const data = {
                name: document.getElementById('sub-name').value.trim(),
                vendor: document.getElementById('sub-vendor').value.trim(),
                renewalDate: document.getElementById('sub-renewal-date').value,
                cancelByDate: document.getElementById('sub-cancel-by-date').value || null,
                cost: document.getElementById('sub-cost').value ? parseFloat(document.getElementById('sub-cost').value) : null,
                billingCycle: document.getElementById('sub-billing-cycle').value,
                seats: document.getElementById('sub-seats').value ? parseInt(document.getElementById('sub-seats').value) : null,
                accountNumber: document.getElementById('sub-account-number').value.trim() || null,
                owner: document.getElementById('sub-owner').value.trim() || null,
                alertEmail: document.getElementById('sub-alert-email').value.trim() || null,
                alertDays: alertDays.length > 0 ? alertDays : [60, 30, 7],
                notes: document.getElementById('sub-notes').value.trim() || null
            };
            
            const response = await fetch(`/api/renewals/pending/${pendingId}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (result.success) {
                closeModal();
                showToast('Subscription imported successfully!', 'success');
                delete form.dataset.pendingId;
                loadSubscriptions();
                loadPendingSubscriptions();
            } else {
                showToast(result.error || 'Failed to import subscription', 'error');
            }
        } catch (error) {
            console.error('Error approving pending:', error);
            showToast('Error importing subscription', 'error');
        }
        return;
    }
    
    // Otherwise use original save function
    const id = document.getElementById('subscription-id').value;
    const isEdit = !!id;
    
    // Gather alert days
    const alertDays = Array.from(document.querySelectorAll('input[name="alert-days"]:checked'))
        .map(cb => parseInt(cb.value))
        .sort((a, b) => b - a);
    
    const data = {
        name: document.getElementById('sub-name').value.trim(),
        vendor: document.getElementById('sub-vendor').value.trim(),
        renewalDate: document.getElementById('sub-renewal-date').value,
        cancelByDate: document.getElementById('sub-cancel-by-date').value || null,
        cost: document.getElementById('sub-cost').value ? parseFloat(document.getElementById('sub-cost').value) : null,
        billingCycle: document.getElementById('sub-billing-cycle').value,
        seats: document.getElementById('sub-seats').value ? parseInt(document.getElementById('sub-seats').value) : null,
        accountNumber: document.getElementById('sub-account-number').value.trim() || null,
        owner: document.getElementById('sub-owner').value.trim() || null,
        alertEmail: document.getElementById('sub-alert-email').value.trim() || null,
        alertDays: alertDays.length > 0 ? alertDays : [60, 30, 7],
        notes: document.getElementById('sub-notes').value.trim() || null
    };
    
    try {
        const url = isEdit ? `/api/renewals/${id}` : '/api/renewals';
        const method = isEdit ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            closeModal();
            showToast(isEdit ? 'Subscription updated!' : 'Subscription added!', 'success');
            loadSubscriptions();
        } else {
            showToast(result.error || 'Failed to save subscription', 'error');
        }
    } catch (error) {
        console.error('Error saving subscription:', error);
        showToast('Error saving subscription', 'error');
    }
}

// Override closeModal to clean up pending ID
const originalCloseModal = closeModal;
closeModal = function() {
    const form = document.getElementById('subscription-form');
    if (form) {
        delete form.dataset.pendingId;
    }
    // Hide reject button
    const rejectBtn = document.getElementById('reject-pending-btn');
    if (rejectBtn) {
        rejectBtn.style.display = 'none';
        rejectBtn.removeAttribute('data-pending-id');
    }
    // Hide test alert button
    const testAlertBtn = document.getElementById('test-alert-btn');
    if (testAlertBtn) {
        testAlertBtn.style.display = 'none';
        testAlertBtn.removeAttribute('data-subscription-id');
    }
    document.getElementById('subscription-modal').style.display = 'none';
}


