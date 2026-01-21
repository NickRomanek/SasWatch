const crypto = require('crypto');

/**
 * Encryption utility for SasWatch
 * Uses AES-256-GCM for secure data storage
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recomendded for GCM
const AUTH_TAG_LENGTH = 16;
const KEY = process.env.ENCRYPTION_KEY;

if (!KEY || KEY.length !== 64) {
    console.error('CRITICAL: ENCRYPTION_KEY missing or invalid in .env. Must be 32 bytes (64 hex characters).');
    // We don't throw here to avoid crashing on startup if not used, but it will fail on use
}

/**
 * Encrypt text using AES-256-GCM
 * @param {string} text - Text to encrypt
 * @returns {string} - Encrypted string in format: iv:authTag:encryptedText
 */
function encrypt(text) {
    if (!text) return null;
    if (!KEY) throw new Error('ENCRYPTION_KEY missing');

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(KEY, 'hex'), iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt text using AES-256-GCM
 * @param {string} encryptedData - String in format: iv:authTag:encryptedText
 * @returns {string} - Decrypted text
 */
function decrypt(encryptedData) {
    if (!encryptedData) return null;
    if (!KEY) throw new Error('ENCRYPTION_KEY missing');

    try {
        const [ivHex, authTagHex, encryptedText] = encryptedData.split(':');

        if (!ivHex || !authTagHex || !encryptedText) {
            throw new Error('Invalid encrypted data format');
        }

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(KEY, 'hex'), iv);

        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        console.error('Decryption failed:', error.message);
        throw new Error('Decryption failed - possibly invalid key or corrupted data');
    }
}

module.exports = {
    encrypt,
    decrypt
};
