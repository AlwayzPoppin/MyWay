import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { vehicleFuelService, RollingFuelReport } from '../services/vehicleFuelService';
import { getSavedTrips, formatDuration } from '../services/tripHistoryService';
import { Vehicle, Trip } from '../types';
import {
    VEHICLE_DATABASE,
    VehicleMakeInfo,
    VehicleModelInfo,
    getAllMakes,
    getModelsForMake,
    findModelDefaults
} from '../data/vehicleDatabase';
import {
    maintenanceAlertService,
    VehicleHealthItem,
    MaintenanceCategory
} from '../services/maintenanceAlertService';

interface MaintenancePanelProps {
    theme: 'light' | 'dark';
    onClose: () => void;
}

type TimeFilter = 'today' | 'week' | 'month' | 'year' | 'lifetime';

interface ManualExpense {
    id: string;
    date: string;
    category: 'gas' | 'oil_change' | 'tires' | 'repair' | 'insurance' | 'car_wash' | 'registration' | 'other';
    amount: number;
    note: string;
    vehicleId?: string;
}

const EXPENSE_STORAGE_KEY = 'myway_maintenance_expenses';

const getCategoryIcon = (cat: ManualExpense['category']) => {
    switch (cat) {
        case 'gas': return '⛽';
        case 'oil_change': return '🛢️';
        case 'tires': return '🛞';
        case 'repair': return '🔧';
        case 'insurance': return '🛡️';
        case 'car_wash': return '🚿';
        case 'registration': return '📋';
        case 'other': return '💳';
    }
};

const getCategoryLabel = (cat: ManualExpense['category']) => {
    switch (cat) {
        case 'gas': return 'Gas/Fuel';
        case 'oil_change': return 'Oil Change';
        case 'tires': return 'Tires';
        case 'repair': return 'Repair';
        case 'insurance': return 'Insurance';
        case 'car_wash': return 'Car Wash';
        case 'registration': return 'Registration';
        case 'other': return 'Other';
    }
};

