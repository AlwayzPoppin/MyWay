import React, { useState, useEffect } from 'react';
import { offlineMapService, DownloadArea } from '../services/offlineMapService';

interface OfflineMapManagerProps {
    currentBounds: {
        north: number;
        south: number;
        east: number;
        west: number;
    } | null;
    theme: 'light' | 'dark';
    onClose: () => void;
}

const OfflineMapManager: React.FC<OfflineMapManagerProps> = ({ currentBounds, theme, onClose }) => {
    const [isDownloading, setIsDownloading] = useState(false);
    const [progress, setProgress] = useState({ cached: 0, total: 0 });
    const [downloadedAreas, setDownloadedAreas] = useState<DownloadArea[]>([]);
    const [estimatedTiles, setEstimatedTiles] = useState(0);
    const [isServiceReady, setIsServiceReady] = useState(false);
    const [areaName, setAreaName] = useState('My Area');

    useEffect(() => {
        offlineMapService.init().then((ready) => {
            setIsServiceReady(ready);
            if (ready) {
                setDownloadedAreas(offlineMapService.getDownloadedAreas());
            }
        });
    }, []);

    useEffect(() => {
        if (currentBounds) {
            const count = offlineMapService.estimateTileCount(currentBounds, 12, 16);
            setEstimatedTiles(count);
        }
    }, [currentBounds]);

    const handleDownload = async () => {
        if (!currentBounds || !isServiceReady) return;

        setIsDownloading(true);
        setProgress({ cached: 0, total: estimatedTiles });

        try {
            const area = await offlineMapService.downloadArea(
                areaName,
                currentBounds,
                12,
                16,
                (cached, total) => setProgress({ cached, total })
            );
            setDownloadedAreas([...downloadedAreas, area]);
        } catch (error) {
            console.error('Download failed:', error);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleClearCache = async () => {
        await offlineMapService.clearCache();
        setDownloadedAreas([]);
    };

    const progressPercent = progress.total > 0 ? Math.round((progress.cached / progress.total) * 100) : 0;

    return (
        <div className={`rounded-3xl border backdrop-blur-2xl shadow-2xl overflow-hidden
      ${theme === 'dark'
                ? 'bg-[#0a0f1e]/95 border-white/10 text-white'
                : 'bg-white/95 border-slate-200 text-slate-900'}`}
        >
            {/* Header */}
            <div className={`px-6 py-4 border-b flex items-center justify-between
        ${theme === 'dark' ? 'border-white/10' : 'border-slate-100'}`}>
                <div className="flex items-center gap-3">
                    <span className="text-2xl">📥</span>
                    <div>
                        <h2 className="font-black text-lg tracking-tight">Offline Maps</h2>
                        <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                            Save maps for emergency offline use. <span className="text-amber-500 font-semibold">(2D Only)</span>
                        </p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className={`p-2 rounded-xl transition-all hover:scale-105
            ${theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}
                >
                    ✕
                </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
                {!isServiceReady ? (
                    <div className={`p-4 rounded-2xl text-center ${theme === 'dark' ? 'bg-red-500/20 text-red-400' : 'bg-red-50 text-red-600'}`}>
                        <p className="font-semibold">Service Worker not supported</p>
                        <p className="text-sm opacity-70">Offline maps require a modern browser</p>
                    </div>
                ) : (
                    <>
                        {/* Download Current Area */}
                        <div className={`p-4 rounded-2xl border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-100'}`}>
                            <h3 className="font-bold text-sm mb-3">Download Current View</h3>

                            <input
                                type="text"
                                value={areaName}
                                onChange={(e) => setAreaName(e.target.value)}
                                placeholder="Area name..."
                                className={`w-full px-4 py-2 rounded-xl mb-3 text-sm font-medium border outline-none
                  ${theme === 'dark'
                                        ? 'bg-slate-800 border-white/10 text-white placeholder-slate-500'
                                        : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'}`}
                            />

                            {currentBounds && (
                                <p className={`text-xs mb-3 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                                    📊 Estimated: <span className="font-bold">{estimatedTiles.toLocaleString()}</span> tiles (~{Math.round(estimatedTiles * 15 / 1024)} MB)
                                </p>
                            )}

                            {isDownloading ? (
                                <div className="space-y-2">
                                    <div className={`h-3 rounded-full overflow-hidden ${theme === 'dark' ? 'bg-slate-700' : 'bg-slate-200'}`}>
                                        <div
                                            className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-300"
                                            style={{ width: `${progressPercent}%` }}
                                        />
                                    </div>
                                    <p className={`text-xs text-center ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                                        {progress.cached.toLocaleString()} / {progress.total.toLocaleString()} tiles ({progressPercent}%)
                                    </p>
                                </div>
                            ) : (
                                <button
                                    onClick={handleDownload}
                                    disabled={!currentBounds}
                                    className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-black text-sm uppercase tracking-wider
                    hover:shadow-lg hover:shadow-amber-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all
                    disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    📥 Download This Area
                                </button>
                            )}
                        </div>

                        {/* Downloaded Areas */}
                        {downloadedAreas.length > 0 && (
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="font-bold text-sm">Saved Areas</h3>
                                    <button
                                        onClick={handleClearCache}
                                        className={`text-xs font-semibold px-3 py-1 rounded-lg transition-all
                      ${theme === 'dark' ? 'text-red-400 hover:bg-red-500/20' : 'text-red-600 hover:bg-red-50'}`}
                                    >
                                        Clear All
                                    </button>
                                </div>

                                <div className="space-y-2">
                                    {downloadedAreas.map((area) => (
                                        <div
                                            key={area.id}
                                            className={`p-3 rounded-xl border flex items-center justify-between
                        ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-slate-100'}`}
                                        >
                                            <div>
                                                <p className="font-semibold text-sm">{area.name}</p>
                                                <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                                                    {area.tilesCount} tiles • {new Date(area.downloadedAt).toLocaleDateString()}
                                                </p>
                                            </div>
                                            <span className="text-green-500 text-lg">✓</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Offline Status Indicator */}
                        <div className={`p-3 rounded-xl text-center text-xs font-medium
              ${theme === 'dark' ? 'bg-green-500/20 text-green-400' : 'bg-green-50 text-green-600'}`}>
                            📶 Cached tiles will load automatically when offline
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default OfflineMapManager;
