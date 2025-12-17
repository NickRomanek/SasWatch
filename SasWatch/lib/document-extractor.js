/**
 * Document Extractor Service
 * Uses OpenAI GPT-4o to extract subscription information from invoices, contracts, and renewal notices
 */

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

// Initialize OpenAI client
let openaiClient = null;

function getOpenAIClient() {
    if (!openaiClient) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required for document extraction');
        }
        openaiClient = new OpenAI({ apiKey });
    }
    return openaiClient;
}

/**
 * Extraction prompt for GPT-4o
 */
const EXTRACTION_PROMPT = `You are a document analysis assistant specializing in extracting subscription and billing information from invoices, contracts, and renewal notices.

Analyze the provided document and extract the following information:

1. **vendor**: The company name providing the service/product (e.g., "Adobe", "Microsoft", "Salesforce")
2. **name**: The specific subscription or service name (e.g., "Creative Cloud All Apps", "Microsoft 365 E3", "Salesforce Enterprise")
3. **cost**: The total amount due or subscription cost (number only, no currency symbols)
4. **renewalDate**: The next renewal date, due date, or subscription end date (ISO 8601 format: YYYY-MM-DD)
5. **billingCycle**: The billing frequency - one of: "monthly", "annual", or "multi-year"
6. **accountNumber**: Only extract account numbers or contract numbers that are clearly labeled as such (e.g., "Account #", "Contract #", "Customer ID"). DO NOT extract invoice numbers, receipt numbers, or transaction IDs.

Return your response as a JSON object with these exact field names. Use null for any fields you cannot confidently extract.

Example response:
{
  "vendor": "Adobe",
  "name": "Creative Cloud All Apps",
  "cost": 599.88,
  "renewalDate": "2025-12-15",
  "billingCycle": "annual",
  "accountNumber": "ACC-12345678"
}

Important guidelines:
- For cost, extract the total/grand total, not individual line items
- For dates, convert to ISO format (YYYY-MM-DD)
- For billing cycle, infer from context (e.g., "per year" = annual, "per month" = monthly)
- For accountNumber: ONLY extract if clearly labeled as "Account Number", "Contract Number", or "Customer ID". DO NOT extract invoice numbers, receipt numbers, order numbers, or transaction IDs.
- Be conservative - use null if uncertain rather than guessing
- If multiple subscriptions are in one document, extract the primary/most prominent one`;

// Lazy-load pdfjs-dist to avoid issues at startup
let pdfjsLib = null;

/**
 * Get pdfjs-dist module (lazy loaded)
 */
function getPdfjsLib() {
    if (!pdfjsLib) {
        try {
            pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
        } catch (e) {
            // Fallback for different Node versions
            try {
                pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
            } catch (e2) {
                console.warn('[DocumentExtractor] pdfjs-dist not available:', e2.message);
                return null;
            }
        }
    }
    return pdfjsLib;
}

