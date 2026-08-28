import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Place } from '../types';
import { searchHistoryService, RecentSearchItem } from '../services/searchHistoryService';
import { searchPlacesText } from '../services/placesService';
import { predictiveRoutingService, PredictedDestination } from '../services/predictiveRoutingService';

interface SearchBoxProps {
  onSearch: (query: string) => void;
  onNavigate?: (query: string, location?: { lat: number; lng: number }) => void;
  onLocate?: () => void;
  onQuickStop?: () => void;
  onTestDrive?: () => void;
  onCategorySearch?: (type: 'gas' | 'coffee' | 'food' | 'grocery') => void;
  theme: 'light' | 'dark';
  userPlaces?: Place[];
  onSelectSavedPlace?: (place: Place) => void;
  onSelectPlace?: (place: Place) => void;
  userLocation?: { lat: number; lng: number } | null;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 172800000) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getDistanceMiles(userLoc: { lat: number; lng: number } | null | undefined, placeLoc: { lat: number; lng: number }): string | null {
  if (!userLoc || !placeLoc || !userLoc.lat || !userLoc.lng || !placeLoc.lat || !placeLoc.lng) return null;
  const R = 3958.8; // Earth radius in miles
  const dLat = (placeLoc.lat - userLoc.lat) * Math.PI / 180;
  const dLng = (placeLoc.lng - userLoc.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(userLoc.lat * Math.PI / 180) * Math.cos(placeLoc.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  const miles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

const SearchBox: React.FC<SearchBoxProps> = ({
  onSearch,
  onNavigate,
  onLocate,
  onQuickStop,
  onTestDrive,
  onCategorySearch,
  theme,
  userPlaces = [],
  onSelectSavedPlace,
  onSelectPlace,
  userLocation
}) => {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [activeTab, setActiveTab] = useState<'suggestions' | 'recent' | 'categories' | 'saved'>('recent');
  const [history, setHistory] = useState<RecentSearchItem[]>([]);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Predictive Routing Destinations based on time, day, trips & saved places
  const predictions = useMemo(() => {
    return predictiveRoutingService.getPredictions(userLocation || null, userPlaces);
  }, [userLocation, userPlaces, showDrawer, history]);

  useEffect(() => {
    const unsub = searchHistoryService.subscribe((items) => {
      setHistory(items);
    });
    return () => unsub();
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDrawer(false);
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Live autocomplete suggestions query (250ms debounce)
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsLoadingSuggestions(false);
      if (activeTab === 'suggestions') setActiveTab('recent');
      return;
    }

    setIsLoadingSuggestions(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const loc = userLocation || { lat: 35.0921, lng: -78.9823 };
        const results = await searchPlacesText(trimmed, loc);
        setSuggestions(results);
        if (results.length > 0) {
          setActiveTab('suggestions');
        }
      } catch (err) {
        console.warn('[SearchBox] Live suggestions failed:', err);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, 250);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [query, userLocation]);

  const filteredHistory = useMemo(() => {
    if (!query.trim()) return history.slice(0, 8);
    const qLower = query.toLowerCase().trim();
    return history.filter(item => 
      item.query.toLowerCase().includes(qLower) ||
      (item.name && item.name.toLowerCase().includes(qLower)) ||
      (item.description && item.description.toLowerCase().includes(qLower))
    ).slice(0, 8);
  }, [history, query]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      searchHistoryService.addItem({ query });
      onSearch(query);
      setShowDrawer(false);
      setIsFocused(false);
    }
  };

  const handleSelectSuggestion = (place: Place) => {
    setQuery(place.name);
    searchHistoryService.addItem({
      query: place.name,
      name: place.name,
      description: place.description,
      location: place.location,
      type: place.type,
      icon: place.icon
    });
    if (onSelectPlace) {
      onSelectPlace(place);
    } else {
      onSearch(place.name);
    }
    setShowDrawer(false);
    setIsFocused(false);
  };

  const handleQuickNavigateSuggestion = (e: React.MouseEvent, place: Place) => {
    e.stopPropagation();
    searchHistoryService.addItem({
      query: place.name,
      name: place.name,
      description: place.description,
      location: place.location,
      type: place.type,
      icon: place.icon
    });
    if (onNavigate) {
      onNavigate(place.name, place.location);
    } else if (onSelectPlace) {
      onSelectPlace(place);
    }
    setShowDrawer(false);
    setIsFocused(false);
  };

  const handleSelectRecent = (item: RecentSearchItem) => {
    const textToSearch = item.name || item.query;
    setQuery(textToSearch);
    searchHistoryService.addItem(item);
    if (item.location && onSelectPlace) {
      onSelectPlace({
        id: item.id,
        name: item.name || item.query,
        location: item.location,
        type: (item.type as any) || 'search_result',
        icon: item.icon || '📍',
        description: item.description || item.query
      });
    } else {
      onSearch(textToSearch);
    }
    setShowDrawer(false);
    setIsFocused(false);
  };

  const handleQuickNavigate = (e: React.MouseEvent, item: RecentSearchItem) => {
    e.stopPropagation();
    const dest = item.name || item.query;
    searchHistoryService.addItem(item);
    if (onNavigate) {
      onNavigate(dest, item.location);
    } else {
      onSearch(dest);
    }
    setShowDrawer(false);
    setIsFocused(false);
  };

  const handleDeleteItem = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    searchHistoryService.removeItem(id);
  };

  const handleClearHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    searchHistoryService.clearHistory();
  };

  const categories: { label: string; icon: string; query: string; type: 'gas' | 'coffee' | 'food' | 'grocery'; gradient: string }[] = [
    { label: 'Gas', icon: '⛽', query: 'Gas Station', type: 'gas', gradient: 'from-orange-500 to-red-500' },
    { label: 'Coffee', icon: '☕', query: 'Coffee Shop', type: 'coffee', gradient: 'from-green-500 to-emerald-600' },
    { label: 'Food', icon: '🍔', query: "Restaurant", type: 'food', gradient: 'from-yellow-500 to-orange-500' },
    { label: 'Grocery', icon: '🛒', query: 'Grocery Store', type: 'grocery', gradient: 'from-red-500 to-pink-500' },
  ];

  const hasQuery = query.trim().length > 0;
  const isDropdownOpen = showDrawer || isFocused;

  return (
    <div ref={containerRef} className="w-full relative group">
      {/* Animated glow background */}
      <div
        className={`absolute -inset-1 rounded-[2.5rem] transition-all duration-500 blur-xl
          ${isFocused || showDrawer
            ? 'opacity-70 bg-gradient-to-r from-amber-400 via-orange-500 to-indigo-500 animate-pulse'
            : 'opacity-20 bg-amber-500'}`}
      />

      {/* Main Search Command Bar */}
      <div className="relative flex items-center glass-panel rounded-[2.5rem] p-2 shadow-2xl gap-2 z-20">
        {/* Recent & Categories Drawer Toggle */}
        <button
          type="button"
          onClick={() => setShowDrawer(prev => !prev)}
          className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ml-1 border
            ${showDrawer
              ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-inner'
              : theme === 'dark' ? 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
          title="Recent Searches & Suggested Places"
        >
          <span className="text-lg">🕒</span>
        </button>

        <div className="w-px h-8 bg-white/10 mx-1" />

        {/* Search Input */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center relative">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowDrawer(true);
            }}
            onFocus={() => {
              setIsFocused(true);
              setShowDrawer(true);
            }}
            placeholder="Where to? (e.g. Main St, Starbucks, Airport)"
            className={`w-full h-10 px-3 bg-transparent font-black text-sm sm:text-base transition-all duration-300 outline-none
              ${theme === 'dark' ? 'text-white placeholder-slate-400' : 'text-slate-900 placeholder-slate-400'}`}
          />

          {isLoadingSuggestions && (
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-2 shrink-0" />
          )}

          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSuggestions([]);
                setActiveTab('recent');
              }}
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-slate-400 hover:text-white flex items-center justify-center text-xs mr-2 transition-all shrink-0"
              title="Clear text"
            >
              ✕
            </button>
          )}

          <button
            type="submit"
            className="w-10 h-10 shrink-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-lg hover:scale-105 transition-all active:scale-90"
            title="Search"
          >
            <span className="text-xl">🚀</span>
          </button>
        </form>

        <div className="w-px h-8 bg-white/10 mx-1" />

        <div className="flex items-center gap-1.5 pr-1">
          {onLocate && (
            <button
              type="button"
              onClick={onLocate}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all border border-white/5
                ${theme === 'dark' ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              title="Current Location"
            >
              <span className="text-xl">🎯</span>
            </button>
          )}
          {onQuickStop && (
            <button
              type="button"
              onClick={onQuickStop}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all border
                ${theme === 'dark' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500 hover:bg-amber-500/20' : 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100'}`}
              title="Saved Places & Favorites"
            >
              <span className="text-lg">⭐</span>
            </button>
          )}
        </div>
      </div>

      {/* Floating Suggestions & History Popover — Opens Upward */}
      {isDropdownOpen && (
        <div className="absolute left-0 right-0 bottom-full mb-3 z-30 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className={`glass-panel rounded-3xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.6)] border backdrop-blur-2xl max-h-[60vh] flex flex-col
            ${theme === 'dark' ? 'border-white/15 bg-slate-950/95' : 'border-slate-200 bg-white/95'}`}
          >
            {/* Predictive Smart Suggestion Banner (shown when search is empty) */}
            {!hasQuery && predictions.length > 0 && (
              <div className="mb-3 p-3 rounded-2xl bg-gradient-to-r from-purple-900/40 via-indigo-900/40 to-blue-900/40 border border-purple-500/30 shadow-lg shrink-0">
                <div className="flex items-center justify-between mb-1.5 px-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs">🔮</span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-purple-300">
                      Smart Route Prediction
                    </span>
                  </div>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-200">
                    {predictions[0].confidence}% Match
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div 
                    onClick={() => handleSelectSuggestion({
                      id: predictions[0].id,
                      name: predictions[0].name,
                      location: predictions[0].location,
                      type: predictions[0].type as any,
                      icon: predictions[0].icon,
                      radius: 100,
                      description: predictions[0].description
                    })}
                    className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer group"
                  >
                    <span className="text-2xl shrink-0 group-hover:scale-110 transition-transform">{predictions[0].icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs sm:text-sm font-black text-white truncate group-hover:text-purple-200 transition-colors">
                          {predictions[0].name}
                        </h4>
                        {predictions[0].distanceMiles && (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-md bg-emerald-500/20 text-emerald-300 shrink-0">
                            ⚡ {predictions[0].distanceMiles}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-purple-200/80 truncate mt-0.5">
                        {predictions[0].reason}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => handleQuickNavigateSuggestion(e, {
                      id: predictions[0].id,
                      name: predictions[0].name,
                      location: predictions[0].location,
                      type: predictions[0].type as any,
                      icon: predictions[0].icon,
                      radius: 100,
                      description: predictions[0].description
                    })}
                    className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-[11px] font-black flex items-center gap-1 shadow-md transition-all active:scale-95 shrink-0"
                    title="Start Navigation"
                  >
                    <span>🚀</span>
                    <span>GO</span>
                  </button>
                </div>
              </div>
            )}

            {/* Header Tabs */}
            <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                {/* Live Suggestions Tab (shown if query or suggestions exist) */}
                {(suggestions.length > 0 || hasQuery) && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('suggestions')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black tracking-wide transition-all flex items-center gap-1.5 shrink-0
                      ${activeTab === 'suggestions'
                        ? 'bg-indigo-600 text-white shadow-md'
                        : theme === 'dark' ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}
                  >
                    <span>Suggestions ({suggestions.length})</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setActiveTab('recent')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black tracking-wide transition-all flex items-center gap-1.5 shrink-0
                    ${activeTab === 'recent'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : theme === 'dark' ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}
                >
                  <span>🕒</span>
                  <span>Recent ({filteredHistory.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('categories')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black tracking-wide transition-all flex items-center gap-1.5 shrink-0
                    ${activeTab === 'categories'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : theme === 'dark' ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}
                >
                  <span>⚡</span>
                  <span>Nearby</span>
                </button>

                {userPlaces.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('saved')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black tracking-wide transition-all flex items-center gap-1.5 shrink-0
                      ${activeTab === 'saved'
                        ? 'bg-indigo-600 text-white shadow-md'
                        : theme === 'dark' ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}
                  >
                    <span>⭐</span>
                    <span>Saved ({userPlaces.length})</span>
                  </button>
                )}
              </div>

              {activeTab === 'recent' && history.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="text-[11px] font-bold text-slate-400 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10 shrink-0"
                >
                  Clear All
                </button>
              )}
            </div>

            {/* Tab 0: Live Suggestions List */}
            {activeTab === 'suggestions' && (
              <div className="flex-1 overflow-y-auto no-scrollbar space-y-1.5">
                {isLoadingSuggestions ? (
                  <div className="py-6 text-center space-y-2">
                    <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-xs font-bold text-slate-400">Searching matching local addresses...</p>
                  </div>
                ) : suggestions.length > 0 ? (
                  suggestions.map((place) => {
                    const distMiles = getDistanceMiles(userLocation, place.location);
                    return (
                      <div
                        key={place.id}
                        onClick={() => handleSelectSuggestion(place)}
                        className={`group flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl cursor-pointer transition-all hover:scale-[1.01] active:scale-98 border
                          ${theme === 'dark'
                            ? 'bg-white/5 hover:bg-indigo-600/15 border-white/5 hover:border-indigo-500/30'
                            : 'bg-slate-50 hover:bg-indigo-50/60 border-slate-200/60 hover:border-indigo-200'}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className={`text-xs sm:text-sm font-black truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                              {place.name}
                            </h4>
                            {distMiles && (
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                                theme === 'dark' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700'
                              }`}>
                                ⚡ {distMiles}
                              </span>
                            )}
                          </div>
                          {place.description && (
                            <p className="text-[10px] text-slate-400 truncate mt-0.5">
                              {place.description}
                            </p>
                          )}
                        </div>

                        {/* Quick 1-Tap GO button */}
                        <button
                          type="button"
                          onClick={(e) => handleQuickNavigateSuggestion(e, place)}
                          className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] sm:text-xs font-black flex items-center gap-1 shadow-md transition-all active:scale-95 shrink-0"
                          title="Navigate to this address"
                        >
                          <span>🚀</span>
                          <span className="hidden sm:inline">GO</span>
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-6">
                    <p className="text-2xl mb-1">🔍</p>
                    <p className={`text-xs font-bold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                      No local addresses match "{query}"
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1 max-w-xs mx-auto">
                      Hit Enter or 🚀 to run an expanded nationwide search.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Tab 1: Recent Searches List */}
            {activeTab === 'recent' && (
              <div className="flex-1 overflow-y-auto no-scrollbar space-y-1.5">
                {filteredHistory.length > 0 ? (
                  filteredHistory.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleSelectRecent(item)}
                      className={`group flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl cursor-pointer transition-all hover:scale-[1.01] active:scale-98 border
                        ${theme === 'dark'
                          ? 'bg-white/5 hover:bg-white/10 border-white/5 hover:border-indigo-500/30'
                          : 'bg-slate-50 hover:bg-indigo-50/60 border-slate-200/60 hover:border-indigo-200'}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className={`text-xs sm:text-sm font-black truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                            {item.name || item.query}
                          </h4>
                          {item.frequencyCount && item.frequencyCount > 1 && (
                            <span className="text-[9px] font-black px-1.5 py-0.2 rounded-md bg-amber-500/20 text-amber-300 shrink-0">
                              🔥 {item.frequencyCount}x
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 font-semibold shrink-0">
                            {formatRelativeTime(item.timestamp)}
                          </span>
                        </div>
                        {item.description && (
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">
                            {item.description}
                          </p>
                        )}
                      </div>

                      {/* Quick 1-Tap Navigate & Delete Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleQuickNavigate(e, item)}
                          className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] sm:text-xs font-black flex items-center gap-1 shadow-md transition-all active:scale-95"
                          title="Start Navigation"
                        >
                          <span>🚀</span>
                          <span className="hidden sm:inline">GO</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteItem(e, item.id)}
                          className="w-7 h-7 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center text-xs transition-all"
                          title="Remove from history"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-6">
                    <p className="text-2xl mb-1">🧭</p>
                    <p className={`text-xs font-bold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                      {query.trim() ? `No recent searches match "${query}"` : 'No recent searches yet'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1 max-w-xs mx-auto">
                      Addresses and places you search or navigate to will appear here for instant 1-tap access.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Nearby Categories */}
            {activeTab === 'categories' && (
              <div className="grid grid-cols-4 gap-2 pt-1">
                {categories.map((cat, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      if (onCategorySearch) onCategorySearch(cat.type);
                      setQuery(cat.query);
                      setShowDrawer(false);
                      setIsFocused(false);
                    }}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl transition-all hover:scale-105 active:scale-95 border
                      ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 border-white/5' : 'bg-slate-100 hover:bg-slate-200 border-slate-200'}`}
                  >
                    <span className="text-2xl">{cat.icon}</span>
                    <span className={`text-[10px] font-bold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                      {cat.label}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Tab 3: Saved Places */}
            {activeTab === 'saved' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto no-scrollbar pt-1">
                {userPlaces.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    onClick={() => {
                      if (onSelectSavedPlace) onSelectSavedPlace(place);
                      setShowDrawer(false);
                      setIsFocused(false);
                    }}
                    className={`flex items-center gap-2.5 p-2.5 rounded-2xl transition-all hover:scale-[1.02] active:scale-95 text-left min-w-0 border
                      ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 border-white/5' : 'bg-slate-100 hover:bg-slate-200 border-slate-200'}`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/20 text-amber-400 flex items-center justify-center text-base shrink-0">
                      {place.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-black truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                        {place.name}
                      </p>
                      {place.description && (
                        <p className="text-[9px] text-slate-400 truncate leading-none mt-0.5">
                          {place.description}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchBox;

