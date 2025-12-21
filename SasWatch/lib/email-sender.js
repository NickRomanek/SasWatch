const axios = require('axios');

// Required env vars for token acquisition
const TOKEN_REQUIRED_ENV_VARS = [
    'GRAPH_TENANT_ID',
    'GRAPH_CLIENT_ID',
    'GRAPH_CLIENT_SECRET'
];

const SURVEY_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let cachedToken = null;
let cachedTokenExpiresAt = 0;

/**
 * Get environment variable value
 * @param {string} name - Environment variable name
 * @param {boolean} required - Whether the variable is required (default: true)
 * @returns {string|undefined} - The value or undefined if not required and missing
 */
function getEnvValue(name, required = true) {
    const value = process.env[name];
    if (!value && required) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

/**
 * Get the "from" email address for a specific purpose
 * @param {string} purpose - 'reset', 'verification', 'reminder', 'survey', 'notification'
 * @returns {string} - The email address to send from
 */
function getFromEmail(purpose) {
    switch (purpose) {
        case 'reminder':
            // Use GRAPH_REMINDER_EMAIL for renewal reminders, fallback to GRAPH_FROM_EMAIL
            return getEnvValue('GRAPH_REMINDER_EMAIL', false) || getEnvValue('GRAPH_FROM_EMAIL');
        case 'reset':
        case 'verification':
        case 'survey':
        case 'notification':
        default:
            // Use GRAPH_FROM_EMAIL for password resets, verification, surveys, and notifications
            return getEnvValue('GRAPH_FROM_EMAIL');
    }
}

function getNotifyRecipients() {
    const rawRecipients = getEnvValue('GRAPH_NOTIFY_EMAILS')
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean);

    if (!rawRecipients.length) {
        throw new Error('GRAPH_NOTIFY_EMAILS must contain at least one email address');
    }

    return rawRecipients.map((address) => ({
        emailAddress: { address }
    }));
}

async function acquireGraphToken() {
    const now = Date.now();
    if (cachedToken && cachedTokenExpiresAt - 60000 > now) {
        return cachedToken;
    }

    // Only check token-required vars, not email addresses
    TOKEN_REQUIRED_ENV_VARS.forEach(name => getEnvValue(name));

    const tenantId = getEnvValue('GRAPH_TENANT_ID');
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const params = new URLSearchParams();
    params.append('client_id', getEnvValue('GRAPH_CLIENT_ID'));
    params.append('client_secret', getEnvValue('GRAPH_CLIENT_SECRET'));
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
 * Send an email via Microsoft Graph API with enhanced error logging
 */
async function sendGraphEmail(fromEmail, message, emailType) {
    const graphToken = await acquireGraphToken();
    
    console.log(`[Email] Sending ${emailType} email from ${fromEmail}`);
    
    try {
        await axios.post(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromEmail)}/sendMail`,
            message,
            {
                headers: {
                    Authorization: `Bearer ${graphToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );
        console.log(`[Email] Successfully sent ${emailType} email from ${fromEmail}`);
    } catch (error) {
        // Enhanced error logging for debugging
        const graphError = error.response?.data?.error || {};
        console.error(`[Email] Graph API Error for ${emailType}:`, JSON.stringify({
            message: graphError.message || error.message,
            code: graphError.code,
            status: error.response?.status,
            statusText: error.response?.statusText,
            fromEmail: fromEmail,
            innerError: graphError.innerError
        }, null, 2));
        
        const errorMessage = graphError.message || error.message;
        throw new Error(`Failed to send ${emailType} email via Microsoft Graph: ${errorMessage}`);
    }
}

