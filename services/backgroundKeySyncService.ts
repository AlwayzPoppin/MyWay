import { 
    getCircleMembers, 
    subscribeToCircleMembers, 
    getWrappedKeyForUser, 
    deliverWrappedKey, 
    getUserProfile,
    getFamilyCircle
} from './authService';
import { 
    loadKeyPairFromSecureStorage, 
    importKeyPairJWK, 
    importPublicKey, 
    deriveSharedSecretKey, 
    wrapCircleKey, 
    unwrapCircleKey, 
    getFamilyKey, 
    setFamilyKey, 
    ensureFamilyKeyRestored,
    generateECDHKeyPair,
    exportKeyPairJWK,
    saveKeyPairToSecureStorage,
    exportPublicKey
} from './cryptoService';

/**
 * Background E2EE Key Synchronization Service
 * 
 * Operates independently of the React component lifecycle to ensure:
 * 1. Background geolocation location pings can always encrypt without waiting for the app to open.
 * 2. New circle members joining while the app is backgrounded/closed receive encrypted circle keys autonomously.
 * 3. Non-owner members joining a circle in the background immediately unwrap and persist their circle key.
 */
class BackgroundKeySyncService {
    private activeCircleId: string | null = null;
    private currentUserId: string | null = null;
    private unsubscribeListener: (() => void) | null = null;
    private lastSyncedSignature: string = '';
    private isSyncing: boolean = false;

    /**
     * Start background key synchronization for the active circle
     */
    public init(userId: string, circleId: string) {
        if (this.activeCircleId === circleId && this.currentUserId === userId && this.unsubscribeListener) {
            return;
        }

        this.stop();
        this.currentUserId = userId;
        this.activeCircleId = circleId;

        console.log(`🔐 [BackgroundKeySync] Starting background listener for circle ${circleId}`);

        // Initial one-shot headless sync
        this.syncCircleKeysHeadless(circleId, userId);

        // Realtime background listener on circle membership
        this.unsubscribeListener = subscribeToCircleMembers(circleId, (memberIds) => {
            const signature = [...memberIds].sort().join(',');
            if (signature === this.lastSyncedSignature) return;
            this.lastSyncedSignature = signature;

            console.log(`🔐 [BackgroundKeySync] Circle member change detected (${memberIds.length} members), syncing keys...`);
            this.syncCircleKeysHeadless(circleId, userId);
        });
    }

    /**
     * Stop background key synchronization listener
     */
    public stop() {
        if (this.unsubscribeListener) {
            this.unsubscribeListener();
            this.unsubscribeListener = null;
        }
        this.activeCircleId = null;
        this.currentUserId = null;
        this.lastSyncedSignature = '';
    }

    /**
     * One-shot headless key synchronization that can be invoked from background tasks,
     * geolocation callbacks, push notification workers, or offline sync handlers.
     */
    public async syncCircleKeysHeadless(circleId: string, userId: string): Promise<boolean> {
        if (this.isSyncing) return false;
        this.isSyncing = true;

        try {
            // 1. Ensure user's ECDH key pair is loaded from secure storage
            let keyPair: CryptoKeyPair | null = null;
            const savedJWK = await loadKeyPairFromSecureStorage(userId);
            if (savedJWK) {
                try {
                    keyPair = await importKeyPairJWK(savedJWK);
                } catch (err) {
                    console.warn('🔐 [BackgroundKeySync] Error importing stored ECDH key pair:', err);
                }
            }

            if (!keyPair) {
                keyPair = await generateECDHKeyPair();
                const jwk = await exportKeyPairJWK(keyPair);
                await saveKeyPairToSecureStorage(userId, jwk);
            }

            // 2. Ensure circle family key is restored
            let familyKey = await ensureFamilyKeyRestored(circleId);

            // 3. Inspect circle details
            const circle = await getFamilyCircle(circleId);
            if (!circle) {
                this.isSyncing = false;
                return false;
            }

            const isOwner = circle.ownerId === userId;

            // Scenario A: User is Circle Owner (or has the circle key) -> Deliver to members missing keys
            if (isOwner || familyKey) {
                const members = await getCircleMembers(circleId);
                for (const member of members) {
                    if (member.uid === userId || !member.ecdhPublicKey) continue;

                    const hasKey = await new Promise<boolean>((resolve) => {
                        getWrappedKeyForUser(circleId, member.uid, (wrapped) => {
                            resolve(Boolean(wrapped));
                        });
                    });

                    if (!hasKey && familyKey && keyPair) {
                        console.log(`🔐 [BackgroundKeySync] Delivering wrapped circle key to new member ${member.displayName || member.uid}`);
                        const memberPubKey = await importPublicKey(member.ecdhPublicKey);
                        const sharedSecret = await deriveSharedSecretKey(keyPair.privateKey, memberPubKey);
                        const wrapped = await wrapCircleKey(familyKey, sharedSecret);
                        await deliverWrappedKey(circleId, member.uid, wrapped);
                    }
                }
            }

            // Scenario B: User is a non-owner member who needs to unwrap the circle key
            if (!isOwner && !familyKey && keyPair) {
                await new Promise<void>((resolve) => {
                    getWrappedKeyForUser(circleId, userId, async (wrapped) => {
                        if (wrapped && circle.ownerId) {
                            try {
                                const ownerProfile = await getUserProfile(circle.ownerId);
                                if (ownerProfile?.ecdhPublicKey && keyPair) {
                                    const ownerPubKey = await importPublicKey(ownerProfile.ecdhPublicKey);
                                    const sharedSecret = await deriveSharedSecretKey(keyPair.privateKey, ownerPubKey);
                                    const unwrapped = await unwrapCircleKey(wrapped, sharedSecret);
                                    setFamilyKey(unwrapped, circleId);
                                    console.log(`🔐 [BackgroundKeySync] Successfully unwrapped & cached circle family key in background`);
                                }
                            } catch (err) {
                                console.warn('🔐 [BackgroundKeySync] Error unwrapping key:', err);
                            }
                        }
                        resolve();
                    });
                });
            }

            this.isSyncing = false;
            return true;
        } catch (err) {
            console.warn('🔐 [BackgroundKeySync] Headless sync error:', err);
            this.isSyncing = false;
            return false;
        }
    }
}

export const backgroundKeySyncService = new BackgroundKeySyncService();
