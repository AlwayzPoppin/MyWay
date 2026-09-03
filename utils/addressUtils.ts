/**
 * Address Utility Functions
 */

/**
 * Extracts the leading house or building number from an address string.
 * e.g., "417 Santa Fe Drive, Fayetteville, NC" -> "417"
 * Matches regex /^(\d+)/ with support for lettered units (e.g. 417A, 12-B).
 */
export const extractHouseNumber = (address?: string | null): string | null => {
    if (!address || typeof address !== 'string') return null;
    const trimmed = address.trim();
    
    // Primary match: leading digits as requested
    const leadingMatch = trimmed.match(/^(\d+[a-zA-Z\-/]*)\b/);
    if (leadingMatch) {
        return leadingMatch[1];
    }

    // Fallback: search within the street line (before first comma) in case of prefix like "Home - 417 Main St"
    const firstPart = trimmed.split(',')[0] || '';
    const partMatch = firstPart.match(/\b(\d+[a-zA-Z\-/]*)\b/);
    return partMatch ? partMatch[1] : null;
};
