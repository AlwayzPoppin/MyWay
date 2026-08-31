import React, { useState, useEffect, useMemo } from 'react';
import { offlineMapService, DownloadArea, DownloadProgress, computeRadiusBounds } from '../services/offlineMapService';

interface OfflineMapManagerProps {
    currentBounds: {
        north: number;
        south: number;
        east: number;
        west: number;
    } | null;
    userLocation?: { lat: number; lng: number } | null;
    theme: 'light' | 'dark';
    onClose: () => void;
}

const OfflineMapManager: React.FC<OfflineMapManagerProps> = ({ currentBounds, userLocation, theme, onClose }) => {
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadingName, setDownloadingName] = useState<string>('');
    const [downloadingDesc, setDownloadingDesc] = useState<string>('');
    const [progress, setProgress] = useState<DownloadProgress>({
        cached: 0,
        total: 0,
        deltaUnchanged: 0,
        deltaUpdated: 0,
        bytesSavedKb: 0
    });
    const [downloadedAreas, setDownloadedAreas] = useState<DownloadArea[]>([]);
    const [isServiceReady, setIsServiceReady] = useState(false);
    const [areaName, setAreaName] = useState('Visible Map View');
    const [syncToast, setSyncToast] = useState<string | null>(null);

    // 80km region bounds computed from user location
    const local80kmBounds = useMemo(() => {
        if (!userLocation) return null;
        return computeRadiusBounds(userLocation, 80);
    }, [userLocation]);

    // Estimated tile counts
    const estimated80kmTiles = useMemo(() => {
        if (!local80kmBounds) return 0;
        return offlineMapService.estimateTileCount(local80kmBounds, 10, 13);
    }, [local80kmBounds]);

    const estimatedScreenTiles = useMemo(() => {
        if (!currentBounds) return 0;
        return offlineMapService.estimateTileCount(currentBounds, 10, 13);
    }, [currentBounds]);

    useEffect(() => {
        offlineMapService.init().then((ready) => {
            setIsServiceReady(ready);
            if (ready) {
                setDownloadedAreas(offlineMapService.getDownloadedAreas());
            }
        });
    }, []);

    const handleDownloadBounds = async (
        bounds: { north: number; south: number; east: number; west: number },
        name: string,
        description: string
    ) => {
        if (!isServiceReady || isDownloading) return;

        const count = offlineMapService.estimateTileCount(bounds, 10, 13);
        setIsDownloading(true);
        setDownloadingName(name);
        setDownloadingDesc(description);
        setProgress({
            cached: 0,
            total: count,
            deltaUnchanged: 0,
            deltaUpdated: 0,
            bytesSavedKb: 0
        });

        try {
            const area = await offlineMapService.downloadArea(
                name,
                bounds,
                10,
                13,
                (p) => setProgress(p),
                description
            );
            setDownloadedAreas(offlineMapService.getDownloadedAreas());
            if (progress.deltaUnchanged > 0) {
                setSyncToast(`⚡ Delta sync saved ${(progress.bytesSavedKb / 1024).toFixed(1)} MB (${progress.deltaUnchanged} unchanged tiles).`);
                setTimeout(() => setSyncToast(null), 5000);
            }
        } catch (error: any) {
            if (error?.name === 'AbortError' || error?.message?.includes('cancelled')) {
                console.log('[OfflineMapManager] Download cancelled by user');
            } else {
                console.error('[OfflineMapManager] Download failed:', error);
            }
        } finally {
            setIsDownloading(false);
            setDownloadingName('');
            setDownloadingDesc('');
        }
    };

    const handleSyncArea = async (area: DownloadArea) => {
        if (!isServiceReady || isDownloading) return;

        setIsDownloading(true);
        setDownloadingName(area.name);
        setDownloadingDesc(`Delta Updating: ${area.name}`);
        setProgress({
            cached: 0,
            total: area.tilesCount,
            deltaUnchanged: 0,
            deltaUpdated: 0,
            bytesSavedKb: 0
        });

        try {
            await offlineMapService.syncArea(area.id, (p) => setProgress(p));
            setDownloadedAreas(offlineMapService.getDownloadedAreas());
            setSyncToast(`✅ "${area.name}" updated! Saved ${(progress.bytesSavedKb / 1024).toFixed(1)} MB via delta ETag verification.`);
            setTimeout(() => setSyncToast(null), 5000);
        } catch (error: any) {
            if (error?.name === 'AbortError' || error?.message?.includes('cancelled')) {
                console.log('[OfflineMapManager] Sync cancelled');
            } else {
                console.error('[OfflineMapManager] Sync failed:', error);
            }
        } finally {
            setIsDownloading(false);
            setDownloadingName('');
            setDownloadingDesc('');
        }
    };

    const handleCancelDownload = () => {
        offlineMapService.cancelDownload();
        setIsDownloading(false);
        setDownloadingName('');
        setDownloadingDesc('');
    };

    const handleDownloadCurrentView = () => {
        if (currentBounds) {
            const desc = `Visible Screen View (${currentBounds.north.toFixed(2)}°N to ${currentBounds.south.toFixed(2)}°N)`;
            handleDownloadBounds(currentBounds, areaName.trim() || 'Visible Screen View', desc);
        }
    };

    const handleDownload80kmRegion = () => {
        if (local80kmBounds && userLocation) {
            const desc = `50-mile (80km) radius around GPS (${userLocation.lat.toFixed(3)}°N, ${userLocation.lng.toFixed(3)}°W)`;
            handleDownloadBounds(local80kmBounds, 'Home / 80km Safety Region', desc);
        }
    };

    const handleDeleteArea = async (id: string, name: string) => {
        if (confirm(`Delete offline map region "${name}"?`)) {
            await offlineMapService.deleteArea(id);
            setDownloadedAreas(offlineMapService.getDownloadedAreas());
        }
    };

    const handleClearCache = async () => {
        if (confirm('Clear all downloaded offline map tiles?')) {
            await offlineMapService.clearCache();
            setDownloadedAreas([]);
        }
    };

    const progressPercent = progress.total > 0 ? Math.round((progress.cached / progress.total) * 100) : 0;

    return (
        <div className={`rounded-3xl border backdrop-blur-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col
      ${theme === 'dark'
                ? 'bg-[#0a0f1e]/95 border-white/10 text-white'
                : 'bg-white/95 border-slate-200 text-slate-900'}`}
        >
            {/* Header */}
            <div className={`px-6 py-4 border-b flex items-center justify-between shrink-0
        ${theme === 'dark' ? 'border-white/10' : 'border-slate-100'}`}>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-xl shadow-md">
                        📥
                    </div>
                    <div>
                        <h2 className="font-black text-lg tracking-tight">Offline Navigation Maps</h2>
                        <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                            Delta ETag updates • 100% offline GPS & vector routing
                        </p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105
            ${theme === 'dark' ? 'hover:bg-white/10 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-600'}`}
                >
                    ✕
                </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1 custom-scrollbar">
                {syncToast && (
                    <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-xs flex items-center gap-2 animate-in fade-in slide-in-from-top-2 shadow-lg">
                        <span>✨</span>
                        <span className="flex-1">{syncToast}</span>
                    </div>
                )}

                {!isServiceReady ? (
                    <div className={`p-4 rounded-2xl text-center ${theme === 'dark' ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                        <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        <p className="font-bold text-sm">Initializing Offline Cache Engine...</p>
                        <p className="text-xs opacity-75 mt-1">Connecting to local CacheStorage pipeline...</p>
                    </div>
                ) : (
                    <>
                        {/* ACTIVE DOWNLOAD IN PROGRESS BANNER */}
                        {isDownloading && (
                            <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-900/60 via-purple-900/60 to-indigo-900/60 border-2 border-indigo-500/50 shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-200">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-xl animate-bounce">📥</span>
                                        <div className="min-w-0">
                                            <h3 className="font-black text-xs uppercase tracking-wider text-indigo-300 truncate">
                                                {downloadingName}
                                            </h3>
                                            {downloadingDesc && (
                                                <p className="text-[10px] text-slate-300 truncate mt-0.5">
                                                    {downloadingDesc}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-indigo-500 text-white shrink-0 shadow">
                                        {progressPercent}%
                                    </span>
                                </div>

                                {/* Animated Progress Bar */}
                                <div className="space-y-1.5">
                                    <div className="h-3 rounded-full overflow-hidden bg-black/50 border border-white/10 p-0.5">
                                        <div
                                            className="h-full rounded-full bg-gradient-to-r from-amber-400 via-indigo-400 to-purple-400 transition-all duration-300 shadow-[0_0_12px_rgba(99,102,241,0.8)]"
                                            style={{ width: `${Math.max(progressPercent, 4)}%` }}
                                        />
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 px-1">
                                        <span>Tiles: {progress.cached.toLocaleString()} / {progress.total.toLocaleString()}</span>
                                        <span>
                                            {progress.bytesSavedKb > 0 ? (
                                                <span className="text-emerald-400">⚡ {(progress.bytesSavedKb / 1024).toFixed(1)} MB saved</span>
                                            ) : (
                                                `~${Math.round((progress.cached * 25) / 1024)} MB`
                                            )}
                                        </span>
                                    </div>

                                    {/* Delta Stats Pill */}
                                    {(progress.deltaUnchanged > 0 || progress.deltaUpdated > 0) && (
                                        <div className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-black/40 border border-white/10 text-slate-300 flex items-center justify-between">
                                            <span>⚡ ETag Unchanged: <strong className="text-emerald-300">{progress.deltaUnchanged.toLocaleString()}</strong></span>
                                            <span>Fresh Updates: <strong className="text-indigo-300">{progress.deltaUpdated.toLocaleString()}</strong></span>
                                        </div>
                                    )}
                                </div>

                                {/* CANCEL DOWNLOAD BUTTON */}
                                <button
                                    onClick={handleCancelDownload}
                                    className="w-full py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 active:scale-95 text-red-300 hover:text-white border border-red-500/40 font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg"
                                >
                                    <span>🛑</span>
                                    <span>Cancel</span>
                                </button>
                            </div>
                        )}

                        {/* Quick 80km Region Download Card */}
                        {userLocation && (
                            <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-indigo-500/15 border border-amber-500/30 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">⚡</span>
                                        <h3 className="font-black text-xs uppercase tracking-wider text-amber-400">
                                            Instant 80km Safety Region
                                        </h3>
                                    </div>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300">
                                        ~{Math.round((estimated80kmTiles * 25) / 1024)} MB ({estimated80kmTiles.toLocaleString()} tiles)
                                    </span>
                                </div>

                                <div className={`text-xs space-y-1.5 ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                                    <p>
                                        📍 <strong>Coverage:</strong> 80 km (50 miles) radius around GPS ({userLocation.lat.toFixed(3)}°N, {userLocation.lng.toFixed(3)}°W)
                                    </p>
                                    <p className="text-[11px] opacity-80">
                                        🛣️ Delta updates only fetch modified tiles using HTTP ETags, saving cellular bandwidth.
                                    </p>
                                </div>

                                <button
                                    onClick={handleDownload80kmRegion}
                                    disabled={isDownloading}
                                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    <span>📥</span>
                                    <span>Download / Delta Sync 80km Corridor</span>
                                </button>
                            </div>
                        )}

                        {/* Download Visible Screen Area Card */}
                        <div className={`p-4 rounded-2xl border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-bold text-xs uppercase tracking-wider text-indigo-400">
                                    Download Visible Screen Area
                                </h3>
                                {currentBounds && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300">
                                        ~{Math.max(1, Math.round((estimatedScreenTiles * 25) / 1024))} MB ({estimatedScreenTiles.toLocaleString()} tiles)
                                    </span>
                                )}
                            </div>

                            <input
                                type="text"
                                value={areaName}
                                onChange={(e) => setAreaName(e.target.value)}
                                disabled={isDownloading}
                                placeholder="Area label (e.g. Downtown / Raleigh to NY)..."
                                className={`w-full px-4 py-2 rounded-xl mb-3 text-xs font-semibold border outline-none ${
                                    theme === 'dark'
                                        ? 'bg-slate-800 border-white/10 text-white placeholder-slate-500'
                                        : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
                                }`}
                            />

                            {currentBounds ? (
                                <div className={`text-[11px] mb-3 space-y-1 ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                                    <p>
                                        📐 <strong>Bounds:</strong> {currentBounds.north.toFixed(2)}°N to {currentBounds.south.toFixed(2)}°N, {currentBounds.west.toFixed(2)}°W to {currentBounds.east.toFixed(2)}°E
                                    </p>
                                </div>
                            ) : (
                                <p className="text-[11px] text-slate-400 mb-3">
                                    Move the map to frame your desired region before downloading.
                                </p>
                            )}

                            <button
                                onClick={handleDownloadCurrentView}
                                disabled={!currentBounds || isDownloading}
                                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-black text-xs uppercase tracking-wider transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                <span>📥</span>
                                <span>Download Visible Viewport</span>
                            </button>
                        </div>

                        {/* Downloaded Areas List */}
                        {downloadedAreas.length > 0 && (
                            <div>
                                <div className="flex items-center justify-between mb-2.5">
                                    <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                                        Saved Offline Regions ({downloadedAreas.length})
                                    </h3>
                                    <button
                                        onClick={handleClearCache}
                                        disabled={isDownloading}
                                        className="text-[11px] font-bold px-2 py-0.5 rounded-lg text-rose-400 hover:bg-rose-500/20 transition-all disabled:opacity-50"
                                    >
                                        Clear All
                                    </button>
                                </div>

                                <div className="space-y-2">
                                    {downloadedAreas.map((area) => (
                                        <div
                                            key={area.id}
                                            className={`p-3 rounded-xl border flex items-center justify-between ${
                                                theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-slate-100 shadow-sm'
                                            }`}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-emerald-400 font-bold text-xs">✓</span>
                                                    <p className="font-bold text-xs truncate">{area.name}</p>
                                                </div>
                                                {area.description && (
                                                    <p className={`text-[10px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'} truncate mt-0.5`}>
                                                        {area.description}
                                                    </p>
                                                )}
                                                <p className={`text-[9px] ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'} mt-0.5`}>
                                                    {area.tilesCount.toLocaleString()} tiles • Updated {new Date(area.downloadedAt).toLocaleDateString()}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                                <button
                                                    onClick={() => handleSyncArea(area)}
                                                    disabled={isDownloading}
                                                    title="Delta Sync (Check for modified tiles)"
                                                    className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 transition-all flex items-center gap-1 active:scale-95 disabled:opacity-50"
                                                >
                                                    <span>🔄</span>
                                                    <span>Sync</span>
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteArea(area.id, area.name)}
                                                    disabled={isDownloading}
                                                    title="Delete this offline region"
                                                    className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all text-xs disabled:opacity-50"
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Offline Status Footer */}
                        <div className={`p-3 rounded-xl text-center text-xs font-bold ${
                            theme === 'dark' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                            📶 Delta ETag caching active: only modified tiles consume network bandwidth.
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default OfflineMapManager;