/**
 * Extract text from PDF using pdfjs-dist (pure JS, no native deps)
 * @param {Buffer} pdfBuffer - The PDF file buffer
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromPdfWithPdfjs(pdfBuffer) {
    const pdfjs = getPdfjsLib();
    
    if (!pdfjs) {
        throw new Error('pdfjs-dist not available');
    }
    
    try {
        // Convert Buffer to Uint8Array for pdfjs
        const data = new Uint8Array(pdfBuffer);
        const pdf = await pdfjs.getDocument({ data }).promise;
        
        let fullText = '';
        const numPages = Math.min(pdf.numPages, 10); // Limit pages for performance
        
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            // Extract text items and join them
            const pageText = textContent.items
                .map(item => item.str)
                .join(' ');
            
            fullText += pageText + '\n\n';
        }
        
        console.log(`[DocumentExtractor] Extracted ${fullText.length} chars from ${numPages} PDF pages`);
        return fullText.trim();
    } catch (error) {
        console.error('[DocumentExtractor] pdfjs extraction failed:', error.message);
        throw error;
    }
}

/**
 * Extract text from a PDF using basic parsing (fallback)
 * @param {Buffer} pdfBuffer - The PDF file buffer
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromPdfBasic(pdfBuffer) {
    // Simple PDF text extraction - looks for text streams
    const content = pdfBuffer.toString('latin1');
    
    // Find text between BT (begin text) and ET (end text) markers
    const textMatches = content.match(/BT[\s\S]*?ET/g) || [];
    let extractedText = '';
    
    for (const match of textMatches) {
        // Extract text from Tj and TJ operators
        const tjMatches = match.match(/\(([^)]*)\)\s*Tj/g) || [];
        const tjArrayMatches = match.match(/\[([^\]]*)\]\s*TJ/g) || [];
        
        for (const tj of tjMatches) {
            const text = tj.match(/\(([^)]*)\)/);
            if (text) extractedText += text[1] + ' ';
        }
        
        for (const tj of tjArrayMatches) {
            const parts = tj.match(/\(([^)]*)\)/g) || [];
            for (const part of parts) {
                extractedText += part.replace(/[()]/g, '') + ' ';
            }
        }
    }
    
    // Clean up the extracted text
    extractedText = extractedText
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    return extractedText || 'Unable to extract text from PDF';
}

/**
 * Extract text from PDF - tries pdfjs first, falls back to basic extraction
 * @param {Buffer} pdfBuffer - The PDF file buffer
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromPdf(pdfBuffer) {
    // Try pdfjs-dist first (better extraction)
    try {
        const text = await extractTextFromPdfWithPdfjs(pdfBuffer);
        if (text && text.length > 50) {
            return text;
        }
    } catch (error) {
        console.log('[DocumentExtractor] pdfjs failed, trying basic extraction');
    }
    
    // Fallback to basic extraction
    return await extractTextFromPdfBasic(pdfBuffer);
}

/**
 * Main extraction function - analyzes a document and extracts subscription info
 * @param {Buffer} fileBuffer - The file buffer (PDF or image)
 * @param {string} mimeType - The MIME type of the file
 * @param {string} filename - Original filename for reference
 * @returns {Promise<Object>} Extracted subscription data with confidence score
 */
