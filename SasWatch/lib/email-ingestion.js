/**
 * Email Ingestion Service
 * Polls a shared mailbox for subscription documents and processes them
 */

const axios = require('axios');
const prisma = require('./prisma');
const { processMultipleAttachments, isSupportedFileType, getMimeTypeFromFilename } = require('./document-extractor');

// Token cache (shared with email-sender.js concept)
let cachedToken = null;
let cachedTokenExpiresAt = 0;

// Track processed email IDs to avoid duplicates
const processedEmails = new Set();

/**
 * Sanitize text for PostgreSQL UTF-8 storage
 * Removes null bytes and other problematic characters
 */
function sanitizeTextForDb(text) {
    if (!text) return null;
    // Remove null bytes (0x00) which PostgreSQL doesn't accept
    // Also remove other control characters except newlines/tabs
    return text
        .replace(/\x00/g, '')  // Remove null bytes
        .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, ' ')  // Replace other control chars with space
        .trim();
}

/**
 * Acquire a Graph API access token
 */
async function acquireGraphToken() {
    const now = Date.now();
    if (cachedToken && cachedTokenExpiresAt - 60000 > now) {
        return cachedToken;
    }

    const tenantId = process.env.GRAPH_TENANT_ID;
    const clientId = process.env.GRAPH_CLIENT_ID;
    const clientSecret = process.env.GRAPH_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
        throw new Error('Missing required Graph API environment variables (GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET)');
    }

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('grant_type', 'client_credentials');

    try {
        const response = await axios.post(tokenUrl, params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
        });

        cachedToken = response.data.access_token;
        const expiresIn = Number(response.data.expires_in) || 3600;
        cachedTokenExpiresAt = now + expiresIn * 1000;
        return cachedToken;
    } catch (error) {
        const message = error.response?.data?.error_description || error.message;
        throw new Error(`Failed to acquire Microsoft Graph access token: ${message}`);
    }
}

/**
 * Determine if email ingestion feature flag is enabled (case-insensitive)
 */
function isEmailIngestionEnabled() {
    return String(process.env.ENABLE_EMAIL_INGESTION || '')
        .trim()
        .toLowerCase() === 'true';
}

/**
 * Get unread messages from the subscription inbox
 */
async function getUnreadMessages() {
    const inboxEmail = process.env.SUBSCRIPTION_INBOX_EMAIL;
    if (!inboxEmail) {
        throw new Error('SUBSCRIPTION_INBOX_EMAIL environment variable is required');
    }

    const token = await acquireGraphToken();

    try {
        // For shared mailboxes, use explicit mailFolders/inbox path
        // This is more reliable than /messages for shared mailboxes
        const response = await axios.get(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(inboxEmail)}/mailFolders/inbox/messages`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    '$filter': 'isRead eq false',
                    '$select': 'id,subject,from,receivedDateTime,hasAttachments',
                    '$top': 50
                },
                timeout: 30000
            }
        );

        // Filter for messages with attachments client-side
        // Also sort by receivedDateTime descending (newest first)
        const allMessages = response.data.value || [];
        const messages = allMessages
            .filter(msg => msg.hasAttachments)
            .sort((a, b) => new Date(b.receivedDateTime) - new Date(a.receivedDateTime));

        console.log(`[EmailIngestion] Retrieved ${allMessages.length} unread messages, ${messages.length} with attachments`);

        return messages;
    } catch (error) {
        // Enhanced error logging for debugging
        const graphError = error.response?.data?.error || {};
        console.error('[EmailIngestion] Graph API Error:', JSON.stringify({
            message: graphError.message || error.message,
            code: graphError.code,
            status: error.response?.status,
            statusText: error.response?.statusText
        }, null, 2));
        throw new Error(`Failed to fetch messages from inbox: ${graphError.message || error.message}`);
    }
}

/**
 * Get attachments for a specific message
 */
async function getMessageAttachments(messageId) {
    const inboxEmail = process.env.SUBSCRIPTION_INBOX_EMAIL;
    const token = await acquireGraphToken();

    try {
        // Use mailFolders/inbox path for shared mailbox compatibility
        // Note: do not apply $select contentBytes; Graph will reject for base attachment type
        const response = await axios.get(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(inboxEmail)}/mailFolders/inbox/messages/${messageId}/attachments`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        const attachments = response.data.value || [];
        console.log(`[EmailIngestion] Found ${attachments.length} attachment(s) for message ${messageId}`);
        return attachments;
    } catch (error) {
        const graphError = error.response?.data?.error?.message || error.message;
        console.error(`[EmailIngestion] Failed to get attachments for ${messageId}:`, graphError);
        throw new Error(`Failed to fetch attachments: ${graphError}`);
    }
}

