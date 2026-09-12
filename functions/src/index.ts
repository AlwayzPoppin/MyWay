import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';

admin.initializeApp();

type TrustedDeviceRecord = {
    label?: string;
    platform?: string;
    fcmToken?: string;
    createdAt?: number;
    lastActiveAt?: number;
    isLocationPublisher?: boolean;
    revokedAt?: number | null;
};

const cleanDeviceId = (value: unknown): string => {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid device identifier is required.');
    }
    return id;
};

const cleanDeviceLabel = (value: unknown): string => {
    const label = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    return (label || 'My Way device').slice(0, 60);
};

const sendNewDeviceAlert = async (tokens: string[], label: string) => {
    const uniqueTokens = Array.from(new Set(tokens.filter(token => typeof token === 'string' && token.length > 20))).slice(0, 500);
    if (uniqueTokens.length === 0) return;
    try {
        await admin.messaging().sendEachForMulticast({
            tokens: uniqueTokens,
            notification: {
                title: 'New My Way sign-in',
                body: `${label} signed in to your account.`
            },
            data: { type: 'new_device_sign_in' },
            android: { notification: { channelId: 'myway_safety', icon: 'ic_stat_myway', color: '#6366f1' } }
        });
    } catch (error) {
        // Device registration must still succeed when notifications are unavailable.
        console.warn('New-device notification failed:', error);
    }
};

/** Includes every trusted-device token while retaining the legacy profile token. */
const getUserPushTokens = async (uid: string): Promise<string[]> => {
    const root = admin.database().ref();
    const [legacyTokenSnapshot, devicesSnapshot] = await Promise.all([
        root.child(`users/${uid}/fcmToken`).once('value'),
        root.child(`userDevices/${uid}`).once('value')
    ]);
    const devices = (devicesSnapshot.val() || {}) as Record<string, TrustedDeviceRecord>;
    return Array.from(new Set([
        legacyTokenSnapshot.val(),
        ...Object.values(devices).map(device => device?.fcmToken)
    ].filter((token): token is string => typeof token === 'string' && token.length > 20)));
};

/**
 * Registers a trusted My Way device without replacing the account's current
 * GPS publisher. The first registered device becomes the publisher.
 */
export const registerTrustedDevice = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const deviceId = cleanDeviceId(data?.deviceId);
    const label = cleanDeviceLabel(data?.label);
    const platform = cleanDeviceLabel(data?.platform || 'unknown').toLowerCase();
    const now = Date.now();
    const root = admin.database().ref();
    const devicesSnapshot = await root.child(`userDevices/${uid}`).once('value');
    const devices = (devicesSnapshot.val() || {}) as Record<string, TrustedDeviceRecord>;
    const previous = devices[deviceId];
    const profileSnapshot = await root.child(`users/${uid}/activeLocationDeviceId`).once('value');
    const storedActiveDeviceId = typeof profileSnapshot.val() === 'string' && profileSnapshot.val()
        ? profileSnapshot.val()
        : '';
    const activeDevice = storedActiveDeviceId ? devices[storedActiveDeviceId] : null;
    const isMobile = platform === 'android' || platform === 'ios';
    // A desktop is deliberately view-only. If a phone arrives after a desktop
    // session, make the phone the account's live-location publisher automatically.
    const activeLocationDeviceId = isMobile && (!storedActiveDeviceId || activeDevice?.platform === 'web')
        ? deviceId
        : storedActiveDeviceId;

    const updates: Record<string, unknown> = {
        [`userDevices/${uid}/${deviceId}/label`]: label,
        [`userDevices/${uid}/${deviceId}/platform`]: platform,
        [`userDevices/${uid}/${deviceId}/createdAt`]: previous?.createdAt || now,
        [`userDevices/${uid}/${deviceId}/lastActiveAt`]: now,
        [`userDevices/${uid}/${deviceId}/revokedAt`]: null,
        [`userDevices/${uid}/${deviceId}/isLocationPublisher`]: activeLocationDeviceId === deviceId
    };
    if (activeLocationDeviceId !== storedActiveDeviceId) {
        updates[`users/${uid}/activeLocationDeviceId`] = activeLocationDeviceId;
        if (storedActiveDeviceId && storedActiveDeviceId !== deviceId) {
            updates[`userDevices/${uid}/${storedActiveDeviceId}/isLocationPublisher`] = false;
        }
    }
    await root.update(updates);

    if (!previous) {
        const existingTokens = Object.entries(devices)
            .filter(([id]) => id !== deviceId)
            .map(([, device]) => device?.fcmToken || '');
        await sendNewDeviceAlert(existingTokens, label);
    }
    return { activeLocationDeviceId };
});

