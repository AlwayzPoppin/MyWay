import React, { useState, useCallback } from 'react';
import {
    exportKeyPairJWK,
    loadKeyPairFromSecureStorage,
    importKeyPairJWK,
    saveKeyPairToSecureStorage,
    setFamilyKey,
    generateFamilyKey
} from '../services/cryptoService';

// Storage adapter — uses localStorage until Firestore is configured
const RECOVERY_STORAGE_KEY = 'myway_e2ee_recovery';

interface KeyRecoveryPanelProps {
    uid: string;
    onClose: () => void;
    onBack?: () => void;
    showNotification?: (msg: string, duration?: number) => void;
    theme: 'light' | 'dark';
}

/**
 * Derive a wrapping key from a passphrase using PBKDF2
 */
const deriveWrappingKey = async (passphrase: string, salt: Uint8Array): Promise<CryptoKey> => {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return window.crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: 600000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['wrapKey', 'unwrapKey']
    );
};

/**
 * Encrypt a JWK private key with a passphrase
 */
const encryptPrivateKey = async (privateKeyJwk: JsonWebKey, passphrase: string): Promise<{ encrypted: string; salt: string; iv: string }> => {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const wrappingKey = await deriveWrappingKey(passphrase, salt);

    // Import the JWK as a CryptoKey so we can wrap it
    const privateKey = await window.crypto.subtle.importKey(
        'jwk', privateKeyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
    );

    const wrappedKey = await window.crypto.subtle.wrapKey(
        'jwk', privateKey, wrappingKey, { name: 'AES-GCM', iv }
    );

    return {
        encrypted: btoa(String.fromCharCode(...new Uint8Array(wrappedKey))),
        salt: btoa(String.fromCharCode(...salt)),
        iv: btoa(String.fromCharCode(...iv))
    };
};

/**
 * Decrypt a wrapped private key with a passphrase
 */
const decryptPrivateKey = async (encrypted: string, saltB64: string, ivB64: string, passphrase: string): Promise<CryptoKey> => {
    const salt = new Uint8Array(atob(saltB64).split('').map(c => c.charCodeAt(0)));
    const iv = new Uint8Array(atob(ivB64).split('').map(c => c.charCodeAt(0)));
    const wrappedKey = new Uint8Array(atob(encrypted).split('').map(c => c.charCodeAt(0)));
    const wrappingKey = await deriveWrappingKey(passphrase, salt);

    return window.crypto.subtle.unwrapKey(
        'jwk', wrappedKey, wrappingKey,
        { name: 'AES-GCM', iv },
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
    );
};

