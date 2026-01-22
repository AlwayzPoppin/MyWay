
import React, { useState } from 'react';

interface SearchBoxProps {
  onSearch: (query: string) => void;
  onNavigate?: (query: string) => void; // NEW: Direct navigation
  onLocate?: () => void;
  onQuickStop?: () => void;
  onTestDrive?: () => void;
  onCategorySearch?: (type: 'gas' | 'coffee' | 'food' | 'grocery') => void;
  theme: 'light' | 'dark';
}

const SearchBox: React.FC<SearchBoxProps> = ({ onSearch, onNavigate, onLocate, onQuickStop, onTestDrive, onCategorySearch, theme }) => {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch(query);
  };

  const handleNavigate = () => {
    if (query.trim() && onNavigate) {
      onNavigate(query);
    }
  };

  const categories: { label: string; icon: string; query: string; type: 'gas' | 'coffee' | 'food' | 'grocery'; gradient: string }[] = [
    { label: 'Gas', icon: '⛽', query: 'Gas Station', type: 'gas', gradient: 'from-orange-500 to-red-500' },
    { label: 'Coffee', icon: '☕', query: 'Coffee Shop', type: 'coffee', gradient: 'from-green-500 to-emerald-600' },
    { label: 'Food', icon: '🍔', query: "Restaurant", type: 'food', gradient: 'from-yellow-500 to-orange-500' },
    { label: 'Grocery', icon: '🛒', query: 'Grocery Store', type: 'grocery', gradient: 'from-red-500 to-pink-500' },
  ];

  return (
    <div className="w-full relative group">
      {/* Animated glow background for the entire Command Center */}
      <div
        className={`absolute -inset-1 rounded-[2.5rem] transition-all duration-500 blur-xl
          ${isFocused
            ? 'opacity-60 bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500 animate-pulse'
            : 'opacity-20 bg-amber-500'}`}
      />

      <div className="relative flex items-center glass-panel rounded-[2.5rem] p-2 shadow-2xl gap-2">
        {/* POI Fast-Action Cluster (Integrated Left) */}
        <div className="flex gap-1.5 pl-1">
          {categories.map((cat, idx) => (
            <button
              key={idx}
              onClick={() => {
                if (onCategorySearch) onCategorySearch(cat.type);
                setQuery(cat.query);
              }}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 border border-white/5
                ${theme === 'dark' ? 'bg-white/5 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-700 shadow-sm'}`}
              title={cat.label}
            >
              <span className="text-base">{cat.icon}</span>
            </button>
          ))}
        </div>

        <div className="w-px h-8 bg-white/10 mx-1" />

        {/* Search Input Area */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            placeholder="Search destination..."
            className={`w-full h-10 px-4 bg-transparent font-bold text-base transition-all duration-300 outline-none
              ${theme === 'dark' ? 'text-white placeholder-slate-300' : 'text-slate-900 placeholder-slate-500'}`}
          />

          <div className="flex items-center gap-2 pr-1">
            {onLocate && (
              <button
                type="button"
                onClick={onLocate}
                className="w-10 h-10 rounded-2xl bg-white/5 text-slate-300 flex items-center justify-center hover:bg-white/10 transition-all border border-white/5"
                title="Current Location"
              >
                <span className="text-xl">🎯</span>
              </button>
            )}
            {onQuickStop && (
              <button
                type="button"
                onClick={onQuickStop}
                className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center hover:bg-amber-500/20 transition-all"
                title="Quick Stops"
              >
                ⭐
              </button>
            )}
            <button
              type="submit"
              className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white flex items-center justify-center shadow-lg hover:scale-105 transition-all"
              title="Search"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
            {/* NEW: Direct Navigate Button */}
            {onNavigate && (
              <button
                type="button"
                onClick={handleNavigate}
                disabled={!query.trim()}
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg transition-all
                  ${query.trim()
                    ? 'bg-gradient-to-br from-emerald-400 to-green-600 text-white hover:scale-105'
                    : 'bg-white/5 text-slate-500 cursor-not-allowed'}`}
                title="Navigate to destination"
              >
                <span className="text-lg">🚀</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default SearchBox;
