"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeDeletedUserContact = exports.getCircleContacts = exports.saveContactPreferences = exports.sendSosAlert = exports.sendGeofenceAlert = exports.computeTrafficRoutes = exports.geocodeAddress = exports.searchPlaces = exports.callGeminiAIv2 = exports.callGeminiAI = exports.getNationalAddressPoints = exports.assignAdminRole = exports.listMapReviewHistory = exports.listPendingDestinationAccessPoints = exports.assertCanDeleteMyWayAccount = exports.getAdminDeletionProtection = exports.getMapReviewAccess = exports.finalizeAdminCommunityPhoto = exports.withdrawCommunityPhoto = exports.moderateDestinationAccessPoint = exports.getAmbientEmergencyPois = exports.submitDestinationAccessPoint = exports.deleteCircleSafely = exports.leaveCircleSafely = exports.joinCircleSafely = exports.removeCircleSponsorship = exports.getCircleSubscriptionEntitlement = exports.sponsorCircleSubscription = exports.syncCircleMembership = exports.revokeAllDeviceSessions = exports.revokeTrustedDevice = exports.backgroundLocationUpdate = exports.createBackgroundTrackingCredential = exports.updateTrustedDevicePushToken = exports.claimLocationSharingDevice = exports.registerTrustedDevice = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const generative_ai_1 = require("@google/generative-ai");
const crypto_1 = require("crypto");
admin.initializeApp();
const hashBackgroundTrackingToken = (token) => (0, crypto_1.createHash)('sha256').update(token).digest('hex');
const isCircleMember = (circle, uid) => {
    const members = circle === null || circle === void 0 ? void 0 : circle.members;
    if (Array.isArray(members))
        return members.includes(uid);
    return Boolean(members && typeof members === 'object' && (members[uid] === true || members[uid] === uid));
};
const cleanDeviceId = (value) => {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid device identifier is required.');
    }
    return id;
};
const cleanDeviceLabel = (value) => {
    const label = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    return (label || 'My Way device').slice(0, 60);
};
const sendNewDeviceAlert = async (tokens, label) => {
    const uniqueTokens = Array.from(new Set(tokens.filter(token => typeof token === 'string' && token.length > 20))).slice(0, 500);
    if (uniqueTokens.length === 0)
        return;
    try {
        await admin.messaging().sendEachForMulticast({
            tokens: uniqueTokens,
            notification: {
                title: 'New My Way sign-in',
                body: `${label} signed in to your account.`
            },
            data: { type: 'new_device_sign_in' },
            android: { notification: { channelId: 'myway_safety_v2', icon: 'ic_stat_myway', color: '#6366f1' } }
        });
    }
    catch (error) {
        // Device registration must still succeed when notifications are unavailable.
        console.warn('New-device notification failed:', error);
    }
};
/** Includes every trusted-device token while retaining the legacy profile token. */
const getUserPushTokens = async (uid) => {
    const root = admin.database().ref();
    const [legacyTokenSnapshot, devicesSnapshot] = await Promise.all([
        root.child(`users/${uid}/fcmToken`).once('value'),
        root.child(`userDevices/${uid}`).once('value')
    ]);
    const devices = (devicesSnapshot.val() || {});
    return Array.from(new Set([
        legacyTokenSnapshot.val(),
        ...Object.values(devices).map(device => device === null || device === void 0 ? void 0 : device.fcmToken)
    ].filter((token) => typeof token === 'string' && token.length > 20)));
};
/**
 * Registers a trusted My Way device without replacing the account's current
 * GPS publisher. The first registered device becomes the publisher.
 */
exports.registerTrustedDevice = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const deviceId = cleanDeviceId(data === null || data === void 0 ? void 0 : data.deviceId);
    const label = cleanDeviceLabel(data === null || data === void 0 ? void 0 : data.label);
    const platform = cleanDeviceLabel((data === null || data === void 0 ? void 0 : data.platform) || 'unknown').toLowerCase();
    const now = Date.now();
    const root = admin.database().ref();
    const devicesSnapshot = await root.child(`userDevices/${uid}`).once('value');
    const devices = (devicesSnapshot.val() || {});
    const previous = devices[deviceId];
    const profileSnapshot = await root.child(`users/${uid}/activeLocationDeviceId`).once('value');
    const storedActiveDeviceId = typeof profileSnapshot.val() === 'string' && profileSnapshot.val()
        ? profileSnapshot.val()
        : '';
    const activeDevice = storedActiveDeviceId ? devices[storedActiveDeviceId] : null;
    const isMobile = platform === 'android' || platform === 'ios';
    // A desktop is deliberately view-only. If a phone arrives after a desktop
    // session, make the phone the account's live-location publisher automatically.
    const activeLocationDeviceId = isMobile && (!storedActiveDeviceId || (activeDevice === null || activeDevice === void 0 ? void 0 : activeDevice.platform) === 'web')
        ? deviceId
        : storedActiveDeviceId;
    const updates = {
        [`userDevices/${uid}/${deviceId}/label`]: label,
        [`userDevices/${uid}/${deviceId}/platform`]: platform,
        [`userDevices/${uid}/${deviceId}/createdAt`]: (previous === null || previous === void 0 ? void 0 : previous.createdAt) || now,
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
            .map(([, device]) => (device === null || device === void 0 ? void 0 : device.fcmToken) || '');
        await sendNewDeviceAlert(existingTokens, label);
    }
    return { activeLocationDeviceId };
});
/** Claims the sole live-location publisher role for the device making this call. */
exports.claimLocationSharingDevice = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const deviceId = cleanDeviceId(data === null || data === void 0 ? void 0 : data.deviceId);
    const root = admin.database().ref();
    const deviceSnapshot = await root.child(`userDevices/${uid}/${deviceId}`).once('value');
    if (!deviceSnapshot.exists() || ((_a = deviceSnapshot.val()) === null || _a === void 0 ? void 0 : _a.revokedAt)) {
        throw new functions.https.HttpsError('failed-precondition', 'This device must sign in again before it can share location.');
    }
    const previousSnapshot = await root.child(`users/${uid}/activeLocationDeviceId`).once('value');
    const previousDeviceId = typeof previousSnapshot.val() === 'string' ? previousSnapshot.val() : '';
    const updates = {
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
exports.updateTrustedDevicePushToken = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const deviceId = cleanDeviceId(data === null || data === void 0 ? void 0 : data.deviceId);
    const token = typeof (data === null || data === void 0 ? void 0 : data.token) === 'string' ? data.token.trim() : '';
    if (token.length < 20 || token.length > 4096) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid push token is required.');
    }
    await admin.database().ref().update({
        [`userDevices/${uid}/${deviceId}/fcmToken`]: token,
        [`userDevices/${uid}/${deviceId}/lastActiveAt`]: Date.now()
    });
    return { success: true };
});
/**
 * Issues a scoped credential for the Android foreground location service.
 * The service outlives Capacitor's WebView, so it cannot rely on a short-lived
 * browser Firebase session. This token is limited to one trusted GPS device and
 * expires after 30 days (or immediately when that device is revoked).
 */
