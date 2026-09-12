import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
// Enable only after deploying the participant-scoped Firestore rules.
export const FOLLOW_TRIP_ENABLED = (import.meta as any).env.VITE_FOLLOW_TRIP_ENABLED === 'true';

export interface SharedTrip {
  id: string;
  driverId: string;
  driverName: string;
  participantIds: string[];
  circleNames: string[];
  destination: string;
  destinationLocation: { lat: number; lng: number };
  geometry: string;
  location: { lat: number; lng: number } | null;
  eta: string;
  updatedAt: number;
  locationUpdatedAt: number;
  startedAt: number;
  status: 'active' | 'arrived' | 'ended';
}

export const saveSharedTrip = (trip: SharedTrip) => {
  if (!FOLLOW_TRIP_ENABLED) return Promise.reject(new Error('Follow Trip access rules must be deployed first.'));
  return setDoc(doc(db, 'sharedTrips', trip.driverId), trip);
};

export const subscribeToSharedTrips = (
  userId: string,
  receive: (trips: SharedTrip[]) => void,
  fail: (error: Error) => void
) => onSnapshot(query(collection(db, 'sharedTrips'), where('participantIds', 'array-contains', userId)),
  snapshot => receive(snapshot.docs.map(item => item.data() as SharedTrip)), fail);
