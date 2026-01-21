
import React from 'react';
import { Place } from '../types';

interface PlaceDetailPanelProps {
    place: Place;
    onClose: () => void;
    onNavigate: () => void;
    theme: 'light' | 'dark';
}

const PlaceDetailPanel: React.FC<PlaceDetailPanelProps> = ({ place, onClose, onNavigate, theme }) => {
    const bgColor = theme === 'dark' ? 'bg-[#0f172a]/95 border-white/10' : 'bg-white/95 border-slate-200';
    const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';
    const subTextColor = theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600';

    return (
        <div className={`w-80 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_60px_rgba(0,0,0,0.4)] border overflow-hidden animate-in slide-in-from-left duration-300 ${bgColor}`}>
            <div className="relative h-32 bg-indigo-600 flex items-center justify-center overflow-hidden">
                {/* Abstract Background */}
                <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>

                <div className="relative z-10 text-6xl drop-shadow-lg transform hover:scale-110 transition-transform duration-300">
                    {place.icon}
                </div>

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/40 rounded-full text-white backdrop-blur-md transition-all"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <div className="p-6">
                <h3 className={`text-2xl font-black leading-tight mb-1 ${textColor}`}>{place.name}</h3>
                <p className={`text-xs font-bold uppercase tracking-widest mb-6 ${subTextColor}`}>
                    {place.type} • {Math.round(place.radius * 1000)}m
                </p>

                <div className="flex gap-4">
                    <button
                        onClick={onNavigate}
                        className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold text-lg shadow-lg shadow-indigo-600/30 transition-all transform hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2"
                    >
                        <span>🚀</span> Go
                    </button>
                    <button
                        className={`px-4 py-4 rounded-2xl font-bold border transition-all ${theme === 'dark' ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-600'}`}
                    >
                        Share
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PlaceDetailPanel;