/** Claims the sole live-location publisher role for the device making this call. */
export const claimLocationSharingDevice = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const deviceId = cleanDeviceId(data?.deviceId);
    const root = admin.database().ref();
    const deviceSnapshot = await root.child(`userDevices/${uid}/${deviceId}`).once('value');
    if (!deviceSnapshot.exists() || deviceSnapshot.val()?.revokedAt) {
        throw new functions.https.HttpsError('failed-precondition', 'This device must sign in again before it can share location.');
    }
    const previousSnapshot = await root.child(`users/${uid}/activeLocationDeviceId`).once('value');
    const previousDeviceId = typeof previousSnapshot.val() === 'string' ? previousSnapshot.val() : '';
    const updates: Record<string, unknown> = {
        [`users/${uid}/activeLocationDeviceId`]: deviceId,
        [`userDevices/${uid}/${deviceId}/isLocationPublisher`]: true,
        [`userDevices/${uid}/${deviceId}/lastActiveAt`]: Date.now()
    };
    if (previousDeviceId && previousDeviceId !== deviceId) {
        updates[`userDevices/${uid}/${previousDeviceId}/isLocationPublisher`] = false;
    }
    await root.update(updates);
    return { activeLocationDeviceId: deviceId };
});

export const updateTrustedDevicePushToken = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const deviceId = cleanDeviceId(data?.deviceId);
    const token = typeof data?.token === 'string' ? data.token.trim() : '';
    if (token.length < 20 || token.length > 4096) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid push token is required.');
    }
    await admin.database().ref().update({
        [`userDevices/${uid}/${deviceId}/fcmToken`]: token,
        [`userDevices/${uid}/${deviceId}/lastActiveAt`]: Date.now()
    });
    return { success: true };
});

export const revokeTrustedDevice = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const deviceId = cleanDeviceId(data?.deviceId);
    const root = admin.database().ref();
    const updates: Record<string, unknown> = {
        [`userDevices/${uid}/${deviceId}/revokedAt`]: Date.now(),
        [`userDevices/${uid}/${deviceId}/isLocationPublisher`]: false
    };
    const activeSnapshot = await root.child(`users/${uid}/activeLocationDeviceId`).once('value');
    if (activeSnapshot.val() === deviceId) updates[`users/${uid}/activeLocationDeviceId`] = null;
    await root.update(updates);
    return { success: true };
});

/** Signs out every known app session and revokes Firebase refresh tokens. */
export const revokeAllDeviceSessions = functions.https.onCall(async (_data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const now = Date.now();
    const root = admin.database().ref();
    const devicesSnapshot = await root.child(`userDevices/${uid}`).once('value');
    const devices = (devicesSnapshot.val() || {}) as Record<string, TrustedDeviceRecord>;
    const updates: Record<string, unknown> = {
        [`userDeviceControls/${uid}/signOutAllAt`]: now,
        [`users/${uid}/activeLocationDeviceId`]: null
    };
    Object.keys(devices).forEach(deviceId => {
        updates[`userDevices/${uid}/${deviceId}/revokedAt`] = now;
        updates[`userDevices/${uid}/${deviceId}/isLocationPublisher`] = false;
    });
    await Promise.all([root.update(updates), admin.auth().revokeRefreshTokens(uid)]);
    return { success: true };
});

/**
 * Firestore rules cannot read RTDB directly. This callable function is the
 * narrow bridge between the authoritative Circle membership in RTDB and the
 * Firestore membership document used to authorize chat listeners.
 */
export const syncCircleMembership = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    }

    const circleId = typeof data?.circleId === 'string' ? data.circleId.trim() : '';
    const requestedUserId = typeof data?.userId === 'string' ? data.userId.trim() : context.auth.uid;
    if (!circleId || !requestedUserId) {
        throw new functions.https.HttpsError('invalid-argument', 'A Circle and member are required.');
    }

    const circleSnapshot = await admin.database().ref(`circles/${circleId}`).once('value');
    const circle = circleSnapshot.val() as { ownerId?: string; members?: unknown; memberIds?: Record<string, boolean> } | null;
    const memberIds = new Set<string>([
        ...(Array.isArray(circle?.members) ? circle.members.filter((id): id is string => typeof id === 'string') : []),
        ...Object.entries(circle?.memberIds || {}).filter(([, active]) => active === true).map(([id]) => id)
    ]);
    const callerIsOwner = circle?.ownerId === context.auth.uid;

    // A member can only refresh their own access. An owner may also revoke or
    // restore a member after a Circle management change.
    if (requestedUserId !== context.auth.uid && !callerIsOwner) {
        throw new functions.https.HttpsError('permission-denied', 'Only the Circle owner can sync another member.');
    }

    const membershipRef = admin.firestore().doc(`circleMemberships/${circleId}/members/${requestedUserId}`);
    if (memberIds.has(requestedUserId)) {
        await membershipRef.set({
            circleId,
            userId: requestedUserId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return { active: true };
    }

    // A departed member can always remove their own access. Owner-triggered
    // removal also makes revocation immediate for a removed member.
    if (requestedUserId === context.auth.uid || callerIsOwner) {
        await membershipRef.delete();
        return { active: false };
    }

    throw new functions.https.HttpsError('permission-denied', 'You are not a member of this Circle.');
});

