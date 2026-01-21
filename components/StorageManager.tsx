import React, { useState, useEffect } from 'react';

interface StorageManagerProps {
    theme: 'light' | 'dark';
}

const StorageManager: React.FC<StorageManagerProps> = ({ theme }) => {
    const [usage, setUsage] = useState<number>(0);
    const [quota, setQuota] = useState<number>(0);

    useEffect(() => {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            navigator.storage.estimate().then((estimate) => {
                setUsage(estimate.usage || 0);
                setQuota(estimate.quota || 0);
            });
        }
    }, []);

    const clearCache = async () => {
        // 1. Clear Browser Caches (Tiles/Assets)
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
        }

        // 2. Clear Local Storage (State, Keys, Settings)
        localStorage.clear();

        // 3. Clear Session Storage
        sessionStorage.clear();

        // 4. Force Reload to reset app state
        window.location.reload();
    };

    const usageMB = (usage / 1024 / 1024).toFixed(1);
    const quotaGB = (quota / 1024 / 1024 / 1024).toFixed(1);
    const percent = quota > 0 ? (usage / quota) * 100 : 0;

    return (
        <div className={`p-4 rounded-2xl border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex justify-between items-center mb-2">
                <h4 className={`text-sm font-bold ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>Offline Storage</h4>
                <span className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>{usageMB} MB / {quotaGB} GB</span>
            </div>

            <div className="w-full h-2 bg-slate-700/30 rounded-full overflow-hidden mb-4">
                <div
                    className="h-full bg-amber-500 transition-all duration-500"
                    style={{ width: `${Math.max(2, percent)}%` }}
                />
            </div>

            <button
                onClick={clearCache}
                className="w-full py-2 text-xs font-bold uppercase tracking-wider text-red-400 border border-red-500/30 rounded-xl hover:bg-red-500/10 transition-colors"
            >
                Clear Map Cache
            </button>
        </div>
    );
};

export default StorageManager;
