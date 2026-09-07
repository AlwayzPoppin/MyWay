// Image Moderation Service - AI Safety & Place Relevance Verification for Storefront Photos
import { callGeminiProxy } from './geminiService';

export interface ImageValidationResult {
    isValid: boolean;
    flagReason?: 'explicit_content' | 'illegal_content' | 'irrelevant_content' | 'blank_image' | 'low_resolution' | 'corrupt_image' | 'error';
    message: string;
    category?: string;
    confidence?: number;
    details?: string;
}

export interface StorefrontValidationOptions {
    placeName?: string;
    category?: string;
}

/**
 * Extracts mime type and base64 content from a data URI
 */
export function parseDataUri(dataUri: string): { mimeType: string; base64Data: string } | null {
    const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return {
        mimeType: match[1],
        base64Data: match[2]
    };
}

/**
 * Client-side pre-flight heuristic checks:
 * - Ensures image loads properly
 * - Minimum resolution (at least 120x120px)
 * - Aspect ratio sanity (rejects absurdly thin slices)
 * - Pixel variance check to catch solid black / solid white / blank dummy images
 */
export async function performPreflightImageCheck(dataUri: string): Promise<ImageValidationResult> {
    return new Promise((resolve) => {
        const parsed = parseDataUri(dataUri);
        if (!parsed) {
            resolve({
                isValid: false,
                flagReason: 'corrupt_image',
                message: 'Invalid image data format. Please upload a valid image file.'
            });
            return;
        }

        const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
        if (!validMimes.includes(parsed.mimeType.toLowerCase()) && !parsed.mimeType.startsWith('image/')) {
            resolve({
                isValid: false,
                flagReason: 'corrupt_image',
                message: 'Unsupported image type. Please upload a JPEG, PNG, or WebP photo.'
            });
            return;
        }

        if (typeof Image === 'undefined' || typeof document === 'undefined') {
            resolve({ isValid: true, message: 'Preflight skipped in non-DOM environment' });
            return;
        }

        const img = new Image();
        img.onload = () => {
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;

            // 1. Resolution Check
            if (width < 120 || height < 120) {
                resolve({
                    isValid: false,
                    flagReason: 'low_resolution',
                    message: 'Photo resolution is too low. Please upload a clear photo of the building facade or storefront.'
                });
                return;
            }

            // 2. Aspect Ratio Check (e.g. 10:1 or 1:10 slivers)
            const aspectRatio = width / Math.max(1, height);
            if (aspectRatio > 8 || aspectRatio < 0.12) {
                resolve({
                    isValid: false,
                    flagReason: 'irrelevant_content',
                    message: 'Please upload a standard photo showing the building facade or storefront.'
                });
                return;
            }

            // 3. Canvas Variance Check for Blank / Solid Images
            try {
                const sampleSize = 32;
                const canvas = document.createElement('canvas');
                canvas.width = sampleSize;
                canvas.height = sampleSize;
                const ctx = canvas.getContext('2d');

                if (ctx) {
                    ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
                    const imgData = ctx.getImageData(0, 0, sampleSize, sampleSize);
                    const pixels = imgData.data;

                    let totalLuminance = 0;
                    const lums: number[] = [];
                    for (let i = 0; i < pixels.length; i += 4) {
                        // Standard perceived luminance formula
                        const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
                        lums.push(lum);
                        totalLuminance += lum;
                    }

                    const meanLum = totalLuminance / lums.length;
                    let varianceSum = 0;
                    for (let i = 0; i < lums.length; i++) {
                        varianceSum += Math.pow(lums[i] - meanLum, 2);
                    }
                    const variance = varianceSum / lums.length;

                    // Variance < 3 indicates a flat solid black, flat white, or completely empty image
                    if (variance < 3.0) {
                        resolve({
                            isValid: false,
                            flagReason: 'blank_image',
                            message: 'Photo appears blank or unreadable. Please upload a clear photo of the building facade or storefront.'
                        });
                        return;
                    }
                }
            } catch (canvasErr) {
                console.warn('[ImageModeration] Canvas pixel inspection warning:', canvasErr);
            }

            resolve({
                isValid: true,
                message: 'Local preflight integrity check passed'
            });
        };

        img.onerror = () => {
            resolve({
                isValid: false,
                flagReason: 'corrupt_image',
                message: 'Failed to read image. Please select a valid photo.'
            });
        };

        img.src = dataUri;
    });
}

/**
 * Validates a storefront or building photo before upload:
 * 1. Runs local pre-flight checks (dimensions, aspect ratio, blank canvas detection)
 * 2. Runs multimodal AI review (safety moderation + place relevance verification)
 * 3. Returns a user-friendly pass/fail result
 */