const ACCESS_POINT_TYPES = new Set([
    'main_entrance', 'curbside', 'auto_care', 'pharmacy_drive_thru',
    'emergency_dropoff', 'contractor_lumber', 'drive_thru', 'parking'
]);
const ENTRANCE_TYPES = new Set(['main_door', 'curbside', 'drive_thru', 'parking', 'driveway', 'front_door']);

const cleanCommunityKey = (value: unknown): string => {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!/^[a-z0-9_]{8,220}$/.test(key)) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid place key is required.');
    }
    return key;
};

const cleanCoordinate = (value: unknown, min: number, max: number, label: string): number => {
    const coordinate = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
        throw new functions.https.HttpsError('invalid-argument', `A valid ${label} is required.`);
    }
    return coordinate;
};

const cleanCommunityText = (value: unknown, maxLength: number): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const clean = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    return clean || undefined;
};

/**
 * Stores an authenticated driver's contribution as pending. The record is not
 * added to live navigation data until an admin approves it.
 */
export const submitDestinationAccessPoint = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');

    const key = cleanCommunityKey(data?.normalizedKey);
    const raw = data?.accessPoint || {};
    const type = typeof raw.type === 'string' && ACCESS_POINT_TYPES.has(raw.type) ? raw.type : '';
    const entranceType = typeof raw.entranceType === 'string' && ENTRANCE_TYPES.has(raw.entranceType)
        ? raw.entranceType
        : '';
    const lat = cleanCoordinate(raw.location?.lat, -90, 90, 'latitude');
    const lng = cleanCoordinate(raw.location?.lng, -180, 180, 'longitude');
    const name = cleanCommunityText(raw.name, 80);
    if (!type || !entranceType || !name) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid entrance type and name are required.');
    }

    const day = new Date().toISOString().slice(0, 10);
    const rateRef = admin.database().ref(`community_submission_rate/${context.auth.uid}/${day}`);
    const rateResult = await rateRef.transaction((count) => {
        const next = (typeof count === 'number' ? count : 0) + 1;
        return next <= 12 ? next : undefined;
    });
    if (!rateResult.committed) {
        throw new functions.https.HttpsError('resource-exhausted', 'Daily entrance contribution limit reached.');
    }

    const accessPointId = typeof raw.id === 'string' && /^ap_[a-z0-9_]{8,180}$/i.test(raw.id)
        ? raw.id
        : `ap_${type}_${lat.toFixed(5).replace(/[-.]/g, '_')}_${lng.toFixed(5).replace(/[-.]/g, '_')}`;
    const candidateRef = admin.database().ref(`destination_access_point_submissions/${key}/${accessPointId}`);
    const submissionRef = candidateRef.child(context.auth.uid);
    const now = Date.now();
    const submission = {
        id: accessPointId,
        placeId: cleanCommunityText(raw.placeId, 160),
        placeName: cleanCommunityText(raw.placeName, 120),
        placeLocation: (raw.placeLocation && typeof raw.placeLocation.lat === 'number' && typeof raw.placeLocation.lng === 'number')
            ? { lat: raw.placeLocation.lat, lng: raw.placeLocation.lng }
            : undefined,
        name,
        type,
        location: { lat, lng },
        entranceType,
        notes: cleanCommunityText(raw.notes, 300),
        imageUrl: cleanCommunityText(raw.imageUrl, 2_000),
        source: 'community',
        confidence: 'medium',
        verifiedCount: 1,
        status: 'pending',
        submittedBy: context.auth.uid,
        submittedAt: now,
        updatedAt: now
    };
    await submissionRef.set(submission);

    // A single account cannot make a public routing change. Three independent
    // authenticated drivers confirming the same precise point can promote a
    // low-risk entrance automatically; everything else stays pending.
    const candidateSnapshot = await candidateRef.once('value');
    const confirmations = Object.values(candidateSnapshot.val() || {})
        .filter((candidate: any) => candidate?.status === 'pending' || candidate?.status === 'approved');
    const independentUsers = new Set(confirmations.map((candidate: any) => candidate.submittedBy).filter(Boolean));
    if (independentUsers.size >= 3) {
        const approvedPoint = {
            ...submission,
            status: 'approved',
            confidence: 'high',
            verifiedCount: independentUsers.size,
            autoApprovedAt: now,
            approvalReason: 'three_independent_confirmations'
        };
        await admin.database().ref(`destination_access_points/${key}/${accessPointId}`).set(approvedPoint);
        await Promise.all(Object.keys(candidateSnapshot.val() || {}).map(uid =>
            candidateRef.child(uid).update({ status: 'approved', moderatedAt: now, moderationReason: 'automatic_consensus' })
        ));
        return { id: accessPointId, status: 'approved', autoApproved: true, verifiedCount: independentUsers.size };
    }

    return { id: accessPointId, status: 'pending', verifiedCount: independentUsers.size };
});

const ADMIN_UIDS = new Set([
    'UZEu0ZK82EZQPNuBwfnl6dA3iwr1' // TEST WATTZ / nexgensynapse@gmail.com
]);