exports.createBackgroundTrackingCredential = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const deviceId = cleanDeviceId(data === null || data === void 0 ? void 0 : data.deviceId);
    const root = admin.database().ref();
    const deviceSnapshot = await root.child(`userDevices/${uid}/${deviceId}`).once('value');
    const device = deviceSnapshot.val();
    const activeDeviceId = (await root.child(`users/${uid}/activeLocationDeviceId`).once('value')).val();
    if (!device || device.revokedAt || device.platform !== 'android' || activeDeviceId !== deviceId) {
        throw new functions.https.HttpsError('permission-denied', 'Only this account’s active Android location device can enable background tracking.');
    }
    const token = (0, crypto_1.randomBytes)(32).toString('base64url');
    const now = Date.now();
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000;
    const record = { tokenHash: hashBackgroundTrackingToken(token), createdAt: now, expiresAt };
    await root.child(`backgroundTrackingCredentials/${uid}/${deviceId}`).set(record);
    return { token, expiresAt };
});
/** Receives a foreground-service location update after the Android UI is closed. */
exports.backgroundLocationUpdate = functions.https.onRequest(async (request, response) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
        response.status(204).send('');
        return;
    }
    if (request.method !== 'POST') {
        response.status(405).json({ error: 'method-not-allowed' });
        return;
    }
    try {
        const body = request.body || {};
        const uid = typeof body.uid === 'string' ? body.uid : '';
        const deviceId = cleanDeviceId(body.deviceId);
        const token = typeof body.token === 'string' ? body.token : '';
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        if (!uid || token.length < 32 || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            response.status(400).json({ error: 'invalid-location-update' });
            return;
        }
        const root = admin.database().ref();
        const [credentialSnapshot, deviceSnapshot, activeDeviceSnapshot] = await Promise.all([
            root.child(`backgroundTrackingCredentials/${uid}/${deviceId}`).once('value'),
            root.child(`userDevices/${uid}/${deviceId}`).once('value'),
            root.child(`users/${uid}/activeLocationDeviceId`).once('value')
        ]);
        const credential = credentialSnapshot.val();
        const device = deviceSnapshot.val();
        const suppliedHash = hashBackgroundTrackingToken(token);
        const hashesMatch = Boolean(credential === null || credential === void 0 ? void 0 : credential.tokenHash) && credential.tokenHash.length === suppliedHash.length && (0, crypto_1.timingSafeEqual)(Buffer.from(credential.tokenHash), Buffer.from(suppliedHash));
        if (!credential || credential.expiresAt <= Date.now() || !hashesMatch || !device || device.revokedAt || activeDeviceSnapshot.val() !== deviceId) {
            response.status(401).json({ error: 'tracking-credential-expired' });
            return;
        }
        const requestedCircles = Array.isArray(body.circles) ? body.circles.slice(0, 12) : [];
        const circles = requestedCircles.filter((circle) => typeof (circle === null || circle === void 0 ? void 0 : circle.id) === 'string' && /^[A-Za-z0-9_-]{3,128}$/.test(circle.id));
        const now = Date.now();
        const updates = {
            [`userDevices/${uid}/${deviceId}/lastActiveAt`]: now
        };
        for (const circleConfig of circles) {
            const circleSnapshot = await root.child(`circles/${circleConfig.id}`).once('value');
            if (!isCircleMember(circleSnapshot.val(), uid))
                continue;
            const privacyMode = circleConfig.privacyMode === 'invisible' || circleConfig.privacyMode === 'blurred'
                ? circleConfig.privacyMode
                : 'exact';
            const accuracy = Math.max(0, Math.min(10000, Number(body.accuracy) || 0));
            const speedMph = Math.max(0, Math.min(200, Number(body.speedMph) || 0));
            let storedLat = lat;
            let storedLng = lng;
            if (privacyMode === 'invisible') {
                updates[`locations/${circleConfig.id}/${uid}`] = {
                    lat: 0, lng: 0, speed: 0, heading: 0, accuracy, timestamp: now,
                    status: 'Invisible', privacyMode: 'invisible', isSharingLocation: false, locationSharing: false
                };
                continue;
            }
            if (privacyMode === 'blurred') {
                // Approximate a stable neighbourhood centre. Raw GPS is never written to RTDB for blurred sharing.
                storedLat = Math.round(lat / 0.022) * 0.022;
                storedLng = Math.round(lng / 0.027) * 0.027;
            }
            updates[`locations/${circleConfig.id}/${uid}`] = {
                lat: storedLat,
                lng: storedLng,
                speed: privacyMode === 'exact' ? speedMph : 0,
                heading: privacyMode === 'exact' ? Number(body.heading) || 0 : 0,
                accuracy: privacyMode === 'blurred' ? 2400 : accuracy,
                timestamp: now,
                battery: Math.max(0, Math.min(100, Number(body.battery) || 100)),
                signalQuality: typeof body.signalQuality === 'string' ? body.signalQuality.slice(0, 20) : 'native',
                status: speedMph >= 15 ? 'Driving' : speedMph >= 1 ? 'Moving' : 'Stationary',
                privacyMode,
                blurredRadiusMeters: privacyMode === 'blurred' ? 2400 : null,
                displayName: typeof body.displayName === 'string' ? body.displayName.slice(0, 80) : 'You',
                photoURL: typeof body.photoURL === 'string' ? body.photoURL.slice(0, 2048) : null,
                role: typeof body.role === 'string' ? body.role.slice(0, 40) : 'Member',
                isSharingLocation: true,
                locationSharing: true,
                backgroundTracking: true
            };
        }
        await root.update(updates);
        response.status(200).json({ ok: true, timestamp: now });
    }
    catch (error) {
        console.error('backgroundLocationUpdate failed:', error);
        response.status(500).json({ error: 'background-location-update-failed' });
    }
});
exports.revokeTrustedDevice = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const deviceId = cleanDeviceId(data === null || data === void 0 ? void 0 : data.deviceId);
    const root = admin.database().ref();
    const updates = {
        [`userDevices/${uid}/${deviceId}/revokedAt`]: Date.now(),
        [`userDevices/${uid}/${deviceId}/isLocationPublisher`]: false
    };
    const activeSnapshot = await root.child(`users/${uid}/activeLocationDeviceId`).once('value');
    if (activeSnapshot.val() === deviceId)
        updates[`users/${uid}/activeLocationDeviceId`] = null;
    await root.update(updates);
    return { success: true };
});
/** Signs out every known app session and revokes Firebase refresh tokens. */
exports.revokeAllDeviceSessions = functions.https.onCall(async (_data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const now = Date.now();
    const root = admin.database().ref();
    const devicesSnapshot = await root.child(`userDevices/${uid}`).once('value');
    const devices = (devicesSnapshot.val() || {});
    const updates = {
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
 * Firestore membership document retained for legacy clients.
 */
exports.syncCircleMembership = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    }
    const circleId = typeof (data === null || data === void 0 ? void 0 : data.circleId) === 'string' ? data.circleId.trim() : '';
    const requestedUserId = typeof (data === null || data === void 0 ? void 0 : data.userId) === 'string' ? data.userId.trim() : context.auth.uid;
    if (!circleId || !requestedUserId) {
        throw new functions.https.HttpsError('invalid-argument', 'A Circle and member are required.');
    }
    const circleSnapshot = await admin.database().ref(`circles/${circleId}`).once('value');
    const circle = circleSnapshot.val();
    const memberIds = new Set([
        ...(Array.isArray(circle === null || circle === void 0 ? void 0 : circle.members) ? circle.members.filter((id) => typeof id === 'string') : []),
        ...Object.entries((circle === null || circle === void 0 ? void 0 : circle.memberIds) || {}).filter(([, active]) => active === true).map(([id]) => id)
    ]);
    const callerIsOwner = (circle === null || circle === void 0 ? void 0 : circle.ownerId) === context.auth.uid;
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
const cleanCircleId = (value) => {
    const circleId = typeof value === 'string' ? value.trim() : '';
    if (!/^circle_[A-Za-z0-9_-]{8,160}$/.test(circleId)) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid Circle is required.');
    }
    return circleId;
};
const getActiveCircleMembers = (circle) => Array.from(new Set(Array.isArray(circle === null || circle === void 0 ? void 0 : circle.members) ? circle.members.filter((member) => typeof member === 'string' && member.trim().length > 0) : []));
const isActiveSubscription = (subscription) => subscription.status === 'active' || subscription.status === 'trialing';
const priceIdsFromSubscription = (subscription) => {
    var _a;
    const values = new Set();
    const add = (value) => {
        if (typeof value === 'string' && value.trim())
            values.add(value.trim());
        if (value && typeof value === 'object' && typeof value.id === 'string')
            values.add(value.id.trim());
    };
    add(subscription.price);
    add(subscription.priceId);
    const items = Array.isArray(subscription.items) ? subscription.items : (_a = subscription.items) === null || _a === void 0 ? void 0 : _a.data;
    if (Array.isArray(items))
        items.forEach((item) => add(item === null || item === void 0 ? void 0 : item.price));
    return Array.from(values);
};
const tierFromSubscription = (subscription) => {
    var _a, _b;
    if (!isActiveSubscription(subscription))
        return null;
    const configured = functions.config().subscriptions || {};
    const configuredGold = String(configured.gold_price_ids || '').split(',').map(id => id.trim()).filter(Boolean);
    const configuredPlatinum = String(configured.platinum_price_ids || '').split(',').map(id => id.trim()).filter(Boolean);
    const priceIds = priceIdsFromSubscription(subscription);
    if (priceIds.some(id => configuredPlatinum.includes(id) || /^price_platinum_(monthly|annual)$/.test(id)))
        return 'platinum';
    if (priceIds.some(id => configuredGold.includes(id) || /^price_gold_(monthly|annual)$/.test(id)))
        return 'gold';
    const metadataTier = String(((_a = subscription.metadata) === null || _a === void 0 ? void 0 : _a.mywayTier) || ((_b = subscription.metadata) === null || _b === void 0 ? void 0 : _b.tier) || '').toLowerCase();
    return metadataTier === 'platinum' || metadataTier === 'gold' ? metadataTier : null;
};
const getVerifiedSubscription = async (uid) => {
    const subscriptions = await admin.firestore().collection(`customers/${uid}/subscriptions`).get();
    let best = null;
    subscriptions.forEach(document => {
        const tier = tierFromSubscription(document.data());
        if (tier === 'platinum' || (tier === 'gold' && !best))
            best = { tier, subscriptionId: document.id };
    });
    return best;
};
const memberLimitForTier = (tier) => tier === 'gold' ? 5 : null;
const validCircleSponsorship = async (circle) => {
    const sponsorship = circle === null || circle === void 0 ? void 0 : circle.sponsorship;
    if (!(sponsorship === null || sponsorship === void 0 ? void 0 : sponsorship.sponsorId) || (sponsorship.tier !== 'gold' && sponsorship.tier !== 'platinum'))
        return null;
    const verified = await getVerifiedSubscription(sponsorship.sponsorId);
    if (!verified || verified.tier !== sponsorship.tier || verified.subscriptionId !== sponsorship.subscriptionId)
        return null;
    return sponsorship;
};
/** A paid member may sponsor one Circle. Billing stays personal; entitlements apply only to current members. */
exports.sponsorCircleSubscription = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const circleId = cleanCircleId(data === null || data === void 0 ? void 0 : data.circleId);
    const root = admin.database().ref();
    const circleSnapshot = await root.child(`circles/${circleId}`).once('value');
    const circle = circleSnapshot.val();
    if (!circle || !getActiveCircleMembers(circle).includes(uid)) {
        throw new functions.https.HttpsError('permission-denied', 'You must be a member of this Circle to sponsor it.');
    }
    const verified = await getVerifiedSubscription(uid);
    if (!verified) {
        throw new functions.https.HttpsError('failed-precondition', 'No active My Way Gold or Platinum subscription could be verified.');
    }
    const memberLimit = memberLimitForTier(verified.tier);
    const memberCount = getActiveCircleMembers(circle).length;
    if (memberLimit !== null && memberCount > memberLimit) {
        throw new functions.https.HttpsError('failed-precondition', `Gold supports up to ${memberLimit} Circle members.`);
    }
    const existingCircleId = (await root.child(`circle_sponsorships/${uid}`).once('value')).val();
    if (existingCircleId && existingCircleId !== circleId) {
        throw new functions.https.HttpsError('failed-precondition', 'Your subscription already sponsors another Circle. Remove sponsorship there first.');
    }
    const existing = await validCircleSponsorship(circle);
    if (existing && existing.sponsorId !== uid) {
        throw new functions.https.HttpsError('already-exists', 'This Circle already has an active sponsor.');
    }
    const sponsorship = { sponsorId: uid, tier: verified.tier, memberLimit, activatedAt: Date.now(), subscriptionId: verified.subscriptionId };
    await root.update({ [`circles/${circleId}/sponsorship`]: sponsorship, [`circle_sponsorships/${uid}`]: circleId });
    return Object.assign(Object.assign({}, sponsorship), { active: true, memberCount });
});
/** Resolves entitlement from the Stripe extension every time; stale sponsor records grant nothing. */
exports.getCircleSubscriptionEntitlement = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const circleId = cleanCircleId(data === null || data === void 0 ? void 0 : data.circleId);
    const root = admin.database().ref();
    const circleSnapshot = await root.child(`circles/${circleId}`).once('value');
    const circle = circleSnapshot.val();
    if (!circle || !getActiveCircleMembers(circle).includes(uid))
        throw new functions.https.HttpsError('permission-denied', 'You are not a member of this Circle.');
    const sponsorship = await validCircleSponsorship(circle);
    if (!sponsorship && circle.sponsorship) {
        const staleSponsorId = circle.sponsorship.sponsorId;
        await root.update(Object.assign({ [`circles/${circleId}/sponsorship`]: null }, (staleSponsorId ? { [`circle_sponsorships/${staleSponsorId}`]: null } : {})));
    }
    const personal = await getVerifiedSubscription(uid);
    return {
        active: Boolean(sponsorship),
        tier: (sponsorship === null || sponsorship === void 0 ? void 0 : sponsorship.tier) || 'free',
        sponsorId: (sponsorship === null || sponsorship === void 0 ? void 0 : sponsorship.sponsorId) || null,
        memberLimit: (_a = sponsorship === null || sponsorship === void 0 ? void 0 : sponsorship.memberLimit) !== null && _a !== void 0 ? _a : null,
        personalTier: (personal === null || personal === void 0 ? void 0 : personal.tier) || 'free',
        isSponsor: (sponsorship === null || sponsorship === void 0 ? void 0 : sponsorship.sponsorId) === uid,
        memberCount: getActiveCircleMembers(circle).length
    };
});
exports.removeCircleSponsorship = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const circleId = cleanCircleId(data === null || data === void 0 ? void 0 : data.circleId);
    const root = admin.database().ref();
    const circle = (await root.child(`circles/${circleId}`).once('value')).val();
    if (((_a = circle === null || circle === void 0 ? void 0 : circle.sponsorship) === null || _a === void 0 ? void 0 : _a.sponsorId) !== uid)
        throw new functions.https.HttpsError('permission-denied', 'Only the Circle sponsor can remove sponsorship.');
    await root.update({ [`circles/${circleId}/sponsorship`]: null, [`circle_sponsorships/${uid}`]: null });
    return { removed: true };
});
/** Joins by invite through trusted code so a sponsored Circle cannot exceed its paid member limit. */
exports.joinCircleSafely = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const inviteCode = typeof (data === null || data === void 0 ? void 0 : data.inviteCode) === 'string' ? data.inviteCode.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{6,16}$/.test(inviteCode))
        throw new functions.https.HttpsError('invalid-argument', 'A valid invite code is required.');
    const root = admin.database().ref();
    const circles = (await root.child('circles').once('value')).val() || {};
    const match = Object.entries(circles).find(([, value]) => (value === null || value === void 0 ? void 0 : value.inviteCode) === inviteCode);
    if (!match)
        throw new functions.https.HttpsError('not-found', 'Circle invite not found.');
    const [circleId, circle] = match;
    const members = getActiveCircleMembers(circle);
    if (!members.includes(uid)) {
        const sponsorship = await validCircleSponsorship(circle);
        const memberLimit = sponsorship === null || sponsorship === void 0 ? void 0 : sponsorship.memberLimit;
        if (memberLimit !== undefined && memberLimit !== null && members.length >= memberLimit) {
            throw new functions.https.HttpsError('resource-exhausted', `This Gold Circle is full (${memberLimit} members).`);
        }
        members.push(uid);
        await root.update({
            [`circles/${circleId}/members`]: members,
            [`users/${uid}/familyCircleId`]: circleId
        });
        await admin.firestore().doc(`circleMemberships/${circleId}/members/${uid}`).set({
            circleId, userId: uid, updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
    return Object.assign(Object.assign({ id: circleId }, circle), { members });
});
/**
 * Leaves a Circle without ever assigning ownership implicitly. An owner must
 * choose an existing member as successor, or delete the Circle if they are
 * its last member. All access artifacts for the departing member are revoked.
 */
exports.leaveCircleSafely = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const circleId = cleanCircleId(data === null || data === void 0 ? void 0 : data.circleId);
    const nextCircleId = typeof (data === null || data === void 0 ? void 0 : data.nextCircleId) === 'string' ? data.nextCircleId.trim() : null;
    const successorId = typeof (data === null || data === void 0 ? void 0 : data.successorId) === 'string' ? data.successorId.trim() : '';
    const root = admin.database().ref();
    const snapshot = await root.child(`circles/${circleId}`).once('value');
    const circle = snapshot.val();
    if (!circle)
        throw new functions.https.HttpsError('not-found', 'Circle not found.');
    const members = getActiveCircleMembers(circle);
    if (!members.includes(uid))
        throw new functions.https.HttpsError('permission-denied', 'You are not a member of this Circle.');
    const remainingMembers = members.filter(member => member !== uid);
    const contactPreferences = (await root.child(`privateContactPreferences/${uid}`).once('value')).val();
    if (circle.ownerId === uid && remainingMembers.length > 0 && !remainingMembers.includes(successorId)) {
        throw new functions.https.HttpsError('failed-precondition', 'Choose an existing member to take ownership before leaving.');
    }
    const updates = {
        [`locations/${circleId}/${uid}`]: null,
        [`keys/${circleId}/${uid}`]: null,
        [`users/${uid}/familyCircleId`]: nextCircleId || null,
    };
    if (Array.isArray(contactPreferences === null || contactPreferences === void 0 ? void 0 : contactPreferences.circleIds)) {
        updates[`privateContactPreferences/${uid}/circleIds`] = contactPreferences.circleIds.filter((id) => id !== circleId);
    }
    if (((_a = circle.sponsorship) === null || _a === void 0 ? void 0 : _a.sponsorId) === uid) {
        updates[`circles/${circleId}/sponsorship`] = null;
        updates[`circle_sponsorships/${uid}`] = null;
    }
    if (remainingMembers.length === 0) {
        updates[`circles/${circleId}`] = null;
        updates[`locations/${circleId}`] = null;
        updates[`keys/${circleId}`] = null;
        updates[`geofences/${circleId}`] = null;
        updates[`places/${circleId}`] = null;
        updates[`circle_tombstones/${circleId}`] = { deletedAt: Date.now(), deletedBy: uid, reason: 'last_member_left' };
    }
    else {
        updates[`circles/${circleId}/members`] = remainingMembers;
        if (circle.ownerId === uid)
            updates[`circles/${circleId}/ownerId`] = successorId;
    }
    await Promise.all([
        root.update(updates),
        admin.firestore().doc(`circleMemberships/${circleId}/members/${uid}`).delete()
    ]);
    return { deleted: remainingMembers.length === 0, ownerId: remainingMembers.length === 0 ? null : (circle.ownerId === uid ? successorId : circle.ownerId) };
});
/** Deletes a Circle only when requested by its owner and clears every member's active-circle reference. */
exports.deleteCircleSafely = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const uid = context.auth.uid;
    const circleId = cleanCircleId(data === null || data === void 0 ? void 0 : data.circleId);
    const root = admin.database().ref();
    const snapshot = await root.child(`circles/${circleId}`).once('value');
    const circle = snapshot.val();
    if (!circle)
        return { deleted: true, memberCount: 0 };
    if (circle.ownerId !== uid)
        throw new functions.https.HttpsError('permission-denied', 'Only the Circle owner can delete this Circle.');
    const members = getActiveCircleMembers(circle);
    const updates = {
        [`circles/${circleId}`]: null,
        [`locations/${circleId}`]: null,
        [`keys/${circleId}`]: null,
        [`geofences/${circleId}`]: null,
        [`places/${circleId}`]: null,
        [`circle_tombstones/${circleId}`]: { deletedAt: Date.now(), deletedBy: uid, memberCount: members.length, reason: 'owner_deleted' }
    };
    if ((_a = circle.sponsorship) === null || _a === void 0 ? void 0 : _a.sponsorId)
        updates[`circle_sponsorships/${circle.sponsorship.sponsorId}`] = null;
    await Promise.all(members.map(async (memberId) => {
        const [profileSnapshot, preferencesSnapshot] = await Promise.all([
            root.child(`users/${memberId}`).once('value'),
            root.child(`privateContactPreferences/${memberId}`).once('value')
        ]);
        const profile = profileSnapshot.val();
        const contactPreferences = preferencesSnapshot.val();
        if ((profile === null || profile === void 0 ? void 0 : profile.familyCircleId) === circleId)
            updates[`users/${memberId}/familyCircleId`] = null;
        if (Array.isArray(contactPreferences === null || contactPreferences === void 0 ? void 0 : contactPreferences.circleIds)) {
            updates[`privateContactPreferences/${memberId}/circleIds`] = contactPreferences.circleIds
                .filter((id) => id !== circleId);
        }
    }));
    await root.update(updates);
    await Promise.all(members.map(memberId => admin.firestore().doc(`circleMemberships/${circleId}/members/${memberId}`).delete()));
    return { deleted: true, memberCount: members.length };
});
const ACCESS_POINT_TYPES = new Set([
    'main_entrance', 'curbside', 'auto_care', 'pharmacy_drive_thru',
    'emergency_dropoff', 'contractor_lumber', 'drive_thru', 'parking'
]);
const ENTRANCE_TYPES = new Set(['main_door', 'curbside', 'drive_thru', 'parking', 'driveway', 'front_door']);
const cleanCommunityKey = (value) => {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!/^[a-z0-9_]{8,220}$/.test(key)) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid place key is required.');
    }
    return key;
};
const cleanCoordinate = (value, min, max, label) => {
    const coordinate = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
        throw new functions.https.HttpsError('invalid-argument', `A valid ${label} is required.`);
    }
    return coordinate;
};
const cleanCommunityText = (value, maxLength) => {
    if (typeof value !== 'string')
        return undefined;
    const clean = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    return clean || undefined;
};
/**
 * Stores an authenticated driver's contribution as pending. The record is not
 * added to live navigation data until an admin approves it.
 */
