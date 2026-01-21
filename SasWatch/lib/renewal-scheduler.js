/**
 * Renewal Scheduler - Sends email reminders for upcoming subscription renewals
 * 
 * Runs daily at 8:00 AM to check for subscriptions that need reminder emails
 * based on their configured alertDays settings.
 */

const cron = require('node-cron');
const prisma = require('./prisma');
const { sendRenewalReminderEmail, sendInactivityAlertEmail } = require('./email-sender');
const { startEmailPolling, stopEmailPolling, pollInboxForSubscriptions } = require('./email-ingestion');
const { getInactiveUsers } = require('./database-multitenant');

// Track if scheduler is running to prevent duplicate starts
let isSchedulerRunning = false;
let emailPollingIntervalId = null;

/**
 * Calculate days until a given date
 */
function getDaysUntil(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    return Math.floor((date - now) / (1000 * 60 * 60 * 24));
}

/**
 * Check if we should send an alert for this subscription today
 * Returns the matching alert threshold (e.g., 60, 30, 7) or null
 */
function shouldSendAlert(subscription, daysUntil) {
    const alertDays = subscription.alertDays || [60, 30, 7];
    
    // Check if daysUntil matches any of the alert thresholds
    // We check for exact match or if we're past the threshold but haven't sent yet
    for (const threshold of alertDays.sort((a, b) => b - a)) {
        if (daysUntil === threshold) {
            return threshold;
        }
        // Also alert if we're past due (daysUntil < 0) and haven't alerted recently
        if (daysUntil < 0 && threshold === Math.min(...alertDays)) {
            return threshold;
        }
    }
    
    return null;
}

/**
 * Check if we've already sent an alert for this threshold recently
 */
function hasRecentAlert(subscription, threshold) {
    if (!subscription.lastAlertSent) return false;
    
    const lastAlert = new Date(subscription.lastAlertSent);
    const now = new Date();
    
    // Don't send more than one alert per week for the same subscription
    const daysSinceLastAlert = Math.floor((now - lastAlert) / (1000 * 60 * 60 * 24));
    return daysSinceLastAlert < 7;
}

/**
 * Process renewal reminders for all accounts
 */
async function processRenewalReminders() {
    console.log('[Renewal Scheduler] Starting renewal reminder check...');
    
    try {
        // Get all active subscriptions that aren't archived
        const subscriptions = await prisma.subscription.findMany({
            where: {
                isArchived: false
            },
            include: {
                account: {
                    select: {
                        id: true,
                        name: true,
                        email: true
                    }
                }
            }
        });
        
        console.log(`[Renewal Scheduler] Found ${subscriptions.length} active subscriptions`);
        
        let emailsSent = 0;
        let errors = 0;
        
        for (const subscription of subscriptions) {
            try {
                const daysUntil = getDaysUntil(subscription.renewalDate);
                const matchingThreshold = shouldSendAlert(subscription, daysUntil);
                
                if (!matchingThreshold) {
                    continue; // No alert needed for this threshold
                }
                
                // Check if we've already sent a recent alert
                if (hasRecentAlert(subscription, matchingThreshold)) {
                    console.log(`[Renewal Scheduler] Skipping "${subscription.name}" - already alerted recently`);
                    continue;
                }
                
                // Determine recipient email
                const recipientEmail = subscription.alertEmail || subscription.account.email;
                
                if (!recipientEmail) {
                    console.warn(`[Renewal Scheduler] No email for subscription "${subscription.name}" (account: ${subscription.account.name})`);
                    continue;
                }
                
                console.log(`[Renewal Scheduler] Sending reminder for "${subscription.name}" (${daysUntil} days) to ${recipientEmail}`);
                
                // Send the email
                await sendRenewalReminderEmail({
                    to: recipientEmail,
                    subscription,
                    daysUntil,
                    accountName: subscription.account.name
                });
                
                // Update lastAlertSent timestamp
                await prisma.subscription.update({
                    where: { id: subscription.id },
                    data: { lastAlertSent: new Date() }
                });
                
                emailsSent++;
                
                // Small delay between emails to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error(`[Renewal Scheduler] Error processing subscription "${subscription.name}":`, error.message);
                errors++;
            }
        }
        
        console.log(`[Renewal Scheduler] Completed. Sent ${emailsSent} emails, ${errors} errors.`);
        return { emailsSent, errors };
        
    } catch (error) {
        console.error('[Renewal Scheduler] Fatal error:', error);
        throw error;
    }
}

/**
 * Start the renewal scheduler cron job
 * Runs daily at 8:00 AM server time
 */
