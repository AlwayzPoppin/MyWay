import React, { useState, useMemo } from 'react';
import { Vehicle } from '../types';
import {
    VEHICLE_DATABASE,
    VehicleMakeInfo,
    VehicleModelInfo
} from '../data/vehicleDatabase';
import {
    Search,
    ArrowLeft,
    Check,
    Car,
    Zap,
    Fuel,
    Sliders,
    Sparkles,
    X,
    Flame
} from 'lucide-react';

interface VehicleAddWizardProps {
    theme: 'light' | 'dark';
    onAddVehicle: (vehicle: Omit<Vehicle, 'id'>) => void;
    onCancel?: () => void;
}

type CategoryFilter = 'all' | 'popular' | 'american' | 'asian' | 'european' | 'electric';
type BodyTypeFilter = 'all' | 'suv' | 'truck' | 'sedan' | 'ev' | 'hybrid' | 'coupe';

const COUNTRY_FLAGS: Record<string, string> = {
    'USA': '🇺🇸',
    'Japan': '🇯🇵',
    'Germany': '🇩🇪',
    'South Korea': '🇰🇷',
    'Sweden': '🇸🇪',
    'UK': '🇬🇧',
    'Italy': '🇮🇹',
    'Other': '🌐'
};

export const VehicleAddWizard: React.FC<VehicleAddWizardProps> = ({
    theme,
    onAddVehicle,
    onCancel
}) => {
    // Step state: 1 = Make, 2 = Model, 3 = Confirm/Specs, 'custom' = Manual
    const [step, setStep] = useState<1 | 2 | 3 | 'custom'>(1);

    // Selections
    const [selectedMake, setSelectedMake] = useState<VehicleMakeInfo | null>(null);
    const [selectedModel, setSelectedModel] = useState<VehicleModelInfo | null>(null);

    // Step 1 Search & Category filter
    const [makeSearch, setMakeSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

    // Step 2 Search & Body filter
    const [modelSearch, setModelSearch] = useState('');
    const [bodyTypeFilter, setBodyTypeFilter] = useState<BodyTypeFilter>('all');

    // Step 3 / Custom Fields
    const [year, setYear] = useState<number>(2024);
    const [nickname, setNickname] = useState('');
    const [mpg, setMpg] = useState<number>(28);
    const [tankCapacityGal, setTankCapacityGal] = useState<number>(15.0);
    const [fuelType, setFuelType] = useState<Vehicle['fuelType']>('gasoline');

    // Custom fallback specific fields
    const [customMakeName, setCustomMakeName] = useState('');
    const [customModelName, setCustomModelName] = useState('');

    // Filter makes
    const filteredMakes = useMemo(() => {
        return VEHICLE_DATABASE.filter(makeInfo => {
            const matchesSearch = makeInfo.make.toLowerCase().includes(makeSearch.trim().toLowerCase());
            if (!matchesSearch) return false;

            if (categoryFilter === 'all') return true;
            if (categoryFilter === 'popular') return makeInfo.category === 'popular';
            if (categoryFilter === 'american') return makeInfo.category === 'american' || makeInfo.country === 'USA';
            if (categoryFilter === 'asian') return makeInfo.category === 'asian' || makeInfo.country === 'Japan' || makeInfo.country === 'South Korea';
            if (categoryFilter === 'european') return makeInfo.category === 'european' || makeInfo.country === 'Germany' || makeInfo.country === 'Sweden' || makeInfo.country === 'UK' || makeInfo.country === 'Italy';
            if (categoryFilter === 'electric') return makeInfo.category === 'electric' || makeInfo.models.some(m => m.fuelType === 'electric');
            return true;
        });
    }, [makeSearch, categoryFilter]);

    // Filter models for selected make
    const filteredModels = useMemo(() => {
        if (!selectedMake) return [];
        return selectedMake.models.filter(modelInfo => {
            const matchesSearch = modelInfo.model.toLowerCase().includes(modelSearch.trim().toLowerCase());
            if (!matchesSearch) return false;

            if (bodyTypeFilter === 'all') return true;
            if (bodyTypeFilter === 'suv') return modelInfo.bodyType === 'suv';
            if (bodyTypeFilter === 'truck') return modelInfo.bodyType === 'truck';
            if (bodyTypeFilter === 'sedan') return modelInfo.bodyType === 'sedan';
            if (bodyTypeFilter === 'coupe') return modelInfo.bodyType === 'coupe';
            if (bodyTypeFilter === 'ev') return modelInfo.fuelType === 'electric' || modelInfo.bodyType === 'ev';
            if (bodyTypeFilter === 'hybrid') return modelInfo.fuelType === 'hybrid';
            return true;
        });
    }, [selectedMake, modelSearch, bodyTypeFilter]);

    // Handlers
    const handleSelectMake = (make: VehicleMakeInfo) => {
        setSelectedMake(make);
        setModelSearch('');
        setBodyTypeFilter('all');
        setStep(2);
    };

    const handleSelectModel = (model: VehicleModelInfo) => {
        setSelectedModel(model);
        setMpg(model.mpg);
        setTankCapacityGal(model.tankCapacityGal || (model.fuelType === 'electric' ? 75 : 15.0));
        setFuelType(model.fuelType);
        setNickname(`${year} ${selectedMake?.make} ${model.model}`);
        setStep(3);
    };

    const handleYearChange = (newYear: number) => {
        setYear(newYear);
        if (selectedMake && selectedModel) {
            setNickname(`${newYear} ${selectedMake.make} ${selectedModel.model}`);
        }
    };

    const handleConfirmVehicle = () => {
        if (!selectedMake || !selectedModel) return;

        const displayName = nickname.trim() || `${year} ${selectedMake.make} ${selectedModel.model}`;
        onAddVehicle({
            name: displayName,
            make: selectedMake.make,
            model: selectedModel.model,
            year: year,
            mpg: mpg > 0 ? mpg : selectedModel.mpg,
            tankCapacityGal: tankCapacityGal > 0 ? tankCapacityGal : 15.0,
            fuelType: fuelType,
            isPrimary: true
        });
    };

    const handleConfirmCustom = () => {
        if (!customMakeName.trim() || !customModelName.trim()) return;

        const displayName = nickname.trim() || `${year} ${customMakeName.trim()} ${customModelName.trim()}`;
        onAddVehicle({
            name: displayName,
            make: customMakeName.trim(),
            model: customModelName.trim(),
            year: year,
            mpg: mpg > 0 ? mpg : 28,
            tankCapacityGal: tankCapacityGal > 0 ? tankCapacityGal : 15.0,
            fuelType: fuelType,
            isPrimary: true
        });
    };

    const estimatedRange = Math.round(mpg * tankCapacityGal);
    const usableRange = Math.round(estimatedRange * 0.9);

    return (
        <div className={`rounded-2xl border p-3.5 sm:p-4 shadow-xl transition-all animate-in fade-in duration-200 ${
            theme === 'dark'
                ? 'bg-slate-900/95 border-indigo-500/30 text-white shadow-indigo-950/20'
                : 'bg-white border-indigo-200 text-slate-900 shadow-indigo-100/50'
        }`}>
            {/* Wizard Header & Breadcrumbs */}
            <div className="flex items-center justify-between gap-2 mb-3 pb-2.5 border-b border-white/10">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1.5 rounded-xl bg-indigo-500/20 text-indigo-400">
                        <Car className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <h4 className="text-xs font-black uppercase tracking-wider text-indigo-400">
                                Vehicle Setup Wizard
                            </h4>
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 font-bold">
                                {step === 1 ? 'Step 1/3: Make' : step === 2 ? 'Step 2/3: Model' : step === 3 ? 'Step 3/3: Specs' : 'Custom Specs'}
                            </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate">
                            {step === 1 && 'Choose your vehicle make from 40+ automotive brands'}
                            {step === 2 && `Select your ${selectedMake?.make} model`}
                            {step === 3 && `Confirm factory EPA specs for your ${selectedModel?.model}`}
                            {step === 'custom' && 'Enter custom vehicle specifications manually'}
                        </p>
                    </div>
                </div>

                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                        title="Close wizard"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Stepper Pill Indicator */}
            {step !== 'custom' && (
                <div className="grid grid-cols-3 gap-1 mb-3 text-center text-[10px] font-bold">
                    <button
                        type="button"
                        onClick={() => setStep(1)}
                        className={`py-1 rounded-lg transition-all ${
                            step === 1
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-white/5 text-slate-400 hover:text-white'
                        }`}
                    >
                        1. {selectedMake ? selectedMake.make : 'Brand'}
                    </button>
                    <button
                        type="button"
                        disabled={!selectedMake}
                        onClick={() => selectedMake && setStep(2)}
                        className={`py-1 rounded-lg transition-all ${
                            step === 2
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : selectedMake ? 'bg-white/5 text-slate-400 hover:text-white' : 'opacity-40 bg-white/5 text-slate-500 cursor-not-allowed'
                        }`}
                    >
                        2. {selectedModel ? selectedModel.model : 'Model'}
                    </button>
                    <button
                        type="button"
                        disabled={!selectedModel}
                        onClick={() => selectedModel && setStep(3)}
                        className={`py-1 rounded-lg transition-all ${
                            step === 3
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : selectedModel ? 'bg-white/5 text-slate-400 hover:text-white' : 'opacity-40 bg-white/5 text-slate-500 cursor-not-allowed'
                        }`}
                    >
                        3. Specs & Range
                    </button>
                </div>
            )}

            {/* STEP 1: MAKE SELECTION */}
            {step === 1 && (
                <div className="space-y-3 animate-in fade-in duration-150">
                    {/* Search Bar */}
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            value={makeSearch}
                            onChange={(e) => setMakeSearch(e.target.value)}
                            placeholder="Search 40+ brands (e.g. Jeep, Toyota, Ford, Tesla, BMW)..."
                            className={`w-full pl-9 pr-8 py-2 text-xs rounded-xl border font-medium outline-none transition-all ${
                                theme === 'dark'
                                    ? 'bg-slate-950/80 border-white/10 text-white placeholder:text-slate-500 focus:border-indigo-500'
                                    : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500'
                            }`}
                        />
                        {makeSearch && (
                            <button
                                type="button"
                                onClick={() => setMakeSearch('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    {/* Category Filter Chips */}
                    <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none text-[10px] font-bold">
                        {(
                            [
                                { id: 'all', label: 'All Brands' },
                                { id: 'popular', label: '⭐ Most Popular' },
                                { id: 'american', label: '🇺🇸 American' },
                                { id: 'asian', label: '🇯🇵 / 🇰🇷 Asian' },
                                { id: 'european', label: '🇪🇺 European' },
                                { id: 'electric', label: '⚡ Electric' }
                            ] as const
                        ).map((cat) => (
                            <button
                                key={cat.id}
                                type="button"
                                onClick={() => setCategoryFilter(cat.id)}
                                className={`px-2.5 py-1 rounded-lg shrink-0 transition-all cursor-pointer ${
                                    categoryFilter === cat.id
                                        ? 'bg-indigo-600 text-white shadow-sm'
                                        : theme === 'dark' ? 'bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                            >
                                {cat.label}
                            </button>
                        ))}
                    </div>

                    {/* Makes Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
                        {filteredMakes.length === 0 ? (
                            <div className="col-span-full py-8 text-center text-xs text-slate-400">
                                No brand found matching "{makeSearch}".
                                <div className="mt-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCustomMakeName(makeSearch);
                                            setStep('custom');
                                        }}
                                        className="text-indigo-400 hover:underline font-bold cursor-pointer"
                                    >
                                        Add "{makeSearch}" as a custom vehicle →
                                    </button>
                                </div>
                            </div>
                        ) : (
                            filteredMakes.map((makeInfo) => {
                                const flag = COUNTRY_FLAGS[makeInfo.country] || '🚗';
                                return (
                                    <button
                                        key={makeInfo.make}
                                        type="button"
                                        onClick={() => handleSelectMake(makeInfo)}
                                        className={`p-2.5 rounded-xl border text-left transition-all group cursor-pointer hover:scale-[1.02] active:scale-[0.98] ${
                                            theme === 'dark'
                                                ? 'bg-white/5 border-white/5 hover:bg-indigo-500/10 hover:border-indigo-500/30'
                                                : 'bg-slate-50 border-slate-200 hover:bg-indigo-50/50 hover:border-indigo-200'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-1 mb-1">
                                            <span className="text-sm">{flag}</span>
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-slate-400 capitalize">
                                                {makeInfo.models.length} models
                                            </span>
                                        </div>
                                        <div className="text-xs font-black truncate group-hover:text-indigo-400 transition-colors">
                                            {makeInfo.make}
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    {/* Custom Fallback Link */}
                    <div className="pt-2 text-center border-t border-white/5">
                        <button
                            type="button"
                            onClick={() => setStep('custom')}
                            className="text-[11px] font-semibold text-slate-400 hover:text-indigo-400 transition-colors cursor-pointer inline-flex items-center gap-1"
                        >
                            <Sliders className="w-3 h-3" />
                            Can't find your brand? Enter specs manually
                        </button>
                    </div>
                </div>
            )}

            {/* STEP 2: MODEL SELECTION */}
            {step === 2 && selectedMake && (
                <div className="space-y-3 animate-in fade-in duration-150">
                    {/* Back button & Make title */}
                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            onClick={() => setStep(1)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-white transition-colors cursor-pointer"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" /> Back to Brands
                        </button>
                        <span className="text-xs font-black text-indigo-400">
                            {selectedMake.make} ({selectedMake.models.length} Models)
                        </span>
                    </div>

                    {/* Model Search */}
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            value={modelSearch}
                            onChange={(e) => setModelSearch(e.target.value)}
                            placeholder={`Search ${selectedMake.make} models (e.g. ${selectedMake.models[0]?.model || 'model'})...`}
                            className={`w-full pl-9 pr-8 py-2 text-xs rounded-xl border font-medium outline-none transition-all ${
                                theme === 'dark'
                                    ? 'bg-slate-950/80 border-white/10 text-white placeholder:text-slate-500 focus:border-indigo-500'
                                    : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500'
                            }`}
                        />
                        {modelSearch && (
                            <button
                                type="button"
                                onClick={() => setModelSearch('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    {/* Body Type Filter Chips */}
                    <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none text-[10px] font-bold">
                        {(
                            [
                                { id: 'all', label: 'All Models' },
                                { id: 'suv', label: '🚙 SUV' },
                                { id: 'truck', label: '🛻 Truck' },
                                { id: 'sedan', label: '🚗 Sedan' },
                                { id: 'hybrid', label: '🌿 Hybrid' },
                                { id: 'ev', label: '⚡ EV' },
                                { id: 'coupe', label: '🏎️ Coupe' }
                            ] as const
                        ).map((cat) => (
                            <button
                                key={cat.id}
                                type="button"
                                onClick={() => setBodyTypeFilter(cat.id)}
                                className={`px-2.5 py-1 rounded-lg shrink-0 transition-all cursor-pointer ${
                                    bodyTypeFilter === cat.id
                                        ? 'bg-indigo-600 text-white shadow-sm'
                                        : theme === 'dark' ? 'bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                            >
                                {cat.label}
                            </button>
                        ))}
                    </div>

                    {/* Models List */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
                        {filteredModels.length === 0 ? (
                            <div className="col-span-full py-8 text-center text-xs text-slate-400">
                                No models found matching filter.
                                <div className="mt-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCustomMakeName(selectedMake.make);
                                            setCustomModelName(modelSearch);
                                            setStep('custom');
                                        }}
                                        className="text-indigo-400 hover:underline font-bold cursor-pointer"
                                    >
                                        Add custom model under {selectedMake.make} →
                                    </button>
                                </div>
                            </div>
                        ) : (
                            filteredModels.map((modelInfo) => (
                                <button
                                    key={modelInfo.model}
                                    type="button"
                                    onClick={() => handleSelectModel(modelInfo)}
                                    className={`p-2.5 rounded-xl border text-left transition-all group cursor-pointer hover:scale-[1.01] active:scale-[0.99] flex flex-col justify-between ${
                                        theme === 'dark'
                                            ? 'bg-white/5 border-white/5 hover:bg-indigo-500/10 hover:border-indigo-500/30'
                                            : 'bg-slate-50 border-slate-200 hover:bg-indigo-50/50 hover:border-indigo-200'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                        <span className="text-xs font-black truncate group-hover:text-indigo-400 transition-colors">
                                            {modelInfo.model}
                                        </span>
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-white/10 text-slate-300 shrink-0">
                                            {modelInfo.bodyType || 'auto'}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                                        <span className="inline-flex items-center gap-1 font-semibold">
                                            {modelInfo.fuelType === 'electric' && <Zap className="w-3 h-3 text-amber-400" />}
                                            {modelInfo.fuelType === 'hybrid' && <Sparkles className="w-3 h-3 text-emerald-400" />}
                                            {modelInfo.fuelType === 'diesel' && <Fuel className="w-3 h-3 text-sky-400" />}
                                            {modelInfo.fuelType === 'gasoline' && <Fuel className="w-3 h-3 text-slate-400" />}
                                            {modelInfo.fuelType === 'premium' && <Flame className="w-3 h-3 text-rose-400" />}
                                            <span className="capitalize">{modelInfo.fuelType}</span>
                                        </span>

                                        <span className="font-bold text-slate-300">
                                            {modelInfo.mpg} {modelInfo.fuelType === 'electric' ? 'MPGe' : 'MPG'}
                                            {modelInfo.tankCapacityGal ? ` • ${modelInfo.tankCapacityGal} gal` : ''}
                                        </span>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* STEP 3: CONFIRM & CUSTOMIZE SPECS */}
            {step === 3 && selectedMake && selectedModel && (
                <div className="space-y-3.5 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            onClick={() => setStep(2)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-white transition-colors cursor-pointer"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" /> Back to Models
                        </button>
                        <span className="text-[10px] font-semibold text-emerald-400">
                            ✓ Factory Specs Pre-Loaded
                        </span>
                    </div>

                    {/* Vehicle Identity Card */}
                    <div className={`p-3 rounded-xl border flex items-center gap-3 ${
                        theme === 'dark' ? 'bg-indigo-950/30 border-indigo-500/30' : 'bg-indigo-50/60 border-indigo-200'
                    }`}>
                        <div className="text-2xl p-2 rounded-xl bg-indigo-500/20">
                            {selectedMake.make === 'Jeep' || selectedModel.bodyType === 'suv' ? '🚙'
                                : selectedModel.bodyType === 'truck' ? '🛻'
                                : selectedModel.fuelType === 'electric' ? '⚡'
                                : '🚗'}
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-black truncate">
                                {year} {selectedMake.make} {selectedModel.model}
                            </h3>
                            <p className="text-[10px] text-slate-400">
                                {selectedModel.bodyType?.toUpperCase()} • {fuelType.toUpperCase()} • Factory EPA Calibration
                            </p>
                        </div>
                    </div>

                    {/* Editable Specs Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-left">
                        {/* Year */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Model Year</label>
                            <input
                                type="number"
                                min="1990"
                                max="2027"
                                value={year}
                                onChange={(e) => handleYearChange(parseInt(e.target.value) || 2024)}
                                className={`w-full px-2.5 py-1.5 text-xs font-bold rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                }`}
                            />
                        </div>

                        {/* Combined MPG */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">
                                {fuelType === 'electric' ? 'Combined MPGe' : 'Combined MPG'}
                            </label>
                            <input
                                type="number"
                                min="5"
                                max="160"
                                step="1"
                                value={mpg}
                                onChange={(e) => setMpg(parseFloat(e.target.value) || 20)}
                                className={`w-full px-2.5 py-1.5 text-xs font-bold rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                }`}
                            />
                        </div>

                        {/* Fuel Capacity */}
                        <div className="col-span-2 sm:col-span-1">
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">
                                {fuelType === 'electric' ? 'Battery (kWh)' : 'Tank Capacity (Gal)'}
                            </label>
                            <input
                                type="number"
                                min="5"
                                max="100"
                                step="0.5"
                                value={tankCapacityGal}
                                onChange={(e) => setTankCapacityGal(parseFloat(e.target.value) || 15.0)}
                                className={`w-full px-2.5 py-1.5 text-xs font-bold rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                }`}
                            />
                        </div>
                    </div>

                    {/* Fuel Type & Nickname */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Fuel Type</label>
                            <select
                                value={fuelType}
                                onChange={(e) => setFuelType(e.target.value as any)}
                                className={`w-full px-2.5 py-1.5 text-xs font-bold rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                }`}
                            >
                                <option value="gasoline">Regular Gasoline</option>
                                <option value="premium">Premium 91/93 Gas</option>
                                <option value="hybrid">Hybrid (Gas + Electric)</option>
                                <option value="diesel">Diesel</option>
                                <option value="electric">Electric (EV)</option>
                            </select>
                        </div>

                        <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Garage Display Name</label>
                            <input
                                type="text"
                                value={nickname}
                                onChange={(e) => setNickname(e.target.value)}
                                placeholder="e.g. My Daily Driver"
                                className={`w-full px-2.5 py-1.5 text-xs font-semibold rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                }`}
                            />
                        </div>
                    </div>

                    {/* Calculated Full Tank Range Live Preview */}
                    <div className={`p-2.5 rounded-xl border text-xs flex items-center justify-between ${
                        theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-200'
                    }`}>
                        <div className="flex items-center gap-2">
                            <Fuel className="w-4 h-4 text-emerald-400" />
                            <div>
                                <p className="font-bold text-slate-300">
                                    Full Tank Range: <span className="text-emerald-400 font-black">~{estimatedRange} miles</span>
                                </p>
                                <p className="text-[10px] text-slate-400">
                                    Safe usable range (preserving 10% reserve): ~{usableRange} mi
                                </p>
                            </div>
                        </div>
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400">
                            Auto-Scrubbed
                        </span>
                    </div>

                    {/* Confirm Button */}
                    <button
                        type="button"
                        onClick={handleConfirmVehicle}
                        className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-lg shadow-indigo-600/30 transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                    >
                        <Check className="w-4 h-4" />
                        Add to My Garage & Set Active
                    </button>
                </div>
            )}

            {/* CUSTOM MANUAL ENTRY FALLBACK */}
            {step === 'custom' && (
                <div className="space-y-3 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            onClick={() => setStep(1)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-white transition-colors cursor-pointer"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" /> Back to Brand Search
                        </button>
                        <span className="text-xs font-black text-indigo-400">Custom Manual Specs</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Make / Brand</label>
                            <input
                                type="text"
                                placeholder="e.g. Jeep, Rivian, Dodge"
                                value={customMakeName}
                                onChange={(e) => setCustomMakeName(e.target.value)}
                                className={`w-full px-2.5 py-1.5 text-xs rounded-xl border font-semibold ${
                                    theme === 'dark' ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                }`}
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Model</label>
                            <input
                                type="text"
                                placeholder="e.g. Wrangler 392, R1T"
                                value={customModelName}
                                onChange={(e) => setCustomModelName(e.target.value)}
                                className={`w-full px-2.5 py-1.5 text-xs rounded-xl border font-semibold ${
                                    theme === 'dark' ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                }`}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Year</label>
                            <input
                                type="number"
                                value={year}
                                onChange={(e) => setYear(parseInt(e.target.value) || 2024)}
                                className={`w-full px-2.5 py-1.5 text-xs font-bold rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                }`}
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">MPG</label>
                            <input
                                type="number"
                                value={mpg}
                                onChange={(e) => setMpg(parseFloat(e.target.value) || 25)}
                                className={`w-full px-2.5 py-1.5 text-xs font-bold rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                }`}
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Tank Gal</label>
                            <input
                                type="number"
                                value={tankCapacityGal}
                                onChange={(e) => setTankCapacityGal(parseFloat(e.target.value) || 16)}
                                className={`w-full px-2.5 py-1.5 text-xs font-bold rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                }`}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Fuel Type</label>
                            <select
                                value={fuelType}
                                onChange={(e) => setFuelType(e.target.value as any)}
                                className={`w-full px-2.5 py-1.5 text-xs font-bold rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                }`}
                            >
                                <option value="gasoline">Gas</option>
                                <option value="premium">Premium</option>
                                <option value="hybrid">Hybrid</option>
                                <option value="diesel">Diesel</option>
                                <option value="electric">EV</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Nickname (Optional)</label>
                            <input
                                type="text"
                                placeholder="e.g. The Cruiser"
                                value={nickname}
                                onChange={(e) => setNickname(e.target.value)}
                                className={`w-full px-2.5 py-1.5 text-xs rounded-xl border font-semibold ${
                                    theme === 'dark' ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                }`}
                            />
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleConfirmCustom}
                        disabled={!customMakeName.trim() || !customModelName.trim()}
                        className={`w-full py-2.5 rounded-xl text-white text-xs font-black shadow-lg transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 ${
                            !customMakeName.trim() || !customModelName.trim()
                                ? 'bg-indigo-600/40 opacity-60 cursor-not-allowed'
                                : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
                        }`}
                    >
                        <Check className="w-4 h-4" />
                        Save Custom Vehicle & Set Active
                    </button>
                </div>
            )}
        </div>
    );
};

export default VehicleAddWizard;
