import React, { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { ArrivalTripData, Place, Location, EntranceType } from '../types';
import { placeCorrectionService } from '../services/placeCorrectionService';
import { contributionService, TripContributionPayload } from '../services/contributionService';
import {
    X,
    ChevronLeft,
    MapPin,
    Home,
    Building2,
    Check,
    LocateFixed,
    RotateCcw,
    Plus,
    Minus,
    Camera
} from 'lucide-react';

export interface TripCompletedCardProps {
    arrivalData: ArrivalTripData | null;
    isOpen: boolean;
    onClose: () => void;
    onFixLocation?: (place: Place) => void;
    theme?: 'light' | 'dark';
    userLocation?: Location | null;
    userId?: string;
    userName?: string;
    userAvatar?: string;
}

const FEEDBACK_TAGS = [
    { id: 'smooth', label: 'Smooth route', icon: '🛣️' },
    { id: 'accurate_eta', label: 'Accurate ETA', icon: '⏱️' },
    { id: 'wrong_entrance', label: 'Wrong entrance / pin', icon: '📍', isPinIssue: true },
    { id: 'traffic', label: 'Heavy traffic', icon: '🚗' },
    { id: 'hazard', label: 'Road hazard on way', icon: '⚠️' },
];

export const TripCompletedCard: React.FC<TripCompletedCardProps> = ({
    arrivalData,
    isOpen,
    onClose,
    onFixLocation,
    theme = 'dark',
    userLocation,
    userId,
    userName,
    userAvatar
}) => {
    // Step state: 1 = Rating & Tags, 2 = Place Category, 3 = Pin Accuracy, 4 = Pin Correction
    const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

    // Step 1 state
    const [rating, setRating] = useState<number>(0);
    const [hoverRating, setHoverRating] = useState<number>(0);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);

    // Step 2 state: Place Category ('residential' | 'business' | null)
    const [placeType, setPlaceType] = useState<'residential' | 'business' | null>(null);

    // Step 3 state: Pin Accuracy (boolean | null)
    const [isAccurate, setIsAccurate] = useState<boolean | null>(null);

    // Step 4 state: Map Pin Relocation
    const [currentCoords, setCurrentCoords] = useState<Location>({ lat: 0, lng: 0 });
    const [entranceType, setEntranceType] = useState<EntranceType>('main_door');
    const [isSaving, setIsSaving] = useState(false);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);

    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<maplibregl.Map | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isDark = theme === 'dark';
    const textColor = isDark ? 'text-white' : 'text-slate-900';
    const subTextColor = isDark ? 'text-slate-400' : 'text-slate-500';
    const panelBg = isDark ? 'bg-[#0f172a]/98 border-white/10' : 'bg-white/98 border-slate-200';

    // Reset wizard when new trip data arrives
    useEffect(() => {
        if (isOpen && arrivalData) {
            setStep(1);
            setRating(0);
            setSelectedTags([]);
            setPlaceType(null);
            setIsAccurate(null);
            const initialLoc = arrivalData.destinationPlace?.location || userLocation || { lat: 35.105, lng: -78.966 };
            setCurrentCoords({ lat: initialLoc.lat, lng: initialLoc.lng });
            setPhotoPreview(arrivalData.destinationPlace?.imageUrl || null);
        }
    }, [isOpen, arrivalData?.destinationName]);

    // Initialize MapLibre in Step 4
    useEffect(() => {
        if (step !== 4 || !mapContainerRef.current) return;

        const initialLat = currentCoords.lat || arrivalData?.destinationPlace?.location?.lat || 35.105;
        const initialLng = currentCoords.lng || arrivalData?.destinationPlace?.location?.lng || -78.966;

        const map = new maplibregl.Map({
            container: mapContainerRef.current,
            style: isDark
                ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
                : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
            center: [initialLng, initialLat],
            zoom: 18,
            pitch: 0,
            attributionControl: false
        });

        mapInstanceRef.current = map;

        const timer = setTimeout(() => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.resize();
            }
        }, 150);

        const updateCoordsFromCenter = () => {
            if (!mapContainerRef.current || !mapInstanceRef.current) return;
            const rect = mapContainerRef.current.getBoundingClientRect();
            const unprojected = mapInstanceRef.current.unproject([rect.width / 2, rect.height / 2]);
            setCurrentCoords({
                lat: parseFloat(unprojected.lat.toFixed(6)),
                lng: parseFloat(unprojected.lng.toFixed(6))
            });
        };

        map.on('move', updateCoordsFromCenter);
        map.on('dragend', updateCoordsFromCenter);

        map.on('click', (e) => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.easeTo({
                    center: e.lngLat,
                    duration: 250
                });
            }
        });

        return () => {
            clearTimeout(timer);
            map.remove();
            mapInstanceRef.current = null;
        };
    }, [step, isDark]);

    if (!isOpen || !arrivalData) return null;

    const handleTagToggle = (tagId: string) => {
        setSelectedTags(prev =>
            prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
        );
    };

    const handleSkip = () => {
        // Dismiss overlay entirely at any step and cleanly reset local wizard state
        setStep(1);
        setRating(0);
        setHoverRating(0);
        setSelectedTags([]);
        setPlaceType(null);
        setIsAccurate(null);
        setPhotoPreview(null);
        onClose();
    };

    const saveTripMetadata = (accurate: boolean, finalLoc?: Location) => {
        try {
            const ratings = JSON.parse(localStorage.getItem('myway_drive_ratings') || '[]');
            ratings.push({
                destination: arrivalData.destinationName,
                placeId: arrivalData.destinationPlace?.id,
                rating,
                tags: selectedTags,
                placeType,
                isAccurate: accurate,
                coordinates: finalLoc,
                timestamp: Date.now()
            });
            localStorage.setItem('myway_drive_ratings', JSON.stringify(ratings.slice(-50)));
        } catch (e) {
            console.warn('[TripCompletedCard] Failed to cache drive rating:', e);
        }
    };

    // Step 2 Selection Handler: Select option & advance to Step 3
    const handleSelectPlaceType = (type: 'residential' | 'business') => {
        setPlaceType(type);
        setStep(3);
    };

    // Step 3 Pin Accuracy Handlers
    const handlePinAccurateYes = async () => {
        setIsAccurate(true);
        saveTripMetadata(true, arrivalData.destinationPlace?.location);

        const destAddress = arrivalData.destinationPlace?.address || 
                             arrivalData.destinationPlace?.description || 
                             arrivalData.destinationName;
        const tripId = arrivalData.arrivedAt ? `trip_${arrivalData.arrivedAt}` : `trip_${Date.now()}`;

        const payload: TripContributionPayload = {
            tripId,
            destinationAddress: destAddress,
            destinationName: arrivalData.destinationName,
            placeId: arrivalData.destinationPlace?.id,
            rating,
            tags: selectedTags,
            placeType,
            isAccurate: true,
            type: 'trip_review',
            timestamp: Date.now(),
            userId: userId || 'anonymous',
            userName: userName || 'Driver',
            userAvatar
        };

        try {
            await contributionService.recordTripContribution(payload);
        } catch (err) {
            console.warn('[TripCompletedCard] Failed to record trip review contribution:', err);
        }

        onClose();
    };

    const handlePinAccurateNo = () => {
        setIsAccurate(false);
        // Advance to Step 4 for pin relocation
        setStep(4);
    };

    // Step 4 Map Tools
    const handleSnapToGps = () => {
        if (userLocation && mapInstanceRef.current) {
            mapInstanceRef.current.flyTo({
                center: [userLocation.lng, userLocation.lat],
                zoom: 18.5,
                duration: 600
            });
            setCurrentCoords({ lat: userLocation.lat, lng: userLocation.lng });
        }
    };

    const handleResetLocation = () => {
        const orig = arrivalData.destinationPlace?.location;
        if (orig && mapInstanceRef.current) {
            mapInstanceRef.current.flyTo({
                center: [orig.lng, orig.lat],
                zoom: 18,
                duration: 500
            });
            setCurrentCoords({ lat: orig.lat, lng: orig.lng });
        }
    };

    const handleZoomIn = () => {
        mapInstanceRef.current?.zoomIn({ duration: 200 });
    };

    const handleZoomOut = () => {
        mapInstanceRef.current?.zoomOut({ duration: 200 });
    };

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const dataUrl = await placeCorrectionService.uploadPlacePhoto(
                arrivalData.destinationPlace?.id || `place_${Date.now()}`,
                file
            );
            setPhotoPreview(dataUrl);
        } catch (err) {
            console.warn('[TripCompletedCard] Failed to process photo:', err);
        }
    };

    // Step 4: Save True Location & Complete Wizard
    const handleSaveTrueLocation = async () => {
        setIsSaving(true);
        try {
            const destPlace: Place = arrivalData.destinationPlace || {
                id: `place_${Date.now()}`,
                name: arrivalData.destinationName,
                location: currentCoords,
                address: arrivalData.destinationName,
                type: placeType === 'business' ? 'restaurant' : 'home'
            };

            const updatedPlace: Place = {
                ...destPlace,
                location: currentCoords,
                type: placeType === 'business' ? (destPlace.type || 'restaurant') : 'home',
                imageUrl: photoPreview || destPlace.imageUrl
            };

            // Save community correction to database and local store
            await placeCorrectionService.saveCorrection({
                place: updatedPlace,
                correctedLocation: currentCoords,
                correctedName: arrivalData.destinationName,
                category: placeType === 'business' ? 'business' : 'residential',
                entranceType: entranceType,
                submittedBy: userId || 'driver',
                submitterName: userName || 'Driver',
                imageUrl: photoPreview || undefined
            });

            saveTripMetadata(false, currentCoords);

            // Construct payload with all collected wizard data including [longitude, latitude]
            const destAddress = arrivalData.destinationPlace?.address || 
                                 arrivalData.destinationPlace?.description || 
                                 arrivalData.destinationName;
            const tripId = arrivalData.arrivedAt ? `trip_${arrivalData.arrivedAt}` : `trip_${Date.now()}`;

            const payload: TripContributionPayload = {
                tripId,
                destinationAddress: destAddress,
                destinationName: arrivalData.destinationName,
                placeId: arrivalData.destinationPlace?.id,
                rating,
                tags: selectedTags,
                placeType,
                isAccurate: false,
                correctedCoordinates: [currentCoords.lng, currentCoords.lat], // [longitude, latitude]
                correctedLocation: currentCoords,
                entranceType,
                imageUrl: photoPreview || undefined,
                type: 'pin_correction',
                timestamp: Date.now(),
                userId: userId || 'anonymous',
                userName: userName || 'Driver',
                userAvatar
            };

            await contributionService.recordTripContribution(payload);

            if (onFixLocation) {
                onFixLocation(updatedPlace);
            }
        } catch (err) {
            console.warn('[TripCompletedCard] Save true location error:', err);
        } finally {
            setIsSaving(false);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-300 pointer-events-auto overflow-y-auto">
            <div className={`relative w-full max-w-md landscape:max-w-lg rounded-3xl sm:rounded-[2.5rem] border shadow-2xl overflow-y-auto flex flex-col max-h-[90dvh] landscape:max-h-[94dvh] transition-all my-auto ${panelBg}`}>
                
                {/* Ambient Glow */}
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

                {/* Top Nav Header: Back button (if step > 1) + Step Pill + Persistent Skip button */}
                <div className="flex items-center justify-between px-5 pt-4 pb-2 relative z-20 shrink-0">
                    <div>
                        {step > 1 ? (
                            <button
                                type="button"
                                onClick={() => setStep((prev) => (prev - 1) as any)}
                                className={`px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                                    isDark ? 'bg-white/10 hover:bg-white/20 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                }`}
                                title="Back to previous step"
                            >
                                <ChevronLeft className="w-4 h-4" />
                                <span>Back</span>
                            </button>
                        ) : (
                            <div className="w-16" />
                        )}
                    </div>

                    {/* Step Progress Pill */}
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-black uppercase tracking-wider">
                        <span>Step {step} of {isAccurate === false || step === 4 ? 4 : 3}</span>
                    </div>

                    {/* Persistent Skip Button */}
                    <button
                        type="button"
                        onClick={handleSkip}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                            isDark ? 'bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900'
                        }`}
                        title="Skip and close"
                        aria-label="Skip"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* ========================================================================= */}
                {/* STEP 1: Rating & Tags                                                    */}
                {/* ========================================================================= */}
                {step === 1 && (
                    <div className="flex flex-col flex-1 relative z-10 animate-in fade-in slide-in-from-right-4 duration-300">
                        {/* Header with Checkered Flag celebration */}
                        <div className="px-6 pb-3 text-center shrink-0 landscape:py-2">
                            <div className="inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-2xl sm:rounded-3xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-2xl sm:text-3xl shadow-xl shadow-emerald-500/30 mb-2 animate-bounce">
                                🏁
                            </div>
                            <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-emerald-400 block mb-0.5">
                                Trip Completed
                            </span>
                            <h2 className={`text-lg sm:text-2xl font-black tracking-tight leading-tight ${textColor}`}>
                                Arrived at {arrivalData.destinationName}
                            </h2>
                            {arrivalData.destinationPlace?.description && (
                                <p className={`text-xs mt-1 truncate max-w-xs mx-auto ${subTextColor}`}>
                                    {arrivalData.destinationPlace.description}
                                </p>
                            )}
                        </div>

                        {/* Scrollable Content */}
                        <div className="flex-1 overflow-y-auto px-5 sm:px-6 pb-3 space-y-3 sm:space-y-4 no-scrollbar">
                            {/* Trip Metrics Row */}
                            <div className={`grid grid-cols-3 gap-2 p-3 rounded-2xl border text-center ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                                <div>
                                    <span className="text-[9px] sm:text-[10px] uppercase font-bold text-slate-400 block">Distance</span>
                                    <span className={`text-sm font-black ${textColor}`}>
                                        {arrivalData.totalDistance || 'Arrived'}
                                    </span>
                                </div>
                                <div className={`border-x ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                                    <span className="text-[9px] sm:text-[10px] uppercase font-bold text-slate-400 block">Drive Time</span>
                                    <span className={`text-sm font-black ${textColor}`}>
                                        {arrivalData.totalTime || 'Completed'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[9px] sm:text-[10px] uppercase font-bold text-slate-400 block">Safety Score</span>
                                    <span className="text-sm font-black text-emerald-500">
                                        {arrivalData.safetyScore !== undefined ? `${arrivalData.safetyScore}%` : '100%'}
                                    </span>
                                </div>
                            </div>

                            {/* Rate Your Drive (1-5 Stars) */}
                            <div className={`p-4 rounded-2xl border text-center space-y-2 ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                                <span className={`text-xs font-black uppercase tracking-wider block ${textColor}`}>
                                    Rate this drive (Optional)
                                </span>

                                {/* Interactive Stars */}
                                <div className="flex items-center justify-center gap-2 py-1">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <button
                                            key={star}
                                            type="button"
                                            onClick={() => setRating(star)}
                                            onMouseEnter={() => setHoverRating(star)}
                                            onMouseLeave={() => setHoverRating(0)}
                                            className="text-2xl sm:text-3xl transition-transform hover:scale-125 active:scale-95 focus:outline-none cursor-pointer"
                                            title={`${star} Star${star > 1 ? 's' : ''}`}
                                        >
                                            {(hoverRating || rating) >= star ? '⭐' : '☆'}
                                        </button>
                                    ))}
                                </div>

                                {/* Quick Feedback Tags */}
                                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                                    {FEEDBACK_TAGS.map((tag) => {
                                        const isSelected = selectedTags.includes(tag.id);
                                        return (
                                            <button
                                                key={tag.id}
                                                type="button"
                                                onClick={() => handleTagToggle(tag.id)}
                                                className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all flex items-center gap-1 border cursor-pointer ${
                                                    isSelected
                                                        ? tag.isPinIssue
                                                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-md ring-1 ring-amber-400/40'
                                                            : 'bg-indigo-600 text-white border-indigo-500 shadow-md'
                                                        : isDark
                                                            ? 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                                                            : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                                                }`}
                                            >
                                                <span>{tag.icon}</span>
                                                <span>{tag.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Step 1 Footer: "Next" Button */}
                        <div className={`p-4 sm:p-5 pt-3 border-t flex flex-col gap-2 relative z-10 shrink-0 ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                            <button
                                type="button"
                                onClick={() => setStep(2)}
                                className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-lg shadow-emerald-600/30 transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                            >
                                <span>Next</span>
                                <span>→</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleSkip}
                                className={`text-xs font-semibold text-center hover:underline py-1 transition-colors cursor-pointer ${subTextColor}`}
                            >
                                Skip for now
                            </button>
                        </div>
                    </div>
                )}

                {/* ========================================================================= */}
                {/* STEP 2: Place Category                                                   */}
                {/* ========================================================================= */}
                {step === 2 && (
                    <div className="flex flex-col flex-1 relative z-10 p-5 sm:p-6 space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="text-center space-y-1">
                            <h2 className={`text-xl sm:text-2xl font-black tracking-tight ${textColor}`}>
                                Help categorize this location
                            </h2>
                            <p className={`text-xs ${subTextColor}`}>
                                Crowdsourced category tags ensure optimal navigation routing and entrance detection.
                            </p>
                        </div>

                        {/* Two Large Touch-Friendly Buttons */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 my-auto">
                            {/* Residential Option */}
                            <button
                                type="button"
                                onClick={() => handleSelectPlaceType('residential')}
                                className={`p-5 rounded-3xl border text-left flex flex-col justify-between gap-3 transition-all duration-200 group active:scale-95 cursor-pointer shadow-md ${
                                    placeType === 'residential'
                                        ? 'bg-indigo-600 text-white border-indigo-400 ring-2 ring-indigo-400'
                                        : isDark
                                        ? 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
                                        : 'bg-slate-50 hover:bg-indigo-50/50 border-slate-200 text-slate-900'
                                }`}
                            >
                                <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-2xl shrink-0 group-hover:scale-110 transition-transform">
                                    <Home className="w-6 h-6 text-indigo-400" />
                                </div>
                                <div>
                                    <h3 className="text-base font-black flex items-center gap-1.5">
                                        <span>🏠 Residential</span>
                                    </h3>
                                    <p className={`text-xs mt-1 leading-snug ${placeType === 'residential' ? 'text-indigo-100' : subTextColor}`}>
                                        Single family home, apartment, townhouse, or private residential driveway.
                                    </p>
                                </div>
                            </button>

                            {/* Business Option */}
                            <button
                                type="button"
                                onClick={() => handleSelectPlaceType('business')}
                                className={`p-5 rounded-3xl border text-left flex flex-col justify-between gap-3 transition-all duration-200 group active:scale-95 cursor-pointer shadow-md ${
                                    placeType === 'business'
                                        ? 'bg-purple-600 text-white border-purple-400 ring-2 ring-purple-400'
                                        : isDark
                                        ? 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
                                        : 'bg-slate-50 hover:bg-purple-50/50 border-slate-200 text-slate-900'
                                }`}
                            >
                                <div className="w-12 h-12 rounded-2xl bg-purple-500/20 text-purple-400 flex items-center justify-center text-2xl shrink-0 group-hover:scale-110 transition-transform">
                                    <Building2 className="w-6 h-6 text-purple-400" />
                                </div>
                                <div>
                                    <h3 className="text-base font-black flex items-center gap-1.5">
                                        <span>🏢 Business</span>
                                    </h3>
                                    <p className={`text-xs mt-1 leading-snug ${placeType === 'business' ? 'text-purple-100' : subTextColor}`}>
                                        Store, restaurant, office, shopping plaza, medical facility, or warehouse.
                                    </p>
                                </div>
                            </button>
                        </div>

                        {/* Step 2 Footer */}
                        <div className="pt-2 text-center">
                            <button
                                type="button"
                                onClick={handleSkip}
                                className={`text-xs font-semibold hover:underline py-1 transition-colors cursor-pointer ${subTextColor}`}
                            >
                                Skip this step
                            </button>
                        </div>
                    </div>
                )}

                {/* ========================================================================= */}
                {/* STEP 3: Pin Accuracy Check                                               */}
                {/* ========================================================================= */}
                {step === 3 && (
                    <div className="flex flex-col flex-1 relative z-10 p-5 sm:p-6 space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="text-center space-y-1">
                            <h2 className={`text-xl sm:text-2xl font-black tracking-tight ${textColor}`}>
                                Was the map pin accurate?
                            </h2>
                            <p className={`text-xs ${subTextColor}`}>
                                Destination: <span className="font-bold">{arrivalData.destinationName}</span>
                            </p>
                        </div>

                        {/* Two Touch-Friendly Accuracy Options */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 my-auto">
                            {/* YES: It was perfect */}
                            <button
                                type="button"
                                onClick={handlePinAccurateYes}
                                className={`p-5 rounded-3xl border text-left flex flex-col justify-between gap-3 transition-all duration-200 group active:scale-95 cursor-pointer shadow-md ${
                                    isDark
                                        ? 'bg-emerald-950/40 hover:bg-emerald-900/50 border-emerald-500/40 text-white'
                                        : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-slate-900'
                                }`}
                            >
                                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-2xl shrink-0 group-hover:scale-110 transition-transform">
                                    <Check className="w-6 h-6 text-emerald-400" />
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-emerald-500 flex items-center gap-1.5">
                                        <span>✅ Yes, it was perfect</span>
                                    </h3>
                                    <p className={`text-xs mt-1 leading-snug ${isDark ? 'text-emerald-200' : 'text-slate-600'}`}>
                                        The pin navigated straight to the true entrance, front door, or driveway.
                                    </p>
                                </div>
                            </button>

                            {/* NO: It was off */}
                            <button
                                type="button"
                                onClick={handlePinAccurateNo}
                                className={`p-5 rounded-3xl border text-left flex flex-col justify-between gap-3 transition-all duration-200 group active:scale-95 cursor-pointer shadow-md ${
                                    isDark
                                        ? 'bg-amber-950/40 hover:bg-amber-900/50 border-amber-500/40 text-white'
                                        : 'bg-amber-50 hover:bg-amber-100 border-amber-200 text-slate-900'
                                }`}
                            >
                                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center text-2xl shrink-0 group-hover:scale-110 transition-transform">
                                    <MapPin className="w-6 h-6 text-amber-400" />
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-amber-500 flex items-center gap-1.5">
                                        <span>❌ No, it was off</span>
                                    </h3>
                                    <p className={`text-xs mt-1 leading-snug ${isDark ? 'text-amber-200' : 'text-slate-600'}`}>
                                        The pin dropped on the wrong street, back alley, or far away from the door.
                                    </p>
                                </div>
                            </button>
                        </div>

                        {/* Step 3 Footer */}
                        <div className="pt-2 text-center">
                            <button
                                type="button"
                                onClick={handleSkip}
                                className={`text-xs font-semibold hover:underline py-1 transition-colors cursor-pointer ${subTextColor}`}
                            >
                                Skip and close
                            </button>
                        </div>
                    </div>
                )}

                {/* ========================================================================= */}
                {/* STEP 4: Pin Correction (Conditional)                                     */}
                {/* ========================================================================= */}
                {step === 4 && (
                    <div className="flex flex-col flex-1 relative z-10 p-4 sm:p-5 space-y-3 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="text-center space-y-0.5">
                            <h2 className={`text-lg sm:text-xl font-black tracking-tight ${textColor}`}>
                                Drag map to the exact entrance
                            </h2>
                            <p className={`text-[11px] ${subTextColor}`}>
                                Center the crosshair reticle over the building door or driveway.
                            </p>
                        </div>

                        {/* Interactive Miniature Map with Fixed Reticle */}
                        <div className="relative w-full h-56 sm:h-64 rounded-3xl overflow-hidden border border-white/15 shadow-inner bg-slate-950 shrink-0">
                            <div ref={mapContainerRef} className="absolute inset-0 w-full h-full rounded-3xl" />

                            {/* Centered Crosshair Reticle (identical to Update Place Details UX) */}
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                <div className="relative pointer-events-none flex flex-col items-center">
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full border-2 border-amber-400/60 bg-amber-500/15 animate-ping" />
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-400 border-2 border-white shadow-[0_0_10px_rgba(251,191,36,1)] z-20" />

                                    <div className="relative flex flex-col items-center -translate-y-[calc(100%+2px)]">
                                        <div className="relative z-10 w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-amber-600 border-[3px] border-white shadow-2xl flex items-center justify-center text-white">
                                            <MapPin className="w-5 h-5 shrink-0" />
                                        </div>
                                        <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-amber-600 -mt-0.5 filter drop-shadow(0 2px 4px rgba(0,0,0,0.5))" />
                                        <div className="w-5 h-2 rounded-full bg-black/50 blur-[2px] mt-1" />
                                    </div>
                                </div>
                            </div>

                            {/* Floating Map Tools */}
                            <div className="absolute top-2.5 right-2.5 flex flex-col gap-1.5 z-10">
                                {userLocation && (
                                    <button
                                        type="button"
                                        onClick={handleSnapToGps}
                                        className="px-2.5 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-white text-[11px] font-bold border border-white/20 shadow-md backdrop-blur-md flex items-center gap-1 active:scale-95 cursor-pointer"
                                        title="Center on my GPS location"
                                    >
                                        <LocateFixed className="w-3.5 h-3.5 text-amber-400" />
                                        <span>My GPS</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={handleResetLocation}
                                    className="px-2.5 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 text-[11px] font-bold border border-white/20 shadow-md backdrop-blur-md flex items-center gap-1 active:scale-95 cursor-pointer"
                                    title="Reset to original pin"
                                >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    <span>Reset</span>
                                </button>
                                <div className="flex flex-col bg-slate-900/90 border border-white/20 rounded-xl overflow-hidden divide-y divide-white/10 shadow-md">
                                    <button
                                        type="button"
                                        onClick={handleZoomIn}
                                        className="w-8 h-8 flex items-center justify-center text-white hover:bg-white/20 text-sm font-bold active:scale-95 cursor-pointer"
                                        title="Zoom in"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleZoomOut}
                                        className="w-8 h-8 flex items-center justify-center text-white hover:bg-white/20 text-sm font-bold active:scale-95 cursor-pointer"
                                        title="Zoom out"
                                    >
                                        <Minus className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Live Pin Coordinates Pill */}
                            <div className="absolute bottom-2 left-2 pointer-events-none">
                                <div className="px-2.5 py-1 rounded-lg bg-slate-950/85 backdrop-blur-md border border-white/15 text-[9px] font-mono text-amber-300 font-black shadow-md">
                                    LAT: {currentCoords.lat.toFixed(6)} • LNG: {currentCoords.lng.toFixed(6)}
                                </div>
                            </div>
                        </div>

                        {/* Entrance Type Pill Selector */}
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
                            {[
                                { id: 'main_door' as const, label: '🚪 Main Door' },
                                { id: 'driveway' as const, label: '🛣️ Driveway' },
                                { id: 'parking' as const, label: '🅿️ Parking' },
                                { id: 'curbside' as const, label: '📦 Curbside' },
                            ].map((opt) => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => setEntranceType(opt.id)}
                                    className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-all border cursor-pointer ${
                                        entranceType === opt.id
                                            ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                                            : isDark
                                            ? 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                                            : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        {/* Storefront Photo Capture (Optional) */}
                        <div className="flex items-center gap-2">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handlePhotoUpload}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                                    photoPreview
                                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
                                        : isDark
                                        ? 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                                }`}
                            >
                                <Camera className="w-4 h-4" />
                                <span>{photoPreview ? '📸 Entrance Photo Added' : '+ Add Storefront Photo'}</span>
                            </button>
                        </div>

                        {/* Step 4 Footer: "Save True Location" & Skip */}
                        <div className="pt-2 flex flex-col gap-2">
                            <button
                                type="button"
                                onClick={handleSaveTrueLocation}
                                disabled={isSaving}
                                className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-lg shadow-emerald-600/30 transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                                <Check className="w-4 h-4" />
                                <span>{isSaving ? 'Saving True Location...' : 'Save True Location'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleSkip}
                                className={`text-xs font-semibold text-center hover:underline py-1 transition-colors cursor-pointer ${subTextColor}`}
                            >
                                Skip for now
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export const ArrivalPromptModal = TripCompletedCard;
export default TripCompletedCard;