exports.submitDestinationAccessPoint = functions.https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const key = cleanCommunityKey(data === null || data === void 0 ? void 0 : data.normalizedKey);
    const raw = (data === null || data === void 0 ? void 0 : data.accessPoint) || {};
    const type = typeof raw.type === 'string' && ACCESS_POINT_TYPES.has(raw.type) ? raw.type : '';
    const entranceType = typeof raw.entranceType === 'string' && ENTRANCE_TYPES.has(raw.entranceType)
        ? raw.entranceType
        : '';
    const lat = cleanCoordinate((_a = raw.location) === null || _a === void 0 ? void 0 : _a.lat, -90, 90, 'latitude');
    const lng = cleanCoordinate((_b = raw.location) === null || _b === void 0 ? void 0 : _b.lng, -180, 180, 'longitude');
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
    // Realtime Database rejects `undefined` values. Optional user-provided
    // metadata therefore has to be omitted rather than assigned undefined.
    const placeId = cleanCommunityText(raw.placeId, 160);
    const placeName = cleanCommunityText(raw.placeName, 120);
    const placeLocation = (raw.placeLocation && typeof raw.placeLocation.lat === 'number' && typeof raw.placeLocation.lng === 'number')
        ? { lat: raw.placeLocation.lat, lng: raw.placeLocation.lng }
        : undefined;
    const notes = cleanCommunityText(raw.notes, 300);
    const imageUrl = cleanCommunityText(raw.imageUrl, 2000);
    const submission = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ id: accessPointId }, (placeId ? { placeId } : {})), (placeName ? { placeName } : {})), (placeLocation ? { placeLocation } : {})), { name,
        type, location: { lat, lng }, entranceType }), (notes ? { notes } : {})), (imageUrl ? { imageUrl } : {})), { source: 'community', confidence: 'medium', verifiedCount: 1, status: 'pending', submittedBy: context.auth.uid, submittedAt: now, updatedAt: now });
    await submissionRef.set(submission);
    // Operations admins are trusted publishers. Keep an explicit audit trail
    // instead of making them review their own navigation change.
    if (isCallerAdmin(context)) {
        const approvedPoint = Object.assign(Object.assign({}, submission), { status: 'approved', confidence: 'high', approvedAt: now, approvedBy: context.auth.uid, approvalReason: 'admin_self_submission' });
        await admin.database().ref(`destination_access_points/${key}/${accessPointId}`).set(approvedPoint);
        await submissionRef.update({
            status: 'approved',
            moderatedAt: now,
            moderatedBy: context.auth.uid,
            moderationReason: 'admin_self_submission'
        });
        return { id: accessPointId, status: 'approved', verifiedCount: 1 };
    }
    // Community confirmations help the reviewer assess confidence, but shared
    // navigation data never publishes automatically. Operations is the gate.
    const candidateSnapshot = await candidateRef.once('value');
    const confirmations = Object.values(candidateSnapshot.val() || {})
        .filter((candidate) => (candidate === null || candidate === void 0 ? void 0 : candidate.status) === 'pending' || (candidate === null || candidate === void 0 ? void 0 : candidate.status) === 'approved');
    const independentUsers = new Set(confirmations.map((candidate) => candidate.submittedBy).filter(Boolean));
    return { id: accessPointId, status: 'pending', verifiedCount: independentUsers.size };
});
const ADMIN_UIDS = new Set([
    'UZEu0ZK82EZQPNuBwfnl6dA3iwr1' // TEST WATTZ / nexgensynapse@gmail.com
]);
const isCallerAdmin = (context) => {
    if (!context.auth)
        return false;
    if (context.auth.token.admin === true)
        return true;
    if (ADMIN_UIDS.has(context.auth.uid))
        return true;
    return false;
};
/**
 * Retrieves emergency landmarks for the current map viewport from a server
 * context. Browsers frequently block or rate-limit direct Overpass requests,
 * leaving the map with a partial, stale emergency layer.
 */
