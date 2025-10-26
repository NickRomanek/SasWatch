// Intune Package Generator
// Dynamically generates ZIP packages for Microsoft Intune deployment
// Each package includes monitoring script with customer's API key + install/uninstall/detection scripts

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { generateMonitorScript } = require('./script-generator');

/**
 * Generates a ZIP package for Intune deployment
 * @param {Object} account - Account object with name, email, apiKey
 * @param {String} apiUrl - API URL for the monitoring script
 * @param {String} nodeEnv - Environment (development/production)
 * @returns {Promise<Buffer>} - ZIP file buffer
 */
async function generateIntunePackage(account, apiUrl, nodeEnv = 'production') {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });

        const chunks = [];

        // Collect chunks as they're created
        archive.on('data', chunk => chunks.push(chunk));

        // Resolve with complete buffer when done
        archive.on('end', () => {
            const buffer = Buffer.concat(chunks);
            resolve(buffer);
        });

        // Handle errors
        archive.on('error', err => reject(err));

        // =========================================
        // 1. Generate monitoring script with customer's API key
        // =========================================
        const monitoringScript = generateMonitorScript(account.apiKey, apiUrl, nodeEnv);
        archive.append(monitoringScript, { name: 'Monitor-AdobeUsage-Generated.ps1' });

        // =========================================
        // 2. Add installer script
        // =========================================
        const installerPath = path.join(__dirname, '../intune-scripts/Install-AdobeMonitor.ps1');
        if (!fs.existsSync(installerPath)) {
            return reject(new Error(`Installer script not found: ${installerPath}`));
        }
        archive.file(installerPath, { name: 'Install-AdobeMonitor.ps1' });

        // =========================================
        // 3. Add uninstaller script
        // =========================================
        const uninstallerPath = path.join(__dirname, '../intune-scripts/Uninstall-AdobeMonitor.ps1');
        if (!fs.existsSync(uninstallerPath)) {
            return reject(new Error(`Uninstaller script not found: ${uninstallerPath}`));
        }
        archive.file(uninstallerPath, { name: 'Uninstall-AdobeMonitor.ps1' });

        // =========================================
        // 4. Add detection script
        // =========================================
        const detectionPath = path.join(__dirname, '../intune-scripts/Detect-AdobeMonitor.ps1');
        if (!fs.existsSync(detectionPath)) {
            return reject(new Error(`Detection script not found: ${detectionPath}`));
        }
        archive.file(detectionPath, { name: 'Detect-AdobeMonitor.ps1' });

        // =========================================
        // 5. Add troubleshooting script
        // =========================================
        const troubleshootPath = path.join(__dirname, '../intune-scripts/troubleshoot-monitoring.ps1');
        if (!fs.existsSync(troubleshootPath)) {
            return reject(new Error(`Troubleshooting script not found: ${troubleshootPath}`));
        }
        archive.file(troubleshootPath, { name: 'troubleshoot-monitoring.ps1' });

        // =========================================
        // 6. Generate customized deployment guide
        // =========================================
        const deploymentGuide = generateDeploymentGuide(account, apiUrl, nodeEnv);
        archive.append(deploymentGuide, { name: 'DEPLOYMENT-GUIDE.txt' });

        // Finalize the archive
        archive.finalize();
    });
}

/**
 * Generates customized deployment guide for customer
 * @param {Object} account - Account object
 * @param {String} apiUrl - API URL
 * @param {String} nodeEnv - Environment
 * @returns {String} - Customized deployment guide
 */
function generateDeploymentGuide(account, apiUrl, nodeEnv) {
    const templatePath = path.join(__dirname, '../intune-scripts/DEPLOYMENT-GUIDE-template.txt');

    if (!fs.existsSync(templatePath)) {
        throw new Error(`Deployment guide template not found: ${templatePath}`);
    }

    let template = fs.readFileSync(templatePath, 'utf8');

    // Remove trailing slash from API URL if present
    const cleanApiUrl = apiUrl.replace(/\/$/, '');

    // Replace placeholders with customer's actual data
    template = template.replace(/{{ACCOUNT_NAME}}/g, account.name);
    template = template.replace(/{{ACCOUNT_EMAIL}}/g, account.email);
    template = template.replace(/{{API_URL}}/g, cleanApiUrl);
    template = template.replace(/{{API_KEY}}/g, account.apiKey);
    template = template.replace(/{{GENERATED_DATE}}/g, new Date().toLocaleString());
    template = template.replace(/{{NODE_ENV}}/g, nodeEnv.toUpperCase());

    return template;
}

/**
 * Generates customized troubleshooting script with customer's API key and URL
 * @param {String} apiKey - Customer's API key
 * @param {String} apiUrl - API base URL
 * @returns {String} - Customized troubleshooting script
 */
function generateTroubleshootScript(apiKey, apiUrl) {
    const templatePath = path.join(__dirname, '../troubleshoot-monitoring.ps1');

    if (!fs.existsSync(templatePath)) {
        throw new Error(`Troubleshooting script template not found: ${templatePath}`);
    }

    let script = fs.readFileSync(templatePath, 'utf8');

    // Remove trailing slash from API URL if present
    const cleanApiUrl = apiUrl.replace(/\/$/, '');

    // Replace hardcoded localhost URLs with customer's actual API URL
    script = script.replace(/http:\/\/localhost:3000/g, cleanApiUrl);

    // Replace hardcoded API key with customer's actual API key
    script = script.replace(/"dca3ea2d-0953-4aa6-b39a-0b3facfff360"/g, `"${apiKey}"`);

    return script;
}

/**
 * Get suggested filename for the Intune package
 * @param {Object} account - Account object
 * @param {String} environment - Environment (production/testing)
 * @returns {String} - Suggested filename
 */
function getPackageFilename(account, environment = 'production') {
    // Create safe filename from account name
    const safeName = account.name
        .replace(/[^a-zA-Z0-9-]/g, '-') // Replace special chars with dash
        .replace(/-+/g, '-')  // Replace multiple dashes with single dash
        .toLowerCase();

    const envSuffix = environment === 'testing' ? '-Testing' : '';
    return `AdobeMonitor-Intune-${safeName}${envSuffix}.zip`;
}

module.exports = {
    generateIntunePackage,
    generateDeploymentGuide,
    getPackageFilename
};
