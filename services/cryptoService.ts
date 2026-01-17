/**
 * Secure E2EE service using Web Crypto API.
 * Implements Elliptic Curve Diffie-Hellman (ECDH) on P-256 curve
 * for secure shared secret derivation and AES-GCM for payload encryption.
 */

// Global reference for the circle key (derived from shared secret in production flow)
let familyKey: CryptoKey | null = null;

export const setFamilyKey = (key: CryptoKey) => {
    familyKey = key;
};

export const generateFamilyKey = async () => {
    return await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
};

// --- ECDH KEY EXCHANGE PRIMITIVES ---

export const generateECDHKeyPair = async (): Promise<CryptoKeyPair> => {
    return await window.crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
    );
};

export const exportPublicKey = async (key: CryptoKey): Promise<string> => {
    const exported = await window.crypto.subtle.exportKey('spki', key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
};

export const importPublicKey = async (base64Key: string): Promise<CryptoKey> => {
    const binaryKey = new Uint8Array(atob(base64Key).split('').map(c => c.charCodeAt(0)));
    return await window.crypto.subtle.importKey(
        'spki',
        binaryKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
    );
};

export const deriveSharedSecretKey = async (privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> => {
    return await window.crypto.subtle.deriveKey(
        { name: 'ECDH', public: publicKey },
        privateKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
};

// Helper to "wrap" (encrypt) a circle key using a shared secret
export const wrapCircleKey = async (circleKey: CryptoKey, sharedSecret: CryptoKey): Promise<string> => {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        sharedSecret,
        await window.crypto.subtle.exportKey('raw', circleKey)
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
};

// Helper to "unwrap" (decrypt) a circle key using a shared secret
export const unwrapCircleKey = async (wrappedKeyBase64: string, sharedSecret: CryptoKey): Promise<CryptoKey> => {
    const combined = new Uint8Array(atob(wrappedKeyBase64).split('').map(c => c.charCodeAt(0)));
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decryptedRaw = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        sharedSecret,
        encrypted
    );

    return await window.crypto.subtle.importKey(
        'raw',
        decryptedRaw,
        { name: 'AES-GCM' },
        true,
        ['encrypt', 'decrypt']
    );
};


export const encryptLocation = async (lat: number, lng: number): Promise<string> => {
    if (!familyKey) {
        console.warn("🔒 Encryption skipped: No Family Key established yet.");
        // We return empty string or throw error to prevent leaking plaintext location
        return "";
    }

    const data = new TextEncoder().encode(JSON.stringify({ lat, lng }));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        familyKey,
        data
    );

    // Combine IV and ciphertext for storage
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return btoa(String.fromCharCode(...combined));
};

export const decryptLocation = async (wrappedData: string): Promise<{ lat: number, lng: number } | null> => {
    if (!familyKey || !wrappedData) return null;
    try {
        const combined = new Uint8Array(atob(wrappedData).split('').map(c => c.charCodeAt(0)));
        const iv = combined.slice(0, 12);
        const encrypted = combined.slice(12);

        const decrypted = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            familyKey,
            encrypted
        );

        const text = new TextDecoder().decode(decrypted);
        return JSON.parse(text);
    } catch (e) {
        console.error("Location decryption failed", e);
        return null;
    }
};

export const encryptMessage = async (text: string): Promise<string> => {
    if (!familyKey) return text;
    const data = new TextEncoder().encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        familyKey,
        data
    );
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return btoa(String.fromCharCode(...combined));
};

export const decryptMessage = async (text: string): Promise<string> => {
    if (!familyKey || !text) return text;
    try {
        const combined = new Uint8Array(atob(text).split('').map(c => c.charCodeAt(0)));
        const iv = combined.slice(0, 12);
        const encrypted = combined.slice(12);
        const decrypted = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            familyKey,
            encrypted
        );
        return new TextDecoder().decode(decrypted);
    } catch {
        return text;
    }
};

export const getFuzzyLocation = (lat: number, lng: number): { lat: number, lng: number } => {
    return { lat: lat + (Math.random() - 0.5) * 0.01, lng: lng + (Math.random() - 0.5) * 0.01 };
};