const isCallerAdmin = (context: functions.https.CallableContext): boolean => {
    if (!context.auth) return false;
    if (context.auth.token.admin === true) return true;
    if (ADMIN_UIDS.has(context.auth.uid)) return true;
    return false;
};

const listAdminUids = async (): Promise<string[]> => {
    // A bootstrap UID is only an administrator while that Auth account still
    // exists. Keeping a deleted UID here would otherwise look like a recovery
    // admin and could allow the last real operator to delete their account.
    const admins = new Set<string>();
    await Promise.all([...ADMIN_UIDS].map(async uid => {
        try {
            await admin.auth().getUser(uid);
            admins.add(uid);
        } catch (error: any) {
            if (error?.code !== 'auth/user-not-found') {
                console.warn(`[Admin] Could not verify bootstrap admin ${uid}`, error);
            }
        }
    }));
    let pageToken: string | undefined;
    do {
        const page = await admin.auth().listUsers(1000, pageToken);
        page.users.forEach(user => {
            if (user.customClaims?.admin === true) admins.add(user.uid);
        });
        pageToken = page.pageToken;
    } while (pageToken);
    return [...admins];
};

/** Approves a pending contribution into the live, routable access-point dataset. */
export const moderateDestinationAccessPoint = functions.https.onCall(async (data, context) => {
    if (!isCallerAdmin(context)) {
        throw new functions.https.HttpsError('permission-denied', 'Administrator access is required.');
    }
    const moderatorUid = context.auth!.uid;
    const key = cleanCommunityKey(data?.normalizedKey);
    const accessPointId = typeof data?.accessPointId === 'string' ? data.accessPointId.trim() : '';
    const decision = data?.decision === 'approve' || data?.decision === 'reject' ? data.decision : '';
    if (!/^ap_[a-z0-9_]{8,180}$/i.test(accessPointId) || !decision) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid access-point decision is required.');
    }

    const submissionRef = admin.database().ref(`destination_access_point_submissions/${key}/${accessPointId}`);
    const snapshot = await submissionRef.once('value');
    const candidates = Object.values(snapshot.val() || {}) as any[];
    const submission = candidates.find(candidate => candidate?.status === 'pending');
    if (!submission) {
        throw new functions.https.HttpsError('not-found', 'Pending access-point contribution not found.');
    }

    const now = Date.now();
    if (decision === 'approve') {
        await admin.database().ref(`destination_access_points/${key}/${accessPointId}`).set({
            ...submission,
            status: 'approved',
            approvedAt: now,
            approvedBy: moderatorUid,
            updatedAt: now
        });
    }
    await Promise.all(Object.keys(snapshot.val() || {}).map(uid =>
        submissionRef.child(uid).update({
            status: decision === 'approve' ? 'approved' : 'rejected',
            moderatedAt: now,
            moderatedBy: moderatorUid
        })
    ));
    return { id: accessPointId, status: decision === 'approve' ? 'approved' : 'rejected' };
});

/** Returns the authenticated account identity and whether it can open Map Review. */
export const getMapReviewAccess = functions.https.onCall(async (_data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const isAdmin = isCallerAdmin(context);

    // Auto-bootstrap admin custom claim if authorized admin identity
    if (isAdmin && context.auth.token.admin !== true) {
        try {
            const user = await admin.auth().getUser(context.auth.uid);
            await admin.auth().setCustomUserClaims(context.auth.uid, {
                ...(user.customClaims || {}),
                admin: true
            });
            console.log(`[Admin] Assigned admin custom claim to ${context.auth.uid} (${context.auth.token.email})`);
        } catch (claimErr) {
            console.warn('[Admin] Failed to assign custom claim:', claimErr);
        }
    }

    return { uid: context.auth.uid, isAdmin };
});

/** Prevents the final My Way operator from deleting the only recovery path. */
export const getAdminDeletionProtection = functions.https.onCall(async (_data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    if (!isCallerAdmin(context)) return { isAdmin: false, hasRecoveryAdmin: true };
    const otherAdmins = (await listAdminUids()).filter(uid => uid !== context.auth!.uid);
    return { isAdmin: true, hasRecoveryAdmin: otherAdmins.length > 0 };
});

export const assertCanDeleteMyWayAccount = functions.https.onCall(async (_data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    if (!isCallerAdmin(context)) return { allowed: true };
    const otherAdmins = (await listAdminUids()).filter(uid => uid !== context.auth!.uid);
    if (otherAdmins.length === 0) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'Assign a recovery admin before deleting the final My Way Operations account.'
        );
    }
    return { allowed: true };
});