export async function validateStorefrontPhoto(
    imageDataUri: string,
    options?: StorefrontValidationOptions
): Promise<ImageValidationResult> {
    // Step 1: Pre-flight local validation
    const preflight = await performPreflightImageCheck(imageDataUri);
    if (!preflight.isValid) {
        return preflight;
    }

    const parsed = parseDataUri(imageDataUri);
    if (!parsed) {
        return {
            isValid: false,
            flagReason: 'corrupt_image',
            message: 'Invalid image format.'
        };
    }

    // Step 2: Multimodal AI Evaluation via Gemini
    const placeContext = options?.placeName ? `Target Place: "${options.placeName}"` : 'Target Place: Public map location';
    const categoryContext = options?.category ? `Category: "${options.category}"` : '';

    const promptText = `You are the automated image moderation and place verification system for MyWay GPS navigation.
A user has uploaded a photo for a public map place edit.
${placeContext}
${categoryContext}

Evaluate this image across two mandatory criteria:

1. CONTENT SAFETY & MODERATION:
   - Strictly check for: sexually explicit content, pornography, nudity, graphic violence/gore, hate symbols, or illegal drugs.
   - If any is detected, set "isSafe": false.

2. MAP & PLACE RELEVANCE:
   - Acceptable subjects: Exterior building facades, storefronts with/without signs, restaurant/shop entrances, commercial buildings, outdoor parking/driveway approaches, landmarks, or residential house exteriors.
   - Must REJECT: Personal selfies / portraits of faces with no building, memes, phone screenshots, receipts/text documents, pets/animals alone, food dishes alone without storefront context, or random indoor household clutter.
   - If it clearly represents a physical building, storefront, house, or entrance, set "isStorefrontOrBuilding": true.
   - If it is irrelevant, a selfie, a meme, or unrelated indoor clutter, set "isStorefrontOrBuilding": false.

Respond ONLY with valid JSON in this exact structure:
{
  "isSafe": boolean,
  "isStorefrontOrBuilding": boolean,
  "category": "storefront" | "building_facade" | "residential_house" | "entrance" | "signage" | "parking" | "selfie" | "meme" | "document" | "unrelated" | "inappropriate",
  "flagReason": "explicit_content" | "illegal_content" | "irrelevant_content" | null,
  "friendlyMessage": string
}

Guidelines for friendlyMessage:
- If rejected for safety: "Image flagged: Inappropriate or explicit content is not allowed."
- If rejected for irrelevance: "Please upload a valid building facade or storefront photo."
- If approved: "Valid building facade or storefront photo."`;

    try {
        const contents = [
            {
                inlineData: {
                    mimeType: parsed.mimeType,
                    data: parsed.base64Data
                }
            },
            {
                text: promptText
            }
        ];

        const response = await callGeminiProxy(
            contents,
            {
                responseMimeType: "application/json"
            },
            'gemini-2.0-flash'
        );

        if (response && response.text && response.text.trim()) {
            try {
                const aiResult = JSON.parse(response.text.trim());

                // Content safety violation
                if (aiResult.isSafe === false) {
                    return {
                        isValid: false,
                        flagReason: 'explicit_content',
                        message: aiResult.friendlyMessage || 'Image flagged: Inappropriate or explicit content is not allowed.',
                        category: aiResult.category,
                        details: 'Failed safety moderation check'
                    };
                }

                // Place relevance violation (selfie, meme, animal, document, etc.)
                if (aiResult.isStorefrontOrBuilding === false) {
                    return {
                        isValid: false,
                        flagReason: 'irrelevant_content',
                        message: aiResult.friendlyMessage || 'Please upload a valid building facade or storefront photo.',
                        category: aiResult.category,
                        details: 'Failed place relevance check'
                    };
                }

                // Passed both safety and relevance checks
                return {
                    isValid: true,
                    category: aiResult.category || 'storefront',
                    message: aiResult.friendlyMessage || 'Valid building facade or storefront photo.',
                    confidence: 0.95
                };
            } catch (parseError) {
                console.warn('[ImageModeration] Failed to parse AI JSON response:', parseError);
            }
        }

        // If AI is offline, unconfigured, or unreachable:
        // Local preflight checks already succeeded, so allow resilient pass-through
        console.log('[ImageModeration] AI service unavailable; passed local integrity check.');
        return {
            isValid: true,
            message: 'Photo passed local verification check.',
            confidence: 0.85
        };
    } catch (err) {
        console.error('[ImageModeration] AI evaluation error:', err);
        // Resilient fallback after local preflight passed
        return {
            isValid: true,
            message: 'Photo passed local integrity check.',
            confidence: 0.8
        };
    }
}
