import React, { useState } from 'react';

interface CircleManagerProps {
    onCreateCircle: (name: string) => Promise<any>;
    onJoinCircle: (code: string) => Promise<any>;
    theme: 'light' | 'dark';
}

const CircleManager: React.FC<CircleManagerProps> = ({ onCreateCircle, onJoinCircle, theme }) => {
    const [mode, setMode] = useState<'initial' | 'create' | 'join'>('initial');
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setLoading(true);
        setError(null);
        try {
            await onCreateCircle(name);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleJoin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim()) return;
        setLoading(true);
        setError(null);
        try {
            const circle = await onJoinCircle(code);
            if (!circle) setError('Invalid invite code');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const isDark = theme === 'dark';

    return (
        <div className={`p-6 rounded-3xl border transition-all duration-500 overflow-hidden
            ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}
        >
            {mode === 'initial' && (
                <div className="space-y-6">
                    <div className="text-center">
                        <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-xl shadow-indigo-500/20">
                            🏠
                        </div>
                        <h3 className={`text-xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
                            Your Family Circle
                        </h3>
                        <p className={`text-xs font-bold mt-2 opacity-60 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                            Start your family journey together
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        <button
                            onClick={() => setMode('create')}
                            className="w-full p-4 rounded-2xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-sm transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
                        >
                            Create New Circle
                        </button>
                        <button
                            onClick={() => setMode('join')}
                            className={`w-full p-4 rounded-2xl font-black text-sm transition-all active:scale-95 border
                                ${isDark ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                        >
                            Join Existing Circle
                        </button>
                    </div>
                </div>
            )}

            {mode === 'create' && (
                <form onSubmit={handleCreate} className="space-y-4 animate-in slide-in-from-right duration-300">
                    <div>
                        <button onClick={() => setMode('initial')} className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1 opacity-60 hover:opacity-100 mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
                            ← Back
                        </button>
                        <h3 className={`text-lg font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>Create Family</h3>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">What should we call your circle?</p>
                    </div>

                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="The Smith Family"
                        className={`w-full p-4 rounded-2xl font-bold bg-transparent border outline-none transition-all
                            ${isDark ? 'border-white/10 text-white focus:border-indigo-500' : 'border-slate-200 text-slate-900 focus:border-indigo-500'}`}
                        autoFocus
                    />

                    {error && <p className="text-xs text-red-500 font-bold">{error}</p>}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full p-4 rounded-2xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-sm transition-all disabled:opacity-50"
                    >
                        {loading ? 'Creating...' : 'Launch Circle'}
                    </button>
                </form>
            )}

            {mode === 'join' && (
                <form onSubmit={handleJoin} className="space-y-4 animate-in slide-in-from-right duration-300">
                    <div>
                        <button onClick={() => setMode('initial')} className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1 opacity-60 hover:opacity-100 mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
                            ← Back
                        </button>
                        <h3 className={`text-lg font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>Join Family</h3>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Enter the 8-character invite code</p>
                    </div>

                    <input
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        placeholder="A1B2C3D4"
                        maxLength={8}
                        className={`w-full p-4 rounded-2xl font-bold bg-transparent border outline-none transition-all text-center tracking-[0.5em]
                            ${isDark ? 'border-white/10 text-white focus:border-indigo-500' : 'border-slate-200 text-slate-900 focus:border-indigo-500'}`}
                        autoFocus
                    />

                    {error && <p className="text-xs text-red-500 font-bold">{error}</p>}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full p-4 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-black text-sm transition-all disabled:opacity-50"
                    >
                        {loading ? 'Joining...' : 'Join Circle'}
                    </button>
                </form>
            )}
        </div>
    );
};

export default CircleManager;
