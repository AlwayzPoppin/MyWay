
import React, { useState } from 'react';

interface SearchBoxProps {
  onSearch: (query: string) => void;
  theme: 'light' | 'dark';
}

const SearchBox: React.FC<SearchBoxProps> = ({ onSearch, theme }) => {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch(query);
  };

  const categories = [
    { label: 'Gas', icon: '⛽', query: 'Shell Gas Station', gradient: 'from-orange-500 to-red-500' },
    { label: 'Coffee', icon: '☕', query: 'Starbucks Coffee', gradient: 'from-green-500 to-emerald-600' },
    { label: 'Food', icon: '🍔', query: "McDonald's", gradient: 'from-yellow-500 to-orange-500' },
    { label: 'Grocery', icon: '🛒', query: 'Target Store', gradient: 'from-red-500 to-pink-500' },
  ];

  return (
    <div className="w-full flex flex-col-reverse gap-4">
      <form onSubmit={handleSubmit} className="relative group">
        {/* Animated glow background */}
        <div
          className={`absolute -inset-1 rounded-[2.5rem] transition-all duration-500 blur-xl
            ${isFocused
              ? 'opacity-60 bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500 animate-pulse'
              : 'opacity-20 bg-amber-500'}`}
        />

        {/* Shimmer effect on focus */}
        <div className={`absolute inset-0 rounded-[2rem] overflow-hidden ${isFocused ? 'opacity-100' : 'opacity-0'} transition-opacity`}>
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-shimmer" />
        </div>

        <div className="relative flex items-center">
          {/* Search icon with animation */}
          <div className="absolute left-6 flex items-center pointer-events-none">
            <div className={`transition-all duration-300 ${isFocused ? 'scale-110' : ''}`}>
              <svg
                className={`w-7 h-7 transition-all duration-300 ${isFocused
                  ? 'text-amber-500 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                  : theme === 'dark' ? 'text-slate-500' : 'text-slate-400'
                  }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Where to? (e.g. Office, Home...)"
            className={`w-full h-16 pl-16 pr-20 border-2 rounded-[2rem] font-semibold text-lg transition-all duration-300 outline-none
              backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)]
              ${theme === 'dark'
                ? `bg-[#0f172a]/95 text-white placeholder-slate-500 ${isFocused ? 'border-amber-500/70' : 'border-white/10'}`
                : `bg-white/95 text-slate-900 placeholder-slate-400 border-slate-200 shadow-[0_8px_30px_rgba(0,0,0,0.12)] ${isFocused ? 'border-amber-500/50' : 'border-slate-200'}`}`}
          />

          {/* Submit button with gradient */}
          <div className="absolute right-3">
            <button
              type="submit"
              className="group/btn w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white flex items-center justify-center shadow-lg 
                hover:shadow-amber-500/30 hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-200"
            >
              <svg className="w-5 h-5 transition-transform group-hover/btn:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </form>

      {/* Enhanced category chips */}
      <div className="flex gap-2.5 overflow-x-auto pt-2 no-scrollbar px-1 justify-center">
        {categories.map((cat, idx) => (
          <button
            key={cat.label}
            onClick={() => onSearch(cat.query)}
            className={`group relative flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shrink-0
              hover:scale-105 active:scale-95
              ${theme === 'dark'
                ? 'bg-slate-800/80 text-slate-300 hover:text-white border border-white/5 hover:border-white/10'
                : 'bg-white text-slate-700 hover:text-slate-900 border-2 border-slate-200 shadow-md hover:border-amber-400'}`}
            style={{ animationDelay: `${idx * 50}ms` }}
          >
            {/* Hover gradient overlay */}
            <div className={`absolute inset-0 rounded-2xl bg-gradient-to-r ${cat.gradient} opacity-0 group-hover:opacity-10 transition-opacity duration-300`} />

            <span className="text-lg relative z-10 group-hover:scale-110 transition-transform duration-200">{cat.icon}</span>
            <span className="relative z-10">{cat.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SearchBox;