function buildSurveyBody({ email, feedback, rating, submittedAt, context = {} }) {
    const lines = [
        'New Survey Submission',
        '=====================',
        `Submitted At: ${submittedAt}`,
        `Email: ${email}`,
        `Rating: ${rating || 'Not provided'}`,
        '',
        'Feedback:',
        feedback || 'No feedback provided.',
    ];

    const contextDetails = [];
    if (context.accountId) contextDetails.push(`Account ID: ${context.accountId}`);
    if (context.accountEmail) contextDetails.push(`Account Email: ${context.accountEmail}`);
    if (context.ip) contextDetails.push(`IP Address: ${context.ip}`);
    if (context.userAgent) contextDetails.push(`User Agent: ${context.userAgent}`);

    if (contextDetails.length) {
        lines.push('', 'Context:', ...contextDetails);
    }

    return lines.join('\n');
}

async function sendSurveyEmail({ email, feedback, rating, submittedAt = new Date().toISOString(), context }) {
    if (!SURVEY_EMAIL_REGEX.test(email)) {
        throw new Error('Invalid email address provided for survey submission');
    }

    const fromEmail = getFromEmail('survey');
    const message = {
        message: {
            subject: 'Survey Submission',
            body: {
                contentType: 'Text',
                content: buildSurveyBody({
                    email,
                    feedback: feedback?.trim(),
                    rating: rating?.trim(),
                    submittedAt,
                    context
                })
            },
            toRecipients: getNotifyRecipients()
        },
        saveToSentItems: false
    };

    await sendGraphEmail(fromEmail, message, 'survey');
}

