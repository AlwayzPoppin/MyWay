import React, { useState, useEffect, useMemo } from 'react';
import { offlineMapService, DownloadArea, DownloadProgress } from '../services/offlineMapService';

interface OfflineMapManagerProps {
    currentBounds: {
        north: number;
        south: number;
        east: number;
        west: number;
    } | null;
    theme: 'light' | 'dark';
    isMobile: boolean;
    onClose: () => void;
    onDownloadComplete: (area: DownloadArea) => void;
}

const getFriendlyAreaName = (name: string): string => {
    if (/^auto-cache\s*\(dwelling\)$/i.test(name)) return 'Nearby area';
    if (/^dead zone\s*\(/i.test(name)) return 'Low-signal area';
    if (/^low-signal area\s*\(/i.test(name)) return 'Low-signal area';
    if (/^active route corridor$/i.test(name)) return 'Route coverage';
    return name;
};

const OfflineMapManager: React.FC<OfflineMapManagerProps> = ({ currentBounds, theme, isMobile, onClose, onDownloadComplete }) => {
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
    const [syncToast, setSyncToast] = useState<string | null>(null);
    const [view, setView] = useState<'select' | 'saved'>('saved');
    const [cacheUsage, setCacheUsage] = useState({ tiles: 0, bytes: 0 });
    const [isClearingMaps, setIsClearingMaps] = useState(false);

    const estimatedScreenTiles = useMemo(() => {
        if (!currentBounds) return 0;
        return offlineMapService.estimateTileCount(currentBounds, 10, 13);
    }, [currentBounds]);

    useEffect(() => {
        offlineMapService.init().then(async (ready) => {
            setIsServiceReady(ready);
            if (ready) {
                setDownloadedAreas(offlineMapService.getDownloadedAreas());
                setCacheUsage(await offlineMapService.getCacheUsage());
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
            onDownloadComplete(area);
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
            handleDownloadBounds(currentBounds, `Map area · ${new Date().toLocaleDateString()}`, desc);
        }
    };

    const handleDeleteArea = async (id: string, name: string) => {
        if (confirm(`Delete offline map region "${name}"?`)) {
            await offlineMapService.deleteArea(id);
            setDownloadedAreas(offlineMapService.getDownloadedAreas());
        }
    };

    const handleClearDownloadedMaps = async () => {
        if (isClearingMaps) return;
        setIsClearingMaps(true);
        try {
            await offlineMapService.clearCache();
            setDownloadedAreas([]);
            setCacheUsage(await offlineMapService.getCacheUsage());
            setSyncToast('Downloaded maps cleared.');
        } catch (error) {
            console.warn('[OfflineMapManager] Could not clear downloaded maps:', error);
            setSyncToast('Could not clear downloaded maps.');
        } finally {
            setIsClearingMaps(false);
        }
    };

    const progressPercent = progress.total > 0 ? Math.round((progress.cached / progress.total) * 100) : 0;

    if (view === 'select') {
        const estimateMb = Math.max(1, Math.round((estimatedScreenTiles * 25) / 1024));
        return (
            <div className="relative h-full w-full overflow-hidden pointer-events-none text-white">
                <div className="absolute inset-0 bg-slate-950/42" />

                <header className="absolute inset-x-0 top-0 flex items-center justify-between px-6 pt-[max(2rem,env(safe-area-inset-top))] pointer-events-auto">
                    <div>
                        <h2 className="text-2xl font-semibold tracking-tight">Download a map of this area?</h2>
                        <p className="mt-1 text-sm text-white/65">Drag or zoom to adjust the map</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-3xl font-light text-white transition-colors hover:bg-white/20"
                        aria-label="Close offline maps"
                    >
                        ×
                    </button>
                </header>

                <div
                    className="absolute left-[7%] right-[7%] top-[17%] bottom-[23%] rounded-[28px] border-2 border-white/80 pointer-events-none"
                    style={{ boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.22), inset 0 0 0 1px rgba(255,255,255,0.22)' }}
                >
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="rounded-full bg-slate-950/70 px-4 py-2 text-sm font-semibold shadow-lg">
                            Drag or zoom to adjust the map
                        </div>
                    </div>
                </div>

                <div className="absolute inset-x-0 bottom-0 rounded-t-[32px] bg-[#161616] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl pointer-events-auto">
                    <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                        <button type="button" onClick={() => setView('saved')} className="font-semibold text-white/70 hover:text-white">
                            Saved maps{downloadedAreas.length ? ` (${downloadedAreas.length})` : ''}
                        </button>
                        {currentBounds && <span className="text-white/60">~{estimateMb} MB · {estimatedScreenTiles.toLocaleString()} tiles</span>}
                    </div>
                    {isDownloading ? (
                        <div className="rounded-2xl bg-white/10 px-4 py-3">
                            <div className="flex items-center justify-between text-sm font-semibold"><span>Downloading map…</span><span>{progressPercent}%</span></div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-indigo-400 transition-all" style={{ width: `${progressPercent}%` }} /></div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={handleDownloadCurrentView}
                            disabled={!currentBounds || !isServiceReady}
                            className="w-full rounded-2xl bg-indigo-500 py-4 text-base font-bold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
                        >
                            Download
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className={`absolute bottom-0 overflow-hidden border shadow-2xl flex flex-col pointer-events-auto ${isMobile ? 'inset-x-0 max-h-[82dvh] rounded-t-3xl' : 'right-6 w-96 max-h-[85vh] rounded-3xl'}
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
                        <h2 className="font-black text-lg tracking-tight">Offline maps</h2>
                        <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                            Your downloaded map areas and storage.
                        </p>
                    </div>
                </div>
                <button onClick={onClose} className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105 ${theme === 'dark' ? 'hover:bg-white/10 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-600'}`}>✕</button>
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

                        {/* Saved maps is the one user-facing source of truth. */}
                        <div>
                            <div className="flex items-center justify-between mb-2.5">
                                <div>
                                    <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">Saved maps ({downloadedAreas.length})</h3>
                                    <p className={`mt-0.5 text-[10px] ${theme === 'dark' ? 'text-slate-500' : 'text-slate-500'}`}>{(cacheUsage.bytes / 1024 / 1024).toFixed(1)} MB stored on this device</p>
                                </div>
                                {cacheUsage.tiles > 0 && <button type="button" onClick={handleClearDownloadedMaps} disabled={isClearingMaps} className="rounded-lg px-2 py-1 text-[10px] font-bold text-rose-500 hover:bg-rose-500/10 disabled:opacity-50">{isClearingMaps ? 'Clearing…' : 'Clear all'}</button>}
                            </div>

                            {downloadedAreas.length > 0 ? (
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
                                                    <p className="font-bold text-xs truncate">{getFriendlyAreaName(area.name)}</p>
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
                            ) : (
                                <div className={`rounded-xl border px-3 py-4 text-center text-xs ${theme === 'dark' ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500'}`}>No map areas saved yet.</div>
                            )}
                        </div>

                        {/* Offline Status Footer */}
                        <div className={`p-3 rounded-xl text-center text-xs font-bold ${
                            theme === 'dark' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                            Your saved maps stay ready when service is weak or unavailable.
                        </div>
                    </>
                )}
            </div>
            <div className={`shrink-0 border-t p-4 ${theme === 'dark' ? 'border-white/10 bg-slate-950/40' : 'border-slate-200 bg-white/90'}`}>
                <button
                    type="button"
                    onClick={() => setView('select')}
                    className="w-full rounded-2xl bg-indigo-600 py-3.5 text-sm font-black text-white transition-colors hover:bg-indigo-500"
                >
                    Download offline map
                </button>
            </div>
        </div>
    );
};

export default OfflineMapManager;