/**
 * Mark a message as read
 */
async function markMessageAsRead(messageId) {
    const inboxEmail = process.env.SUBSCRIPTION_INBOX_EMAIL;
    const token = await acquireGraphToken();

    try {
        // Use mailFolders/inbox path for shared mailbox compatibility
        await axios.patch(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(inboxEmail)}/mailFolders/inbox/messages/${messageId}`,
            { isRead: true },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );
        console.log(`[EmailIngestion] Marked message ${messageId} as read`);
    } catch (error) {
        console.error(`[EmailIngestion] Failed to mark message ${messageId} as read:`, error.message);
    }
}

/**
 * Find account by email address (case-insensitive)
 */
async function findAccountByEmail(email) {
    if (!email) return null;

    const normalizedEmail = email.toLowerCase().trim();

    const account = await prisma.account.findFirst({
        where: {
            email: {
                equals: normalizedEmail,
                mode: 'insensitive'
            },
            isActive: true
        },
        select: {
            id: true,
            email: true,
            name: true
        }
    });

    return account;
}

/**
 * Check if an email has already been processed
 */
async function isEmailAlreadyProcessed(messageId, accountId) {
    // Check in-memory cache first
    if (processedEmails.has(messageId)) {
        return true;
    }

    // Check database
    const existing = await prisma.pendingSubscription.findFirst({
        where: {
            sourceEmailId: messageId,
            accountId: accountId
        }
    });

    if (existing) {
        processedEmails.add(messageId);
        return true;
    }

    return false;
}

/**
 * Process a single email message
 */
async function processEmail(message) {
    const messageId = message.id;
    const senderEmail = message.from?.emailAddress?.address;
    const subject = message.subject || 'No subject';

    console.log(`[EmailIngestion] Processing email: "${subject}" from ${senderEmail}`);

    // Find account by sender email
    const account = await findAccountByEmail(senderEmail);

    if (!account) {
        console.log(`[EmailIngestion] No account found for email ${senderEmail}, skipping`);
        await markMessageAsRead(messageId);
        return null;
    }

    // Check if already processed
    if (await isEmailAlreadyProcessed(messageId, account.id)) {
        console.log(`[EmailIngestion] Email ${messageId} already processed, skipping`);
        await markMessageAsRead(messageId);
        return null;
    }

    // Check monthly email limit (max 20 emails per month per account)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Count unique emails processed this month by grouping by sourceEmailId
    const emailsThisMonth = await prisma.pendingSubscription.groupBy({
        by: ['sourceEmailId'],
        where: {
            accountId: account.id,
            sourceType: 'email',
            sourceEmailId: { not: null },
            createdAt: { gte: startOfMonth }
        }
    });

    const uniqueEmailsThisMonth = emailsThisMonth.length;
    
    if (uniqueEmailsThisMonth >= 20) {
        console.log(`[EmailIngestion] Account ${account.id} has reached monthly limit of 20 emails (${uniqueEmailsThisMonth} processed this month). Skipping.`);
        await markMessageAsRead(messageId);
        return null;
    }

    // Get attachments
    const attachments = await getMessageAttachments(messageId);
    
    if (!attachments || attachments.length === 0) {
        console.log(`[EmailIngestion] No attachments found in email, skipping`);
        await markMessageAsRead(messageId);
        return null;
    }

    // Filter to supported file types and prepare for processing
    const supportedAttachments = attachments
        .filter(att => {
            const mimeType = att.contentType || getMimeTypeFromFilename(att.name);
            return isSupportedFileType(mimeType) && att.contentBytes;
        })
        .map(att => ({
            buffer: Buffer.from(att.contentBytes, 'base64'),
            mimeType: att.contentType || getMimeTypeFromFilename(att.name),
            filename: att.name
        }));

    if (supportedAttachments.length === 0) {
        console.log(`[EmailIngestion] No supported attachments in email, skipping`);
        await markMessageAsRead(messageId);
        return null;
    }

    // Limit: Maximum 4 PDFs per email
    const pdfAttachments = supportedAttachments.filter(att => 
        att.mimeType === 'application/pdf' || att.filename.toLowerCase().endsWith('.pdf')
    );
    
    if (pdfAttachments.length > 4) {
        console.log(`[EmailIngestion] Email from ${senderEmail} has ${pdfAttachments.length} PDF attachments, maximum is 4 per email. Skipping.`);
        await markMessageAsRead(messageId);
        return null;
    }

    console.log(`[EmailIngestion] Processing ${supportedAttachments.length} attachment(s) (${pdfAttachments.length} PDFs) for account ${account.id}`);

    // Extract subscription data from attachments
    const extractedData = await processMultipleAttachments(supportedAttachments);

    if (extractedData.length === 0) {
        console.log(`[EmailIngestion] Could not extract data from attachments`);
        await markMessageAsRead(messageId);
        return null;
    }

    // Save to pending_subscriptions table
    const pendingItems = [];

    for (const data of extractedData) {
        try {
            const pending = await prisma.pendingSubscription.create({
                data: {
                    accountId: account.id,
                    sourceType: 'email',
                    sourceEmailId: messageId,
                    senderEmail: senderEmail,
                    vendor: sanitizeTextForDb(data.vendor),
                    name: sanitizeTextForDb(data.name),
                    cost: data.cost,
                    renewalDate: data.renewalDate,
                    billingCycle: data.billingCycle,
                    accountNumber: sanitizeTextForDb(data.accountNumber),
                    confidence: data.confidence,
                    rawText: sanitizeTextForDb(data.rawText),
                    attachmentNames: data.attachmentNames || [],
                    status: 'pending'
                }
            });

            pendingItems.push(pending);
            processedEmails.add(messageId);

            console.log(`[EmailIngestion] Created pending subscription: vendor=${data.vendor}, name=${data.name}`);
        } catch (error) {
            if (error.code === 'P2002') {
                // Duplicate key - already processed
                console.log(`[EmailIngestion] Duplicate entry, skipping`);
            } else {
                console.error(`[EmailIngestion] Failed to save pending subscription:`, error.message);
            }
        }
    }

    // Mark email as read
    await markMessageAsRead(messageId);

    return pendingItems;
}

/**
 * Main polling function - checks inbox for new subscription documents
 */
async function pollInboxForSubscriptions() {
    if (!isEmailIngestionEnabled()) {
        console.log('[EmailIngestion] Email ingestion is disabled');
        return { processed: 0, skipped: 0, errors: 0 };
    }

    const inboxEmail = process.env.SUBSCRIPTION_INBOX_EMAIL;
    console.log(`[EmailIngestion] Starting inbox poll for: ${inboxEmail}`);

    const stats = {
        processed: 0,
        skipped: 0,
        errors: 0
    };

    try {
        const messages = await getUnreadMessages();

        if (messages.length === 0) {
            console.log('[EmailIngestion] No unread messages with attachments to process');
            return stats;
        }

        console.log(`[EmailIngestion] Processing ${messages.length} message(s)...`);

        for (const message of messages) {
            try {
                const fromEmail = message.from?.emailAddress?.address || 'unknown';
                console.log(`[EmailIngestion] Processing: "${message.subject}" from ${fromEmail}`);
                
                const result = await processEmail(message);
                
                if (result && result.length > 0) {
                    stats.processed += result.length;
                    console.log(`[EmailIngestion] Successfully extracted ${result.length} subscription(s) from message`);
                } else {
                    stats.skipped++;
                    console.log(`[EmailIngestion] Skipped message (no account match or extraction failed)`);
                }
            } catch (error) {
                console.error(`[EmailIngestion] Error processing message ${message.id}:`, error.message);
                stats.errors++;
            }
        }

        console.log(`[EmailIngestion] Poll complete: ${stats.processed} processed, ${stats.skipped} skipped, ${stats.errors} errors`);
    } catch (error) {
        console.error('[EmailIngestion] Poll failed:', error.message);
        if (error.stack) {
            console.error('[EmailIngestion] Stack:', error.stack);
        }
        stats.errors++;
    }

    return stats;
}

/**
 * Start the email polling scheduler
 */
function startEmailPolling() {
    const intervalMs = parseInt(process.env.EMAIL_POLLING_INTERVAL_MS) || 300000; // Default 5 minutes
    if (!isEmailIngestionEnabled()) {
        console.log('[EmailIngestion] Email ingestion is disabled, not starting poller');
        return null;
    }

    console.log(`[EmailIngestion] Starting email poller with ${intervalMs / 1000}s interval`);

    // Run immediately on start
    pollInboxForSubscriptions().catch(err => {
        console.error('[EmailIngestion] Initial poll failed:', err.message);
    });

    // Schedule periodic polling
    const intervalId = setInterval(async () => {
        try {
            await pollInboxForSubscriptions();
        } catch (error) {
            console.error('[EmailIngestion] Scheduled poll failed:', error.message);
        }
    }, intervalMs);

    return intervalId;
}

/**
 * Stop the email polling scheduler
 */
function stopEmailPolling(intervalId) {
    if (intervalId) {
        clearInterval(intervalId);
        console.log('[EmailIngestion] Email poller stopped');
    }
}

module.exports = {
    pollInboxForSubscriptions,
    startEmailPolling,
    stopEmailPolling,
    processEmail,
    findAccountByEmail
};

