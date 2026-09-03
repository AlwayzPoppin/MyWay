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
