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
    if (!trimmed) return null;

    // 0. Direct match if the string is just the house/building number itself (e.g. "5554" or "417A")
    const pureNumberMatch = trimmed.match(/^#?(\d+[a-zA-Z\-/]*)$/);
    if (pureNumberMatch) {
        return pureNumberMatch[1];
    }

    // Clean common prefixes like "Home - ", "Home: ", "My Home: "
    const cleaned = trimmed.replace(/^(?:home|work|office|school)\s*[-:–—]\s*/i, '').trim();

    // 1. Primary match: leading digits with optional prefix like '#' or 'No.'
    const leadingMatch = cleaned.match(/^(?:#|no\.?\s*)?(\d+[a-zA-Z\-/]*)\b/i);
    if (leadingMatch) {
        return leadingMatch[1];
    }

    // 2. Search within the primary street section (before first comma)
    const firstPart = cleaned.split(',')[0] || '';

    // Look for street number before street suffix (St, Rd, Ave, Dr, Blvd, Way, Ln, Ct, Pl, Cir, Pkwy)
    const streetWithSuffixMatch = firstPart.match(/\b(\d+[a-zA-Z\-/]*)\s+[A-Za-z0-9\s]+?\b(?:dr|drive|rd|road|st|street|ave|avenue|blvd|boulevard|ln|lane|ct|court|way|pl|place|cir|circle|pkwy|parkway|hwy|highway)\b/i);
    if (streetWithSuffixMatch) {
        return streetWithSuffixMatch[1];
    }

    // 3. Fallback: match any discrete alphanumeric house number in firstPart (preferring digits)
    const partMatch = firstPart.match(/\b(\d+[a-zA-Z\-/]*)\b/);
    if (partMatch) {
        return partMatch[1];
    }

    // 4. Global fallback across entire address string for first discrete digit sequence
    const globalMatch = cleaned.match(/\b(\d{1,6}[a-zA-Z\-/]*)\b/);
    return globalMatch ? globalMatch[1] : null;
};

/**
 * Extracts the street name from an address string by stripping leading house numbers and trailing city/state.
 * e.g., "5610 Carson Drive, Fayetteville, NC 28303" -> "Carson Drive"
 */
export const extractStreetName = (address?: string | null): string | null => {
    if (!address || typeof address !== 'string') return null;
    const trimmed = address.trim();
    if (!trimmed) return null;

    const cleaned = trimmed.replace(/^(?:home|work|office|school)\s*[-:–—]\s*/i, '').trim();
    const firstPart = cleaned.split(',')[0] || '';
    // Strip leading digits/house number
    const streetOnly = firstPart.replace(/^(?:#|no\.?\s*)?\d+[a-zA-Z\-/]*\s+/i, '').trim();
    return streetOnly || null;
};

