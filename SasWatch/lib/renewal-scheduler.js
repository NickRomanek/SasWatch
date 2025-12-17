/**
 * Renewal Scheduler - Sends email reminders for upcoming subscription renewals
 * 
 * Runs daily at 8:00 AM to check for subscriptions that need reminder emails
 * based on their configured alertDays settings.
 */

const cron = require('node-cron');
const prisma = require('./prisma');
const { sendRenewalReminderEmail } = require('./email-sender');
const { startEmailPolling, stopEmailPolling, pollInboxForSubscriptions } = require('./email-ingestion');

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
    
    // Schedule for 8:00 AM every day
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

module.exports = {
    startRenewalScheduler,
    stopSchedulers,
    processRenewalReminders,
    triggerRenewalCheck,
    triggerEmailPoll
};