/** Returns a compact, phone-friendly list of pending access-point candidates. */
export const listPendingDestinationAccessPoints = functions.https.onCall(async (_data, context) => {
    if (!isCallerAdmin(context)) {
        throw new functions.https.HttpsError('permission-denied', 'Administrator access is required.');
    }
    const snapshot = await admin.database().ref('destination_access_point_submissions').once('value');
    const pending: any[] = [];
    snapshot.forEach(placeSnapshot => {
        placeSnapshot.forEach(accessPointSnapshot => {
            const candidates = accessPointSnapshot.val() || {};
            const firstPending = Object.values(candidates).find((candidate: any) => candidate?.status === 'pending') as any;
            if (!firstPending) return;
            const confirmations = new Set(
                Object.values(candidates)
                    .filter((candidate: any) => candidate?.status === 'pending' || candidate?.status === 'approved')
                    .map((candidate: any) => candidate?.submittedBy)
                    .filter(Boolean)
            );

            // Compute move distance from original place location if available
            let placeLocation = firstPending.placeLocation;
            const placeName = firstPending.placeName || firstPending.name;

            // Fallback: parse approximate place anchor from normalizedKey
            // Format: name_desc_lat_lng
            if (!placeLocation && placeSnapshot.key) {
                const parts = placeSnapshot.key.split('_');
                if (parts.length >= 4) {
                    const latCandidate = parseFloat(parts[parts.length - 2]);
                    const lngCandidate = parseFloat(parts[parts.length - 1]);
                    if (Number.isFinite(latCandidate) && Number.isFinite(lngCandidate)) {
                        placeLocation = { lat: latCandidate, lng: lngCandidate };
                    }
                }
            }

            let moveDistanceMeters: number | undefined = undefined;
            if (placeLocation && firstPending.location) {
                const R = 6371000;
                const dLat = (firstPending.location.lat - placeLocation.lat) * Math.PI / 180;
                const dLng = (firstPending.location.lng - placeLocation.lng) * Math.PI / 180;
                const a = Math.sin(dLat / 2) ** 2 +
                    Math.cos(placeLocation.lat * Math.PI / 180) * Math.cos(firstPending.location.lat * Math.PI / 180) *
                    Math.sin(dLng / 2) ** 2;
                moveDistanceMeters = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
            }

            pending.push({
                normalizedKey: placeSnapshot.key,
                accessPointId: accessPointSnapshot.key,
                name: firstPending.name,
                placeName,
                placeLocation,
                moveDistanceMeters,
                type: firstPending.type,
                location: firstPending.location,
                notes: firstPending.notes,
                imageUrl: firstPending.imageUrl,
                submittedAt: firstPending.submittedAt,
                confirmations: confirmations.size
            });
        });
    });
    pending.sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
    return { submissions: pending.slice(0, 100) };
});

/** Allows an existing admin to grant admin status to another user UID or email */
export const assignAdminRole = functions.https.onCall(async (data, context) => {
    if (!isCallerAdmin(context)) {
        throw new functions.https.HttpsError('permission-denied', 'Administrator access is required.');
    }
    const targetUid = typeof data?.uid === 'string' ? data.uid.trim() : '';
    const targetEmail = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (!targetUid && !targetEmail) {
        throw new functions.https.HttpsError('invalid-argument', 'A target UID or email is required.');
    }

    let userToUpdate: admin.auth.UserRecord;
    if (targetUid) {
        userToUpdate = await admin.auth().getUser(targetUid);
    } else {
        userToUpdate = await admin.auth().getUserByEmail(targetEmail);
    }

    if (userToUpdate.uid === context.auth!.uid) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Choose a different existing My Way account as the recovery admin.'
        );
    }

    await admin.auth().setCustomUserClaims(userToUpdate.uid, {
        ...(userToUpdate.customClaims || {}),
        admin: true
    });

    return { success: true, uid: userToUpdate.uid, email: userToUpdate.email };
});

const NATIONAL_ADDRESS_ENDPOINT = 'https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/Address_Points_from_National_Address_Database_view/FeatureServer/0/query';
const MAX_ADDRESS_VIEWPORT_DEGREES = 0.12;
const MIN_ADDRESS_LABEL_ZOOM = 15;
const MAX_ADDRESS_RESULTS = 850;

type NationalAddressFeature = {
    attributes?: Record<string, unknown>;
    geometry?: { x?: number; y?: number };
};

/**
 * Bounded proxy for U.S. DOT National Address Database viewport labels.
 * This prevents an unbounded public-data request from every map movement and
 * leaves a clean seam for a My Way-hosted vector-tile pipeline later.
 */
