const axios = require('axios');

const REQUIRED_ENV_VARS = [
    'GRAPH_TENANT_ID',
    'GRAPH_CLIENT_ID',
    'GRAPH_CLIENT_SECRET',
    'GRAPH_FROM_EMAIL',
    'GRAPH_NOTIFY_EMAILS'
];

const SURVEY_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function getEnvValue(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
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

    REQUIRED_ENV_VARS.forEach(getEnvValue);

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

    const token = await acquireGraphToken();
    const fromEmail = getEnvValue('GRAPH_FROM_EMAIL');
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

    try {
        await axios.post(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromEmail)}/sendMail`,
            message,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );
    } catch (error) {
        const graphError = error.response?.data?.error?.message || error.message;
        throw new Error(`Failed to send survey email via Microsoft Graph: ${graphError}`);
    }
}

module.exports = {
    sendSurveyEmail,
    SURVEY_EMAIL_REGEX
};

