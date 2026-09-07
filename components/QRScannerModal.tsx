import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode, CameraDevice } from 'html5-qrcode';
import {
    X,
    Flashlight,
    FlashlightOff,
    SwitchCamera,
    UploadCloud,
    AlertCircle,
    QrCode,
    Loader2,
    RefreshCw
} from 'lucide-react';
import { hapticSuccess, hapticError } from '../utils/haptics';
import { extractInviteCodeFromQr } from '../utils/inviteCode';

interface QRScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScan: (inviteCode: string, rawText?: string) => void;
    theme?: 'light' | 'dark';
    title?: string;
    description?: string;
}

const QR_ELEMENT_ID = 'myway-qr-reader-viewport';

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
    isOpen,
    onClose,
    onScan,
    theme = 'dark',
    title = 'Scan Circle QR Code',
    description = 'Point your camera at another member\'s screen to join their Circle'
}) => {
    const isDark = theme === 'dark';
    const [scannerLoading, setScannerLoading] = useState(true);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [cameras, setCameras] = useState<CameraDevice[]>([]);
    const [activeCameraIndex, setActiveCameraIndex] = useState(0);
    const [torchAvailable, setTorchAvailable] = useState(false);
    const [torchOn, setTorchOn] = useState(false);
    const [scanningFile, setScanningFile] = useState(false);

    const scannerRef = useRef<Html5Qrcode | null>(null);
    const activeStreamTrackRef = useRef<MediaStreamTrack | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const hasHandledScanRef = useRef(false);

    const stopScanner = useCallback(async () => {
        if (scannerRef.current) {
            try {
                if (scannerRef.current.isScanning) {
                    await scannerRef.current.stop();
                }
                scannerRef.current.clear();
            } catch (err) {
                console.debug('[QRScanner] Error stopping scanner:', err);
            }
            scannerRef.current = null;
        }

        // Ensure torch is reset
        if (activeStreamTrackRef.current) {
            try {
                if (torchOn) {
                    await (activeStreamTrackRef.current as any).applyConstraints?.({
                        advanced: [{ torch: false }]
                    });
                }
            } catch {}
            activeStreamTrackRef.current = null;
        }
        setTorchOn(false);
        setTorchAvailable(false);
    }, [torchOn]);

    const handleSuccess = useCallback(async (decodedText: string) => {
        if (hasHandledScanRef.current) return;
        hasHandledScanRef.current = true;

        hapticSuccess();
        await stopScanner();

        const extractedCode = extractInviteCodeFromQr(decodedText);
        onScan(extractedCode || decodedText, decodedText);
        onClose();
    }, [stopScanner, onScan, onClose]);

    const startScanner = useCallback(async (cameraIdOrConfig?: string | { facingMode: string }) => {
        setScannerLoading(true);
        setCameraError(null);
        hasHandledScanRef.current = false;

        await stopScanner();

        // Short timeout to guarantee container DOM node is mounted and laid out
        await new Promise(res => setTimeout(res, 120));

        const containerEl = document.getElementById(QR_ELEMENT_ID);
        if (!containerEl) {
            setScannerLoading(false);
            return;
        }

        try {
            const html5QrCode = new Html5Qrcode(QR_ELEMENT_ID);
            scannerRef.current = html5QrCode;

            // Discover cameras if available
            try {
                const deviceList = await Html5Qrcode.getCameras();
                if (deviceList && deviceList.length > 0) {
                    setCameras(deviceList);
                }
            } catch {}

            const config = {
                fps: 12,
                qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
                    const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                    const size = Math.floor(minEdge * 0.72);
                    return { width: size, height: size };
                },
                aspectRatio: 1.0
            };

            const cameraChoice = cameraIdOrConfig || { facingMode: 'environment' };

            await html5QrCode.start(
                cameraChoice,
                config,
                (decodedText) => {
                    handleSuccess(decodedText);
                },
                (_errorMsg) => {
                    // Ignore frame-by-frame decode misses
                }
            );

            // Probe torch capability on active video track
            try {
                const videoEl = containerEl.querySelector('video') as HTMLVideoElement | null;
                const stream = videoEl?.srcObject as MediaStream | null;
                const videoTrack = stream?.getVideoTracks?.()[0];
                if (videoTrack) {
                    activeStreamTrackRef.current = videoTrack;
                    const capabilities = (videoTrack.getCapabilities?.() || {}) as any;
                    if (capabilities.torch) {
                        setTorchAvailable(true);
                    }
                }
            } catch {}

            setScannerLoading(false);
        } catch (err: any) {
            console.warn('[QRScanner] Failed to start camera:', err);
            await stopScanner();
            setScannerLoading(false);

            const errStr = String(err?.message || err || '');
            if (errStr.includes('NotAllowedError') || errStr.includes('Permission')) {
                setCameraError('Camera access was denied. Please allow camera access in your browser settings to scan QR codes, or upload an image below.');
            } else if (errStr.includes('NotFoundError') || errStr.includes('DevicesNotFoundError')) {
                setCameraError('No camera found on this device. You can upload an image or screenshot of the QR code instead.');
            } else if (errStr.includes('NotReadableError') || errStr.includes('TrackStartError')) {
                setCameraError('Camera is currently in use by another application. Please close other camera apps and retry.');
            } else {
                setCameraError('Unable to access camera. Please check camera permissions or upload an image below.');
            }
            hapticError();
        }
    }, [stopScanner, handleSuccess]);

    // Initialize or cleanup on isOpen change
    useEffect(() => {
        if (isOpen) {
            startScanner({ facingMode: 'environment' });
        } else {
            stopScanner();
        }

        return () => {
            stopScanner();
        };
    }, [isOpen]);

    const handleToggleTorch = async () => {
        if (!activeStreamTrackRef.current || !torchAvailable) return;
        try {
            const nextState = !torchOn;
            await (activeStreamTrackRef.current as any).applyConstraints?.({
                advanced: [{ torch: nextState }]
            });
            setTorchOn(nextState);
            hapticSuccess();
        } catch (err) {
            console.warn('[QRScanner] Torch toggle failed:', err);
        }
    };

    const handleSwitchCamera = async () => {
        if (cameras.length <= 1) return;
        const nextIndex = (activeCameraIndex + 1) % cameras.length;
        setActiveCameraIndex(nextIndex);
        await startScanner(cameras[nextIndex].id);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setScanningFile(true);
        setCameraError(null);

        try {
            // If live scanner is active, stop it first
            await stopScanner();

            // Create temporary instance to scan file
            const html5QrCode = new Html5Qrcode(QR_ELEMENT_ID);
            const decodedResult = await html5QrCode.scanFile(file, true);
            html5QrCode.clear();

            if (decodedResult) {
                handleSuccess(decodedResult);
            }
        } catch (err: any) {
            console.warn('[QRScanner] File scan failed:', err);
            setCameraError('Could not detect a valid QR code in that image. Please try another photo or enter the 8-character code manually.');
            hapticError();
        } finally {
            setScanningFile(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-200 pointer-events-auto">
            <div className={`relative w-full max-w-md rounded-[2.5rem] border shadow-2xl overflow-hidden flex flex-col transition-all ${
                isDark ? 'bg-slate-950/95 border-white/10 text-white' : 'bg-white/98 border-slate-200 text-slate-900'
            }`}>
                {/* Header Ambient Glow */}
                <div className="absolute -top-20 -left-20 w-40 h-40 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-20 -right-20 w-40 h-40 rounded-full bg-emerald-500/20 blur-3xl pointer-events-none" />

                {/* Top Bar */}
                <div className="flex items-center justify-between px-6 pt-6 pb-3 relative z-10">
                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-sm">
                            <QrCode className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-base font-black tracking-tight">{title}</h3>
                            <p className="text-[11px] text-slate-400 font-medium">Auto-scans and connects instantly</p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close Scanner"
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 active:scale-90 flex items-center justify-center text-slate-400 hover:text-white transition-all cursor-pointer"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Camera Viewport Area */}
                <div className="relative px-6 py-2 flex flex-col items-center">
                    <div className="relative w-full aspect-square max-w-[320px] rounded-3xl overflow-hidden border border-white/15 bg-black flex items-center justify-center shadow-2xl">
                        {/* html5-qrcode mounting container */}
                        <div
                            id={QR_ELEMENT_ID}
                            className="w-full h-full overflow-hidden [&_video]:w-full [&_video]:h-full [&_video]:object-cover"
                        />

                        {/* Scanner Reticle Overlay */}
                        {!cameraError && (
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-8">
                                <div className="relative w-full h-full max-w-[230px] max-h-[230px]">
                                    {/* Reticle 4 Corners */}
                                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl shadow-sm" />
                                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl shadow-sm" />
                                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl shadow-sm" />
                                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-400 rounded-br-xl shadow-sm" />

                                    {/* Animated Laser Scanning Beam */}
                                    <div className="absolute left-1 right-1 top-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_#34d399] animate-[bounce_2.5s_ease-in-out_infinite]" />
                                </div>
                            </div>
                        )}

                        {/* Loading State Spinner */}
                        {(scannerLoading || scanningFile) && !cameraError && (
                            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-center px-4">
                                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                                <p className="text-xs font-bold text-slate-300">
                                    {scanningFile ? 'Decoding QR image...' : 'Starting camera...'}
                                </p>
                            </div>
                        )}

                        {/* Camera Error / Permission Fallback View */}
                        {cameraError && (
                            <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center gap-3 p-5 text-center">
                                <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                                    <AlertCircle className="w-6 h-6" />
                                </div>
                                <p className="text-xs font-bold text-slate-200 leading-relaxed max-w-[260px]">
                                    {cameraError}
                                </p>
                                <div className="flex gap-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => startScanner({ facingMode: 'environment' })}
                                        className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" />
                                        <span>Retry Camera</span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Viewport Action Controls (Torch & Camera Switch) */}
                    <div className="flex items-center justify-center gap-4 mt-3">
                        {torchAvailable && (
                            <button
                                type="button"
                                onClick={handleToggleTorch}
                                className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                                    torchOn
                                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-sm'
                                        : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                                }`}
                            >
                                {torchOn ? <Flashlight className="w-3.5 h-3.5 text-amber-400" /> : <FlashlightOff className="w-3.5 h-3.5" />}
                                <span>{torchOn ? 'Flash On' : 'Flash'}</span>
                            </button>
                        )}

                        {cameras.length > 1 && (
                            <button
                                type="button"
                                onClick={handleSwitchCamera}
                                className="px-3 py-1.5 rounded-xl border bg-white/5 border-white/10 text-slate-400 hover:text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                                <SwitchCamera className="w-3.5 h-3.5" />
                                <span>Flip Camera</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Bottom Helper & File Upload Fallback */}
                <div className="px-6 pb-6 pt-2 space-y-3 relative z-10">
                    <p className="text-center text-[11px] text-slate-400 font-medium leading-relaxed">
                        {description}
                    </p>

                    <div className="pt-1">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleFileUpload}
                            className="hidden"
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={scanningFile}
                            className={`w-full py-2.5 px-4 rounded-2xl border text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer ${
                                isDark
                                    ? 'border-white/10 hover:bg-white/5 text-slate-300'
                                    : 'border-slate-200 hover:bg-slate-100 text-slate-700'
                            }`}
                        >
                            <UploadCloud className="w-4 h-4 text-indigo-400" />
                            <span>Upload QR Code Image</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QRScannerModal;
