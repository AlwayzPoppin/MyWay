import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export interface PendingAccessPointReview {
    kind?: 'access_point' | 'photo';
    normalizedKey: string;
    accessPointId: string;
    photoId?: string;
    name: string;
    placeName?: string;
    reportedAddress?: string;
    reportedBy?: string;
    reportedById?: string;
    placeLocation?: { lat: number; lng: number };
    moveDistanceMeters?: number;
    type: string;
    location: { lat: number; lng: number };
    notes?: string;
    imageUrl?: string;
    submittedAt?: number;
    confirmations: number;
    reviewStatus?: 'approved' | 'rejected';
    reviewedAt?: number;
    reviewedBy?: string;
}

export const getMapReviewAccess = async (): Promise<{ uid: string; isAdmin: boolean }> => {
    const response = await httpsCallable<void, { uid: string; isAdmin: boolean }>(functions, 'getMapReviewAccess')();
    return response.data;
};

export const getAdminDeletionProtection = async (): Promise<{ isAdmin: boolean; hasRecoveryAdmin: boolean }> => {
    const response = await httpsCallable<void, { isAdmin: boolean; hasRecoveryAdmin: boolean }>(functions, 'getAdminDeletionProtection')();
    return response.data;
};

export const assertCanDeleteMyWayAccount = async (): Promise<void> => {
    await httpsCallable(functions, 'assertCanDeleteMyWayAccount')();
};

export const listPendingAccessPointReviews = async (): Promise<PendingAccessPointReview[]> => {
    const response = await httpsCallable<void, { submissions: PendingAccessPointReview[] }>(
        functions,
        'listPendingDestinationAccessPoints'
    )();
    return response.data.submissions || [];
};

export const listMapReviewHistory = async (): Promise<PendingAccessPointReview[]> => {
    const response = await httpsCallable<void, { submissions: PendingAccessPointReview[] }>(functions, 'listMapReviewHistory')();
    return response.data.submissions || [];
};

export const moderateAccessPoint = async (
    normalizedKey: string,
    accessPointId: string,
    decision: 'approve' | 'reject',
    kind: 'access_point' | 'photo' = 'access_point',
    photoId?: string
): Promise<void> => {
    await httpsCallable(functions, 'moderateDestinationAccessPoint')({ normalizedKey, accessPointId, decision, kind, photoId });
};

export const assignAdminRole = async (target: { uid?: string; email?: string }): Promise<{ success: boolean; uid?: string; email?: string }> => {
    const response = await httpsCallable<{ uid?: string; email?: string }, { success: boolean; uid?: string; email?: string }>(
        functions,
        'assignAdminRole'
    )(target);
    return response.data;
};
