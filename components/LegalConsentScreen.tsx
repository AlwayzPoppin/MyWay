import React, { useState } from 'react';

interface LegalConsentScreenProps {
    onAccept: () => void;
    theme: 'light' | 'dark';
}

/**
 * Legal Compliance Screen — ToS and Privacy Policy acceptance.
 * Displayed on first launch before the user can access the app.
 * Consent is stored in localStorage to avoid re-prompting.
 */
const LegalConsentScreen: React.FC<LegalConsentScreenProps> = ({ onAccept, theme }) => {
    const [tosAccepted, setTosAccepted] = useState(false);
    const [privacyAccepted, setPrivacyAccepted] = useState(false);
    const isDark = theme === 'dark';

    const handleAccept = () => {
        if (tosAccepted && privacyAccepted) {
            localStorage.setItem('myway_legal_consent', JSON.stringify({
                tos: true,
                privacy: true,
                version: '1.0',
                timestamp: Date.now(),
            }));
            onAccept();
        }
    };

    const canProceed = tosAccepted && privacyAccepted;

    return (
        <div className={`fixed inset-0 z-[300] flex items-center justify-center ${isDark ? 'bg-[#050914]' : 'bg-slate-50'}`}>
            <div className={`max-w-md w-full mx-6 rounded-3xl overflow-hidden border shadow-2xl ${
                isDark ? 'bg-slate-900/95 border-white/10' : 'bg-white border-slate-200'
            }`}>
                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-center">
                    <div className="text-5xl mb-3">🛡️</div>
                    <h1 className="text-2xl font-black text-white">Before You Start</h1>
                    <p className="text-indigo-200 text-sm mt-2">MyWay handles your precise location and safety data. Please review our policies.</p>
                </div>

                <div className="p-6 space-y-4">
                    {/* Terms of Service */}
                    <div className={`p-4 rounded-2xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                        <h3 className={`font-bold text-sm mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>📋 Terms of Service</h3>
                        <div className={`text-xs leading-relaxed max-h-24 overflow-y-auto pr-2 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                            <p>By using MyWay GPS, you agree to:</p>
                            <ul className="list-disc pl-4 mt-1 space-y-0.5">
                                <li>Use the app responsibly while driving</li>
                                <li>Not rely solely on the app for emergency services</li>
                                <li>Share location data only with your consented circle members</li>
                                <li>Acknowledge that GPS accuracy varies by device and environment</li>
                                <li>Accept that crash detection is advisory, not a substitute for 911</li>
                            </ul>
                        </div>
                        <label className="flex items-center gap-3 mt-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={tosAccepted}
                                onChange={(e) => setTosAccepted(e.target.checked)}
                                className="w-5 h-5 rounded accent-indigo-500"
                            />
                            <span className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                                I accept the Terms of Service
                            </span>
                        </label>
                    </div>

                    {/* Privacy Policy */}
                    <div className={`p-4 rounded-2xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                        <h3 className={`font-bold text-sm mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>🔒 Privacy Policy</h3>
                        <div className={`text-xs leading-relaxed max-h-24 overflow-y-auto pr-2 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                            <p>MyWay collects and processes:</p>
                            <ul className="list-disc pl-4 mt-1 space-y-0.5">
                                <li><strong>Location data</strong> — encrypted end-to-end, shared only within your circle</li>
                                <li><strong>Device sensors</strong> — accelerometer for crash detection (processed locally)</li>
                                <li><strong>Account info</strong> — email for authentication via Firebase</li>
                                <li>Data is stored in Firebase with encryption at rest</li>
                                <li>You can delete your data at any time by leaving your circle</li>
                            </ul>
                        </div>
                        <label className="flex items-center gap-3 mt-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={privacyAccepted}
                                onChange={(e) => setPrivacyAccepted(e.target.checked)}
                                className="w-5 h-5 rounded accent-indigo-500"
                            />
                            <span className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                                I accept the Privacy Policy
                            </span>
                        </label>
                    </div>

                    {/* Accept Button */}
                    <button
                        onClick={handleAccept}
                        disabled={!canProceed}
                        className={`w-full py-4 rounded-2xl font-bold text-base transition-all ${
                            canProceed
                                ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:opacity-90 shadow-lg'
                                : isDark
                                    ? 'bg-white/5 text-slate-600 cursor-not-allowed'
                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                        {canProceed ? '✓ Continue to MyWay' : 'Please accept both policies'}
                    </button>
                </div>
            </div>
        </div>
    );
};

/**
 * Check if user has already given legal consent.
 */
export const hasLegalConsent = (): boolean => {
    try {
        const consent = localStorage.getItem('myway_legal_consent');
        if (!consent) return false;
        const parsed = JSON.parse(consent);
        return parsed.tos === true && parsed.privacy === true;
    } catch {
        return false;
    }
};

export default LegalConsentScreen;
