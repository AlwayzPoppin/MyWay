
import React from 'react';

interface HeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onUpgrade?: () => void;
  userTier?: string;
  children?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({ theme, onToggleTheme, onUpgrade, userTier = 'free', children }) => {
  const isPremium = userTier === 'gold' || userTier === 'platinum';

  return (
    <header className={`h-16 md:h-18 border-b px-4 md:px-8 flex items-center justify-between z-[90] safe-top transition-all duration-500 backdrop-blur-xl
      ${theme === 'dark'
        ? 'bg-gradient-to-r from-[#050914]/98 via-[#0f172a]/95 to-[#050914]/98 border-white/5'
        : 'bg-gradient-to-r from-white/98 via-slate-50/95 to-white/98 border-slate-200'}`}
    >
      {/* Logo and brand */}
      <div className="flex items-center gap-3 md:gap-4">
        <div className="relative group w-10 h-10 md:w-11 md:h-11 shadow-xl transition-all duration-300 hover:scale-105">
          {/* Logo Image */}
          <img
            src="/logo.png"
            alt="MyWay Logo"
            className="w-full h-full object-contain drop-shadow-lg"
          />
        </div>

        <div className="hidden sm:block">
          <h1 className="text-xl md:text-2xl leading-none flex items-center" style={{ fontFamily: 'Poppins, sans-serif' }}>
            <span className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>My</span>
            <span className="font-extrabold bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500 bg-clip-text text-transparent">Way</span>
          </h1>
          <p className="text-[9px] text-slate-500 font-semibold uppercase tracking-[0.2em] mt-0.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Family GPS
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 md:gap-5">
        {/* Alerts for Desktop - Integrated */}
        <div className="hidden md:flex flex-col items-end mr-2">
          {children}
        </div>

        {/* Upgrade button with gradient */}
        {!isPremium && (
          <button
            onClick={onUpgrade}
            className="hidden md:flex items-center gap-2 px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300
              bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 text-black
              hover:shadow-lg hover:shadow-amber-500/30 hover:scale-105 active:scale-95"
          >
            <span>✨</span>
            Upgrade to Gold
          </button>
        )}

        {/* Status indicator */}
        <div className={`flex items-center gap-2.5 rounded-full px-4 py-2 transition-all duration-300
          ${theme === 'dark'
            ? 'bg-white/5 border border-white/5 hover:bg-white/10'
            : 'bg-slate-100 border border-slate-200 hover:bg-slate-50'}`}
        >
          <div className="relative">
            <div className={`w-2 h-2 rounded-full ${isPremium ? 'bg-amber-500' : 'bg-green-500'}`} />
            <div className={`absolute inset-0 w-2 h-2 rounded-full animate-ping ${isPremium ? 'bg-amber-500' : 'bg-green-500'}`} />
          </div>
          <span className={`text-[10px] font-bold uppercase tracking-widest whitespace-nowrap
            ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}
          >
            {isPremium ? `${userTier} Member` : 'Active Circle'}
          </span>
        </div>

        {/* Theme toggle - Circular Button */}
        <button
          onClick={onToggleTheme}
          className={`group w-10 h-10 flex items-center justify-center rounded-full transition-all duration-300 hover:scale-110 shadow-lg
            ${theme === 'dark'
              ? 'bg-white/10 border border-white/10 hover:bg-white/20 text-yellow-400'
              : 'bg-white border border-slate-100 hover:border-slate-200 text-slate-600 shadow-sm'}`}
        >
          {theme === 'dark' ? (
            <svg className="w-5 h-5 transition-transform group-hover:rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M16.95 16.95l.707.707M7.05 7.05l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 transition-transform group-hover:-rotate-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>

        {/* User avatar with premium ring */}
        <div className="relative group">
          {isPremium && (
            <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 animate-gradient opacity-70 blur-sm" />
          )}
          <div className={`relative w-10 h-10 md:w-11 md:h-11 rounded-full border-2 overflow-hidden shadow-xl transition-all duration-300 group-hover:scale-105
            ${theme === 'dark' ? 'bg-slate-800 border-white/20' : 'bg-white border-slate-200'}
            ${isPremium ? 'border-amber-500' : ''}`}
          >
            <img src="https://i.pravatar.cc/100?u=sarah" alt="User" className="w-full h-full object-cover" />
          </div>
          {/* Online indicator */}
          <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#050914]" />
        </div>
      </div>
    </header>
  );
};

export default Header;
