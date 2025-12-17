/**
 * Document Extractor Service
 * Uses OpenAI GPT-4o to extract subscription information from invoices, contracts, and renewal notices
 */

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = require('pdfjs-dist/legacy/build/pdf.worker.js');

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

/**
 * Convert a PDF buffer to base64 images for GPT-4o vision
 * Uses pdfjs-dist (pure JS) so it works on Railway without system deps
 * @param {Buffer} pdfBuffer - The PDF file buffer
 * @returns {Promise<string[]>} Array of base64-encoded images
 */
async function convertPdfToImages(pdfBuffer) {
    const images = [];
    
    try {
        const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
        const pageCount = Math.min(pdf.numPages, 5); // cap pages for perf
        
        for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2.0 }); // balance quality/perf
            
            const canvas = createCanvas(viewport.width, viewport.height);
            const context = canvas.getContext('2d');
            
            await page.render({ canvasContext: context, viewport }).promise;
            
            const base64 = canvas.toBuffer('image/png').toString('base64');
            images.push(base64);
        }
    } catch (err) {
        console.warn('[DocumentExtractor] pdfjs conversion failed, falling back to text extraction:', err.message);
        throw new Error('PDF_CONVERSION_FAILED');
    }
    
    return images;
}

/**
 * Extract text from a PDF using basic parsing
 * Fallback when image conversion isn't available
 * @param {Buffer} pdfBuffer - The PDF file buffer
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromPdf(pdfBuffer) {
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
            // Try image-based extraction first (better for scanned PDFs)
            try {
                const images = await convertPdfToImages(fileBuffer);
                
                if (images.length > 0) {
                    // Use vision API with images
                    const imageContent = images.slice(0, 5).map(base64 => ({
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${base64}`,
                            detail: 'high'
                        }
                    }));
                    
                    messages = [{
                        role: 'user',
                        content: [
                            { type: 'text', text: EXTRACTION_PROMPT },
                            ...imageContent
                        ]
                    }];
                } else {
                    throw new Error('No images generated');
                }
            } catch (conversionError) {
                // Fall back to text extraction
                console.log('[DocumentExtractor] Using text extraction fallback for PDF');
                try {
                    rawText = await extractTextFromPdf(fileBuffer);
                    
                    messages = [{
                        role: 'user',
                        content: `${EXTRACTION_PROMPT}\n\n---\nDocument text:\n${rawText}`
                    }];
                } catch (textError) {
                    console.error('[DocumentExtractor] Text extraction also failed:', textError.message);
                    throw new Error(`Failed to extract data from PDF: ${textError.message}`);
                }
            }
        } else if (mimeType.startsWith('image/')) {
            // Direct image processing
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
    getMimeTypeFromFilename,
    convertPdfToImages
};

