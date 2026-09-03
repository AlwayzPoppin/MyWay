import { useState, useEffect, useCallback, useRef } from 'react';
import { 
    getCircleMembers, 
    subscribeToCircleMembers,
    getFamilyCircle, 
    deliverWrappedKey, 
    getWrappedKeyForUser, 
    getUserProfile, 
    updateUserProfile 
} from '../services/authService';
import { 
    generateECDHKeyPair, 
    exportPublicKey, 
    importPublicKey, 
    deriveSharedSecretKey, 
    wrapCircleKey, 
    unwrapCircleKey, 
    exportKeyPairJWK, 
    importKeyPairJWK, 
    saveKeyPairToSecureStorage, 
    loadKeyPairFromSecureStorage,
    generateFamilyKey,
    setFamilyKey,
    getFamilyKey
} from '../services/cryptoService';

export const useE2EE = (
    user: any,
    profile: any,
    currentCircle: any,
    isOwner: boolean
) => {
    const [ecdhKeyPair, setEcdhKeyPair] = useState<CryptoKeyPair | null>(null);

    const initE2EE = useCallback(async () => {
        if (!user) return;

        let keys = ecdhKeyPair;
        if (!keys) {
            const savedKeys = await loadKeyPairFromSecureStorage(user.uid);
            if (savedKeys) {
                try {
                    keys = await importKeyPairJWK(savedKeys);
                } catch (e) {
                    console.error("Failed to restore keys", e);
                }
            }
        }

        if (!keys) {
            keys = await generateECDHKeyPair();
            const jwk = await exportKeyPairJWK(keys);
            await saveKeyPairToSecureStorage(user.uid, jwk);
        }

        setEcdhKeyPair(keys);

        const pubKeyBase64 = await exportPublicKey(keys.publicKey);
        if (profile && profile.ecdhPublicKey !== pubKeyBase64) {
            updateUserProfile(user.uid, { ecdhPublicKey: pubKeyBase64 });
        }

        if (isOwner && currentCircle) {
            const circleMembers = await getCircleMembers(currentCircle.id);
            getWrappedKeyForUser(currentCircle.id, user.uid, async (existingWrapped) => {
                let circleKey: CryptoKey;
                if (existingWrapped) {
                    const sharedSecret = await deriveSharedSecretKey(keys.privateKey, keys.publicKey);
                    circleKey = await unwrapCircleKey(existingWrapped, sharedSecret);
                } else {
                    circleKey = await generateFamilyKey();
                    const selfSharedSecret = await deriveSharedSecretKey(keys.privateKey, keys.publicKey);
                    const selfWrapped = await wrapCircleKey(circleKey, selfSharedSecret);
                    await deliverWrappedKey(currentCircle.id, user.uid, selfWrapped);
                }
                setFamilyKey(circleKey, currentCircle.id);

                for (const member of circleMembers) {
                    if (member.uid !== user.uid && member.ecdhPublicKey) {
                        const memberPubKey = await importPublicKey(member.ecdhPublicKey);
                        const sharedSecret = await deriveSharedSecretKey(keys.privateKey, memberPubKey);
                        const wrapped = await wrapCircleKey(circleKey, sharedSecret);
                        await deliverWrappedKey(currentCircle.id, member.uid, wrapped);
                    }
                }
            });
        }

        if (!isOwner && currentCircle) {
            getWrappedKeyForUser(currentCircle.id, user.uid, async (wrapped) => {
                const ownerProfile = await getUserProfile(currentCircle.ownerId);
                if (ownerProfile?.ecdhPublicKey && keys) {
                    const ownerPubKey = await importPublicKey(ownerProfile.ecdhPublicKey);
                    const sharedSecret = await deriveSharedSecretKey(keys.privateKey, ownerPubKey);
                    const unwrapped = await unwrapCircleKey(wrapped, sharedSecret);
                    setFamilyKey(unwrapped, currentCircle.id);
                }
            });
        }
    }, [user, profile, currentCircle, isOwner, ecdhKeyPair]);

    useEffect(() => {
        initE2EE();
    }, [user?.uid, profile?.familyCircleId, isOwner, !!currentCircle]);

    // Auto Key-Sync: Targeted Realtime Listener on Circle Members (Eliminates aggressive 30s polling)
    const lastSyncedMembersSignatureRef = useRef<string>('');

    useEffect(() => {
        if (!currentCircle || !ecdhKeyPair || !currentCircle.id) return;

        const syncKeysToNewMembers = async (memberIds?: string[]) => {
            try {
                const familyKey = getFamilyKey();
                if (!familyKey) return;

                const circleMembers = await getCircleMembers(currentCircle.id);
                for (const member of circleMembers) {
                    if (member.uid === user?.uid || !member.ecdhPublicKey) continue;

                    const hasKey = await new Promise<boolean>((resolve) => {
                        getWrappedKeyForUser(currentCircle.id, member.uid, (wrapped) => {
                            resolve(!!wrapped);
                        });
                    });

                    if (!hasKey) {
                        console.log(`🔑 E2EE: Delivering circle key to new member ${member.displayName || member.uid}`);
                        const memberPubKey = await importPublicKey(member.ecdhPublicKey);
                        const sharedSecret = await deriveSharedSecretKey(ecdhKeyPair.privateKey, memberPubKey);
                        const wrapped = await wrapCircleKey(familyKey, sharedSecret);
                        await deliverWrappedKey(currentCircle.id, member.uid, wrapped);
                    }
                }
            } catch (err) {
                console.warn('⚠️ Targeted key-sync error:', err);
            }
        };

        // Targeted Realtime Listener: triggers only when circle membership changes
        const unsubscribe = subscribeToCircleMembers(currentCircle.id, (memberIds) => {
            if (!memberIds || memberIds.length === 0) return;
            const signature = [...memberIds].sort().join(',');
            if (signature === lastSyncedMembersSignatureRef.current) return;
            lastSyncedMembersSignatureRef.current = signature;

            console.log(`🔑 E2EE: Circle members changed (${memberIds.length} members), triggering targeted key-sync`);
            syncKeysToNewMembers(memberIds);
        });

        return () => {
            unsubscribe();
        };
    }, [currentCircle?.id, ecdhKeyPair, user?.uid]);

    return { ecdhKeyPair, initE2EE };
};
