import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { User } from 'firebase/auth';
import { UserProfile, updateUserProfile, uploadProfileImage } from '../services/authService';
import { searchPlacesText } from '../services/placesService';
import { addUserPlace } from '../services/userPlacesService';
import { compressImageFile } from '../services/placeCorrectionService';
import { Location, Place } from '../types';
import { hapticTick, hapticSuccess, hapticError } from '../utils/haptics';

interface SetupWizardModalProps {
    isOpen: boolean;
    user: User | null;
    profile: UserProfile | null;
    theme?: 'light' | 'dark';
    userLocation?: Location | null;
    onComplete: (updatedProfile: Partial<UserProfile>) => void;
}

type WizardStep = 1 | 2 | 3;

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({
    isOpen,
    user,
    profile,
    theme = 'dark',
    userLocation,
    onComplete
}) => {
    const isDark = theme === 'dark';

    // Step state
    const [currentStep, setCurrentStep] = useState<WizardStep>(1);

    // Step 1: Social Profile State
    const [fullName, setFullName] = useState(profile?.displayName || user?.displayName || '');
    const [dob, setDob] = useState(profile?.dateOfBirth || '');
    const [gender, setGender] = useState<string>(profile?.gender || 'prefer_not_to_say');
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(profile?.photoURL || user?.photoURL || null);
    const [profileError, setProfileError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Step 2: Home Base Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Place[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedHomePlace, setSelectedHomePlace] = useState<Place | null>(null);
    const [homeAddressError, setHomeAddressError] = useState<string | null>(null);
    const searchTimeoutRef = useRef<any>(null);

    // Step 3: Precision Pin Drop State
    const [precisionCoords, setPrecisionCoords] = useState<{ lat: number; lng: number }>({
        lat: 35.105,
        lng: -78.966
    });
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
    const [isMapReady, setIsMapReady] = useState(false);

    // Submission state
    const [isSaving, setIsSaving] = useState(false);

    // Initialize or sync defaults when profile/user changes
    useEffect(() => {
        if (profile?.displayName || user?.displayName) {
            setFullName(prev => prev || profile?.displayName || user?.displayName || '');
        }
        if (profile?.photoURL || user?.photoURL) {
            setAvatarPreview(prev => prev || profile?.photoURL || user?.photoURL || null);
        }
        if (profile?.dateOfBirth) {
            setDob(profile.dateOfBirth);
        }
        if (profile?.gender) {
            setGender(profile.gender);
        }
    }, [profile, user]);

    // Handle avatar file selection with preview
    const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const compressed = await compressImageFile(file, 600, 600, 0.85);
            setAvatarFile(compressed);
            const objectUrl = URL.createObjectURL(compressed);
            setAvatarPreview(objectUrl);
            hapticTick();
        } catch (err) {
            console.error('Failed to compress avatar:', err);
            setAvatarFile(file);
            setAvatarPreview(URL.createObjectURL(file));
        }
    };

    // Step 1 Validation & Proceed
    const handleNextToStep2 = () => {
        if (!fullName.trim()) {
            setProfileError('Please enter your full name');
            hapticError();
            return;
        }
        setProfileError(null);
        hapticSuccess();
        setCurrentStep(2);
    };

    // Debounced search for Step 2
    useEffect(() => {
        if (currentStep !== 2) return;
        const query = searchQuery.trim();
        if (query.length < 3) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const results = await searchPlacesText(query, userLocation || undefined);
                setSearchResults(results);
            } catch (err) {
                console.error('Failed to search home addresses:', err);
            } finally {
                setIsSearching(false);
            }
        }, 350);

        return () => {
            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        };
    }, [searchQuery, currentStep, userLocation]);

    // Step 2 Address Selection
    const handleSelectAddress = (place: Place) => {
        hapticTick();
        setSelectedHomePlace(place);
        setPrecisionCoords({
            lat: parseFloat(place.location.lat.toFixed(6)),
            lng: parseFloat(place.location.lng.toFixed(6))
        });
        setHomeAddressError(null);
    };

    // Step 2 "Use Current Location" quick action
    const handleUseCurrentLocation = () => {
        if (!userLocation) {
            setHomeAddressError('Current location unavailable. Please search your address above.');
            hapticError();
            return;
        }
        hapticTick();
        const currentPlace: Place = {
            id: `cur_loc_${Date.now()}`,
            name: 'Current Location',
            address: 'Your current location',
            description: 'Your current location',
            location: {
                lat: userLocation.lat,
                lng: userLocation.lng
            },
            category: 'home'
        };
        setSelectedHomePlace(currentPlace);
        setPrecisionCoords({
            lat: parseFloat(userLocation.lat.toFixed(6)),
            lng: parseFloat(userLocation.lng.toFixed(6))
        });
        setHomeAddressError(null);
    };

    // Step 2 Proceed to Step 3
    const handleNextToStep3 = () => {
        if (!selectedHomePlace) {
            setHomeAddressError('Please select your home address before continuing');
            hapticError();
            return;
        }
        setHomeAddressError(null);
        hapticSuccess();
        setCurrentStep(3);
    };

    // Initialize MapLibre Interactive Drill-Down Map when entering Step 3
    useEffect(() => {
        if (currentStep !== 3 || !mapContainerRef.current) return;

        const initialLat = precisionCoords.lat || 35.105;
        const initialLng = precisionCoords.lng || -78.966;

        const mapStyleUrl = isDark
            ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
            : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

        const map = new maplibregl.Map({
            container: mapContainerRef.current,
            style: mapStyleUrl,
            center: [initialLng, initialLat],
            zoom: 19.5, // High precision zoom for driveway / door placement
            pitch: 0,
            attributionControl: false
        });

        mapInstanceRef.current = map;

        // Create Custom Draggable Marker Element with Glowing Amber Pin
        const markerEl = document.createElement('div');
        markerEl.className = 'w-10 h-10 -ml-5 -mt-10 cursor-grab active:cursor-grabbing select-none relative group';
        markerEl.innerHTML = `
            <div class="w-10 h-10 rounded-full bg-amber-500/30 animate-ping absolute inset-0 pointer-events-none"></div>
            <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-600 to-amber-400 border-2 border-white shadow-[0_4px_16px_rgba(245,158,11,0.6)] flex items-center justify-center text-lg text-slate-950 font-black relative z-10 transition-transform hover:scale-110">
                📍
            </div>
            <div class="w-2.5 h-2.5 bg-amber-500 rounded-full mx-auto -mt-1 border border-white shadow"></div>
        `;

        const marker = new maplibregl.Marker({
            element: markerEl,
            draggable: true
        })
            .setLngLat([initialLng, initialLat])
            .addTo(map);

        markerRef.current = marker;

        marker.on('drag', () => {
            const lngLat = marker.getLngLat();
            setPrecisionCoords({
                lat: parseFloat(lngLat.lat.toFixed(6)),
                lng: parseFloat(lngLat.lng.toFixed(6))
            });
        });

        marker.on('dragend', () => {
            hapticTick();
            const lngLat = marker.getLngLat();
            setPrecisionCoords({
                lat: parseFloat(lngLat.lat.toFixed(6)),
                lng: parseFloat(lngLat.lng.toFixed(6))
            });
        });

        // Allow clicking anywhere on the map to jump the pin there
        map.on('click', (e) => {
            hapticTick();
            marker.setLngLat(e.lngLat);
            setPrecisionCoords({
                lat: parseFloat(e.lngLat.lat.toFixed(6)),
                lng: parseFloat(e.lngLat.lng.toFixed(6))
            });
        });

        map.on('load', () => {
            setIsMapReady(true);
            map.resize();
        });

        const resizeTimer = setTimeout(() => {
            map.resize();
        }, 200);

        return () => {
            clearTimeout(resizeTimer);
            marker.remove();
            map.remove();
            mapInstanceRef.current = null;
            markerRef.current = null;
            setIsMapReady(false);
        };
    }, [currentStep, isDark]);

    // Recenter map on pin
    const handleRecenterMap = () => {
        if (mapInstanceRef.current && precisionCoords) {
            hapticTick();
            mapInstanceRef.current.flyTo({
                center: [precisionCoords.lng, precisionCoords.lat],
                zoom: 19.5,
                essential: true
            });
        }
    };

    // Zoom handlers for Step 3 Map
    const handleZoomIn = () => {
        if (mapInstanceRef.current) {
            mapInstanceRef.current.zoomIn();
            hapticTick();
        }
    };
    const handleZoomOut = () => {
        if (mapInstanceRef.current) {
            mapInstanceRef.current.zoomOut();
            hapticTick();
        }
    };

    // Final Completion Handler
    const handleCompleteSetup = async () => {
        if (!user || isSaving) return;
        setIsSaving(true);
        try {
            hapticSuccess();

            let finalPhotoUrl = profile?.photoURL || user.photoURL || null;
            if (avatarFile) {
                try {
                    finalPhotoUrl = await uploadProfileImage(user.uid, avatarFile);
                } catch (uploadErr) {
                    console.warn('[SetupWizard] Failed to upload avatar to storage:', uploadErr);
                }
            }

            const homeAddressString = selectedHomePlace?.address || selectedHomePlace?.description || selectedHomePlace?.name || 'Home';

            // 1. Update Firebase User Profile Document
            const profileUpdates: Partial<UserProfile> = {
                displayName: fullName.trim(),
                photoURL: finalPhotoUrl,
                dateOfBirth: dob || undefined,
                gender: gender || 'prefer_not_to_say',
                hasCompletedSetup: true,
                preciseHomeLocation: {
                    lat: precisionCoords.lat,
                    lng: precisionCoords.lng,
                    address: homeAddressString,
                    label: 'Verified Precision Pin'
                }
            };

            await updateUserProfile(user.uid, profileUpdates);

            // 2. Automatically register "Home" in user's saved places & geofences
            try {
                const targetCircleId = profile?.familyCircleId || `user_${user.uid}`;
                await addUserPlace(
                    targetCircleId,
                    {
                        name: 'Home',
                        address: homeAddressString,
                        description: homeAddressString,
                        location: {
                            lat: precisionCoords.lat,
                            lng: precisionCoords.lng
                        },
                        category: 'home',
                        icon: 'home',
                        radius: 150, // Standard 150m arrival geofence
                        isCorrected: true,
                        entranceNotes: 'Precision front door / driveway routing pin',
                        tags: ['Verified Precision Pin', 'home']
                    },
                    user.uid
                );
            } catch (placeErr) {
                console.warn('[SetupWizard] Non-critical error saving Home place to circle:', placeErr);
            }

            // 3. Complete callback
            onComplete(profileUpdates);
        } catch (err) {
            console.error('[SetupWizard] Failed to complete setup:', err);
            hapticError();
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-fade-in">
            <div
                className={`w-full max-w-2xl rounded-3xl border shadow-2xl flex flex-col overflow-hidden transition-all duration-300 max-h-[92vh] ${
                    isDark
                        ? 'bg-slate-900/95 border-white/10 text-white'
                        : 'bg-white/95 border-slate-200 text-slate-900'
                }`}
            >
                {/* Modal Header & Progress Stepper */}
                <div className={`px-6 pt-6 pb-4 border-b shrink-0 ${isDark ? 'border-white/10' : 'border-slate-100'}`}>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">✨</span>
                            <h2 className="text-xl font-black tracking-tight">Welcome to MyWay</h2>
                        </div>
                        <span className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider ${
                            isDark ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-amber-100 text-amber-800'
                        }`}>
                            Step {currentStep} of 3
                        </span>
                    </div>

                    {/* Progress Bar Indicators */}
                    <div className="grid grid-cols-3 gap-2">
                        {/* Step 1 Pill */}
                        <div className="flex flex-col gap-1.5">
                            <div className={`h-1.5 rounded-full transition-all duration-300 ${
                                currentStep >= 1 ? 'bg-amber-500' : isDark ? 'bg-white/10' : 'bg-slate-200'
                            }`} />
                            <span className={`text-[10px] font-bold uppercase tracking-wider truncate ${
                                currentStep === 1 ? 'text-amber-400' : 'opacity-40'
                            }`}>
                                1. Social Profile
                            </span>
                        </div>

                        {/* Step 2 Pill */}
                        <div className="flex flex-col gap-1.5">
                            <div className={`h-1.5 rounded-full transition-all duration-300 ${
                                currentStep >= 2 ? 'bg-amber-500' : isDark ? 'bg-white/10' : 'bg-slate-200'
                            }`} />
                            <span className={`text-[10px] font-bold uppercase tracking-wider truncate ${
                                currentStep === 2 ? 'text-amber-400' : 'opacity-40'
                            }`}>
                                2. Home Base
                            </span>
                        </div>

                        {/* Step 3 Pill */}
                        <div className="flex flex-col gap-1.5">
                            <div className={`h-1.5 rounded-full transition-all duration-300 ${
                                currentStep >= 3 ? 'bg-amber-500' : isDark ? 'bg-white/10' : 'bg-slate-200'
                            }`} />
                            <span className={`text-[10px] font-bold uppercase tracking-wider truncate ${
                                currentStep === 3 ? 'text-amber-400' : 'opacity-40'
                            }`}>
                                3. Precision Pin
                            </span>
                        </div>
                    </div>
                </div>

                {/* Modal Body: Dynamic Step Content */}
                <div className="flex-1 overflow-y-auto px-6 py-5">
                    {/* ================= STEP 1: THE SOCIAL PROFILE ================= */}
                    {currentStep === 1 && (
                        <div className="space-y-5 animate-fade-in">
                            <div>
                                <h3 className="text-lg font-black tracking-tight mb-1">Build Your Social Profile</h3>
                                <p className={`text-xs font-medium leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                    Set up your profile so your Circle knows it's you—and so we never miss a birthday!
                                </p>
                            </div>

                            {/* Avatar Picker */}
                            <div className="flex flex-col items-center justify-center pt-2 pb-1">
                                <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                    <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-amber-500/80 shadow-[0_0_20px_rgba(245,158,11,0.25)] flex items-center justify-center bg-slate-800 transition-transform group-hover:scale-105">
                                        {avatarPreview ? (
                                            <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="text-3xl font-black text-amber-400">
                                                {fullName ? fullName.charAt(0).toUpperCase() : '👤'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-xs font-bold">
                                        Change
                                    </div>
                                    <button
                                        type="button"
                                        aria-label="Upload photo"
                                        className="absolute bottom-0 right-0 p-2 rounded-full bg-amber-500 text-slate-950 shadow-md hover:bg-amber-400 transition-colors"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </button>
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleAvatarSelect}
                                    className="hidden"
                                />
                                <span className={`text-[11px] font-bold mt-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                    Tap to upload a profile photo
                                </span>
                            </div>

                            {/* Full Name */}
                            <div className="space-y-1.5">
                                <label className={`block text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                                    Full Name <span className="text-amber-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={fullName}
                                    onChange={(e) => {
                                        setFullName(e.target.value);
                                        if (profileError) setProfileError(null);
                                    }}
                                    placeholder="e.g. Alex Sterling"
                                    className={`w-full px-4 py-3 rounded-2xl text-sm font-semibold border transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                                        isDark
                                            ? 'bg-white/5 border-white/10 text-white placeholder-slate-500'
                                            : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400'
                                    }`}
                                />
                                {profileError && (
                                    <p className="text-xs font-bold text-rose-400 mt-1">{profileError}</p>
                                )}
                            </div>

                            {/* Date of Birth & Gender Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Date of Birth */}
                                <div className="space-y-1.5">
                                    <label className={`block text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                                        Date of Birth 🎂
                                    </label>
                                    <input
                                        type="date"
                                        value={dob}
                                        onChange={(e) => setDob(e.target.value)}
                                        className={`w-full px-4 py-3 rounded-2xl text-sm font-semibold border transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                                            isDark
                                                ? 'bg-white/5 border-white/10 text-white [color-scheme:dark]'
                                                : 'bg-slate-50 border-slate-200 text-slate-900'
                                        }`}
                                    />
                                    <p className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                        Used for Circle birthday celebration notifications
                                    </p>
                                </div>

                                {/* Gender Dropdown */}
                                <div className="space-y-1.5">
                                    <label className={`block text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                                        Gender
                                    </label>
                                    <select
                                        value={gender}
                                        onChange={(e) => setGender(e.target.value)}
                                        className={`w-full px-4 py-3 rounded-2xl text-sm font-semibold border transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50 cursor-pointer ${
                                            isDark
                                                ? 'bg-slate-800 border-white/10 text-white'
                                                : 'bg-slate-50 border-slate-200 text-slate-900'
                                        }`}
                                    >
                                        <option value="prefer_not_to_say">Prefer not to say</option>
                                        <option value="female">Female</option>
                                        <option value="male">Male</option>
                                        <option value="non_binary">Non-Binary</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ================= STEP 2: THE HOME BASE ================= */}
                    {currentStep === 2 && (
                        <div className="space-y-4 animate-fade-in">
                            <div>
                                <h3 className="text-lg font-black tracking-tight mb-1">Set Your Home Base</h3>
                                <p className={`text-xs font-medium leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                    Where does your journey start? Search your home address for circle arrival alerts, route guidance, and precision geofencing.
                                </p>
                            </div>

                            {/* Search Box */}
                            <div className="space-y-2">
                                <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base opacity-50">
                                        🔍
                                    </span>
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search street address, city, or zip..."
                                        className={`w-full pl-11 pr-10 py-3.5 rounded-2xl text-sm font-semibold border transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                                            isDark
                                                ? 'bg-white/5 border-white/10 text-white placeholder-slate-500'
                                                : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400'
                                        }`}
                                    />
                                    {isSearching && (
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                                    )}
                                </div>

                                <div className="flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={handleUseCurrentLocation}
                                        className={`text-xs font-bold flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                                            isDark
                                                ? 'bg-white/5 border-white/10 text-amber-400 hover:bg-white/10'
                                                : 'bg-slate-100 border-slate-200 text-amber-700 hover:bg-slate-200'
                                        }`}
                                    >
                                        <span>📍</span>
                                        <span>Use My Current Location</span>
                                    </button>
                                </div>
                            </div>

                            {/* Autocomplete Results List */}
                            {searchResults.length > 0 && !selectedHomePlace && (
                                <div className={`rounded-2xl border divide-y overflow-hidden max-h-56 overflow-y-auto ${
                                    isDark ? 'bg-slate-800/80 border-white/10 divide-white/5' : 'bg-white border-slate-200 divide-slate-100'
                                }`}>
                                    {searchResults.map((place) => (
                                        <div
                                            key={place.id || `${place.location.lat}_${place.location.lng}`}
                                            onClick={() => handleSelectAddress(place)}
                                            className={`px-4 py-3 flex items-start gap-3 cursor-pointer transition-colors ${
                                                isDark ? 'hover:bg-white/5' : 'hover:bg-slate-50'
                                            }`}
                                        >
                                            <span className="text-base shrink-0 mt-0.5">🏠</span>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-bold truncate">{place.name}</p>
                                                <p className={`text-[11px] truncate opacity-70 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                                    {place.address || place.description}
                                                </p>
                                            </div>
                                            <span className="text-xs text-amber-400 font-bold shrink-0">Select</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Selected Home Address Card */}
                            {selectedHomePlace && (
                                <div className={`p-4 rounded-2xl border flex items-start justify-between gap-3 ${
                                    isDark
                                        ? 'bg-gradient-to-r from-amber-500/10 to-transparent border-amber-500/40 text-white'
                                        : 'bg-amber-50 border-amber-300 text-slate-900'
                                }`}>
                                    <div className="flex items-start gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl shrink-0">
                                            🏠
                                        </div>
                                        <div className="min-w-0">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
                                                Selected Home Address
                                            </span>
                                            <h4 className="text-sm font-black truncate">{selectedHomePlace.name}</h4>
                                            <p className={`text-xs truncate opacity-80 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                                                {selectedHomePlace.address || selectedHomePlace.description}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedHomePlace(null)}
                                        className="text-xs font-bold opacity-60 hover:opacity-100 px-2 py-1 shrink-0"
                                    >
                                        Change
                                    </button>
                                </div>
                            )}

                            {homeAddressError && (
                                <p className="text-xs font-bold text-rose-400">{homeAddressError}</p>
                            )}
                        </div>
                    )}

                    {/* ================= STEP 3: PRECISION PIN DROP (DRILL-DOWN) ================= */}
                    {currentStep === 3 && (
                        <div className="space-y-3 animate-fade-in">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-lg font-black tracking-tight">Precision Pin Drop</h3>
                                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                        Verified Precision Pin
                                    </span>
                                </div>
                                <p className={`text-xs font-medium leading-relaxed mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                    Hold and drag the pin to your exact driveway or front door for precise routing.
                                </p>
                            </div>

                            {/* Map Container */}
                            <div className="relative w-full h-72 sm:h-80 rounded-2xl overflow-hidden border border-white/10 shadow-inner">
                                <div ref={mapContainerRef} className="w-full h-full" />

                                {/* High-Contrast Instruction Overlay Badge */}
                                <div className="absolute top-3 left-3 right-3 pointer-events-none flex justify-center">
                                    <div className="px-3 py-1.5 rounded-xl bg-slate-950/80 backdrop-blur-md border border-white/15 text-white text-[11px] font-bold shadow-lg flex items-center gap-1.5">
                                        <span>📍</span>
                                        <span>Drag pin or tap map to place exact entrance</span>
                                    </div>
                                </div>

                                {/* Map Controls */}
                                <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 z-10">
                                    <button
                                        type="button"
                                        onClick={handleRecenterMap}
                                        title="Recenter on pin"
                                        className="w-8 h-8 rounded-xl bg-slate-900/90 text-white border border-white/20 flex items-center justify-center text-sm shadow hover:bg-slate-800 transition-colors"
                                    >
                                        🎯
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleZoomIn}
                                        title="Zoom In"
                                        className="w-8 h-8 rounded-xl bg-slate-900/90 text-white border border-white/20 flex items-center justify-center text-base font-bold shadow hover:bg-slate-800 transition-colors"
                                    >
                                        +
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleZoomOut}
                                        title="Zoom Out"
                                        className="w-8 h-8 rounded-xl bg-slate-900/90 text-white border border-white/20 flex items-center justify-center text-base font-bold shadow hover:bg-slate-800 transition-colors"
                                    >
                                        -
                                    </button>
                                </div>

                                {/* Precision Coordinate Pills */}
                                <div className="absolute bottom-3 left-3 pointer-events-none">
                                    <div className="px-2.5 py-1 rounded-lg bg-slate-950/85 backdrop-blur-md border border-white/10 text-[10px] font-mono text-amber-300 font-bold shadow">
                                        LAT: {precisionCoords.lat.toFixed(6)} • LNG: {precisionCoords.lng.toFixed(6)}
                                    </div>
                                </div>
                            </div>

                            {/* Verification Tag Notice */}
                            <div className={`px-3 py-2 rounded-xl border flex items-center gap-2 text-xs ${
                                isDark ? 'bg-white/5 border-white/10 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
                            }`}>
                                <span className="text-base">🛡️</span>
                                <p className="text-[11px] leading-tight font-medium">
                                    This pin is saved to your profile and tagged as <strong className="text-amber-400">Verified Precision Pin</strong> for family navigation accuracy.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Modal Footer: Navigation Controls */}
                <div className={`px-6 py-4 border-t flex items-center justify-between shrink-0 ${
                    isDark ? 'border-white/10 bg-slate-900/80' : 'border-slate-100 bg-slate-50/80'
                }`}>
                    {currentStep > 1 ? (
                        <button
                            type="button"
                            onClick={() => {
                                hapticTick();
                                setCurrentStep((prev) => (prev - 1) as WizardStep);
                            }}
                            className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-colors cursor-pointer ${
                                isDark ? 'text-slate-300 hover:bg-white/5' : 'text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            ← Back
                        </button>
                    ) : (
                        <div />
                    )}

                    {currentStep === 1 && (
                        <button
                            type="button"
                            onClick={handleNextToStep2}
                            className="px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-[0_4px_12px_rgba(245,158,11,0.3)] hover:brightness-110 active:scale-95 transition-all cursor-pointer flex items-center gap-2"
                        >
                            <span>Next: Set Home Base</span>
                            <span>➔</span>
                        </button>
                    )}

                    {currentStep === 2 && (
                        <button
                            type="button"
                            onClick={handleNextToStep3}
                            disabled={!selectedHomePlace}
                            className={`px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center gap-2 ${
                                selectedHomePlace
                                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-[0_4px_12px_rgba(245,158,11,0.3)] hover:brightness-110 active:scale-95 cursor-pointer'
                                    : 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-50'
                            }`}
                        >
                            <span>Next: Precision Pin</span>
                            <span>➔</span>
                        </button>
                    )}

                    {currentStep === 3 && (
                        <button
                            type="button"
                            onClick={handleCompleteSetup}
                            disabled={isSaving}
                            className="px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-gradient-to-r from-emerald-500 to-emerald-600 text-slate-950 shadow-[0_4px_16px_rgba(16,185,129,0.35)] hover:brightness-110 active:scale-95 transition-all cursor-pointer flex items-center gap-2"
                        >
                            {isSaving ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                                    <span>Saving Setup...</span>
                                </>
                            ) : (
                                <>
                                    <span>Complete Setup</span>
                                    <span>🎉</span>
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};
export default SetupWizardModal;
