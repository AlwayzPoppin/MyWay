import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

/** Refreshes the Firestore authorization mirror from the authoritative RTDB Circle. */
export const syncVerifiedCircleMembership = async (circleId: string, userId?: string): Promise<boolean> => {
    if (!circleId) return false;
    const syncMembership = httpsCallable<{ circleId: string; userId?: string }, { active: boolean }>(
        functions,
        'syncCircleMembership'
    );
    const result = await syncMembership({ circleId, ...(userId ? { userId } : {}) });
    return result.data.active;
};