function startRenewalScheduler() {
    if (isSchedulerRunning) {
        console.log('[Renewal Scheduler] Already running, skipping start');
        return;
    }
    
    // Check if email configuration is available
    // Requires Graph API credentials and at least one "from" email address
    const hasEmailConfig = process.env.GRAPH_TENANT_ID && 
                           process.env.GRAPH_CLIENT_ID && 
                           process.env.GRAPH_CLIENT_SECRET &&
                           (process.env.GRAPH_FROM_EMAIL || process.env.GRAPH_REMINDER_EMAIL);
    
    if (!hasEmailConfig) {
        console.log('[Renewal Scheduler] Email not configured, scheduler disabled');
        return;
    }
    
    console.log('[Renewal Scheduler] Starting scheduler (daily at 8:00 AM)');
    
    // Schedule renewal reminders for 8:00 AM every day
    // Cron format: minute hour day month weekday
    cron.schedule('0 8 * * *', async () => {
        console.log('[Renewal Scheduler] Running scheduled check...');
        try {
            await processRenewalReminders();
        } catch (error) {
            console.error('[Renewal Scheduler] Scheduled run failed:', error);
        }
    }, {
        scheduled: true,
        timezone: 'America/New_York' // Adjust as needed
    });
    
    // Schedule inactivity alerts for 9:00 AM every Monday
    // Sends weekly digest of inactive users to accounts that have alerts enabled
    cron.schedule('0 9 * * 1', async () => {
        console.log('[Inactivity Alerts] Running scheduled check...');
        try {
            await processInactivityAlerts();
        } catch (error) {
            console.error('[Inactivity Alerts] Scheduled run failed:', error);
        }
    }, {
        scheduled: true,
        timezone: 'America/New_York' // Adjust as needed
    });
    
    // Start email ingestion polling (if enabled)
    emailPollingIntervalId = startEmailPolling();
    
    isSchedulerRunning = true;
    console.log('[Renewal Scheduler] Scheduler started successfully');
}

/**
 * Stop all schedulers
 */
function stopSchedulers() {
    if (emailPollingIntervalId) {
        stopEmailPolling(emailPollingIntervalId);
        emailPollingIntervalId = null;
    }
    isSchedulerRunning = false;
    console.log('[Renewal Scheduler] All schedulers stopped');
}

/**
 * Process inactivity alerts for all accounts with alerts enabled
 */
async function processInactivityAlerts() {
    console.log('[Inactivity Alerts] Starting inactivity alert check...');
    
    try {
        // Get all accounts with inactivity alerts enabled
        const accounts = await prisma.account.findMany({
            where: {
                inactivityAlertEnabled: true,
                isActive: true
            },
            select: {
                id: true,
                name: true,
                email: true,
                inactivityAlertThreshold: true,
                inactivityAlertLastSent: true,
                inactivityAlertEmail: true
            }
        });
        
        console.log(`[Inactivity Alerts] Found ${accounts.length} accounts with alerts enabled`);
        
        let emailsSent = 0;
        let errors = 0;
        
        for (const account of accounts) {
            try {
                // Check if we've already sent an alert today
                if (account.inactivityAlertLastSent) {
                    const lastSent = new Date(account.inactivityAlertLastSent);
                    const now = new Date();
                    const daysSinceLastAlert = Math.floor((now - lastSent) / (1000 * 60 * 60 * 24));
                    
                    // Only send alerts once per week max
                    if (daysSinceLastAlert < 7) {
                        console.log(`[Inactivity Alerts] Skipping ${account.name} - already alerted ${daysSinceLastAlert} days ago`);
                        continue;
                    }
                }
                
                // Get inactive users for this account
                const inactiveUsers = await getInactiveUsers(account.id, account.inactivityAlertThreshold);
                
                if (inactiveUsers.length === 0) {
                    console.log(`[Inactivity Alerts] No inactive users for ${account.name}`);
                    continue;
                }
                
                const recipientEmail = account.inactivityAlertEmail || account.email;
                
                if (!recipientEmail) {
                    console.warn(`[Inactivity Alerts] No email for account "${account.name}"`);
                    continue;
                }
                
                console.log(`[Inactivity Alerts] Sending alert for ${account.name} - ${inactiveUsers.length} inactive users`);
                
                // Send the email
                await sendInactivityAlertEmail({
                    to: recipientEmail,
                    accountName: account.name,
                    inactiveUsers,
                    daysThreshold: account.inactivityAlertThreshold
                });
                
                // Update lastAlertSent timestamp
                await prisma.account.update({
                    where: { id: account.id },
                    data: { inactivityAlertLastSent: new Date() }
                });
                
                emailsSent++;
                
                // Small delay between emails to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error(`[Inactivity Alerts] Error processing account "${account.name}":`, error.message);
                errors++;
            }
        }
        
        console.log(`[Inactivity Alerts] Completed. Sent ${emailsSent} emails, ${errors} errors.`);
        return { emailsSent, errors };
        
    } catch (error) {
        console.error('[Inactivity Alerts] Fatal error:', error);
        throw error;
    }
}

/**
 * Manually trigger renewal check (for testing/admin purposes)
 */
async function triggerRenewalCheck() {
    console.log('[Renewal Scheduler] Manual trigger requested');
    return await processRenewalReminders();
}

/**
 * Manually trigger email poll (for testing/admin purposes)
 */
async function triggerEmailPoll() {
    console.log('[Renewal Scheduler] Manual email poll triggered');
    return await pollInboxForSubscriptions();
}

/**
 * Manually trigger inactivity alert check (for testing/admin purposes)
 */
async function triggerInactivityAlerts() {
    console.log('[Inactivity Alerts] Manual trigger requested');
    return await processInactivityAlerts();
}

module.exports = {
    startRenewalScheduler,
    stopSchedulers,
    processRenewalReminders,
    processInactivityAlerts,
    triggerRenewalCheck,
    triggerEmailPoll,
    triggerInactivityAlerts
};