export const getNationalAddressPoints = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required to load address labels.');
    }

    const { north, south, east, west, zoom } = data || {};
    const coordinates = [north, south, east, west];
    if (!coordinates.every(value => typeof value === 'number' && Number.isFinite(value)) ||
        typeof zoom !== 'number' || !Number.isFinite(zoom)) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid viewport and zoom are required.');
    }
    if (zoom < MIN_ADDRESS_LABEL_ZOOM) return { points: [] };
    if (north <= south || east <= west ||
        east - west > MAX_ADDRESS_VIEWPORT_DEGREES ||
        north - south > MAX_ADDRESS_VIEWPORT_DEGREES ||
        west < -180 || east > 180 || south < -90 || north > 90) {
        throw new functions.https.HttpsError('invalid-argument', 'Address viewport is too large or invalid.');
    }

    const params = new URLSearchParams({
        where: "Add_Number IS NOT NULL AND (Lifecycle IS NULL OR Lifecycle <> 'Retired')",
        geometry: `${west},${south},${east},${north}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'OBJECTID,UUID,AddNo_Full,Add_Number,StNam_Full,St_Name,Placement,Lifecycle,Latitude,Longitude',
        returnGeometry: 'false',
        resultRecordCount: String(MAX_ADDRESS_RESULTS),
        orderByFields: 'OBJECTID',
        f: 'json'
    });

    try {
        const response = await fetch(`${NATIONAL_ADDRESS_ENDPOINT}?${params.toString()}`);
        if (!response.ok) throw new Error(`NAD request failed (${response.status})`);
        const payload = await response.json() as { error?: { message?: string }; features?: NationalAddressFeature[] };
        if (payload.error) throw new Error(payload.error.message || 'NAD returned an error');

        const points = (payload.features || []).flatMap(feature => {
            const attributes = feature.attributes || {};
            const latitude = Number(attributes.Latitude);
            const longitude = Number(attributes.Longitude);
            const rawNumber = attributes.AddNo_Full ?? attributes.Add_Number;
            const number = typeof rawNumber === 'string' || typeof rawNumber === 'number' ? String(rawNumber).trim() : '';
            if (!number || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
            const id = String(attributes.UUID || attributes.OBJECTID || `${latitude}:${longitude}:${number}`);
            const streetValue = attributes.StNam_Full ?? attributes.St_Name;
            return [{
                id,
                number,
                street: typeof streetValue === 'string' ? streetValue.trim() : '',
                placement: typeof attributes.Placement === 'string' ? attributes.Placement : 'Unknown',
                latitude,
                longitude
            }];
        });

        return { points, truncated: points.length >= MAX_ADDRESS_RESULTS };
    } catch (error) {
        console.error('getNationalAddressPoints error:', error);
        throw new functions.https.HttpsError('unavailable', 'National address labels are temporarily unavailable.');
    }
});

// Gemini AI Proxy
// This function secures your Gemini API key by keeping it server-side.
// Keep the handler shared by the legacy endpoint and its clean v2 replacement
// so a broken invocation policy never strands authenticated app users.
const callGeminiHandler = async (data: any, context: any) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required to use My Way AI.');
    }
    const { prompt, config, model = 'gemini-2.0-flash-exp' } = data;

    if (!prompt) {
        throw new functions.https.HttpsError('invalid-argument', 'Prompt is required.');
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || functions.config().google?.gemini_api_key;

    if (!apiKey) {
        console.error('Gemini API key not configured');
        throw new functions.https.HttpsError('internal', 'AI configuration error.');
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const aiModel = genAI.getGenerativeModel({ model });

        const result = await aiModel.generateContent({
            contents: Array.isArray(prompt) ? prompt : [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: config
        });

        const response = await result.response;
        return {
            text: response.text(),
            candidates: response.candidates || []
        };
    } catch (error: any) {
        console.error('callGeminiAI runtime error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'AI service failed');
    }
};

export const callGeminiAI = functions.https.onCall(callGeminiHandler);
export const callGeminiAIv2 = functions.https.onCall(callGeminiHandler);

// Google Places API Proxy
// This function secures your API key by keeping it server-side
export const searchPlaces = functions.https.onCall(async (data, context) => {
    // Rate limiting: Check if user is authenticated (optional but recommended)
    // if (!context.auth) {
    //   throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    // }

    const { query, lat, lng, type } = data;
    console.log(`🔌 [searchPlaces] Triggered with query="${query}", lat=${lat}, lng=${lng}, type=${type}`);

    // Input validation
    if (!query || typeof query !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Query is required.');
    }

    if (typeof lat !== 'number' || typeof lng !== 'number') {
        throw new functions.https.HttpsError('invalid-argument', 'Valid coordinates are required.');
    }

    // Get API key from Firebase environment config
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || functions.config().google?.maps_api_key;

    if (!apiKey) {
        console.error('🔌 [searchPlaces] Google Maps API key not configured in process.env or functions.config()');
        throw new functions.https.HttpsError('internal', 'API configuration error.');
    }
    console.log(`🔌 [searchPlaces] Using API Key: ${apiKey.substring(0, 8)}...`);

    try {
        // Build the Places API URL
        const radius = 5000; // 5km radius
        const placeType = type || 'point_of_interest';

        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&keyword=${encodeURIComponent(query)}&type=${placeType}&key=${apiKey}`;
        console.log(`🔌 [searchPlaces] Fetching from Google Maps Places API...`);

        const response = await fetch(url);
        const json = await response.json();

        console.log(`🔌 [searchPlaces] Google Places response status: ${json.status}`);
        if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
            console.error('🔌 [searchPlaces] Google Places API error:', json.status, json.error_message);
            throw new functions.https.HttpsError('internal', `Places search failed: ${json.status} ${json.error_message || ''}`);
        }

        // Transform results to match client expectations
        const places = (json.results || []).slice(0, 10).map((place: any, index: number) => ({
            id: `place-${place.place_id}`,
            name: place.name,
            location: {
                lat: place.geometry.location.lat,
                lng: place.geometry.location.lng
            },
            type: categorizePlace(place.types),
            icon: getPlaceIcon(place.types),
            address: place.vicinity,
            rating: place.rating,
            isOpen: place.opening_hours?.open_now
        }));

        console.log(`🔌 [searchPlaces] Successfully returned ${places.length} places to client`);
        return { places };
    } catch (error: any) {
        console.error('🔌 [searchPlaces] Runtime error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to search places.');
    }
});

