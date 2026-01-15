import React, { useState } from 'react';

interface QuickStopGridProps {
    onSearch: (query: string) => void;
    onClose: () => void;
    theme: 'light' | 'dark';
}

const QuickStopGrid: React.FC<QuickStopGridProps> = ({ onSearch, onClose, theme }) => {
    const categories = [
        { id: 'gas', icon: '⛽', label: 'Gas', query: 'Gas Station', color: '#f97316' },
        { id: 'coffee', icon: '☕', label: 'Coffee', query: 'Coffee Shop', color: '#22c55e' },
        { id: 'food', icon: '🍔', label: 'Food', query: 'Restaurant', color: '#ef4444' },
        { id: 'grocery', icon: '🛒', label: 'Grocery', query: 'Grocery Store', color: '#3b82f6' },
        { id: 'parking', icon: '🅿️', label: 'Parking', query: 'Parking', color: '#8b5cf6' },
        { id: 'pharmacy', icon: '💊', label: 'Pharmacy', query: 'Pharmacy', color: '#ec4899' },
        { id: 'atm', icon: '🏧', label: 'ATM', query: 'ATM', color: '#14b8a6' },
        { id: 'hospital', icon: '🏥', label: 'Hospital', query: 'Hospital', color: '#dc2626' },
    ];

    const handleSelect = (query: string) => {
        onSearch(query);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-end justify-center p-4 md:items-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Grid container */}
            <div className={`relative w-full max-w-sm rounded-3xl p-6 shadow-2xl
        ${theme === 'dark'
                    ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-white/10'
                    : 'bg-white border border-slate-200'}`}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <h3 className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                        Quick Stop
                    </h3>
                    <button
                        onClick={onClose}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors
              ${theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                    >
                        ✕
                    </button>
                </div>

                {/* Grid */}
                <div className="grid grid-cols-4 gap-3">
                    {categories.map((cat, index) => (
                        <button
                            key={cat.id}
                            onClick={() => handleSelect(cat.query)}
                            className={`group flex flex-col items-center gap-2 p-3 rounded-2xl transition-all duration-200
                hover:scale-105 active:scale-95
                ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-slate-50 hover:bg-slate-100'}`}
                            style={{ animationDelay: `${index * 30}ms` }}
                        >
                            <div
                                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-transform group-hover:scale-110"
                                style={{
                                    backgroundColor: `${cat.color}20`,
                                    boxShadow: `0 4px 12px ${cat.color}30`
                                }}
                            >
                                {cat.icon}
                            </div>
                            <span className={`text-[10px] font-semibold uppercase tracking-wide
                ${theme === 'dark' ? 'text-slate-400 group-hover:text-white' : 'text-slate-500 group-hover:text-slate-900'}`}>
                                {cat.label}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Recent searches - could be enhanced later */}
                <div className={`mt-6 pt-4 border-t ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
                    <p className={`text-xs font-medium uppercase tracking-wide mb-3
            ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                        Recent
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {['Home', 'Work', "Mom's House"].map(place => (
                            <button
                                key={place}
                                onClick={() => handleSelect(place)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors
                  ${theme === 'dark'
                                        ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                                📍 {place}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QuickStopGrid;
