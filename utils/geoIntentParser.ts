/**
 * Geo Intent Parser for My Way
 * Parses Android intent URIs (geo: and google.navigation:) received from external apps like Spark,
 * delivery dispatchers, and map links.
 */

export interface ParsedGeoIntent {
  coords?: { lat: number; lng: number };
  query?: string;
  label?: string;
  name: string;
  address?: string;
  rawUrl: string;
}

/**
 * Safely decodes a URI component, handling both '+' for spaces and percent-encoding.
 */
function safeDecode(str: string): string {
  try {
    return decodeURIComponent(str.replace(/\+/g, ' ')).trim();
  } catch {
    try {
      return decodeURI(str.replace(/\+/g, ' ')).trim();
    } catch {
      return str.replace(/\+/g, ' ').trim();
    }
  }
}

/**
 * Validates if numeric latitude/longitude fall within valid geographic bounds.
 */
function isValidCoordinate(lat: number, lng: number): boolean {
  return !isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * Parses a string that might be coordinates like "37.7749,-122.4194" or "37.7749, -122.4194"
 */
function extractCoords(str: string): { lat: number; lng: number } | null {
  const match = str.match(/^([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  if (isValidCoordinate(lat, lng)) {
    return { lat, lng };
  }
  return null;
}

/**
 * Checks if an incoming deep link URL is a geo or navigation intent.
 */
export function isGeoIntentUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith('geo:') ||
    trimmed.startsWith('google.navigation:') ||
    trimmed.includes('maps.google.com') ||
    trimmed.includes('google.com/maps') ||
    trimmed.includes('maps.app.goo.gl')
  );
}

/**
 * Parses an incoming geo or navigation intent URL into structured location data.
 * Supports:
 * - geo:37.7749,-122.4194
 * - geo:37.7749,-122.4194?z=15
 * - geo:0,0?q=37.7749,-122.4194(Customer+Stop)
 * - geo:0,0?q=123+Main+St,+Fayetteville,+NC
 * - geo:?q=123+Main+St
 * - google.navigation:q=37.7749,-122.4194
 * - google.navigation:q=123+Main+St&mode=d
 * - https://maps.google.com/?q=...
 */
export function parseGeoIntent(url: string): ParsedGeoIntent | null {
  if (!isGeoIntentUrl(url)) return null;

  const rawUrl = url.trim();
  let baseCoords: { lat: number; lng: number } | undefined;
  let queryCoords: { lat: number; lng: number } | undefined;
  let queryStr: string | undefined;
  let label: string | undefined;

  const lower = rawUrl.toLowerCase();

  if (lower.startsWith('geo:')) {
    // Format: geo:latitude,longitude?query
    const body = rawUrl.substring(4);
    const qMarkIndex = body.indexOf('?');
    const coordsSection = qMarkIndex >= 0 ? body.substring(0, qMarkIndex) : body;
    const querySection = qMarkIndex >= 0 ? body.substring(qMarkIndex + 1) : '';

    if (coordsSection) {
      const parsedBase = extractCoords(coordsSection);
      if (parsedBase && (parsedBase.lat !== 0 || parsedBase.lng !== 0)) {
        baseCoords = parsedBase;
      }
    }

    if (querySection) {
      // Parse query params (e.g. q=..., z=...)
      const params = new URLSearchParams(querySection);
      const qParam = params.get('q');
      if (qParam) {
        let decodedQ = safeDecode(qParam);

        // Check for parenthesized label: e.g. "37.7749,-122.4194(Customer Stop)" or "123 Main St(Warehouse 2)"
        const labelMatch = decodedQ.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        if (labelMatch) {
          label = labelMatch[2].trim();
          decodedQ = labelMatch[1].trim();
        }

        const parsedQCoords = extractCoords(decodedQ);
        if (parsedQCoords) {
          queryCoords = parsedQCoords;
        } else if (decodedQ) {
          queryStr = decodedQ;
        }
      }
    }
  } else if (lower.startsWith('google.navigation:')) {
    // Format: google.navigation:q=37.7749,-122.4194 or google.navigation:q=123+Main+St
    const body = rawUrl.substring('google.navigation:'.length);
    // Can begin with ? or query directly
    const cleanBody = body.startsWith('?') ? body.substring(1) : body;
    const params = new URLSearchParams(cleanBody);
    const qParam = params.get('q') || params.get('ll');

    if (qParam) {
      let decodedQ = safeDecode(qParam);
      const labelMatch = decodedQ.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      if (labelMatch) {
        label = labelMatch[2].trim();
        decodedQ = labelMatch[1].trim();
      }

      const parsedQCoords = extractCoords(decodedQ);
      if (parsedQCoords) {
        queryCoords = parsedQCoords;
      } else if (decodedQ) {
        queryStr = decodedQ;
      }
    }
  } else if (lower.includes('maps.google.com') || lower.includes('google.com/maps') || lower.includes('maps.app.goo.gl')) {
    try {
      const parsed = new URL(rawUrl);
      const q = parsed.searchParams.get('q') || parsed.searchParams.get('query') || parsed.searchParams.get('destination') || parsed.searchParams.get('daddr');
      if (q) {
        let decodedQ = safeDecode(q);
        const labelMatch = decodedQ.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        if (labelMatch) {
          label = labelMatch[2].trim();
          decodedQ = labelMatch[1].trim();
        }
        const parsedQCoords = extractCoords(decodedQ);
        if (parsedQCoords) {
          queryCoords = parsedQCoords;
        } else if (decodedQ) {
          queryStr = decodedQ;
        }
      }
    } catch {
      // Ignore URL parse errors
    }
  }

  const finalCoords = queryCoords || baseCoords;

  // Build a friendly name
  let name = '';
  if (label) {
    name = label;
  } else if (queryStr) {
    name = queryStr;
  } else if (finalCoords) {
    name = `${finalCoords.lat.toFixed(5)}, ${finalCoords.lng.toFixed(5)}`;
  } else {
    name = 'Navigation Destination';
  }

  return {
    coords: finalCoords,
    query: queryStr,
    label,
    name,
    address: queryStr,
    rawUrl
  };
}