exports.getAmbientEmergencyPois = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const bounds = (data === null || data === void 0 ? void 0 : data.bounds) || {};
    const south = cleanCoordinate(bounds.south, -90, 90, 'south bound');
    const north = cleanCoordinate(bounds.north, -90, 90, 'north bound');
    const west = cleanCoordinate(bounds.west, -180, 180, 'west bound');
    const east = cleanCoordinate(bounds.east, -180, 180, 'east bound');
    if (south >= north || west >= east || north - south > 0.35 || east - west > 0.35) {
        throw new functions.https.HttpsError('invalid-argument', 'A reasonably sized map viewport is required.');
    }
    const s = south - 0.005;
    const w = west - 0.005;
    const n = north + 0.005;
    const e = east + 0.005;
    const query = `[out:json][timeout:12];(nwr["amenity"="fire_station"](${s},${w},${n},${e});nwr["amenity"="hospital"](${s},${w},${n},${e});nwr["emergency"="ambulance_station"](${s},${w},${n},${e});nwr["amenity"="police"](${s},${w},${n},${e}););out center 180;`;
    for (const endpoint of [
        'https://overpass-api.de/api/interpreter',
        'https://lz4.overpass-api.de/api/interpreter'
    ]) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                body: `data=${encodeURIComponent(query)}`
            });
            if (!response.ok)
                continue;
            const payload = await response.json();
            const pois = (payload.elements || []).map((element, index) => {
                var _a, _b, _c, _d;
                const tags = element.tags || {};
                const lat = (_a = element.lat) !== null && _a !== void 0 ? _a : (_b = element.center) === null || _b === void 0 ? void 0 : _b.lat;
                const lng = (_c = element.lon) !== null && _c !== void 0 ? _c : (_d = element.center) === null || _d === void 0 ? void 0 : _d.lon;
                if (!Number.isFinite(lat) || !Number.isFinite(lng))
                    return null;
                const amenity = tags.amenity || tags.emergency;
                const config = amenity === 'fire_station'
                    ? { type: 'fire_station', icon: '🚒', brandColor: '#ef4444', fallbackName: 'Fire Station' }
                    : amenity === 'hospital' || amenity === 'ambulance_station'
                        ? { type: 'hospital', icon: '🏥', brandColor: '#e11d48', fallbackName: 'Hospital' }
                        : amenity === 'police'
                            ? { type: 'police', icon: '🚓', brandColor: '#2563eb', fallbackName: 'Police Department' }
                            : null;
                if (!config || tags.disused === 'yes' || tags.abandoned === 'yes' || tags.closed === 'yes')
                    return null;
                return {
                    id: `ambient-osm-${element.type || 'poi'}-${element.id || index}`,
                    name: tags.name || tags.operator || config.fallbackName,
                    location: { lat, lng },
                    radius: 0.15,
                    type: config.type,
                    icon: config.icon,
                    brandColor: config.brandColor,
                    description: tags['addr:street'] || `${config.fallbackName} · Emergency service`,
                    isAmbient: true
                };
            }).filter(Boolean);
            return { pois };
        }
        catch (error) {
            console.warn('[getAmbientEmergencyPois] Overpass request failed', error);
        }
    }
    throw new functions.https.HttpsError('unavailable', 'Emergency place data is temporarily unavailable.');
});
const listAdminUids = async () => {
    // A bootstrap UID is only an administrator while that Auth account still
    // exists. Keeping a deleted UID here would otherwise look like a recovery
    // admin and could allow the last real operator to delete their account.
    const admins = new Set();
    await Promise.all([...ADMIN_UIDS].map(async (uid) => {
        try {
            await admin.auth().getUser(uid);
            admins.add(uid);
        }
        catch (error) {
            if ((error === null || error === void 0 ? void 0 : error.code) !== 'auth/user-not-found') {
                console.warn(`[Admin] Could not verify bootstrap admin ${uid}`, error);
            }
        }
    }));
    let pageToken;
    do {
        const page = await admin.auth().listUsers(1000, pageToken);
        page.users.forEach(user => {
            var _a;
            if (((_a = user.customClaims) === null || _a === void 0 ? void 0 : _a.admin) === true)
                admins.add(user.uid);
        });
        pageToken = page.pageToken;
    } while (pageToken);
    return [...admins];
};
/** Approves a pending contribution into the live, routable access-point dataset. */
exports.moderateDestinationAccessPoint = functions.https.onCall(async (data, context) => {
    var _a, _b;
    if (!isCallerAdmin(context)) {
        throw new functions.https.HttpsError('permission-denied', 'Administrator access is required.');
    }
    const moderatorUid = context.auth.uid;
    const kind = (data === null || data === void 0 ? void 0 : data.kind) === 'photo' ? 'photo' : 'access_point';
    if (kind === 'photo') {
        const photoId = typeof (data === null || data === void 0 ? void 0 : data.photoId) === 'string' ? data.photoId.trim() : '';
        const decision = (data === null || data === void 0 ? void 0 : data.decision) === 'approve' || (data === null || data === void 0 ? void 0 : data.decision) === 'reject' ? data.decision : '';
        if (!photoId || !decision) {
            throw new functions.https.HttpsError('invalid-argument', 'A photo and decision are required.');
        }
        const photoRef = admin.firestore().collection('photos').doc(photoId);
        const photoSnapshot = await photoRef.get();
        if (!photoSnapshot.exists || ((_a = photoSnapshot.data()) === null || _a === void 0 ? void 0 : _a.reviewStatus) !== 'pending') {
            throw new functions.https.HttpsError('not-found', 'Pending building photo not found.');
        }
        await photoRef.update({
            reviewStatus: decision === 'approve' ? 'approved' : 'rejected',
            reviewedAt: Date.now(),
            reviewedBy: moderatorUid
        });
        const contributorId = (_b = photoSnapshot.data()) === null || _b === void 0 ? void 0 : _b.userId;
        if (typeof contributorId === 'string' && contributorId) {
            const contributionSnapshot = await admin.firestore()
                .collection('users').doc(contributorId).collection('contributions')
                .where('tripId', '==', `photo_${photoId}`).get();
            await Promise.all(contributionSnapshot.docs.map(contribution => contribution.ref.update({
                reviewStatus: decision === 'approve' ? 'approved' : 'rejected',
                reviewedAt: Date.now()
            })));
        }
        return { id: photoId, status: decision === 'approve' ? 'approved' : 'rejected' };
    }
    const key = cleanCommunityKey(data === null || data === void 0 ? void 0 : data.normalizedKey);
    const accessPointId = typeof (data === null || data === void 0 ? void 0 : data.accessPointId) === 'string' ? data.accessPointId.trim() : '';
    const decision = (data === null || data === void 0 ? void 0 : data.decision) === 'approve' || (data === null || data === void 0 ? void 0 : data.decision) === 'reject' ? data.decision : '';
    if (!/^ap_[a-z0-9_]{8,180}$/i.test(accessPointId) || !decision) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid access-point decision is required.');
    }
    const submissionRef = admin.database().ref(`destination_access_point_submissions/${key}/${accessPointId}`);
    const snapshot = await submissionRef.once('value');
    const candidates = Object.values(snapshot.val() || {});
    const submission = candidates.find(candidate => (candidate === null || candidate === void 0 ? void 0 : candidate.status) === 'pending');
    if (!submission) {
        throw new functions.https.HttpsError('not-found', 'Pending access-point contribution not found.');
    }
    const now = Date.now();
    if (decision === 'approve') {
        await admin.database().ref(`destination_access_points/${key}/${accessPointId}`).set(Object.assign(Object.assign({}, submission), { status: 'approved', approvedAt: now, approvedBy: moderatorUid, updatedAt: now }));
    }
    await Promise.all(Object.keys(snapshot.val() || {}).map(uid => submissionRef.child(uid).update({
        status: decision === 'approve' ? 'approved' : 'rejected',
        moderatedAt: now,
        moderatedBy: moderatorUid
    })));
    return { id: accessPointId, status: decision === 'approve' ? 'approved' : 'rejected' };
});
/** Contributors may withdraw only their own building photo. Cleanup happens server-side to avoid Storage CORS failures. */
exports.withdrawCommunityPhoto = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const photoId = typeof (data === null || data === void 0 ? void 0 : data.photoId) === 'string' ? data.photoId.trim() : '';
    if (!photoId)
        throw new functions.https.HttpsError('invalid-argument', 'A photo is required.');
    const photoRef = admin.firestore().collection('photos').doc(photoId);
    const photoSnapshot = await photoRef.get();
    if (!photoSnapshot.exists)
        return { deleted: true };
    const photo = photoSnapshot.data();
    if (photo.userId !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'You can only withdraw your own photo.');
    }
    const storagePath = typeof photo.storagePath === 'string' ? photo.storagePath : '';
    await photoRef.delete();
    const contributionSnapshot = await admin.firestore()
        .collection('users').doc(context.auth.uid).collection('contributions')
        .where('tripId', '==', `photo_${photoId}`).get();
    const batch = admin.firestore().batch();
    contributionSnapshot.docs.forEach(contribution => batch.delete(contribution.ref));
    if (!contributionSnapshot.empty)
        await batch.commit();
    if (storagePath) {
        try {
            await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
        }
        catch (error) {
            console.warn('[withdrawCommunityPhoto] Storage cleanup failed after Firestore withdrawal:', error);
        }
    }
    return { deleted: true };
});
/** Marks an Operations admin's own photo approved without placing it in their review queue. */
exports.finalizeAdminCommunityPhoto = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const photoId = typeof (data === null || data === void 0 ? void 0 : data.photoId) === 'string' ? data.photoId.trim() : '';
    if (!photoId)
        throw new functions.https.HttpsError('invalid-argument', 'A photo is required.');
    const photoRef = admin.firestore().collection('photos').doc(photoId);
    const snapshot = await photoRef.get();
    if (!snapshot.exists)
        throw new functions.https.HttpsError('not-found', 'Photo not found.');
    const photo = snapshot.data();
    if (photo.userId !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'You can only finalize your own photo.');
    }
    if (!isCallerAdmin(context))
        return { reviewStatus: photo.reviewStatus || 'pending' };
    await photoRef.update({
        reviewStatus: 'approved',
        reviewedAt: Date.now(),
        reviewedBy: context.auth.uid,
        approvalReason: 'admin_self_submission'
    });
    return { reviewStatus: 'approved' };
});
/** Returns the authenticated account identity and whether it can open Map Review. */
exports.getMapReviewAccess = functions.https.onCall(async (_data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    const isAdmin = isCallerAdmin(context);
    // Auto-bootstrap admin custom claim if authorized admin identity
    if (isAdmin && context.auth.token.admin !== true) {
        try {
            const user = await admin.auth().getUser(context.auth.uid);
            await admin.auth().setCustomUserClaims(context.auth.uid, Object.assign(Object.assign({}, (user.customClaims || {})), { admin: true }));
            console.log(`[Admin] Assigned admin custom claim to ${context.auth.uid} (${context.auth.token.email})`);
        }
        catch (claimErr) {
            console.warn('[Admin] Failed to assign custom claim:', claimErr);
        }
    }
    return { uid: context.auth.uid, isAdmin };
});
/** Prevents the final My Way operator from deleting the only recovery path. */
exports.getAdminDeletionProtection = functions.https.onCall(async (_data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    if (!isCallerAdmin(context))
        return { isAdmin: false, hasRecoveryAdmin: true };
    const otherAdmins = (await listAdminUids()).filter(uid => uid !== context.auth.uid);
    return { isAdmin: true, hasRecoveryAdmin: otherAdmins.length > 0 };
});
exports.assertCanDeleteMyWayAccount = functions.https.onCall(async (_data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required.');
    if (!isCallerAdmin(context))
        return { allowed: true };
    const otherAdmins = (await listAdminUids()).filter(uid => uid !== context.auth.uid);
    if (otherAdmins.length === 0) {
        throw new functions.https.HttpsError('failed-precondition', 'Assign a recovery admin before deleting the final My Way Operations account.');
    }
    return { allowed: true };
});
/** Returns a compact, phone-friendly list of pending access-point candidates. */
exports.listPendingDestinationAccessPoints = functions.https.onCall(async (_data, context) => {
    if (!isCallerAdmin(context)) {
        throw new functions.https.HttpsError('permission-denied', 'Administrator access is required.');
    }
    const snapshot = await admin.database().ref('destination_access_point_submissions').once('value');
    const pending = [];
    snapshot.forEach(placeSnapshot => {
        placeSnapshot.forEach(accessPointSnapshot => {
            const candidates = accessPointSnapshot.val() || {};
            const firstPending = Object.values(candidates).find((candidate) => (candidate === null || candidate === void 0 ? void 0 : candidate.status) === 'pending');
            if (!firstPending)
                return;
            const confirmations = new Set(Object.values(candidates)
                .filter((candidate) => (candidate === null || candidate === void 0 ? void 0 : candidate.status) === 'pending' || (candidate === null || candidate === void 0 ? void 0 : candidate.status) === 'approved')
                .map((candidate) => candidate === null || candidate === void 0 ? void 0 : candidate.submittedBy)
                .filter(Boolean));
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
            let moveDistanceMeters = undefined;
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
    const photoSnapshot = await admin.firestore().collection('photos').where('reviewStatus', '==', 'pending').limit(100).get();
    photoSnapshot.forEach(photo => {
        const data = photo.data();
        pending.push({
            kind: 'photo',
            normalizedKey: `photo_${photo.id}`,
            accessPointId: photo.id,
            photoId: photo.id,
            name: 'Community building photo',
            placeName: data.placeName || 'Saved place',
            reportedAddress: data.reportedAddress || data.placeName || 'Saved place',
            reportedBy: data.userName || 'Contributor',
            reportedById: data.userId || '',
            placeLocation: data.placeLocation,
            type: 'building_photo',
            location: data.placeLocation || { lat: 0, lng: 0 },
            notes: data.caption || 'Awaiting photo moderation',
            imageUrl: data.url,
            submittedAt: data.createdAt,
            confirmations: 1
        });
    });
    pending.sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
    return { submissions: pending.slice(0, 100) };
});
/** Recent Operations decisions for audit, search, and support follow-up. */
exports.listMapReviewHistory = functions.https.onCall(async (_data, context) => {
    if (!isCallerAdmin(context))
        throw new functions.https.HttpsError('permission-denied', 'Administrator access is required.');
    const history = [];
    const snapshot = await admin.database().ref('destination_access_point_submissions').once('value');
    snapshot.forEach(placeSnapshot => placeSnapshot.forEach(accessPointSnapshot => {
        Object.values(accessPointSnapshot.val() || {}).forEach((entry) => {
            if ((entry === null || entry === void 0 ? void 0 : entry.status) !== 'approved' && (entry === null || entry === void 0 ? void 0 : entry.status) !== 'rejected')
                return;
            history.push({
                kind: 'access_point', normalizedKey: placeSnapshot.key, accessPointId: accessPointSnapshot.key,
                name: entry.name, placeName: entry.placeName, placeLocation: entry.placeLocation, type: entry.type,
                location: entry.location, notes: entry.notes, imageUrl: entry.imageUrl, submittedAt: entry.submittedAt,
                confirmations: entry.verifiedCount || 1, reviewStatus: entry.status,
                reviewedAt: entry.moderatedAt || entry.approvedAt || entry.updatedAt, reviewedBy: entry.moderatedBy || entry.approvedBy
            });
        });
    }));
    const photos = await admin.firestore().collection('photos').limit(200).get();
    photos.forEach(photo => {
        const entry = photo.data();
        if (entry.reviewStatus !== 'approved' && entry.reviewStatus !== 'rejected')
            return;
        history.push({
            kind: 'photo', normalizedKey: `photo_${photo.id}`, accessPointId: photo.id, photoId: photo.id,
            name: 'Community building photo', placeName: entry.placeName || 'Saved place',
            reportedAddress: entry.reportedAddress || entry.placeName, reportedBy: entry.userName || 'Contributor', reportedById: entry.userId || '',
            type: 'building_photo', location: entry.placeLocation || { lat: 0, lng: 0 }, imageUrl: entry.url,
            submittedAt: entry.createdAt, confirmations: 1, reviewStatus: entry.reviewStatus,
            reviewedAt: entry.reviewedAt, reviewedBy: entry.reviewedBy
        });
    });
    history.sort((a, b) => (b.reviewedAt || b.submittedAt || 0) - (a.reviewedAt || a.submittedAt || 0));
    return { submissions: history.slice(0, 200) };
});
/** Allows an existing admin to grant admin status to another user UID or email */
exports.assignAdminRole = functions.https.onCall(async (data, context) => {
    if (!isCallerAdmin(context)) {
        throw new functions.https.HttpsError('permission-denied', 'Administrator access is required.');
    }
    const targetUid = typeof (data === null || data === void 0 ? void 0 : data.uid) === 'string' ? data.uid.trim() : '';
    const targetEmail = typeof (data === null || data === void 0 ? void 0 : data.email) === 'string' ? data.email.trim().toLowerCase() : '';
    if (!targetUid && !targetEmail) {
        throw new functions.https.HttpsError('invalid-argument', 'A target UID or email is required.');
    }
    let userToUpdate;
    if (targetUid) {
        userToUpdate = await admin.auth().getUser(targetUid);
    }
    else {
        userToUpdate = await admin.auth().getUserByEmail(targetEmail);
    }
    if (userToUpdate.uid === context.auth.uid) {
        throw new functions.https.HttpsError('invalid-argument', 'Choose a different existing My Way account as the recovery admin.');
    }
    await admin.auth().setCustomUserClaims(userToUpdate.uid, Object.assign(Object.assign({}, (userToUpdate.customClaims || {})), { admin: true }));
    return { success: true, uid: userToUpdate.uid, email: userToUpdate.email };
});
const NATIONAL_ADDRESS_ENDPOINT = 'https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/Address_Points_from_National_Address_Database_view/FeatureServer/0/query';
const MAX_ADDRESS_VIEWPORT_DEGREES = 0.12;
const MIN_ADDRESS_LABEL_ZOOM = 15;
const MAX_ADDRESS_RESULTS = 850;
/**
 * Bounded proxy for U.S. DOT National Address Database viewport labels.
 * This prevents an unbounded public-data request from every map movement and
 * leaves a clean seam for a My Way-hosted vector-tile pipeline later.
 */
exports.getNationalAddressPoints = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required to load address labels.');
    }
    const { north, south, east, west, zoom } = data || {};
    const coordinates = [north, south, east, west];
    if (!coordinates.every(value => typeof value === 'number' && Number.isFinite(value)) ||
        typeof zoom !== 'number' || !Number.isFinite(zoom)) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid viewport and zoom are required.');
    }
    if (zoom < MIN_ADDRESS_LABEL_ZOOM)
        return { points: [] };
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
        if (!response.ok)
            throw new Error(`NAD request failed (${response.status})`);
        const payload = await response.json();
        if (payload.error)
            throw new Error(payload.error.message || 'NAD returned an error');
        const points = (payload.features || []).flatMap(feature => {
            var _a, _b;
            const attributes = feature.attributes || {};
            const latitude = Number(attributes.Latitude);
            const longitude = Number(attributes.Longitude);
            const rawNumber = (_a = attributes.AddNo_Full) !== null && _a !== void 0 ? _a : attributes.Add_Number;
            const number = typeof rawNumber === 'string' || typeof rawNumber === 'number' ? String(rawNumber).trim() : '';
            if (!number || !Number.isFinite(latitude) || !Number.isFinite(longitude))
                return [];
            const id = String(attributes.UUID || attributes.OBJECTID || `${latitude}:${longitude}:${number}`);
            const streetValue = (_b = attributes.StNam_Full) !== null && _b !== void 0 ? _b : attributes.St_Name;
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
    }
    catch (error) {
        console.error('getNationalAddressPoints error:', error);
        throw new functions.https.HttpsError('unavailable', 'National address labels are temporarily unavailable.');
    }
});
// Gemini AI Proxy
// This function secures your Gemini API key by keeping it server-side.
// Keep the handler shared by the legacy endpoint and its clean v2 replacement
// so a broken invocation policy never strands authenticated app users.
const callGeminiHandler = async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in is required to use My Way AI.');
    }
    const { prompt, config, model = 'gemini-2.0-flash-exp' } = data;
    if (!prompt) {
        throw new functions.https.HttpsError('invalid-argument', 'Prompt is required.');
    }
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || ((_a = functions.config().google) === null || _a === void 0 ? void 0 : _a.gemini_api_key);
    if (!apiKey) {
        console.error('Gemini API key not configured');
        throw new functions.https.HttpsError('internal', 'AI configuration error.');
    }
    try {
        const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
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
    }
    catch (error) {
        console.error('callGeminiAI runtime error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'AI service failed');
    }
};
exports.callGeminiAI = functions.https.onCall(callGeminiHandler);
exports.callGeminiAIv2 = functions.https.onCall(callGeminiHandler);
// Google Places API Proxy
// This function secures your API key by keeping it server-side
exports.searchPlaces = functions.https.onCall(async (data, context) => {
    // Rate limiting: Check if user is authenticated (optional but recommended)
    // if (!context.auth) {
    //   throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    // }
    var _a;
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
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || ((_a = functions.config().google) === null || _a === void 0 ? void 0 : _a.maps_api_key);
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
        const places = (json.results || []).slice(0, 10).map((place, index) => {
            var _a;
            return ({
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
                isOpen: (_a = place.opening_hours) === null || _a === void 0 ? void 0 : _a.open_now
            });
        });
        console.log(`🔌 [searchPlaces] Successfully returned ${places.length} places to client`);
        return { places };
    }
    catch (error) {
        console.error('🔌 [searchPlaces] Runtime error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to search places.');
    }
});
// Helper: Categorize place types
function categorizePlace(types) {
    if (types.includes('gas_station'))
        return 'gas';
    if (types.includes('cafe') || types.includes('coffee'))
        return 'coffee';
    if (types.includes('restaurant') || types.includes('food'))
        return 'food';
    if (types.includes('grocery_or_supermarket'))
        return 'grocery';
    return 'other';
}
// Helper: Get emoji icon for place type
function getPlaceIcon(types) {
    if (types.includes('gas_station'))
        return '⛽';
    if (types.includes('cafe') || types.includes('coffee'))
        return '☕';
    if (types.includes('restaurant'))
        return '🍽️';
    if (types.includes('fast_food'))
        return '🍔';
    if (types.includes('grocery_or_supermarket'))
        return '🛒';
    if (types.includes('hospital') || types.includes('pharmacy'))
        return '🏥';
    if (types.includes('school'))
        return '🏫';
    if (types.includes('park'))
        return '🌳';
    return '📍';
}
// Geocoding proxy (for address lookup)
exports.geocodeAddress = functions.https.onCall(async (data, context) => {
    var _a;
    const { address } = data;
    if (!address || typeof address !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Address is required.');
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || ((_a = functions.config().google) === null || _a === void 0 ? void 0 : _a.maps_api_key);
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
    }
    catch (error) {
        console.error('geocodeAddress error:', error);
        throw new functions.https.HttpsError('internal', 'Geocoding failed.');
    }
});
// Google Routes API proxy. Keeps the traffic-enabled Maps key server-side and
// returns only the route data needed by the MyWay navigation client.
exports.computeTrafficRoutes = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in is required for live traffic routing.');
    }
    const { origin, destination, alternatives = true } = data || {};
    const validLocation = (value) => value && typeof value.lat === 'number' && typeof value.lng === 'number' &&
        Number.isFinite(value.lat) && Number.isFinite(value.lng);
    if (!validLocation(origin) || !validLocation(destination)) {
        throw new functions.https.HttpsError('invalid-argument', 'Origin and destination coordinates are required.');
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || ((_a = functions.config().google) === null || _a === void 0 ? void 0 : _a.maps_api_key);
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
            console.error('[computeTrafficRoutes] Google Routes error:', response.status, ((_b = json === null || json === void 0 ? void 0 : json.error) === null || _b === void 0 ? void 0 : _b.message) || json);
            throw new functions.https.HttpsError('unavailable', ((_c = json === null || json === void 0 ? void 0 : json.error) === null || _c === void 0 ? void 0 : _c.message) || 'Live traffic routing is unavailable.');
        }
        return { routes: json.routes, provider: 'google_routes', generatedAt: Date.now() };
    }
    catch (error) {
        if (error instanceof functions.https.HttpsError)
            throw error;
        console.error('[computeTrafficRoutes] Request failed:', (error === null || error === void 0 ? void 0 : error.message) || error);
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
exports.sendGeofenceAlert = functions.https.onCall(async (data, context) => {
    var _a, _b;
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
        const members = Array.isArray(circle.members)
            ? circle.members.filter((member) => typeof member === 'string')
            : Object.entries(circle.members || {})
                .map(([uid, value]) => typeof value === 'string' ? value : (value ? uid : null))
                .filter((uid) => typeof uid === 'string');
        if (!members.includes(context.auth.uid) || context.auth.uid !== memberId) {
            throw new functions.https.HttpsError('permission-denied', 'Only the reporting circle member can send this alert.');
        }
        const memberTokens = [];
        for (const uid of members) {
            if (uid === memberId)
                continue; // Don't notify the person who triggered
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
        const message = {
            tokens: uniqueMemberTokens,
            notification: { title, body },
            data: {
                type: isArrival ? 'geofence_enter' : 'geofence_exit',
                memberId,
                memberName,
                circleId,
                geofenceName,
                lat: ((_a = location === null || location === void 0 ? void 0 : location.lat) === null || _a === void 0 ? void 0 : _a.toString()) || '',
                lng: ((_b = location === null || location === void 0 ? void 0 : location.lng) === null || _b === void 0 ? void 0 : _b.toString()) || '',
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
    }
    catch (error) {
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
exports.sendSosAlert = functions.https.onCall(async (data, context) => {
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
    const members = Array.isArray(circle.members)
        ? circle.members.filter((member) => typeof member === 'string')
        : Object.entries(circle.members || {})
            .map(([uid, value]) => typeof value === 'string' ? value : (value ? uid : null))
            .filter((uid) => typeof uid === 'string');
    if (!members.includes(context.auth.uid)) {
        throw new functions.https.HttpsError('permission-denied', 'Only circle members can notify this circle.');
    }
    const tokens = Array.from(new Set((await Promise.all(members
        .filter(uid => uid !== context.auth.uid)
        .map(uid => getUserPushTokens(uid)))).flat()));
    if (tokens.length === 0)
        return { sent: 0 };
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
            notification: { channelId: 'myway_safety_v2', icon: 'ic_stat_myway', color: '#6366f1' }
        },
        apns: { payload: { aps: { sound: 'default' } } }
    });
    return { sent: response.successCount, failed: response.failureCount };
});
// Contact numbers are deliberately separate from broadly readable user profiles.
// Every lookup checks current RTDB membership; no public directory or client reads.
exports.saveContactPreferences = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
    const phone = typeof (data === null || data === void 0 ? void 0 : data.phone) === 'string' ? data.phone.trim() : '';
    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
        throw new functions.https.HttpsError('invalid-argument', 'Use a phone number with country code.');
    }
    const circleIds = Array.isArray(data === null || data === void 0 ? void 0 : data.circleIds)
        ? Array.from(new Set(data.circleIds.map(cleanCircleId))) : [];
    if (circleIds.length > 30)
        throw new functions.https.HttpsError('invalid-argument', 'Too many circles.');
    for (const id of circleIds) {
        const circle = (await admin.database().ref(`circles/${id}`).once('value')).val();
        if (!getActiveCircleMembers(circle).includes(context.auth.uid)) {
            throw new functions.https.HttpsError('permission-denied', 'You must belong to every selected circle.');
        }
    }
    await admin.database().ref(`privateContactPreferences/${context.auth.uid}`).set({
        phone, circleIds: phone ? circleIds : []
    });
    return { saved: true };
});
exports.getCircleContacts = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
    const uid = context.auth.uid;
    const ids = Array.isArray(data === null || data === void 0 ? void 0 : data.circleIds)
        ? Array.from(new Set(data.circleIds.map(cleanCircleId))) : [];
    if (ids.length > 30)
        throw new functions.https.HttpsError('invalid-argument', 'Too many circles.');
    const contacts = {};
    for (const circleId of ids) {
        const circle = (await admin.database().ref(`circles/${circleId}`).once('value')).val();
        const members = getActiveCircleMembers(circle);
        if (!members.includes(uid))
            continue;
        await Promise.all(members.filter(id => id !== uid).map(async (memberId) => {
            const prefs = (await admin.database().ref(`privateContactPreferences/${memberId}`).once('value')).val();
            if (typeof (prefs === null || prefs === void 0 ? void 0 : prefs.phone) === 'string' && /^\+[1-9]\d{6,14}$/.test(prefs.phone)
                && Array.isArray(prefs.circleIds) && prefs.circleIds.includes(circleId)) {
                contacts[memberId] = prefs.phone;
            }
        }));
    }
    const stored = (await admin.database().ref(`privateContactPreferences/${uid}`).once('value')).val();
    return { contacts, preferences: { phone: (stored === null || stored === void 0 ? void 0 : stored.phone) || '', circleIds: (stored === null || stored === void 0 ? void 0 : stored.circleIds) || [] } };
});
exports.removeDeletedUserContact = functions.auth.user().onDelete(async (user) => {
    await admin.database().ref(`privateContactPreferences/${user.uid}`).remove();
});
//# sourceMappingURL=index.js.map