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

export const getFamilyKey = (): CryptoKey | null => familyKey;

// --- SECURE STORAGE (IndexedDB) ---
const DB_NAME = 'MyWaySecurity';
const STORE_NAME = 'E2EEKeys';

const getIDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const saveKeyPairToSecureStorage = async (uid: string, jwk: any) => {
    try {
        const db = await getIDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(jwk, uid);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error("IDB Save Failed", e);
    }
};

export const loadKeyPairFromSecureStorage = async (uid: string) => {
    try {
        const db = await getIDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(uid);
        return new Promise<any>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error("IDB Load Failed", e);
        return null;
    }
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

export const exportKeyPairJWK = async (keyPair: CryptoKeyPair): Promise<{ publicKey: JsonWebKey, privateKey: JsonWebKey }> => {
    const publicKey = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKey = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);
    return { publicKey, privateKey };
};

export const importKeyPairJWK = async (jwk: { publicKey: JsonWebKey, privateKey: JsonWebKey }): Promise<CryptoKeyPair> => {
    const publicKey = await window.crypto.subtle.importKey(
        'jwk',
        jwk.publicKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
    );
    const privateKey = await window.crypto.subtle.importKey(
        'jwk',
        jwk.privateKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
    );
    return { publicKey, privateKey };
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
    // 0.002 is ~200m
    return { lat: lat + (Math.random() - 0.5) * 0.002, lng: lng + (Math.random() - 0.5) * 0.002 };
};

/**
 * Generates a stable, deterministic neighborhood centroid (~1.5-2.4km offset)
 * Uses spatial grid discretization so the center remains steady while inside the same neighborhood.
 */
export const getNeighborhoodCentroid = (lat: number, lng: number, seed?: string): { lat: number, lng: number } => {
    // 0.02 degrees is approx ~2.2 km
    const GRID_SIZE = 0.02;
    const gridLat = Math.floor(lat / GRID_SIZE) * GRID_SIZE + (GRID_SIZE / 2);
    const gridLng = Math.floor(lng / GRID_SIZE) * GRID_SIZE + (GRID_SIZE / 2);

    // Deterministic pseudo-random offset based on grid cell and seed
    let hash = 0;
    const str = `${gridLat.toFixed(3)}_${gridLng.toFixed(3)}_${seed || 'myway'}`;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }

    const pseudoRandom1 = ((Math.abs(hash) % 1000) / 1000) - 0.5;
    const pseudoRandom2 = ((Math.abs(hash >> 3) % 1000) / 1000) - 0.5;

    return {
        lat: gridLat + pseudoRandom1 * (GRID_SIZE * 0.4),
        lng: gridLng + pseudoRandom2 * (GRID_SIZE * 0.4)
    };
};

