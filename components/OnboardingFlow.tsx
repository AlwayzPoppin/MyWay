import React, { useState, useEffect } from 'react';

interface OnboardingFlowProps {
    onComplete: () => void;
    theme: 'light' | 'dark';
}

type PermissionStatus = 'unknown' | 'granted' | 'denied' | 'prompt';

interface OnboardingStep {
    id: string;
    title: string;
    description: string;
    icon: string;
    action?: () => Promise<void>;
    optional?: boolean;
}

const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete, theme }) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [locationPermission, setLocationPermission] = useState<PermissionStatus>('unknown');
    const [notificationPermission, setNotificationPermission] = useState<PermissionStatus>('unknown');
    const [isRequesting, setIsRequesting] = useState(false);

    // Check existing permissions on mount
    useEffect(() => {
        checkPermissions();
    }, []);

    const checkPermissions = async () => {
        // Check location
        if ('permissions' in navigator) {
            try {
                const geo = await navigator.permissions.query({ name: 'geolocation' });
                setLocationPermission(geo.state as PermissionStatus);
            } catch {
                setLocationPermission('prompt');
            }
        }

        // Check notifications
        if ('Notification' in window) {
            setNotificationPermission(Notification.permission as PermissionStatus);
        }
    };

    const requestLocation = async () => {
        setIsRequesting(true);
        try {
            await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000
                });
            });
            setLocationPermission('granted');
        } catch (error) {
            setLocationPermission('denied');
        }
        setIsRequesting(false);
    };

    const requestNotifications = async () => {
        setIsRequesting(true);
        try {
            const result = await Notification.requestPermission();
            setNotificationPermission(result as PermissionStatus);
        } catch {
            setNotificationPermission('denied');
        }
        setIsRequesting(false);
    };

    const steps: OnboardingStep[] = [
        {
            id: 'welcome',
            title: 'Welcome to MyWay',
            description: 'Your family\'s intelligent navigation companion. Track loved ones, discover places, and drive safer together.',
            icon: '🗺️'
        },
        {
            id: 'location',
            title: 'Enable Location',
            description: 'MyWay needs your location to show nearby places, track your journey, and share your position with family.',
            icon: '📍',
            action: requestLocation
        },
        {
            id: 'notifications',
            title: 'Stay Informed',
            description: 'Get alerts when family members arrive, leave, or need assistance. Never miss an important update.',
            icon: '🔔',
            action: requestNotifications,
            optional: true
        },
        {
            id: 'ready',
            title: 'You\'re All Set!',
            description: 'Start exploring with your family. Create or join a Circle to connect with loved ones.',
            icon: '🚀'
        }
    ];

    const handleNext = async () => {
        const step = steps[currentStep];

        if (step.action) {
            await step.action();
        }

        if (currentStep < steps.length - 1) {
            setCurrentStep(prev => prev + 1);
        } else {
            // Mark onboarding complete
            localStorage.setItem('myway_onboarding_complete', 'true');
            onComplete();
        }
    };

    const handleSkip = () => {
        if (currentStep < steps.length - 1) {
            setCurrentStep(prev => prev + 1);
        } else {
            localStorage.setItem('myway_onboarding_complete', 'true');
            onComplete();
        }
    };

    const step = steps[currentStep];
    const isDark = theme === 'dark';

    return (
        <div className={`fixed inset-0 z-[200] flex items-center justify-center ${isDark ? 'bg-[#050914]' : 'bg-white'}`}>
            {/* Animated background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -left-40 w-96 h-96 bg-gradient-to-br from-amber-500/20 to-orange-500/10 rounded-full blur-3xl animate-pulse" />
                <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-gradient-to-br from-indigo-500/20 to-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
            </div>

            <div className="relative max-w-md w-full mx-4 text-center">
                {/* Progress dots */}
                <div className="flex justify-center gap-2 mb-8">
                    {steps.map((_, index) => (
                        <div
                            key={index}
                            className={`w-2 h-2 rounded-full transition-all duration-300 ${index === currentStep
                                ? 'w-8 bg-gradient-to-r from-amber-400 to-orange-500'
                                : index < currentStep
                                    ? 'bg-amber-500'
                                    : isDark ? 'bg-white/20' : 'bg-gray-300'
                                }`}
                        />
                    ))}
                </div>

                {/* Icon */}
                <div className="text-8xl mb-6 animate-bounce" style={{ animationDuration: '2s' }}>
                    {step.icon}
                </div>

                {/* Title */}
                <h1 className={`text-3xl font-black mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {step.title}
                </h1>

                {/* Description */}
                <p className={`text-lg mb-8 leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    {step.description}
                </p>

                {/* Permission status indicators */}
                {step.id === 'location' && locationPermission !== 'unknown' && (
                    <div className={`mb-6 px-4 py-2 rounded-full inline-block ${locationPermission === 'granted'
                        ? 'bg-green-500/20 text-green-400'
                        : locationPermission === 'denied'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-amber-500/20 text-amber-400'
                        }`}>
                        {locationPermission === 'granted' ? '✓ Location enabled' :
                            locationPermission === 'denied' ? '✗ Location denied' :
                                'Waiting for permission...'}
                    </div>
                )}

                {step.id === 'location' && locationPermission === 'denied' && (
                    <p className="text-sm text-red-400 mb-6 bg-red-500/10 p-3 rounded-lg">
                        ⚠️ Please enable Location in your browser settings (tap the lock icon 🔒 or 'AA' in the URL bar).
                    </p>
                )}

                {step.id === 'notifications' && notificationPermission !== 'unknown' && (
                    <div className={`mb-6 px-4 py-2 rounded-full inline-block ${notificationPermission === 'granted'
                        ? 'bg-green-500/20 text-green-400'
                        : notificationPermission === 'denied'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-amber-500/20 text-amber-400'
                        }`}>
                        {notificationPermission === 'granted' ? '✓ Notifications enabled' :
                            notificationPermission === 'denied' ? '✗ Notifications denied' :
                                'Waiting for permission...'}
                    </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-col gap-3">
                    <button
                        onClick={handleNext}
                        disabled={isRequesting}
                        className={`w-full py-4 rounded-2xl font-black text-lg transition-all duration-300 transform hover:scale-105 active:scale-95 ${isRequesting
                            ? 'bg-gray-500 cursor-wait'
                            : 'bg-gradient-to-r from-amber-400 to-orange-500 text-black shadow-lg hover:shadow-amber-500/30'
                            }`}
                    >
                        {isRequesting ? (
                            <span className="flex items-center justify-center gap-2">
                                <span className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                                Requesting...
                            </span>
                        ) : (
                            currentStep === steps.length - 1 ? 'Get Started' : step.action ? 'Enable' : 'Continue'
                        )}
                    </button>

                    {step.optional && (
                        <button
                            onClick={handleSkip}
                            className={`w-full py-3 rounded-2xl font-bold transition-all ${isDark
                                ? 'text-gray-400 hover:text-white hover:bg-white/10'
                                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                                }`}
                        >
                            Skip for now
                        </button>
                    )}
                </div>
            </div>
        </div >
    );
};

export default OnboardingFlow;
