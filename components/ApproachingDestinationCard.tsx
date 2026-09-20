import React, { useEffect, useRef, useState } from 'react';
import { ArrivalTripData, Location, Place } from '../types';
import { getPlacePhotoKey, placePhotoService } from '../services/placePhotoService';
import { Camera, Check, MapPin, X } from 'lucide-react';

interface ApproachingDestinationCardProps {
  arrivalData: ArrivalTripData | null;
  isOpen: boolean;
  onDismiss: () => void;
  onFixLocation?: (place: Place) => void;
  onPhotoSaved?: (placeId: string, photoUrl: string, isSynced: boolean) => void;
  theme?: 'light' | 'dark';
  userId?: string;
  userName?: string;
  userAvatar?: string;
}

/** A lightweight, moving-friendly arrival contribution prompt. */
const ApproachingDestinationCard: React.FC<ApproachingDestinationCardProps> = ({
  arrivalData,
  isOpen,
  onDismiss,
  onFixLocation,
  onPhotoSaved,
  theme = 'light',
  userId,
  userName,
  userAvatar
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeUploadRef = useRef(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isShared, setIsShared] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const isDark = theme === 'dark';

  const destinationKey = arrivalData
    ? `${arrivalData.destinationPlace?.id || arrivalData.destinationName}:${arrivalData.arrivedAt || ''}`
    : 'closed';

  // Each destination owns its own camera state. Invalidating the active token
  // stops a late completion from a previous trip acting on the next trip.
  useEffect(() => {
    activeUploadRef.current += 1;
    setIsUploading(false);
    setIsShared(false);
    setUploadError(null);
    if (inputRef.current) inputRef.current.value = '';
    return () => { activeUploadRef.current += 1; };
  }, [destinationKey]);

  if (!isOpen || !arrivalData) return null;

  const destinationPlace: Place = arrivalData.destinationPlace || {
    id: `arrival_${arrivalData.arrivedAt || Date.now()}`,
    name: arrivalData.destinationName,
    location: arrivalData.destinationLoc as Location,
    address: arrivalData.destinationName,
    radius: 50,
    type: 'search_result',
    icon: '📍'
  };
  const storefrontImageUrl = destinationPlace.imageUrl;

  const takePhoto = () => {
    if (!isUploading) {
      inputRef.current?.click();
    }
  };

  const handleCapture = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    // Release the native picker selection right away. Keeping it until an
    // async upload resolves can make the next arrival inherit the old image.
    event.target.value = '';
    const uploadToken = activeUploadRef.current + 1;
    activeUploadRef.current = uploadToken;
    setIsUploading(true);
    setUploadError(null);
    try {
      const contribution = await placePhotoService.uploadPhotoContribution({
        // Search provider IDs are often regenerated on the next search. Store
        // arrival photos under the same stable key used by the place detail card.
        placeId: getPlacePhotoKey(destinationPlace),
        placeName: destinationPlace.name,
        reportedAddress: destinationPlace.address || destinationPlace.description || destinationPlace.name,
        placeLocation: destinationPlace.location,
        file,
        userId: userId || 'anonymous',
        userName: userName || 'Driver',
        userAvatar
      });
      if (activeUploadRef.current !== uploadToken) return;
      onPhotoSaved?.(destinationPlace.id, contribution.url, contribution.isSynced !== false);
      setIsShared(true);
    } catch (error) {
      console.warn('[ApproachingDestinationCard] Building photo upload failed:', error);
      if (activeUploadRef.current === uploadToken) {
        setUploadError('Photo could not be saved. Please try again.');
      }
    } finally {
      if (activeUploadRef.current === uploadToken) setIsUploading(false);
    }
  };

  return (
    <section className="fixed z-[160] left-3 right-3 mx-auto max-w-md pointer-events-auto bottom-[calc(var(--drive-hud-controls-bottom,11rem)+12px)] animate-in slide-in-from-bottom-3 duration-200">
      <div className={`rounded-2xl border p-3 shadow-2xl backdrop-blur-xl ${isDark ? 'border-white/15 bg-slate-950/95 text-white' : 'border-slate-200 bg-white/95 text-slate-900'}`}>
        <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={handleCapture} className="hidden" />
        <div className="flex items-start gap-3">
          {storefrontImageUrl ? (
            <img
              src={storefrontImageUrl}
              alt={`${destinationPlace.name} storefront`}
              className="mt-0.5 h-10 w-10 shrink-0 rounded-xl border border-emerald-200 object-cover"
            />
          ) : (
            <div className="mt-0.5 rounded-xl bg-emerald-500/15 p-2 text-emerald-500"><MapPin className="h-5 w-5" /></div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">{destinationPlace.needsBuildingPhoto ? 'Your saved place is nearby' : 'Approaching destination'}</p>
            <h2 className="truncate text-sm font-black">{arrivalData.destinationName}</h2>
            <p className={`mt-0.5 text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>{storefrontImageUrl ? 'Storefront photo on file.' : destinationPlace.needsBuildingPhoto ? 'You’re here—add a photo when it is safe to do so.' : 'Help the next driver spot this entrance.'}</p>
          </div>
          <button type="button" onClick={onDismiss} aria-label="Skip arrival prompt" className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={takePhoto} disabled={isUploading || isShared} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 text-xs font-black text-white shadow-lg shadow-emerald-500/25 disabled:opacity-70">
            {isShared ? <><Check className="h-4 w-4" /> Photo shared</> : <><Camera className={`h-4 w-4 ${isUploading ? 'animate-pulse' : ''}`} /> {isUploading ? 'Uploading…' : 'Take building photo'}</>}
          </button>
          <button type="button" onClick={onDismiss} className={`min-h-11 rounded-xl border px-3 text-xs font-bold ${isDark ? 'border-white/15 text-slate-200' : 'border-slate-200 text-slate-600'}`}>Skip</button>
        </div>
        {uploadError && <p role="alert" className="mt-2 text-center text-[10px] font-bold text-rose-500">{uploadError}</p>}
        <button type="button" onClick={() => { onFixLocation?.(destinationPlace); onDismiss(); }} className="mt-2 w-full text-center text-[10px] font-bold text-slate-400 underline underline-offset-2">Pin or entrance wrong?</button>
      </div>
    </section>
  );
};

export default ApproachingDestinationCard;
