/**
 * Invite Code Formatting & Validation Utility
 * Formats 8-character codes into two distinct 4-character blocks (e.g. "MYWA - Y99X")
 * for improved legibility, error detection, and easy dictation.
 */

/**
 * Strips all non-alphanumeric characters, converts to uppercase, and limits to 8 chars.
 */
export const cleanInviteCode = (raw: string): string => {
    if (!raw) return '';
    return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
};

/**
 * Formats an invite code into "XXXX - XXXX" format.
 * Dynamically handles partial input (e.g. "MYW" -> "MYW", "MYWAY" -> "MYWA - Y").
 */
export const formatSegmentedInviteCode = (raw: string): string => {
    const cleaned = cleanInviteCode(raw);
    if (!cleaned) return '';
    if (cleaned.length <= 4) {
        return cleaned;
    }
    return `${cleaned.slice(0, 4)} - ${cleaned.slice(4)}`;
};

/**
 * Validates that an invite code contains exactly 8 alphanumeric characters.
 */
export const isValidInviteCode = (raw: string): boolean => {
    return cleanInviteCode(raw).length === 8;
};

/**
 * Extracts an 8-character invite code from a scanned QR payload,
 * which may be a full URL, deep link, formatted string, or raw code.
 * Examples:
 *   - "https://myway-gps.com/join/ABCD1234" -> "ABCD1234"
 *   - "myway://join/ABCD-1234" -> "ABCD1234"
 *   - "https://myway-gps.com?code=ABCD1234" -> "ABCD1234"
 *   - "Join my circle on My Way! Use my code: ABCD1234..." -> "ABCD1234"
 *   - "ABCD - 1234" -> "ABCD1234"
 *   - "ABCD1234" -> "ABCD1234"
 */
export const extractInviteCodeFromQr = (scannedText: string): string => {
    if (!scannedText) return '';
    const trimmed = scannedText.trim();

    // 1. Check for /join/{code} URL patterns
    const joinMatch = trimmed.match(/\/join\/([A-Za-z0-9_-]+)/i);
    if (joinMatch && joinMatch[1]) {
        const cleaned = cleanInviteCode(joinMatch[1]);
        if (cleaned.length === 8) return cleaned;
    }

    // 2. Check for ?code= or ?invite= or ?inviteCode= query parameters
    const queryMatch = trimmed.match(/[?&](?:code|invite|inviteCode)=([A-Za-z0-9_-]+)/i);
    if (queryMatch && queryMatch[1]) {
        const cleaned = cleanInviteCode(queryMatch[1]);
        if (cleaned.length === 8) return cleaned;
    }

    // 3. Check for "code: ABCD1234" or "code ABCD1234" in message text
    const textCodeMatch = trimmed.match(/code[:\s]+([A-Za-z0-9\-_]{4,11})/i);
    if (textCodeMatch && textCodeMatch[1]) {
        const cleaned = cleanInviteCode(textCodeMatch[1]);
        if (cleaned.length === 8) return cleaned;
    }

    // 4. Check for segmented pattern like "ABCD - 1234" or "ABCD-1234"
    const segmentedMatch = trimmed.match(/\b([A-Za-z0-9]{4})\s*[-_ ]\s*([A-Za-z0-9]{4})\b/);
    if (segmentedMatch) {
        const cleaned = cleanInviteCode(segmentedMatch[1] + segmentedMatch[2]);
        if (cleaned.length === 8) return cleaned;
    }

    // 5. Fallback: clean the whole string (covers raw "ABCD1234")
    return cleanInviteCode(trimmed);
};