const loadExpenses = (): ManualExpense[] => {
    try {
        const raw = localStorage.getItem(EXPENSE_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
};

const saveExpenses = (expenses: ManualExpense[]) => {
    localStorage.setItem(EXPENSE_STORAGE_KEY, JSON.stringify(expenses));
};

const MPG_PRESETS: Record<string, number> = {
    'Sedan': 32, 'Compact': 36, 'SUV': 26, 'Crossover': 29,
    'Pickup Truck': 20, 'Minivan': 24, 'Sports Car': 22,
    'Hybrid': 50, 'PHEV': 85, 'Electric (EV)': 110
};

const POPULAR_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2012, 2010];

/* ─── Vehicle Setup Wizard ─── */
type WizardStep = 1 | 2 | 3;

interface WizardState {
    make: string;
    model: string;
    year: string;
    nickname: string;
    fuelType: Vehicle['fuelType'];
    mpg: string;
    tankCapacity: string;
}

const INITIAL_WIZARD: WizardState = {
    make: '', model: '', year: new Date().getFullYear().toString(),
    nickname: '', fuelType: 'gasoline', mpg: '28', tankCapacity: '14'
};

type MakeCategoryFilter = 'all' | 'popular' | 'american' | 'asian' | 'european' | 'luxury' | 'electric';

const MaintenancePanel: React.FC<MaintenancePanelProps> = ({ theme, onClose }) => {
    const [timeFilter, setTimeFilter] = useState<TimeFilter>('month');
    const [showAddExpense, setShowAddExpense] = useState(false);
    const [showGarage, setShowGarage] = useState(false);
    const [expenses, setExpenses] = useState<ManualExpense[]>(loadExpenses);
    const [newExpense, setNewExpense] = useState({
        category: 'gas' as ManualExpense['category'],
        amount: '',
        note: '',
        date: new Date().toISOString().split('T')[0]
    });
    const [editingGasPrice, setEditingGasPrice] = useState(false);
    const [gasPriceInput, setGasPriceInput] = useState('');

    // Odometer editing state
    const [editingOdometer, setEditingOdometer] = useState(false);
    const [odometerInput, setOdometerInput] = useState('');

    // Service logging state (when user clicks "Log Service Done")
    const [activeServiceItem, setActiveServiceItem] = useState<VehicleHealthItem | null>(null);
    const [serviceCost, setServiceCost] = useState('');
    const [serviceDate, setServiceDate] = useState(new Date().toISOString().split('T')[0]);
    const [serviceNotes, setServiceNotes] = useState('');

    // Interval editing state
    const [editingIntervalItem, setEditingIntervalItem] = useState<VehicleHealthItem | null>(null);
    const [customIntervalInput, setCustomIntervalInput] = useState('');

    // Vehicle wizard state
    const [showWizard, setShowWizard] = useState(false);
    const [wizardStep, setWizardStep] = useState<WizardStep>(1);
    const [wizard, setWizard] = useState<WizardState>({ ...INITIAL_WIZARD });
    const [makeSearch, setMakeSearch] = useState('');
    const [modelSearch, setModelSearch] = useState('');
    const [makeCategory, setMakeCategory] = useState<MakeCategoryFilter>('popular');
    const [isCustomModel, setIsCustomModel] = useState(false);

    // Force re-render key for vehicle and maintenance changes
    const [versionKey, setVersionKey] = useState(0);

    // Data Sources
    const trips = useMemo(() => getSavedTrips(), [versionKey]);
    const report: RollingFuelReport = useMemo(() => vehicleFuelService.getRollingFuelReport(trips), [trips, versionKey]);
    const vehicle = report.activeVehicle;
    const allVehicles = useMemo(() => vehicleFuelService.getVehicles(), [versionKey]);
    const hasVehicles = allVehicles.length > 0 && allVehicles[0]?.id !== 'veh_fallback';

    // Maintenance Health Data
    const vehicleHealth = useMemo(() => {
        if (!hasVehicles) return null;
        return maintenanceAlertService.getVehicleHealth(vehicle, trips);
    }, [vehicle, trips, versionKey, hasVehicles]);

    const isDark = theme === 'dark';

    // Auto-open wizard if user has no vehicles
    useEffect(() => {
        if (!hasVehicles) setShowWizard(true);
    }, [hasVehicles]);

    // Current period summary
    const periodSummary = useMemo(() => {
        switch (timeFilter) {
            case 'today': return report.today;
            case 'week': return report.thisWeek;
            case 'month': return report.thisMonth;
            case 'year': return report.thisYear;
            case 'lifetime': return report.lifetime;
        }
    }, [report, timeFilter]);

    // Manual expenses filtered by time period
    const filteredExpenses = useMemo(() => {
        const now = Date.now();
        return expenses.filter(e => {
            const ts = new Date(e.date).getTime();
            switch (timeFilter) {
                case 'today': return ts >= new Date().setHours(0, 0, 0, 0);
                case 'week': return ts >= now - 7 * 86400000;
                case 'month': return ts >= now - 30 * 86400000;
                case 'year': return ts >= now - 365 * 86400000;
                case 'lifetime': return true;
            }
        });
    }, [expenses, timeFilter]);

    const totalManualExpenses = filteredExpenses.reduce((s, e) => s + e.amount, 0);

    // IRS standard mileage rate for self-employed (2024: $0.67/mi)
    const IRS_MILEAGE_RATE = 0.67;
    const deductibleMileage = periodSummary.totalDistanceMiles * IRS_MILEAGE_RATE;

    /* ─── Wizard Handlers ─── */
    const openWizard = useCallback(() => {
        setWizard({ ...INITIAL_WIZARD });
        setWizardStep(1);
        setMakeSearch('');
        setModelSearch('');
        setMakeCategory('popular');
        setIsCustomModel(false);
        setShowWizard(true);
    }, []);

    const handleSelectMake = useCallback((makeName: string) => {
        setWizard(w => ({
            ...w,
            make: makeName,
            model: '' // reset model when make changes
        }));
        setMakeSearch('');
        setModelSearch('');
        setIsCustomModel(false);
    }, []);

    const handleSelectModel = useCallback((modelInfo: VehicleModelInfo) => {
        setWizard(w => ({
            ...w,
            model: modelInfo.model,
            fuelType: modelInfo.fuelType,
            mpg: modelInfo.mpg.toString(),
            tankCapacity: modelInfo.tankCapacityGal ? modelInfo.tankCapacityGal.toString() : w.tankCapacity
        }));
        setIsCustomModel(false);
    }, []);

    const handleWizardComplete = useCallback(() => {
        const mpg = parseInt(wizard.mpg) || 28;
        const tank = parseFloat(wizard.tankCapacity) || undefined;
        const year = parseInt(wizard.year) || undefined;
        const name = wizard.nickname.trim() || `${year ? year + ' ' : ''}${wizard.make} ${wizard.model}`.trim();

        const newVeh = vehicleFuelService.addVehicle({
            name,
            make: wizard.make.trim(),
            model: wizard.model.trim(),
            year,
            fuelType: wizard.fuelType,
            mpg,
            tankCapacityGal: tank,
            isPrimary: allVehicles.length === 0
        });

        // Initialize maintenance profile with base odometer
        maintenanceAlertService.getProfile(newVeh);

        setShowWizard(false);
        setVersionKey(v => v + 1);
    }, [wizard, allVehicles.length]);

    const handleDeleteVehicle = useCallback((id: string) => {
        vehicleFuelService.deleteVehicle(id);
        setVersionKey(v => v + 1);
    }, []);

    const handleSetActive = useCallback((id: string) => {
        vehicleFuelService.setActiveVehicle(id);
        setVersionKey(v => v + 1);
        setShowGarage(false);
    }, []);

    /* ─── Odometer Handlers ─── */
    const handleSaveOdometer = useCallback(() => {
        const val = parseFloat(odometerInput);
        if (!isNaN(val) && val >= 0) {
            maintenanceAlertService.setBaseOdometer(vehicle.id, val);
            setVersionKey(v => v + 1);
        }
        setEditingOdometer(false);
    }, [odometerInput, vehicle.id]);

    /* ─── Maintenance Service Done Handlers ─── */
    const handleConfirmServiceDone = useCallback(() => {
        if (!activeServiceItem) return;

        const cost = parseFloat(serviceCost) || 0;

        // 1. Log in maintenance alert service (resets the interval odometer)
        maintenanceAlertService.logServiceCompleted(vehicle.id, activeServiceItem.id, {
            cost: cost > 0 ? cost : undefined,
            date: serviceDate,
            notes: serviceNotes.trim() || undefined
        });

        // 2. Also record expense in Expense Log if cost entered
        if (cost > 0) {
            const expCategory: ManualExpense['category'] =
                activeServiceItem.category === 'oil_change' ? 'oil_change' :
                activeServiceItem.category === 'tires' ? 'tires' : 'repair';

            const newExp: ManualExpense = {
                id: `exp_${Date.now()}`,
                date: serviceDate,
                category: expCategory,
                amount: cost,
                note: serviceNotes.trim() || activeServiceItem.title,
                vehicleId: vehicle.id
            };
            const updated = [newExp, ...expenses];
            setExpenses(updated);
            saveExpenses(updated);
        }

        setActiveServiceItem(null);
        setServiceCost('');
        setServiceNotes('');
        setVersionKey(v => v + 1);
    }, [activeServiceItem, serviceCost, serviceDate, serviceNotes, vehicle.id, expenses]);

    const handleSaveInterval = useCallback(() => {
        if (!editingIntervalItem) return;
        const interval = parseInt(customIntervalInput);
        if (interval && interval > 0) {
            maintenanceAlertService.updateInterval(vehicle.id, editingIntervalItem.id, interval);
            setVersionKey(v => v + 1);
        }
        setEditingIntervalItem(null);
        setCustomIntervalInput('');
    }, [editingIntervalItem, customIntervalInput, vehicle.id]);

    /* ─── Expense Handlers ─── */
    const handleAddExpense = useCallback(() => {
        const amount = parseFloat(newExpense.amount);
        if (isNaN(amount) || amount <= 0) return;
        const entry: ManualExpense = {
            id: `exp_${Date.now()}`,
            date: newExpense.date,
            category: newExpense.category,
            amount,
            note: newExpense.note,
            vehicleId: vehicle.id
        };
        const updated = [entry, ...expenses];
        setExpenses(updated);
        saveExpenses(updated);
        setNewExpense({ category: 'gas', amount: '', note: '', date: new Date().toISOString().split('T')[0] });
        setShowAddExpense(false);
    }, [newExpense, expenses, vehicle.id]);

    const handleDeleteExpense = useCallback((id: string) => {
        const updated = expenses.filter(e => e.id !== id);
        setExpenses(updated);
        saveExpenses(updated);
    }, [expenses]);

    const handleSaveGasPrice = useCallback(() => {
        const price = parseFloat(gasPriceInput);
        if (!isNaN(price) && price > 0) {
            vehicleFuelService.setGasPrice(price);
            setVersionKey(v => v + 1);
        }
        setEditingGasPrice(false);
    }, [gasPriceInput]);

    // Card style helper
    const card = `rounded-2xl border transition-all ${isDark ? 'bg-white/5 border-white/8' : 'bg-white border-slate-100 shadow-sm'}`;
    const text = isDark ? 'text-white' : 'text-slate-900';
    const subtext = isDark ? 'text-slate-400' : 'text-slate-500';
    const inputCls = `w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition-all focus:ring-2 focus:ring-indigo-500/40 ${isDark ? 'bg-slate-800 border-white/10 text-white placeholder:text-slate-600' : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400'}`;

    // Filter makes based on Category and Search Query
    const filteredMakesList = useMemo(() => {
        let list = VEHICLE_DATABASE;
        if (makeCategory !== 'all') {
            list = list.filter(v => v.category === makeCategory);
        }
        if (makeSearch.trim()) {
            const q = makeSearch.toLowerCase().trim();
            list = VEHICLE_DATABASE.filter(v => v.make.toLowerCase().includes(q));
        }
        return list;
    }, [makeCategory, makeSearch]);

    // Available models for currently selected make
    const availableModels = useMemo(() => {
        if (!wizard.make) return [];
        const models = getModelsForMake(wizard.make);
        if (modelSearch.trim()) {
            const q = modelSearch.toLowerCase().trim();
            return models.filter(m => m.model.toLowerCase().includes(q));
        }
        return models;
    }, [wizard.make, modelSearch]);

    const canAdvanceStep1 = wizard.make.trim().length > 0 && wizard.model.trim().length > 0;
    const canFinish = parseInt(wizard.mpg) > 0;

    /* ─── Vehicle Setup Wizard Render ─── */
    const renderWizard = () => (
        <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4">
            {/* Progress Bar */}
            <div className="flex items-center gap-2">
                {[1, 2, 3].map(s => (
                    <div key={s} className="flex-1 flex flex-col items-center gap-1.5">
                        <div className={`h-1.5 w-full rounded-full transition-all duration-500 ${
                            s <= wizardStep
                                ? 'bg-gradient-to-r from-indigo-500 to-purple-500'
                                : isDark ? 'bg-white/10' : 'bg-slate-200'
                        }`} />
                        <span className={`text-[8px] font-bold uppercase tracking-wider ${
                            s <= wizardStep ? (isDark ? 'text-indigo-400' : 'text-indigo-600') : subtext
                        }`}>
                            {s === 1 ? 'Vehicle' : s === 2 ? 'Fuel & Power' : 'Details'}
                        </span>
                    </div>
                ))}
            </div>

            {/* Step 1: Make / Model / Year */}
            {wizardStep === 1 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="text-center py-1">
                        <span className="text-3xl">🚗</span>
                        <h3 className={`text-base font-black mt-1 ${text}`}>What do you drive?</h3>
                        <p className={`text-[11px] mt-0.5 ${subtext}`}>Choose your make, model, and year</p>
                    </div>

                    {/* Make Selection */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className={`text-[10px] font-bold uppercase tracking-wider ${subtext}`}>
                                1. Select Make {wizard.make ? `(${wizard.make})` : ''}
                            </label>
                            {wizard.make && (
                                <button
                                    onClick={() => handleSelectMake('')}
                                    className="text-[10px] text-indigo-400 font-bold hover:underline"
                                >
                                    Change Make
                                </button>
                            )}
                        </div>

                        {/* Make Category Tabs */}
                        <div className={`flex rounded-xl border p-0.5 gap-0.5 overflow-x-auto no-scrollbar ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
                            {([
                                { id: 'popular' as const, label: 'Popular' },
                                { id: 'all' as const, label: 'All (40+)' },
                                { id: 'american' as const, label: 'USA 🇺🇸' },
                                { id: 'asian' as const, label: 'Asian 🇯🇵🇰🇷' },
                                { id: 'european' as const, label: 'European 🇩🇪' },
                                { id: 'luxury' as const, label: 'Luxury' },
                                { id: 'electric' as const, label: 'EV ⚡' },
                            ]).map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => { setMakeCategory(tab.id); setMakeSearch(''); }}
                                    className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-lg shrink-0 transition-all ${
                                        makeCategory === tab.id && !makeSearch
                                            ? 'bg-indigo-600 text-white shadow-sm'
                                            : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Search Make Input */}
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search make (Toyota, Honda, Ford, Tesla...)"
                                value={makeSearch}
                                onChange={(e) => setMakeSearch(e.target.value)}
                                className={`${inputCls} text-xs py-2`}
                            />
                            {makeSearch && (
                                <button
                                    onClick={() => setMakeSearch('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        {/* Make Pills / Grid */}
                        <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto no-scrollbar p-1">
                            {filteredMakesList.map(item => (
                                <button
                                    key={item.make}
                                    onClick={() => handleSelectMake(item.make)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95 ${
                                        wizard.make.toLowerCase() === item.make.toLowerCase()
                                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20 ring-2 ring-indigo-400'
                                            : isDark
                                                ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                                    }`}
                                >
                                    <span>{item.make}</span>
                                    {wizard.make.toLowerCase() === item.make.toLowerCase() && <span>✓</span>}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Model Selection (Contextual to Selected Make) */}
                    {wizard.make && (
                        <div className="space-y-2 pt-2 border-t border-white/10 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="flex items-center justify-between">
                                <label className={`text-[10px] font-bold uppercase tracking-wider ${subtext}`}>
                                    2. Select {wizard.make} Model
                                </label>
                                <button
                                    onClick={() => {
                                        setIsCustomModel(!isCustomModel);
                                        if (!isCustomModel) setWizard(w => ({ ...w, model: '' }));
                                    }}
                                    className={`text-[10px] font-bold transition-colors ${isCustomModel ? 'text-amber-400' : 'text-indigo-400 hover:underline'}`}
                                >
                                    {isCustomModel ? '← Pick from list' : '+ Custom Model'}
                                </button>
                            </div>

                            {isCustomModel ? (
                                <div>
                                    <input
                                        type="text"
                                        placeholder={`Enter custom ${wizard.make} model name`}
                                        value={wizard.model}
                                        onChange={(e) => setWizard(w => ({ ...w, model: e.target.value }))}
                                        autoFocus
                                        className={inputCls}
                                    />
                                </div>
                            ) : (
                                <>
                                    {/* Model Search */}
                                    {getModelsForMake(wizard.make).length > 6 && (
                                        <input
                                            type="text"
                                            placeholder={`Search ${wizard.make} models...`}
                                            value={modelSearch}
                                            onChange={(e) => setModelSearch(e.target.value)}
                                            className={`${inputCls} text-xs py-1.5`}
                                        />
                                    )}

                                    {/* Models Grid */}
                                    <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto no-scrollbar p-1">
                                        {availableModels.map(m => {
                                            const isSelected = wizard.model.toLowerCase() === m.model.toLowerCase();
                                            return (
                                                <button
                                                    key={m.model}
                                                    onClick={() => handleSelectModel(m)}
                                                    className={`p-2.5 rounded-xl border text-left transition-all active:scale-[0.98] flex flex-col gap-0.5 ${
                                                        isSelected
                                                            ? 'bg-indigo-600 text-white border-indigo-400 shadow-md ring-1 ring-indigo-400'
                                                            : isDark
                                                                ? 'bg-white/5 border-white/8 hover:bg-white/10 text-slate-200'
                                                                : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-900'
                                                    }`}
                                                >
                                                    <span className="text-xs font-bold truncate block">{m.model}</span>
                                                    <div className="flex items-center gap-1 text-[9px] opacity-80">
                                                        <span className="uppercase font-semibold">{m.fuelType}</span>
                                                        <span>•</span>
                                                        <span>{m.mpg} {m.fuelType === 'electric' ? 'MPGe' : 'MPG'}</span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Year Selection */}
                    <div className="space-y-2 pt-2 border-t border-white/10">
                        <label className={`text-[10px] font-bold uppercase tracking-wider ${subtext}`}>
                            3. Model Year
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                            {POPULAR_YEARS.slice(0, 7).map(yr => (
                                <button
                                    key={yr}
                                    onClick={() => setWizard(w => ({ ...w, year: yr.toString() }))}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                                        wizard.year === yr.toString()
                                            ? 'bg-indigo-600 text-white shadow-sm'
                                            : isDark ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                >
                                    {yr}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                placeholder="Year (e.g. 2024)"
                                min="1980"
                                max={new Date().getFullYear() + 2}
                                value={wizard.year}
                                onChange={(e) => setWizard(w => ({ ...w, year: e.target.value }))}
                                className={`${inputCls} py-2`}
                            />
                        </div>
                    </div>

                    {/* Selected Summary Pill */}
                    {wizard.make && wizard.model && (
                        <div className={`p-3 rounded-xl border flex items-center justify-between animate-in fade-in slide-in-from-bottom-2 ${
                            isDark ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-indigo-50 border-indigo-200'
                        }`}>
                            <div className="flex items-center gap-2.5">
                                <span className="text-lg">{wizard.fuelType === 'electric' ? '⚡' : '🚗'}</span>
                                <div>
                                    <p className={`text-xs font-black ${text}`}>
                                        {wizard.year} {wizard.make} {wizard.model}
                                    </p>
                                    <p className={`text-[9px] ${subtext}`}>
                                        {wizard.fuelType.toUpperCase()} • {wizard.mpg} MPG auto-filled
                                    </p>
                                </div>
                            </div>
                            <span className="text-xs text-emerald-400 font-bold">Ready</span>
                        </div>
                    )}

                    {/* Next Button */}
                    <button
                        onClick={() => canAdvanceStep1 && setWizardStep(2)}
                        disabled={!canAdvanceStep1}
                        className={`w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.98] ${
                            canAdvanceStep1
                                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40'
                                : isDark ? 'bg-white/5 text-slate-600 cursor-not-allowed' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                        Next: Fuel & MPG Details →
                    </button>
                </div>
            )}

            {/* Step 2: Fuel Type */}
            {wizardStep === 2 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="text-center py-2">
                        <span className="text-4xl">⛽</span>
                        <h3 className={`text-lg font-black mt-2 ${text}`}>Fuel & Powertrain</h3>
                        <p className={`text-xs mt-1 ${subtext}`}>
                            How is your {wizard.year} {wizard.make} {wizard.model} powered?
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                        {([
                            { type: 'gasoline' as const, icon: '⛽', label: 'Gasoline', desc: 'Regular Unleaded (87)' },
                            { type: 'hybrid' as const, icon: '🔋', label: 'Hybrid / PHEV', desc: 'Gas + Electric Assist' },
                            { type: 'electric' as const, icon: '⚡', label: 'Electric (EV)', desc: '100% Battery Electric' },
                            { type: 'diesel' as const, icon: '🛢️', label: 'Diesel', desc: 'Ultra-Low Sulfur Diesel' },
                            { type: 'premium' as const, icon: '💎', label: 'Premium Gas', desc: 'High Octane (91-93)' },
                        ]).map(f => (
                            <button
                                key={f.type}
                                onClick={() => {
                                    setWizard(w => ({
                                        ...w,
                                        fuelType: f.type,
                                        mpg: f.type === 'electric' && parseInt(w.mpg) < 50 ? '115' : f.type === 'hybrid' && parseInt(w.mpg) < 35 ? '48' : w.mpg
                                    }));
                                }}
                                className={`flex flex-col items-center gap-1.5 p-3.5 rounded-2xl border text-center transition-all hover:scale-[1.02] active:scale-[0.98] ${
                                    wizard.fuelType === f.type
                                        ? 'bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border-indigo-500/50 shadow-lg shadow-indigo-500/10 ring-2 ring-indigo-400'
                                        : isDark ? 'bg-white/3 border-white/8 hover:bg-white/5' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                                }`}
                            >
                                <span className="text-2xl">{f.icon}</span>
                                <span className={`text-xs font-black ${wizard.fuelType === f.type ? 'text-indigo-400' : text}`}>{f.label}</span>
                                <span className={`text-[9px] ${subtext}`}>{f.desc}</span>
                            </button>
                        ))}
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button
                            onClick={() => setWizardStep(1)}
                            className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${isDark ? 'bg-white/5 text-white hover:bg-white/10' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                        >
                            ← Back
                        </button>
                        <button
                            onClick={() => setWizardStep(3)}
                            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm shadow-lg shadow-indigo-500/25 transition-all active:scale-[0.98] hover:shadow-indigo-500/40"
                        >
                            Next: Economy & Tank →
                        </button>
                    </div>
                </div>
            )}

            {/* Step 3: MPG & Details */}
            {wizardStep === 3 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="text-center py-1">
                        <span className="text-3xl">📊</span>
                        <h3 className={`text-base font-black mt-1 ${text}`}>Fuel Economy & Details</h3>
                        <p className={`text-xs mt-0.5 ${subtext}`}>
                            Fine-tune MPG for accurate cost tracking
                        </p>
                    </div>

                    {/* MPG Quick Picks & Input */}
                    <div>
                        <label className={`text-[10px] font-bold uppercase tracking-wider ${subtext}`}>
                            {wizard.fuelType === 'electric' ? 'MPGe (Miles Per Gallon Equivalent)' : 'Combined MPG (Miles Per Gallon)'}
                        </label>
                        <input
                            type="number"
                            min="5"
                            max="500"
                            value={wizard.mpg}
                            onChange={(e) => setWizard(w => ({ ...w, mpg: e.target.value }))}
                            className={`${inputCls} mt-1 text-center text-xl font-black`}
                        />
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {Object.entries(MPG_PRESETS).map(([label, val]) => (
                                <button
                                    key={label}
                                    onClick={() => setWizard(w => ({ ...w, mpg: val.toString() }))}
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                                        wizard.mpg === val.toString()
                                            ? 'bg-indigo-600 text-white shadow-sm'
                                            : isDark ? 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
                                    }`}
                                >
                                    {label} ({val})
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Tank Capacity */}
                    {wizard.fuelType !== 'electric' && (
                        <div>
                            <label className={`text-[10px] font-bold uppercase tracking-wider ${subtext}`}>
                                Fuel Tank Capacity (gallons) — Optional
                            </label>
                            <input
                                type="number"
                                step="0.1"
                                min="5"
                                max="50"
                                placeholder="e.g. 14.5"
                                value={wizard.tankCapacity}
                                onChange={(e) => setWizard(w => ({ ...w, tankCapacity: e.target.value }))}
                                className={`${inputCls} mt-1`}
                            />
                        </div>
                    )}

                    {/* Nickname */}
                    <div>
                        <label className={`text-[10px] font-bold uppercase tracking-wider ${subtext}`}>
                            Vehicle Nickname — Optional
                        </label>
                        <input
                            type="text"
                            placeholder={`e.g. "Work Car", "Daily Driver", "The Red Truck"`}
                            value={wizard.nickname}
                            onChange={(e) => setWizard(w => ({ ...w, nickname: e.target.value }))}
                            className={`${inputCls} mt-1`}
                        />
                    </div>

                    {/* Summary Preview */}
                    <div className={`${card} p-3.5`}>
                        <p className={`text-[9px] font-bold uppercase tracking-wider mb-2 ${subtext}`}>Vehicle Preview</p>
                        <div className="flex items-center gap-3">
                            <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl border ${isDark ? 'bg-indigo-500/15 border-indigo-500/30' : 'bg-indigo-50 border-indigo-100'}`}>
                                {wizard.fuelType === 'electric' ? '⚡' : wizard.fuelType === 'hybrid' ? '🔋' : '🚗'}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-black truncate ${text}`}>
                                    {wizard.nickname || `${wizard.year} ${wizard.make} ${wizard.model}`}
                                </p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md ${isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                                        {wizard.mpg} {wizard.fuelType === 'electric' ? 'MPGe' : 'MPG'}
                                    </span>
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md ${isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>
                                        {wizard.fuelType}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => setWizardStep(2)}
                            className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${isDark ? 'bg-white/5 text-white hover:bg-white/10' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                        >
                            ← Back
                        </button>
                        <button
                            onClick={handleWizardComplete}
                            disabled={!canFinish}
                            className={`flex-[2] py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.98] ${
                                canFinish
                                    ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40'
                                    : isDark ? 'bg-white/5 text-slate-600 cursor-not-allowed' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                        >
                            ✅ Save to Garage
                        </button>
                    </div>

                    {/* Cancel link if user has existing vehicles */}
                    {hasVehicles && (
                        <button
                            onClick={() => setShowWizard(false)}
                            className={`w-full text-center text-xs py-1.5 ${subtext} hover:text-indigo-400 transition-colors`}
                        >
                            Cancel
                        </button>
                    )}
                </div>
            )}
        </div>
    );

    /* ─── Main Panel Render ─── */
    return (
        <div className={`fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-4 backdrop-blur-md pointer-events-auto ${isDark ? 'bg-black/70' : 'bg-slate-900/40'}`}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className={`relative w-full max-w-lg max-h-[92vh] sm:max-h-[90vh] overflow-hidden rounded-3xl border shadow-2xl flex flex-col pointer-events-auto
                ${isDark ? 'bg-slate-900/98 border-white/10' : 'bg-white border-slate-200'}`}
                style={{ backdropFilter: 'blur(40px)' }}
            >
                {/* Header */}
                <div className={`flex items-center justify-between px-5 py-4 border-b shrink-0 ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">🔧</span>
                        <div>
                            <h2 className={`text-base font-black tracking-tight ${text}`}>My Maintenance</h2>
                            <p className={`text-[10px] font-bold uppercase tracking-wider ${subtext}`}>
                                {showWizard ? 'Vehicle Setup Wizard' : 'Predictive Mileage & Health'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all hover:scale-110
                        ${isDark ? 'bg-white/5 border-white/10 text-white hover:bg-white/15' : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'}`}>
                        ✕
                    </button>
                </div>

                {/* Wizard Mode */}
                {showWizard ? renderWizard() : (
                    /* Dashboard Mode */
                    <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4">

                        {/* Active Vehicle Card with Odometer and Quick Controls */}
                        {hasVehicles ? (
                            <div className={`${card} p-4`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl border ${isDark ? 'bg-indigo-500/15 border-indigo-500/30' : 'bg-indigo-50 border-indigo-100'}`}>
                                            {vehicle.fuelType === 'electric' ? '⚡' : vehicle.fuelType === 'hybrid' ? '🔋' : '🚗'}
                                        </div>
                                        <div>
                                            <h3 className={`text-sm font-black ${text}`}>
                                                {vehicle.year ? `${vehicle.year} ` : ''}{vehicle.make} {vehicle.model}
                                            </h3>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                                                    {vehicle.mpg} {vehicle.fuelType === 'electric' ? 'MPGe' : 'MPG'}
                                                </span>
                                                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>
                                                    {vehicle.fuelType}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setShowGarage(!showGarage)}
                                        className={`p-1.5 rounded-lg text-[10px] font-bold transition-all ${isDark ? 'text-indigo-400 hover:bg-indigo-500/15' : 'text-indigo-600 hover:bg-indigo-50'}`}
                                    >
                                        {showGarage ? 'Done' : '🚘 Garage'}
                                    </button>
                                </div>

                                {/* Garage Panel */}
                                {showGarage && (
                                    <div className={`mt-3 pt-3 border-t space-y-1.5 ${isDark ? 'border-white/10' : 'border-slate-100'}`}>
                                        {allVehicles.map(v => (
                                            <div
                                                key={v.id}
                                                className={`flex items-center gap-2.5 p-2.5 rounded-xl transition-all
                                                    ${v.id === vehicle.id
                                                        ? (isDark ? 'bg-indigo-500/20 border border-indigo-500/40' : 'bg-indigo-50 border border-indigo-200')
                                                        : (isDark ? 'hover:bg-white/5' : 'hover:bg-slate-50')}`}
                                            >
                                                <button
                                                    onClick={() => handleSetActive(v.id)}
                                                    className="flex-1 flex items-center gap-2.5 text-left"
                                                >
                                                    <span className="text-sm">{v.fuelType === 'electric' ? '⚡' : v.fuelType === 'hybrid' ? '🔋' : '🚗'}</span>
                                                    <div className="flex-1 min-w-0">
                                                        <span className={`text-xs font-bold block truncate ${text}`}>
                                                            {v.year ? `${v.year} ` : ''}{v.make} {v.model}
                                                        </span>
                                                        <span className={`text-[9px] ${subtext}`}>{v.mpg} MPG • {v.fuelType}</span>
                                                    </div>
                                                </button>
                                                {allVehicles.length > 1 && (
                                                    <button
                                                        onClick={() => { if (window.confirm(`Remove ${v.make} ${v.model}?`)) handleDeleteVehicle(v.id); }}
                                                        className="text-[10px] text-red-400 hover:text-red-300 p-1 transition-all"
                                                    >
                                                        🗑️
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        <button
                                            onClick={openWizard}
                                            className={`w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border-2 border-dashed transition-all hover:scale-[1.01] active:scale-[0.99]
                                                ${isDark ? 'border-white/10 text-slate-400 hover:border-indigo-500/40 hover:text-indigo-400' : 'border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'}`}
                                        >
                                            <span className="text-sm">➕</span>
                                            <span className="text-xs font-bold">Add Another Vehicle</span>
                                        </button>
                                    </div>
                                )}

                                {/* Odometer & Gas Price Bar */}
                                <div className={`mt-3 pt-3 border-t grid grid-cols-2 gap-3 ${isDark ? 'border-white/10' : 'border-slate-100'}`}>
                                    {/* Odometer Tracker */}
                                    <div>
                                        <span className={`text-[9px] font-bold uppercase tracking-wider block ${subtext}`}>📏 Odometer</span>
                                        {editingOdometer ? (
                                            <div className="flex items-center gap-1 mt-0.5">
                                                <input
                                                    type="number"
                                                    value={odometerInput}
                                                    onChange={(e) => setOdometerInput(e.target.value)}
                                                    placeholder="e.g. 45000"
                                                    autoFocus
                                                    className={`w-20 px-1.5 py-0.5 rounded-lg border text-xs font-bold outline-none ${
                                                        isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
                                                    }`}
                                                />
                                                <button onClick={handleSaveOdometer} className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white text-[9px] font-bold">Save</button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => {
                                                    setOdometerInput(vehicleHealth?.currentOdometer.toString() || '0');
                                                    setEditingOdometer(true);
                                                }}
                                                className={`text-xs font-black ${text} hover:text-indigo-400 transition-colors flex items-center gap-1 mt-0.5`}
                                            >
                                                <span>{(vehicleHealth?.currentOdometer || 0).toLocaleString()} mi</span>
                                                <span className="text-[9px] text-indigo-400">✏️</span>
                                            </button>
                                        )}
                                    </div>

                                    {/* Gas Price */}
                                    <div className="text-right">
                                        <span className={`text-[9px] font-bold uppercase tracking-wider block ${subtext}`}>⛽ Fuel Price</span>
                                        {editingGasPrice ? (
                                            <div className="flex items-center justify-end gap-1 mt-0.5">
                                                <span className={`text-xs ${text}`}>$</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={gasPriceInput}
                                                    onChange={(e) => setGasPriceInput(e.target.value)}
                                                    autoFocus
                                                    className={`w-14 px-1 py-0.5 rounded-lg border text-xs font-bold outline-none ${
                                                        isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
                                                    }`}
                                                />
                                                <button onClick={handleSaveGasPrice} className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white text-[9px] font-bold">Save</button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => { setGasPriceInput(report.gasPricePerGallon.toFixed(2)); setEditingGasPrice(true); }}
                                                className={`text-xs font-black ${text} hover:text-indigo-400 transition-colors mt-0.5`}
                                            >
                                                ${report.gasPricePerGallon.toFixed(2)}/gal ✏️
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Empty State — No Vehicles */
                            <div className={`${card} p-6 text-center`}>
                                <span className="text-5xl block mb-3">🚘</span>
                                <h3 className={`text-base font-black ${text}`}>No Vehicles Yet</h3>
                                <p className={`text-xs mt-1 mb-4 ${subtext}`}>Add your car to start tracking mileage, fuel costs, and expenses.</p>
                                <button
                                    onClick={openWizard}
                                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all active:scale-[0.98]"
                                >
                                    ➕ Add Your Vehicle
                                </button>
                            </div>
                        )}

                        {/* ────────────────────────────────────────────────────────────
                            PREDICTIVE MAINTENANCE & MILEAGE ALERTS SECTION
                            ──────────────────────────────────────────────────────────── */}
                        {hasVehicles && vehicleHealth && (
                            <div className={`${card} p-4 space-y-3.5`}>
                                {/* Section Header & Overall Status Badge */}
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-base">🛡️</span>
                                            <h3 className={`text-xs font-black uppercase tracking-wider ${text}`}>
                                                Predictive Maintenance
                                            </h3>
                                        </div>
                                        <p className={`text-[9px] ${subtext} mt-0.5`}>
                                            Pace: ~{vehicleHealth.averageDailyMiles} mi/day • Auto-alerts at intervals
                                        </p>
                                    </div>

                                    {/* Overall Status Pill */}
                                    <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full flex items-center gap-1.5 ${
                                        vehicleHealth.overallStatus === 'overdue'
                                            ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
                                            : vehicleHealth.overallStatus === 'due_soon'
                                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                                                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    }`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${
                                            vehicleHealth.overallStatus === 'overdue' ? 'bg-red-400' :
                                            vehicleHealth.overallStatus === 'due_soon' ? 'bg-amber-400' : 'bg-emerald-400'
                                        }`} />
                                        {vehicleHealth.overallStatus === 'overdue' ? `${vehicleHealth.overdueCount} Overdue` :
                                         vehicleHealth.overallStatus === 'due_soon' ? `${vehicleHealth.dueSoonCount} Due Soon` : 'All Good'}
                                    </span>
                                </div>

                                {/* Maintenance Service Cards List */}
                                <div className="space-y-2.5">
                                    {vehicleHealth.items.map(item => {
                                        const isOverdue = item.status === 'overdue';
                                        const isDueSoon = item.status === 'due_soon';

                                        // Progress bar colors
                                        const barColor = isOverdue
                                            ? 'bg-gradient-to-r from-red-500 to-rose-600'
                                            : isDueSoon
                                                ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                                                : 'bg-gradient-to-r from-emerald-500 to-teal-400';

                                        return (
                                            <div
                                                key={item.id}
                                                className={`p-3 rounded-xl border transition-all ${
                                                    isOverdue
                                                        ? 'bg-red-500/8 border-red-500/30'
                                                        : isDueSoon
                                                            ? 'bg-amber-500/8 border-amber-500/30'
                                                            : isDark ? 'bg-white/3 border-white/5 hover:bg-white/5' : 'bg-slate-50 border-slate-200'
                                                }`}
                                            >
                                                {/* Card Header: Title & Remaining Status */}
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="text-lg shrink-0">{item.icon}</span>
                                                        <div className="min-w-0">
                                                            <p className={`text-xs font-bold truncate ${text}`}>
                                                                {item.title}
                                                            </p>
                                                            <p className={`text-[9px] ${subtext}`}>
                                                                Every {item.intervalMiles.toLocaleString()} mi
                                                                {item.lastServiceDate ? ` • Last done ${new Date(item.lastServiceDate).toLocaleDateString()}` : ''}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* Status Badge */}
                                                    <div className="text-right shrink-0">
                                                        {isOverdue ? (
                                                            <span className="text-[10px] font-black text-red-400 block">
                                                                🚨 Overdue by {Math.abs(item.milesRemaining).toLocaleString()} mi
                                                            </span>
                                                        ) : isDueSoon ? (
                                                            <span className="text-[10px] font-black text-amber-400 block">
                                                                ⚠️ In {item.milesRemaining.toLocaleString()} mi
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] font-bold text-emerald-400 block">
                                                                In {item.milesRemaining.toLocaleString()} mi
                                                            </span>
                                                        )}
                                                        {item.estimatedDueDate && !isOverdue && (
                                                            <span className={`text-[8px] block ${subtext}`}>
                                                                ~{item.estimatedDaysRemaining} days ({item.estimatedDueDate})
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Progress Bar */}
                                                <div className="mt-2.5">
                                                    <div className={`h-2 w-full rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-slate-200'}`}>
                                                        <div
                                                            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                                                            style={{ width: `${Math.min(100, item.progressPercent)}%` }}
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between text-[8px] font-bold mt-1 opacity-70">
                                                        <span className={subtext}>
                                                            {item.milesDrivenSinceService.toLocaleString()} mi driven
                                                        </span>
                                                        <span className={isOverdue ? 'text-red-400 font-black' : isDueSoon ? 'text-amber-400 font-black' : subtext}>
                                                            {item.progressPercent}% of interval
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Actions Row: Log Service Done & Edit Interval */}
                                                <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between gap-2">
                                                    <button
                                                        onClick={() => {
                                                            setActiveServiceItem(item);
                                                            setServiceCost('');
                                                            setServiceNotes('');
                                                        }}
                                                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
                                                            isOverdue || isDueSoon
                                                                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm'
                                                                : isDark ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                                        }`}
                                                    >
                                                        <span>✅</span>
                                                        <span>Log Service Done</span>
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setEditingIntervalItem(item);
                                                            setCustomIntervalInput(item.intervalMiles.toString());
                                                        }}
                                                        className={`px-2 py-1 rounded-lg text-[9px] font-bold transition-colors ${
                                                            isDark ? 'text-slate-400 hover:text-indigo-400' : 'text-slate-500 hover:text-indigo-600'
                                                        }`}
                                                        title="Adjust Service Interval"
                                                    >
                                                        ⚙️ Interval
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ────────────────────────────────────────────────────────────
                            LOG SERVICE DONE MODAL / SHEET
                            ──────────────────────────────────────────────────────────── */}
                        {activeServiceItem && (
                            <div className={`p-4 rounded-2xl border space-y-3 animate-in slide-in-from-bottom-2 ${
                                isDark ? 'bg-slate-800/90 border-emerald-500/40' : 'bg-emerald-50/90 border-emerald-300 shadow-lg'
                            }`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl">{activeServiceItem.icon}</span>
                                        <div>
                                            <h4 className={`text-xs font-black ${text}`}>
                                                Log {activeServiceItem.title}
                                            </h4>
                                            <p className={`text-[9px] ${subtext}`}>
                                                Resets interval & logs to vehicle expense history
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setActiveServiceItem(null)}
                                        className="text-xs text-slate-400 hover:text-white p-1"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className={`text-[9px] font-bold uppercase ${subtext}`}>Service Cost ($)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            placeholder="0.00 (optional)"
                                            value={serviceCost}
                                            onChange={(e) => setServiceCost(e.target.value)}
                                            className={`${inputCls} text-xs py-1.5 mt-1`}
                                        />
                                    </div>
                                    <div>
                                        <label className={`text-[9px] font-bold uppercase ${subtext}`}>Date Done</label>
                                        <input
                                            type="date"
                                            value={serviceDate}
                                            onChange={(e) => setServiceDate(e.target.value)}
                                            className={`${inputCls} text-xs py-1.5 mt-1`}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className={`text-[9px] font-bold uppercase ${subtext}`}>Notes / Brand (Optional)</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Mobil 1 Synthetic 0W-20 + OEM Filter"
                                        value={serviceNotes}
                                        onChange={(e) => setServiceNotes(e.target.value)}
                                        className={`${inputCls} text-xs py-1.5 mt-1`}
                                    />
                                </div>

                                <div className="flex gap-2 pt-1">
                                    <button
                                        onClick={() => setActiveServiceItem(null)}
                                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                                            isDark ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-200 text-slate-700'
                                        }`}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleConfirmServiceDone}
                                        className="flex-[2] py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-black shadow-md shadow-emerald-500/25 transition-all active:scale-95"
                                    >
                                        ✅ Complete & Reset Interval
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ────────────────────────────────────────────────────────────
                            EDIT INTERVAL MODAL / SHEET
                            ──────────────────────────────────────────────────────────── */}
                        {editingIntervalItem && (
                            <div className={`p-4 rounded-2xl border space-y-3 animate-in slide-in-from-bottom-2 ${
                                isDark ? 'bg-slate-800/90 border-indigo-500/40' : 'bg-indigo-50/90 border-indigo-300 shadow-lg'
                            }`}>
                                <div className="flex items-center justify-between">
                                    <h4 className={`text-xs font-black ${text}`}>
                                        ⚙️ Adjust {editingIntervalItem.title} Interval
                                    </h4>
                                    <button onClick={() => setEditingIntervalItem(null)} className="text-xs text-slate-400">✕</button>
                                </div>

                                <div>
                                    <label className={`text-[9px] font-bold uppercase ${subtext}`}>Interval in Miles</label>
                                    <input
                                        type="number"
                                        step="500"
                                        min="500"
                                        max="100000"
                                        value={customIntervalInput}
                                        onChange={(e) => setCustomIntervalInput(e.target.value)}
                                        className={`${inputCls} text-center font-black text-base mt-1`}
                                    />
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {[3000, 5000, 6000, 7500, 10000, 15000, 20000].map(val => (
                                            <button
                                                key={val}
                                                onClick={() => setCustomIntervalInput(val.toString())}
                                                className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                                                    customIntervalInput === val.toString()
                                                        ? 'bg-indigo-600 text-white'
                                                        : isDark ? 'bg-white/5 text-slate-400' : 'bg-slate-200 text-slate-700'
                                                }`}
                                            >
                                                {val.toLocaleString()} mi
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex gap-2 pt-1">
                                    <button onClick={() => setEditingIntervalItem(null)} className={`flex-1 py-2 rounded-xl text-xs font-bold ${isDark ? 'bg-white/5 text-slate-300' : 'bg-slate-200 text-slate-700'}`}>
                                        Cancel
                                    </button>
                                    <button onClick={handleSaveInterval} className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">
                                        Save Interval
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Time Filter Tabs */}
                        <div className={`flex rounded-xl border p-1 gap-0.5 ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
                            {(['today', 'week', 'month', 'year', 'lifetime'] as TimeFilter[]).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setTimeFilter(f)}
                                    className={`flex-1 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all
                                        ${timeFilter === f
                                            ? 'bg-indigo-600 text-white shadow-md'
                                            : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'}`}
                                >
                                    {f === 'lifetime' ? 'All' : f === 'today' ? 'Day' : f.charAt(0).toUpperCase() + f.slice(1)}
                                </button>
                            ))}
                        </div>

                        {/* Key Metrics Grid */}
                        <div className="grid grid-cols-2 gap-2.5">
                            <div className={`${card} p-3.5`}>
                                <p className={`text-[9px] font-bold uppercase tracking-wider mb-1 ${subtext}`}>📏 Period Mileage</p>
                                <p className={`text-lg font-black ${text}`}>{periodSummary.totalDistanceMiles.toLocaleString()} <span className="text-xs font-bold text-slate-500">mi</span></p>
                                <p className={`text-[9px] mt-1 ${subtext}`}>{periodSummary.tripCount} trips</p>
                            </div>
                            <div className={`${card} p-3.5`}>
                                <p className={`text-[9px] font-bold uppercase tracking-wider mb-1 ${subtext}`}>⛽ Gas Cost</p>
                                <p className={`text-lg font-black text-red-400`}>${periodSummary.totalCost.toFixed(2)}</p>
                                <p className={`text-[9px] mt-1 ${subtext}`}>{periodSummary.totalGallons.toFixed(1)} gal used</p>
                            </div>
                            <div className={`${card} p-3.5`}>
                                <p className={`text-[9px] font-bold uppercase tracking-wider mb-1 ${subtext}`}>💰 Route Savings</p>
                                <p className={`text-lg font-black text-emerald-400`}>${periodSummary.totalMoneySaved.toFixed(2)}</p>
                                <p className={`text-[9px] mt-1 ${subtext}`}>Optimized routes</p>
                            </div>
                            <div className={`${card} p-3.5`}>
                                <p className={`text-[9px] font-bold uppercase tracking-wider mb-1 ${subtext}`}>📄 IRS Deduction</p>
                                <p className={`text-lg font-black text-indigo-400`}>${deductibleMileage.toFixed(2)}</p>
                                <p className={`text-[9px] mt-1 ${subtext}`}>${IRS_MILEAGE_RATE}/mi rate</p>
                            </div>
                        </div>

                        {/* Projected Annual / Total Expenses */}
                        <div className={`${card} p-4`}>
                            <div className="flex items-center justify-between mb-3">
                                <p className={`text-[10px] font-bold uppercase tracking-wider ${subtext}`}>💳 Total Vehicle Expenses</p>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="text-center">
                                    <p className={`text-lg font-black text-amber-400`}>
                                        ${(periodSummary.totalCost + totalManualExpenses).toFixed(2)}
                                    </p>
                                    <p className={`text-[8px] font-bold uppercase tracking-wider mt-0.5 ${subtext}`}>Total Spent</p>
                                </div>
                                <div className="text-center">
                                    <p className={`text-lg font-black text-emerald-400`}>
                                        ${periodSummary.totalMoneySaved.toFixed(2)}
                                    </p>
                                    <p className={`text-[8px] font-bold uppercase tracking-wider mt-0.5 ${subtext}`}>Saved</p>
                                </div>
                                <div className="text-center">
                                    <p className={`text-lg font-black text-indigo-400`}>
                                        ${report.projectedAnnualCost.toFixed(0)}
                                    </p>
                                    <p className={`text-[8px] font-bold uppercase tracking-wider mt-0.5 ${subtext}`}>Yearly Est.</p>
                                </div>
                            </div>
                        </div>

                        {/* Expense Log Section */}
                        <div className={`${card} p-4`}>
                            <div className="flex items-center justify-between mb-3">
                                <p className={`text-[10px] font-bold uppercase tracking-wider ${subtext}`}>🧾 Expense Log</p>
                                <button
                                    onClick={() => setShowAddExpense(!showAddExpense)}
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all
                                        ${showAddExpense
                                            ? (isDark ? 'bg-red-500/20 text-red-400' : 'bg-red-50 text-red-600')
                                            : 'bg-indigo-600 text-white hover:bg-indigo-500'}`}
                                >
                                    {showAddExpense ? 'Cancel' : '+ Add'}
                                </button>
                            </div>

                            {/* Add Expense Form */}
                            {showAddExpense && (
                                <div className={`p-3 rounded-xl border space-y-2.5 mb-3 animate-in slide-in-from-top-2
                                    ${isDark ? 'bg-slate-800/50 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className={`text-[9px] font-bold uppercase ${subtext}`}>Category</label>
                                            <select
                                                value={newExpense.category}
                                                onChange={(e) => setNewExpense(p => ({ ...p, category: e.target.value as ManualExpense['category'] }))}
                                                className={`w-full mt-1 px-2 py-1.5 rounded-lg border text-xs outline-none
                                                    ${isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'}`}
                                            >
                                                {(['gas', 'oil_change', 'tires', 'repair', 'insurance', 'car_wash', 'registration', 'other'] as ManualExpense['category'][]).map(c => (
                                                    <option key={c} value={c}>{getCategoryIcon(c)} {getCategoryLabel(c)}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={`text-[9px] font-bold uppercase ${subtext}`}>Amount</label>
                                            <div className="flex items-center gap-1 mt-1">
                                                <span className={`text-xs font-bold ${text}`}>$</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={newExpense.amount}
                                                    onChange={(e) => setNewExpense(p => ({ ...p, amount: e.target.value }))}
                                                    className={`flex-1 px-2 py-1.5 rounded-lg border text-xs outline-none
                                                        ${isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'}`}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className={`text-[9px] font-bold uppercase ${subtext}`}>Date</label>
                                            <input
                                                type="date"
                                                value={newExpense.date}
                                                onChange={(e) => setNewExpense(p => ({ ...p, date: e.target.value }))}
                                                className={`w-full mt-1 px-2 py-1.5 rounded-lg border text-xs outline-none
                                                    ${isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'}`}
                                            />
                                        </div>
                                        <div>
                                            <label className={`text-[9px] font-bold uppercase ${subtext}`}>Note</label>
                                            <input
                                                type="text"
                                                placeholder="Optional"
                                                value={newExpense.note}
                                                onChange={(e) => setNewExpense(p => ({ ...p, note: e.target.value }))}
                                                className={`w-full mt-1 px-2 py-1.5 rounded-lg border text-xs outline-none
                                                    ${isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'}`}
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleAddExpense}
                                        className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all active:scale-95"
                                    >
                                        Add Expense
                                    </button>
                                </div>
                            )}

                            {/* Expense List */}
                            {filteredExpenses.length > 0 ? (
                                <div className="space-y-1.5 max-h-48 overflow-y-auto no-scrollbar">
                                    {filteredExpenses.map(e => (
                                        <div key={e.id} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all group
                                            ${isDark ? 'hover:bg-white/5' : 'hover:bg-slate-50'}`}>
                                            <span className="text-lg shrink-0">{getCategoryIcon(e.category)}</span>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-xs font-bold ${text}`}>{getCategoryLabel(e.category)}</p>
                                                <p className={`text-[9px] ${subtext} truncate`}>
                                                    {e.note || new Date(e.date).toLocaleDateString()}
                                                </p>
                                            </div>
                                            <span className="text-xs font-black text-red-400">${e.amount.toFixed(2)}</span>
                                            <button
                                                onClick={() => handleDeleteExpense(e.id)}
                                                className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400 hover:text-red-300 transition-all"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className={`text-xs text-center py-4 ${subtext}`}>No expenses logged for this period</p>
                            )}
                        </div>

                        {/* Recent Trips (mini-list) */}
                        <div className={`${card} p-4`}>
                            <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${subtext}`}>🛣️ Recent Trip Fuel Log</p>
                            {trips.length > 0 ? (
                                <div className="space-y-1.5 max-h-40 overflow-y-auto no-scrollbar">
                                    {trips.slice(0, 10).map(t => (
                                        <div key={t.id} className={`flex items-center gap-3 p-2 rounded-xl ${isDark ? 'hover:bg-white/5' : 'hover:bg-slate-50'} transition-all`}>
                                            <span className="text-sm shrink-0">🚗</span>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-[11px] font-bold truncate ${text}`}>
                                                    {t.destinationName || 'Trip'}
                                                </p>
                                                <p className={`text-[9px] ${subtext}`}>
                                                    {t.totalDistanceMiles.toFixed(1)} mi • {t.endTime ? formatDuration(t.startTime, t.endTime) : 'In progress'}
                                                </p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-[11px] font-black text-amber-400">
                                                    {t.fuelCost != null ? `$${t.fuelCost.toFixed(2)}` : '—'}
                                                </p>
                                                <p className={`text-[8px] ${subtext}`}>
                                                    {t.fuelGallons != null ? `${t.fuelGallons.toFixed(1)} gal` : ''}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className={`text-xs text-center py-4 ${subtext}`}>No trips recorded yet</p>
                            )}
                        </div>

                        {/* Gig Driver Tax Tip */}
                        <div className={`rounded-2xl border p-4 ${isDark ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-emerald-50 border-emerald-100'}`}>
                            <div className="flex items-start gap-3">
                                <span className="text-xl shrink-0">💡</span>
                                <div>
                                    <p className={`text-xs font-bold ${isDark ? 'text-emerald-300' : 'text-emerald-800'}`}>Gig Driver Tax Tip</p>
                                    <p className={`text-[10px] mt-1 leading-relaxed ${isDark ? 'text-emerald-400/80' : 'text-emerald-700'}`}>
                                        Track your miles! The 2024 IRS standard mileage rate is <strong>${IRS_MILEAGE_RATE}/mile</strong>. 
                                        Your {timeFilter === 'lifetime' ? 'total' : timeFilter} deductible amount: <strong>${deductibleMileage.toFixed(2)}</strong> for {periodSummary.totalDistanceMiles.toFixed(1)} business miles.
                                    </p>
                                </div>
                            </div>
                        </div>

                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(MaintenancePanel);