function buildVerificationEmailBody(accountName, verificationLink) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #0066cc; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px; }
                .button { display: inline-block; background: #0066cc; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Welcome to SasWatch!</h1>
                </div>
                <div class="content">
                    <h2>Hi ${accountName},</h2>
                    <p>Thank you for signing up for SasWatch! To get started, please verify your email address by clicking the button below:</p>
                    <center>
                        <a href="${verificationLink}" class="button">Verify Email Address</a>
                    </center>
                    <p>Or copy and paste this link into your browser:</p>
                    <p style="word-break: break-all; color: #0066cc;">${verificationLink}</p>
                    <p><strong>This link will expire in 24 hours.</strong></p>
                    <p>If you didn't create a SasWatch account, please ignore this email.</p>
                </div>
                <div class="footer">
                    <p>© ${new Date().getFullYear()} SasWatch. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

async function sendVerificationEmail({ to, token, accountName }) {
    if (!SURVEY_EMAIL_REGEX.test(to)) {
        throw new Error('Invalid email address provided for verification');
    }

    const fromEmail = getFromEmail('verification');
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const verificationLink = `${baseUrl}/verify-email?token=${token}`;

    const message = {
        message: {
            subject: 'Verify Your SasWatch Account',
            body: {
                contentType: 'HTML',
                content: buildVerificationEmailBody(accountName, verificationLink)
            },
            toRecipients: [{ emailAddress: { address: to } }]
        },
        saveToSentItems: false
    };

    await sendGraphEmail(fromEmail, message, 'verification');
}

function buildPasswordResetEmailBody(accountName, resetLink) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #0066cc; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px; }
                .button { display: inline-block; background: #0066cc; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
                .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 5px; margin: 20px 0; color: #856404; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Password Reset Request</h1>
                </div>
                <div class="content">
                    <h2>Hi ${accountName},</h2>
                    <p>We received a request to reset your password for your SasWatch account. Click the button below to reset your password:</p>
                    <center>
                        <a href="${resetLink}" class="button">Reset Password</a>
                    </center>
                    <p>Or copy and paste this link into your browser:</p>
                    <p style="word-break: break-all; color: #0066cc;">${resetLink}</p>
                    <div class="warning">
                        <p><strong>This link will expire in 1 hour.</strong></p>
                    </div>
                    <p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
                    <p>For security reasons, never share this link with anyone.</p>
                </div>
                <div class="footer">
                    <p>© ${new Date().getFullYear()} SasWatch. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

async function sendPasswordResetEmail({ to, token, accountName }) {
    if (!SURVEY_EMAIL_REGEX.test(to)) {
        throw new Error('Invalid email address provided for password reset');
    }

    const fromEmail = getFromEmail('reset');
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const resetLink = `${baseUrl}/reset-password?token=${token}`;

    const message = {
        message: {
            subject: 'Reset Your SasWatch Password',
            body: {
                contentType: 'HTML',
                content: buildPasswordResetEmailBody(accountName, resetLink)
            },
            toRecipients: [{ emailAddress: { address: to } }]
        },
        saveToSentItems: false
    };

    await sendGraphEmail(fromEmail, message, 'password-reset');
}

// MFA Email
function buildMfaEmailBody(accountName, mfaLink) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #4DD4A2; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px; }
                .button { display: inline-block; background: #4DD4A2; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: 600; }
                .button:hover { background: #2F6E5E; }
                .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
                .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 6px; margin: 15px 0; color: #856404; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Complete Your Login</h1>
                </div>
                <div class="content">
                    <h2>Hi ${accountName},</h2>
                    <p>You've successfully entered your password. To complete your login, please click the button below:</p>
                    <center>
                        <a href="${mfaLink}" class="button">Complete Login</a>
                    </center>
                    <p>Or copy and paste this link into your browser:</p>
                    <p style="word-break: break-all; color: #4DD4A2;">${mfaLink}</p>
                    <div class="warning">
                        <strong>⚠️ Security Notice:</strong> This link will expire in 15 minutes. If you didn't attempt to log in, please ignore this email and consider changing your password.
                    </div>
                    <p>If you didn't request this login, please ignore this email.</p>
                </div>
                <div class="footer">
                    <p>© ${new Date().getFullYear()} SasWatch. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

async function sendMfaEmail({ to, token, accountName }) {
    if (!SURVEY_EMAIL_REGEX.test(to)) {
        throw new Error('Invalid email address provided for MFA');
    }

    const fromEmail = getFromEmail('verification');
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const mfaLink = `${baseUrl}/mfa/verify?token=${token}`;

    const message = {
        message: {
            subject: 'Complete Your Login - SasWatch',
            body: {
                contentType: 'HTML',
                content: buildMfaEmailBody(accountName, mfaLink)
            },
            toRecipients: [{ emailAddress: { address: to } }]
        },
        saveToSentItems: false
    };

    await sendGraphEmail(fromEmail, message, 'mfa');
}

// Renewal Reminder Email
function buildRenewalReminderEmailBody(subscription, daysUntil, accountName) {
    const costSection = subscription.cost 
        ? `<p style="font-size: 1.5rem; color: #0066cc; margin: 15px 0;"><strong>$${parseFloat(subscription.cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> <span style="font-size: 0.9rem; color: #666;">(${subscription.billingCycle})</span></p>`
        : '';
    
    const seatsSection = subscription.seats 
        ? `<p style="margin: 5px 0;"><strong>Seats/Licenses:</strong> ${subscription.seats}</p>`
        : '';
    
    const accountNumberSection = subscription.accountNumber 
        ? `<p style="margin: 5px 0;"><strong>Account Number:</strong> ${subscription.accountNumber}</p>`
        : '';
    
    const ownerSection = subscription.owner 
        ? `<p style="margin: 5px 0;"><strong>Owner:</strong> ${subscription.owner}</p>`
        : '';
    
    const notesSection = subscription.notes 
        ? `<div style="background: #f0f0f0; padding: 12px; border-radius: 6px; margin-top: 15px;"><strong>Notes:</strong><br>${subscription.notes}</div>`
        : '';
    
    const cancelBySection = subscription.cancelByDate 
        ? `<div style="background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 6px; margin: 15px 0; color: #856404;"><strong>⚠️ Cancel By Date:</strong> ${new Date(subscription.cancelByDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>`
        : '';

    const urgencyColor = daysUntil <= 7 ? '#dc2626' : daysUntil <= 30 ? '#d97706' : '#059669';
    const urgencyBg = daysUntil <= 7 ? '#fee2e2' : daysUntil <= 30 ? '#fef3c7' : '#d1fae5';

    // Vendor-specific tips
    let costTip = '';
    const vendorLower = (subscription.vendor || '').toLowerCase();
    if (vendorLower.includes('adobe')) {
        costTip = 'Review user activity in SasWatch to identify unused Adobe licenses before renewal.';
    } else if (vendorLower.includes('microsoft')) {
        costTip = 'Check Entra sign-ins for inactive users who may be eligible for license downgrades.';
    } else if (vendorLower.includes('salesforce')) {
        costTip = 'Review user login activity and consider downgrading inactive users to lower-tier licenses.';
    } else {
        costTip = 'Consider negotiating multi-year discounts or consolidating vendors for better pricing.';
    }

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #0066cc; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px; }
                .urgency-badge { display: inline-block; padding: 8px 16px; border-radius: 20px; font-weight: bold; }
                .details-box { background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 20px 0; }
                .tip-box { background: #e8f4fd; border-left: 4px solid #0066cc; padding: 15px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>⏰ Renewal Reminder</h1>
                </div>
                <div class="content">
                    <p style="text-align: center;">
                        <span class="urgency-badge" style="background: ${urgencyBg}; color: ${urgencyColor};">
                            ${daysUntil === 0 ? '🔥 Renews Today!' : daysUntil < 0 ? `⚠️ ${Math.abs(daysUntil)} Days Overdue` : `${daysUntil} Days Until Renewal`}
                        </span>
                    </p>
                    
                    <div class="details-box">
                        <h2 style="margin-top: 0; color: #333;">${subscription.name}</h2>
                        <p style="margin: 5px 0; color: #666;"><strong>Vendor:</strong> ${subscription.vendor}</p>
                        <p style="margin: 5px 0;"><strong>Renewal Date:</strong> ${new Date(subscription.renewalDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                        ${costSection}
                        ${seatsSection}
                        ${accountNumberSection}
                        ${ownerSection}
                        ${notesSection}
                    </div>
                    
                    ${cancelBySection}
                    
                    <div class="tip-box">
                        <strong>💡 Cost-Saving Tip:</strong><br>
                        ${costTip}
                    </div>
                    
                    <p style="text-align: center; margin-top: 25px;">
                        <a href="${process.env.BASE_URL || 'https://app.saswatch.com'}/renewals" style="display: inline-block; background: #0066cc; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">View in SasWatch</a>
                    </p>
                </div>
                <div class="footer">
                    <p>You're receiving this because you have renewal alerts enabled for ${accountName}.</p>
                    <p>© ${new Date().getFullYear()} SasWatch. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

async function sendRenewalReminderEmail({ to, subscription, daysUntil, accountName }) {
    if (!SURVEY_EMAIL_REGEX.test(to)) {
        throw new Error('Invalid email address provided for renewal reminder');
    }

    // Use GRAPH_REMINDER_EMAIL for renewal reminders, fallback to GRAPH_FROM_EMAIL
    const fromEmail = getFromEmail('reminder');

    const urgencyPrefix = daysUntil <= 7 ? '🔴' : daysUntil <= 30 ? '🟡' : '🟢';
    const daysText = daysUntil === 0 ? 'Today' : daysUntil < 0 ? `${Math.abs(daysUntil)} days overdue` : `${daysUntil} days`;

    const message = {
        message: {
            subject: `${urgencyPrefix} Renewal Reminder: ${subscription.name} (${daysText})`,
            body: {
                contentType: 'HTML',
                content: buildRenewalReminderEmailBody(subscription, daysUntil, accountName)
            },
            toRecipients: [{ emailAddress: { address: to } }]
        },
        saveToSentItems: false
    };

    await sendGraphEmail(fromEmail, message, 'renewal-reminder');
}

module.exports = {
    sendSurveyEmail,
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendMfaEmail,
    sendRenewalReminderEmail,
    SURVEY_EMAIL_REGEX
};