const KeyRecoveryPanel: React.FC<KeyRecoveryPanelProps> = ({ uid, onClose, onBack, showNotification, theme }) => {
    const [mode, setMode] = useState<'menu' | 'backup' | 'restore'>('menu');
    const [passphrase, setPassphrase] = useState('');
    const [confirmPassphrase, setConfirmPassphrase] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState('');
    const isDark = theme === 'dark';

    const handleBackup = useCallback(async () => {
        if (passphrase.length < 8) {
            setError('Passphrase must be at least 8 characters');
            return;
        }
        if (passphrase !== confirmPassphrase) {
            setError('Passphrases do not match');
            return;
        }

        setIsProcessing(true);
        setError('');

        try {
            // Load existing key pair from IndexedDB
            const storedJwk = await loadKeyPairFromSecureStorage(uid);
            if (!storedJwk) {
                setError('No encryption keys found to backup');
                setIsProcessing(false);
                return;
            }

            // Encrypt private key with passphrase
            const bundle = await encryptPrivateKey(storedJwk.privateKey, passphrase);

            // Store encrypted bundle + public key (localStorage until Firestore)
            const recoveryData = {
                publicKey: storedJwk.publicKey,
                encryptedPrivateKey: bundle.encrypted,
                salt: bundle.salt,
                iv: bundle.iv,
                createdAt: Date.now()
            };
            localStorage.setItem(`${RECOVERY_STORAGE_KEY}_${uid}`, JSON.stringify(recoveryData));

            showNotification?.('🔑 Key backup saved securely!', 3000);
            setMode('menu');
            setPassphrase('');
            setConfirmPassphrase('');
        } catch (err) {
            console.error('Backup failed:', err);
            setError('Failed to create backup. Please try again.');
        }
        setIsProcessing(false);
    }, [uid, passphrase, confirmPassphrase, showNotification]);

    const handleRestore = useCallback(async () => {
        if (passphrase.length < 1) {
            setError('Enter your recovery passphrase');
            return;
        }

        setIsProcessing(true);
        setError('');

        try {
            // Fetch backup from localStorage
            const stored = localStorage.getItem(`${RECOVERY_STORAGE_KEY}_${uid}`);
            if (!stored) {
                setError('No backup found for this account');
                setIsProcessing(false);
                return;
            }

            const data = JSON.parse(stored);

            // Decrypt private key
            const privateKey = await decryptPrivateKey(
                data.encryptedPrivateKey, data.salt, data.iv, passphrase
            );

            // Import public key
            const publicKey = await window.crypto.subtle.importKey(
                'jwk', data.publicKey,
                { name: 'ECDH', namedCurve: 'P-256' },
                true, []
            );

            // Export both as JWK and save to IndexedDB
            const privateJwk = await window.crypto.subtle.exportKey('jwk', privateKey);
            await saveKeyPairToSecureStorage(uid, { publicKey: data.publicKey, privateKey: privateJwk });

            // Re-derive family key
            const familyKey = await generateFamilyKey();
            setFamilyKey(familyKey);

            showNotification?.('✅ Encryption keys restored! Reload to activate.', 5000);
            setMode('menu');
            setPassphrase('');
        } catch (err) {
            console.error('Restore failed:', err);
            setError('Incorrect passphrase or corrupted backup');
        }
        setIsProcessing(false);
    }, [uid, passphrase, showNotification]);

    const inputClass = `w-full px-4 py-3 rounded-2xl text-sm transition-all outline-none ${
        isDark
            ? 'bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:border-indigo-500'
            : 'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500'
    }`;

    return (
        <div className="h-full flex flex-col max-h-[70vh]">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-all shadow-sm"
                            title="Back to Settings"
                        >
                            <span className="text-lg">←</span>
                        </button>
                    )}
                    <span className="text-2xl">🔑</span>
                    <div>
                        <h2 className="text-lg font-black text-white">My Security Locker</h2>
                        <p className="text-emerald-200 text-xs">Protect your encrypted data</p>
                    </div>
                </div>
                <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white">
                    ✕
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {mode === 'menu' && (
                    <div className="space-y-4">
                        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-white/5 border-white/8' : 'bg-slate-50 border-slate-100'}`}>
                            <p className={`text-sm ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                                Your encryption keys are stored on this device. If you lose or replace your device, 
                                a recovery backup lets you restore access to your encrypted messages and data.
                            </p>
                        </div>

                        <button
                            onClick={() => { setMode('backup'); setError(''); }}
                            className={`w-full p-4 rounded-2xl border flex items-center gap-4 transition-all hover:scale-[1.01] ${
                                isDark ? 'bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                            }`}
                        >
                            <span className="text-3xl">💾</span>
                            <div className="text-left">
                                <h3 className={`font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Create Backup</h3>
                                <p className="text-xs text-slate-400">Encrypt your keys with a passphrase</p>
                            </div>
                        </button>

                        <button
                            onClick={() => { setMode('restore'); setError(''); }}
                            className={`w-full p-4 rounded-2xl border flex items-center gap-4 transition-all hover:scale-[1.01] ${
                                isDark ? 'bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20' : 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                            }`}
                        >
                            <span className="text-3xl">🔄</span>
                            <div className="text-left">
                                <h3 className={`font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Restore from Backup</h3>
                                <p className="text-xs text-slate-400">Re-import keys on a new device</p>
                            </div>
                        </button>

                        <div className={`p-3 rounded-2xl text-xs ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                            ⚠️ If you forget your recovery passphrase, your backup cannot be decrypted. We never store your passphrase.
                        </div>
                    </div>
                )}

                {mode === 'backup' && (
                    <div className="space-y-4">
                        <button onClick={() => setMode('menu')} className="text-sm text-slate-400 hover:text-white flex items-center gap-1">
                            ← Back
                        </button>

                        <h3 className={`font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Create Recovery Backup</h3>
                        <p className="text-xs text-slate-400">Choose a strong passphrase you'll remember</p>

                        <input
                            type="password"
                            placeholder="Recovery passphrase (8+ characters)"
                            value={passphrase}
                            onChange={e => setPassphrase(e.target.value)}
                            className={inputClass}
                        />
                        <input
                            type="password"
                            placeholder="Confirm passphrase"
                            value={confirmPassphrase}
                            onChange={e => setConfirmPassphrase(e.target.value)}
                            className={inputClass}
                        />

                        {error && (
                            <p className="text-xs text-red-400 bg-red-500/10 p-3 rounded-xl">{error}</p>
                        )}

                        <button
                            onClick={handleBackup}
                            disabled={isProcessing}
                            className={`w-full py-4 rounded-2xl font-black text-lg transition-all ${
                                isProcessing
                                    ? 'bg-gray-500 cursor-wait'
                                    : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg hover:shadow-emerald-500/30'
                            }`}
                        >
                            {isProcessing ? '⏳ Encrypting...' : '💾 Create Backup'}
                        </button>
                    </div>
                )}

                {mode === 'restore' && (
                    <div className="space-y-4">
                        <button onClick={() => setMode('menu')} className="text-sm text-slate-400 hover:text-white flex items-center gap-1">
                            ← Back
                        </button>

                        <h3 className={`font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Restore from Backup</h3>
                        <p className="text-xs text-slate-400">Enter the passphrase you used during backup</p>

                        <input
                            type="password"
                            placeholder="Recovery passphrase"
                            value={passphrase}
                            onChange={e => setPassphrase(e.target.value)}
                            className={inputClass}
                        />

                        {error && (
                            <p className="text-xs text-red-400 bg-red-500/10 p-3 rounded-xl">{error}</p>
                        )}

                        <button
                            onClick={handleRestore}
                            disabled={isProcessing}
                            className={`w-full py-4 rounded-2xl font-black text-lg transition-all ${
                                isProcessing
                                    ? 'bg-gray-500 cursor-wait'
                                    : 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg hover:shadow-blue-500/30'
                            }`}
                        >
                            {isProcessing ? '⏳ Decrypting...' : '🔄 Restore Keys'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default KeyRecoveryPanel;
