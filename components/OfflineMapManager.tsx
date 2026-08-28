import React, { useState, useEffect } from 'react';
import { offlineMapService, DownloadArea, computeRadiusBounds } from '../services/offlineMapService';

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
    const [progress, setProgress] = useState({ cached: 0, total: 0 });
    const [downloadedAreas, setDownloadedAreas] = useState<DownloadArea[]>([]);
    const [estimatedTiles, setEstimatedTiles] = useState(0);
    const [isServiceReady, setIsServiceReady] = useState(false);
    const [areaName, setAreaName] = useState('My Local Region');

    useEffect(() => {
        offlineMapService.init().then((ready) => {
            setIsServiceReady(ready);
            if (ready) {
                setDownloadedAreas(offlineMapService.getDownloadedAreas());
            }
        });
    }, []);

    useEffect(() => {
        const boundsToEstimate = currentBounds || (userLocation ? computeRadiusBounds(userLocation, 80) : null);
        if (boundsToEstimate) {
            const count = offlineMapService.estimateTileCount(boundsToEstimate, 10, 14);
            setEstimatedTiles(count);
        }
    }, [currentBounds, userLocation]);

    const handleDownloadBounds = async (bounds: { north: number; south: number; east: number; west: number }, name: string) => {
        if (!isServiceReady) return;

        const count = offlineMapService.estimateTileCount(bounds, 10, 14);
        setIsDownloading(true);
        setProgress({ cached: 0, total: count });

        try {
            await offlineMapService.downloadArea(
                name,
                bounds,
                10,
                14,
                (cached, total) => setProgress({ cached, total })
            );
            setDownloadedAreas(offlineMapService.getDownloadedAreas());
        } catch (error) {
            console.error('Download failed:', error);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleDownloadCurrentView = () => {
        if (currentBounds) {
            handleDownloadBounds(currentBounds, areaName.trim() || 'Visible Screen Area');
        }
    };

    const handleDownload80kmRegion = () => {
        if (userLocation) {
            const regionBounds = computeRadiusBounds(userLocation, 80);
            handleDownloadBounds(regionBounds, 'Home / 80km Region');
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
                            Pre-download vector & satellite tiles for 100% offline GPS
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
                {!isServiceReady ? (
                    <div className={`p-4 rounded-2xl text-center ${theme === 'dark' ? 'bg-red-500/20 text-red-400' : 'bg-red-50 text-red-600'}`}>
                        <p className="font-bold text-sm">Service Worker Initializing...</p>
                        <p className="text-xs opacity-75 mt-1">Connecting to local CacheStorage pipeline...</p>
                    </div>
                ) : (
                    <>
                        {/* Quick 80km Region Download */}
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
                                        ~50-80 MB
                                    </span>
                                </div>
                                <p className={`text-xs ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                                    Caches full street geometry, highway exits, and turn-by-turn vectors within 80km of your current location.
                                </p>
                                <button
                                    onClick={handleDownload80kmRegion}
                                    disabled={isDownloading}
                                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50"
                                >
                                    📥 Download 80km Local Corridor
                                </button>
                            </div>
                        )}

                        {/* Download Custom Area */}
                        <div className={`p-4 rounded-2xl border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                            <h3 className="font-bold text-xs uppercase tracking-wider text-indigo-400 mb-2">
                                Download Visible Screen Area
                            </h3>

                            <input
                                type="text"
                                value={areaName}
                                onChange={(e) => setAreaName(e.target.value)}
                                placeholder="Area name (e.g. Vacation Trip / Raleigh to NY)..."
                                className={`w-full px-4 py-2 rounded-xl mb-3 text-xs font-semibold border outline-none ${
                                    theme === 'dark'
                                        ? 'bg-slate-800 border-white/10 text-white placeholder-slate-500'
                                        : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
                                }`}
                            />

                            {currentBounds && (
                                <p className={`text-[11px] font-semibold mb-3 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                                    📊 Estimated: <span className="font-bold text-amber-400">{estimatedTiles.toLocaleString()}</span> tiles (~{Math.round(estimatedTiles * 15 / 1024)} MB)
                                </p>
                            )}

                            {isDownloading ? (
                                <div className="space-y-2">
                                    <div className={`h-3 rounded-full overflow-hidden ${theme === 'dark' ? 'bg-slate-700' : 'bg-slate-200'}`}>
                                        <div
                                            className="h-full bg-gradient-to-r from-amber-400 via-orange-500 to-indigo-500 transition-all duration-300 animate-pulse"
                                            style={{ width: `${progressPercent}%` }}
                                        />
                                    </div>
                                    <p className={`text-[11px] font-bold text-center ${theme === 'dark' ? 'text-amber-300' : 'text-amber-600'}`}>
                                        Caching tiles: {progress.cached.toLocaleString()} / {progress.total.toLocaleString()} ({progressPercent}%)
                                    </p>
                                </div>
                            ) : (
                                <button
                                    onClick={handleDownloadCurrentView}
                                    disabled={!currentBounds}
                                    className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-black text-xs uppercase tracking-wider transition-all shadow-md disabled:opacity-50"
                                >
                                    📥 Download Screen View
                                </button>
                            )}
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
                                        className="text-[11px] font-bold px-2 py-0.5 rounded-lg text-rose-400 hover:bg-rose-500/20 transition-all"
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
                                                <p className={`text-[10px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'} mt-0.5`}>
                                                    {area.tilesCount.toLocaleString()} tiles • {new Date(area.downloadedAt).toLocaleDateString()}
                                                </p>
                                            </div>
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                                                Ready
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Offline Status Footer */}
                        <div className={`p-3 rounded-xl text-center text-xs font-bold ${
                            theme === 'dark' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                            📶 Cached vector & raster tiles load with 0ms latency when offline.
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default OfflineMapManager;