// Helper: Categorize place types
function categorizePlace(types: string[]): string {
    if (types.includes('gas_station')) return 'gas';
    if (types.includes('cafe') || types.includes('coffee')) return 'coffee';
    if (types.includes('restaurant') || types.includes('food')) return 'food';
    if (types.includes('grocery_or_supermarket')) return 'grocery';
    return 'other';
}

// Helper: Get emoji icon for place type
function getPlaceIcon(types: string[]): string {
    if (types.includes('gas_station')) return '⛽';
    if (types.includes('cafe') || types.includes('coffee')) return '☕';
    if (types.includes('restaurant')) return '🍽️';
    if (types.includes('fast_food')) return '🍔';
    if (types.includes('grocery_or_supermarket')) return '🛒';
    if (types.includes('hospital') || types.includes('pharmacy')) return '🏥';
    if (types.includes('school')) return '🏫';
    if (types.includes('park')) return '🌳';
    return '📍';
}

// Geocoding proxy (for address lookup)
export const geocodeAddress = functions.https.onCall(async (data, context) => {
    const { address } = data;

    if (!address || typeof address !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Address is required.');
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || functions.config().google?.maps_api_key;

    if (!apiKey) {
        throw new functions.https.HttpsError('internal', 'API configuration error.');
    }

    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
        const response = await fetch(url);
        const json = await response.json();

        if (json.status !== 'OK') {
            return { location: null };
        }

        const result = json.results[0];
        return {
            location: {
                lat: result.geometry.location.lat,
                lng: result.geometry.location.lng
            },
            formattedAddress: result.formatted_address
        };
    } catch (error) {
        console.error('geocodeAddress error:', error);
        throw new functions.https.HttpsError('internal', 'Geocoding failed.');
    }
});

// Google Routes API proxy. Keeps the traffic-enabled Maps key server-side and
// returns only the route data needed by the MyWay navigation client.
export const computeTrafficRoutes = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in is required for live traffic routing.');
    }
    const { origin, destination, alternatives = true } = data || {};
    const validLocation = (value: any) =>
        value && typeof value.lat === 'number' && typeof value.lng === 'number' &&
        Number.isFinite(value.lat) && Number.isFinite(value.lng);

    if (!validLocation(origin) || !validLocation(destination)) {
        throw new functions.https.HttpsError('invalid-argument', 'Origin and destination coordinates are required.');
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || functions.config().google?.maps_api_key;
    if (!apiKey) {
        throw new functions.https.HttpsError('failed-precondition', 'Google Maps routing is not configured.');
    }

    try {
        const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': [
                    'routes.duration',
                    'routes.staticDuration',
                    'routes.distanceMeters',
                    'routes.polyline.encodedPolyline',
                    'routes.travelAdvisory.speedReadingIntervals',
                    'routes.legs.steps.distanceMeters',
                    'routes.legs.steps.staticDuration',
                    'routes.legs.steps.navigationInstruction',
                    'routes.legs.steps.polyline.encodedPolyline'
                ].join(',')
            },
            body: JSON.stringify({
                origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
                destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
                travelMode: 'DRIVE',
                routingPreference: 'TRAFFIC_AWARE',
                computeAlternativeRoutes: Boolean(alternatives),
                extraComputations: ['TRAFFIC_ON_POLYLINE'],
                polylineQuality: 'HIGH_QUALITY',
                languageCode: 'en-US',
                units: 'IMPERIAL'
            }),
            signal: AbortSignal.timeout(8000)
        });

        const json = await response.json();
        if (!response.ok || !Array.isArray(json.routes)) {
            console.error('[computeTrafficRoutes] Google Routes error:', response.status, json?.error?.message || json);
            throw new functions.https.HttpsError('unavailable', json?.error?.message || 'Live traffic routing is unavailable.');
        }

        return { routes: json.routes, provider: 'google_routes', generatedAt: Date.now() };
    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.error('[computeTrafficRoutes] Request failed:', error?.message || error);
        throw new functions.https.HttpsError('unavailable', 'Live traffic routing is temporarily unavailable.');
    }
});

// ==========================================
// FCM Push Notification for Geofence Alerts
// ==========================================
/**
 * Sends push notifications to family circle members when geofence events occur.
 * Called from the client when a transition is detected.
 */