async function extractFromDocument(fileBuffer, mimeType, filename) {
    const openai = getOpenAIClient();
    
    console.log(`[DocumentExtractor] Processing file: ${filename} (${mimeType})`);
    
    let messages = [];
    let rawText = null;
    
    try {
        if (mimeType === 'application/pdf') {
            // Extract text from PDF and send to GPT-4o
            console.log('[DocumentExtractor] Extracting text from PDF');
            rawText = await extractTextFromPdf(fileBuffer);
            
            if (!rawText || rawText.length < 20) {
                throw new Error('Could not extract meaningful text from PDF');
            }
            
            messages = [{
                role: 'user',
                content: `${EXTRACTION_PROMPT}\n\n---\nDocument text:\n${rawText}`
            }];
            
        } else if (mimeType.startsWith('image/')) {
            // Direct image processing with vision API
            const base64 = fileBuffer.toString('base64');
            const imageType = mimeType.split('/')[1];
            
            messages = [{
                role: 'user',
                content: [
                    { type: 'text', text: EXTRACTION_PROMPT },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/${imageType};base64,${base64}`,
                            detail: 'high'
                        }
                    }
                ]
            }];
        } else if (mimeType === 'text/plain' || mimeType === 'text/html') {
            // Text-based document
            rawText = fileBuffer.toString('utf-8');
            
            messages = [{
                role: 'user',
                content: `${EXTRACTION_PROMPT}\n\n---\nDocument text:\n${rawText}`
            }];
        } else {
            throw new Error(`Unsupported file type: ${mimeType}`);
        }
        
        // Call OpenAI API
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: messages,
            max_tokens: 1000,
            temperature: 0.1, // Low temperature for consistent extraction
            response_format: { type: 'json_object' }
        });
        
        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error('No response from OpenAI');
        }
        
        // Parse the JSON response
        const extracted = JSON.parse(content);
        
        // Calculate confidence score based on how many fields were extracted
        const fields = ['vendor', 'name', 'cost', 'renewalDate', 'billingCycle', 'accountNumber'];
        const filledFields = fields.filter(f => extracted[f] !== null && extracted[f] !== undefined);
        const confidence = filledFields.length / fields.length;
        
        // Normalize the data
        const result = {
            vendor: extracted.vendor || null,
            name: extracted.name || null,
            cost: extracted.cost !== null ? parseFloat(extracted.cost) : null,
            renewalDate: extracted.renewalDate ? new Date(extracted.renewalDate) : null,
            billingCycle: normalizedBillingCycle(extracted.billingCycle),
            accountNumber: extracted.accountNumber || null,
            confidence: confidence,
            rawText: rawText || null
        };
        
        console.log(`[DocumentExtractor] Extraction complete. Confidence: ${(confidence * 100).toFixed(0)}%`);
        console.log(`[DocumentExtractor] Extracted: vendor=${result.vendor}, name=${result.name}, cost=${result.cost}`);
        
        return result;
        
    } catch (error) {
        console.error('[DocumentExtractor] Extraction failed:', error.message);
        
        // Return empty result with zero confidence
        return {
            vendor: null,
            name: null,
            cost: null,
            renewalDate: null,
            billingCycle: null,
            accountNumber: null,
            confidence: 0,
            rawText: rawText || null,
            error: error.message
        };
    }
}

/**
 * Normalize billing cycle to standard values
 */
function normalizedBillingCycle(value) {
    if (!value) return null;
    
    const normalized = value.toLowerCase().trim();
    
    if (normalized.includes('month')) return 'monthly';
    if (normalized.includes('year') || normalized.includes('annual')) return 'annual';
    if (normalized.includes('multi') || normalized.includes('3 year') || normalized.includes('2 year')) return 'multi-year';
    
    // Check for exact matches
    if (['monthly', 'annual', 'multi-year'].includes(normalized)) {
        return normalized;
    }
    
    return 'annual'; // Default to annual if unclear
}

/**
 * Process multiple attachments and combine if same vendor
 * @param {Array<{buffer: Buffer, mimeType: string, filename: string}>} attachments
 * @returns {Promise<Array<Object>>} Array of extracted subscription data (combined by vendor)
 */
async function processMultipleAttachments(attachments) {
    if (!attachments || attachments.length === 0) {
        return [];
    }
    
    console.log(`[DocumentExtractor] Processing ${attachments.length} attachment(s)`);
    
    const results = [];
    const filenames = [];
    
    // Extract from each attachment
    for (const attachment of attachments) {
        try {
            const extracted = await extractFromDocument(
                attachment.buffer,
                attachment.mimeType,
                attachment.filename
            );
            
            if (extracted.vendor || extracted.name || extracted.cost) {
                results.push(extracted);
                filenames.push(attachment.filename);
            }
        } catch (error) {
            console.error(`[DocumentExtractor] Failed to process ${attachment.filename}:`, error.message);
        }
    }
    
    if (results.length === 0) {
        return [];
    }
    
    // Group by vendor (case-insensitive)
    const byVendor = {};
    
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const vendorKey = (result.vendor || 'unknown').toLowerCase().trim();
        
        if (!byVendor[vendorKey]) {
            byVendor[vendorKey] = {
                ...result,
                attachmentNames: [filenames[i]]
            };
        } else {
            // Combine: prefer non-null values, take highest confidence
            const existing = byVendor[vendorKey];
            
            existing.vendor = existing.vendor || result.vendor;
            existing.name = existing.name || result.name;
            existing.cost = result.cost || existing.cost; // Prefer later (might be more recent)
            existing.renewalDate = result.renewalDate || existing.renewalDate;
            existing.billingCycle = existing.billingCycle || result.billingCycle;
            existing.accountNumber = existing.accountNumber || result.accountNumber;
            existing.confidence = Math.max(existing.confidence, result.confidence);
            existing.attachmentNames.push(filenames[i]);
            
            if (result.rawText && !existing.rawText) {
                existing.rawText = result.rawText;
            }
        }
    }
    
    return Object.values(byVendor);
}

/**
 * Check if a MIME type is supported for extraction
 */
function isSupportedFileType(mimeType) {
    const supported = [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/gif',
        'image/webp',
        'text/plain',
        'text/html'
    ];
    
    return supported.includes(mimeType);
}

/**
 * Get MIME type from filename extension
 */
function getMimeTypeFromFilename(filename) {
    const ext = path.extname(filename).toLowerCase();
    
    const mimeTypes = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.txt': 'text/plain',
        '.html': 'text/html'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
}

module.exports = {
    extractFromDocument,
    processMultipleAttachments,
    isSupportedFileType,
    getMimeTypeFromFilename
};