export const sendGeofenceAlert = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { circleId, memberId, memberName, geofenceName, eventType, location } = data;

    if (!circleId || !memberId || !geofenceName || !eventType) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields.');
    }

    try {
        // Circles created by the app store members as a UID array. Older
        // circles may use an object map, so normalize both shapes before
        // resolving device tokens.
        const circleSnapshot = await admin.database().ref(`circles/${circleId}`).once('value');
        if (!circleSnapshot.exists()) {
            return { sent: 0 };
        }

        const circle = circleSnapshot.val() || {};
        const members: string[] = Array.isArray(circle.members)
            ? circle.members.filter((member: unknown): member is string => typeof member === 'string')
            : Object.entries(circle.members || {})
                .map(([uid, value]) => typeof value === 'string' ? value : (value ? uid : null))
                .filter((uid): uid is string => typeof uid === 'string');

        if (!members.includes(context.auth.uid) || context.auth.uid !== memberId) {
            throw new functions.https.HttpsError('permission-denied', 'Only the reporting circle member can send this alert.');
        }

        const memberTokens: string[] = [];
        for (const uid of members) {
            if (uid === memberId) continue; // Don't notify the person who triggered

            memberTokens.push(...await getUserPushTokens(uid));
        }

        const uniqueMemberTokens = Array.from(new Set(memberTokens));
        if (uniqueMemberTokens.length === 0) {
            return { sent: 0 };
        }

        // Build notification
        const isArrival = eventType === 'entered';
        const title = isArrival
            ? `📍 ${memberName} arrived at ${geofenceName}`
            : `🚗 ${memberName} left ${geofenceName}`;
        const body = isArrival
            ? `${memberName} just arrived at ${geofenceName}.`
            : `${memberName} just departed from ${geofenceName}.`;

        const message: admin.messaging.MulticastMessage = {
            tokens: uniqueMemberTokens,
            notification: { title, body },
            data: {
                type: isArrival ? 'geofence_enter' : 'geofence_exit',
                memberId,
                memberName,
                circleId,
                geofenceName,
                lat: location?.lat?.toString() || '',
                lng: location?.lng?.toString() || '',
                timestamp: Date.now().toString()
            },
            android: {
                priority: 'high',
                notification: {
                    icon: 'ic_stat_myway',
                    channelId: 'myway_safety_v2',
                    color: '#6366f1',
                    sound: 'myway_arrival_chime'
                }
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1
                    }
                }
            }
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`[FCM] Sent ${response.successCount}/${uniqueMemberTokens.length} notifications for ${eventType} at ${geofenceName}`);

        return { sent: response.successCount, failed: response.failureCount };
    } catch (error: any) {
        console.error('sendGeofenceAlert error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to send notification.');
    }
});

// ==========================================
// FCM Push Notification for SOS / Crash Events
// ==========================================
/**
 * Delivers an attention signal only. The persistent RTDB safety event remains
 * the source of truth, so a missed notification never hides an SOS.
 */
export const sendSosAlert = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    }

    const { circleId, memberName, eventType } = data || {};
    if (!circleId || !['sos', 'crash'].includes(eventType)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid safety alert.');
    }

    const circleSnapshot = await admin.database().ref(`circles/${circleId}`).once('value');
    if (!circleSnapshot.exists()) {
        throw new functions.https.HttpsError('not-found', 'Circle not found.');
    }

    const circle = circleSnapshot.val() || {};
    const members: string[] = Array.isArray(circle.members)
        ? circle.members.filter((member: unknown): member is string => typeof member === 'string')
        : Object.entries(circle.members || {})
            .map(([uid, value]) => typeof value === 'string' ? value : (value ? uid : null))
            .filter((uid): uid is string => typeof uid === 'string');

    if (!members.includes(context.auth.uid)) {
        throw new functions.https.HttpsError('permission-denied', 'Only circle members can notify this circle.');
    }

    const tokens = Array.from(new Set((await Promise.all(members
        .filter(uid => uid !== context.auth!.uid)
        .map(uid => getUserPushTokens(uid))
    )).flat()));

    if (tokens.length === 0) return { sent: 0 };

    const isCrash = eventType === 'crash';
    const safeName = typeof memberName === 'string' && memberName.trim() ? memberName.trim().slice(0, 80) : 'A circle member';
    const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
            title: isCrash ? `🚨 Possible crash: ${safeName}` : `🚨 SOS from ${safeName}`,
            body: 'Open My Way to view the current safety event and location freshness.'
        },
        data: {
            type: 'sos',
            circleId: String(circleId),
            memberId: context.auth.uid,
            eventType,
            timestamp: Date.now().toString()
        },
        android: {
            priority: 'high',
            notification: { channelId: 'myway_safety', icon: 'ic_stat_myway', color: '#6366f1' }
        },
        apns: { payload: { aps: { sound: 'default' } } }
    });
    return { sent: response.successCount, failed: response.failureCount };
});
