import React, { useState, useEffect } from 'react';
import { Vehicle } from '../types';
import { vehicleFuelService } from '../services/vehicleFuelService';
import { VehicleAddWizard } from './VehicleAddWizard';
import {
    Fuel,
    Gauge,
    Check,
    Sparkles,
    ChevronDown,
    ChevronUp,
    AlertTriangle,
    Zap,
    RotateCcw,
    Plus
} from 'lucide-react';

/**
 * Converts a fuel percentage into a driver-friendly dashboard fraction.
 */
function getFractionName(percent: number): string {
    if (percent >= 95) return 'Full Tank';
    if (percent >= 82) return '7/8 Tank';
    if (percent >= 68) return '3/4 Tank';
    if (percent >= 58) return '5/8 Tank';
    if (percent >= 43) return '1/2 Tank';
    if (percent >= 32) return '3/8 Tank';
    if (percent >= 18) return '1/4 Tank';
    if (percent >= 8) return '1/8 Tank';
    return 'Empty / Reserve';
}

const FRACTION_CHIPS = [
    { label: 'E', name: 'Near Empty', percent: 8 },
    { label: '1/4', name: '1/4 Tank', percent: 25 },
    { label: '1/2', name: '1/2 Tank', percent: 50 },
    { label: '3/4', name: '3/4 Tank', percent: 75 },
    { label: 'Full', name: 'Full Tank', percent: 100 }
];

interface VehicleGarageModuleProps {
    theme: 'light' | 'dark';
    onVehicleChange?: (vehicle: Vehicle | null) => void;
}

const VehicleGarageModule: React.FC<VehicleGarageModuleProps> = ({
    theme,
    onVehicleChange
}) => {
    const [vehicles, setVehicles] = useState<Vehicle[]>(() => vehicleFuelService.getVehicles());
    const [activeVeh, setActiveVeh] = useState<Vehicle | null>(() => vehicleFuelService.getActiveVehicleNullable());
    const [gasPriceInput, setGasPriceInput] = useState<string>(() => vehicleFuelService.getGasPrice().toFixed(2));
    const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);
    const [fuelLevelInput, setFuelLevelInput] = useState<string>('');
    const [fillUpGallonsInput, setFillUpGallonsInput] = useState<string>('');
    const [fuelStateVersion, setFuelStateVersion] = useState(0);
    const fuelStatus = vehicleFuelService.getFuelTankStatus(activeVeh || undefined);

    const [sliderPercent, setSliderPercent] = useState<number>(() => {
        return fuelStatus?.percentRemaining ?? 50;
    });
    const [showAdvancedInputs, setShowAdvancedInputs] = useState(false);
    const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

    useEffect(() => {
        if (fuelStatus?.percentRemaining !== undefined) {
            setSliderPercent(fuelStatus.percentRemaining);
            setFuelLevelInput(fuelStatus.gallonsRemaining.toFixed(1));
        } else {
            setSliderPercent(50);
            if (activeVeh?.tankCapacityGal) {
                setFuelLevelInput((activeVeh.tankCapacityGal * 0.5).toFixed(1));
            }
        }
    }, [activeVeh?.id, fuelStateVersion]);

    const handleSelectActiveVehicle = (id: string) => {
        vehicleFuelService.setActiveVehicle(id);
        const updated = vehicleFuelService.getActiveVehicleNullable();
        setActiveVeh(updated);
        setVehicles(vehicleFuelService.getVehicles());
        setFuelLevelInput('');
        setFuelStateVersion(version => version + 1);
        if (onVehicleChange) onVehicleChange(updated);
    };

    const handleAddVehicleFromWizard = (newVehicle: Omit<Vehicle, 'id'>) => {
        const added = vehicleFuelService.addVehicle(newVehicle);
        setVehicles(vehicleFuelService.getVehicles());
        setActiveVeh(added);
        setFuelLevelInput('');
        setFuelStateVersion(version => version + 1);
        if (onVehicleChange) onVehicleChange(added);
        setIsWizardOpen(false);
    };

    const handleDeleteVehicle = (id: string) => {
        vehicleFuelService.deleteVehicle(id);
        const updated = vehicleFuelService.getVehicles();
        setVehicles(updated);
        const nextActive = vehicleFuelService.getActiveVehicleNullable();
        setActiveVeh(nextActive);
        setFuelLevelInput('');
        setFuelStateVersion(version => version + 1);
        if (onVehicleChange) onVehicleChange(nextActive);
    };

    const handleDeleteActiveVehicle = () => {
        if (!activeVeh) return;
        handleDeleteVehicle(activeVeh.id);
    };

    const handleGasPriceChange = (val: string) => {
        setGasPriceInput(val);
        const parsed = parseFloat(val);
        if (!isNaN(parsed) && parsed > 0) {
            vehicleFuelService.setGasPrice(parsed);
        }
    };

    const handleSelectFraction = (percent: number) => {
        setSliderPercent(percent);
        if (activeVeh?.tankCapacityGal) {
            const gal = (activeVeh.tankCapacityGal * percent) / 100;
            setFuelLevelInput(gal.toFixed(1));
        }
    };

    const handleSaveSliderFuel = () => {
        if (!activeVeh || !activeVeh.tankCapacityGal) return;
        const gallons = (activeVeh.tankCapacityGal * sliderPercent) / 100;
        if (sliderPercent >= 99) {
            vehicleFuelService.markTankFull(activeVeh);
            setSaveFeedback('Logged Full Tank (100%)!');
        } else {
            vehicleFuelService.setFuelLevel(gallons, activeVeh, 'manual');
            setSaveFeedback(`Saved ${getFractionName(sliderPercent)} (~${gallons.toFixed(1)} gal)!`);
        }
        setFuelStateVersion(version => version + 1);
        setTimeout(() => setSaveFeedback(null), 2500);
    };

    const handleQuickFillUp = () => {
        if (!activeVeh) return;
        vehicleFuelService.markTankFull(activeVeh);
        setSliderPercent(100);
        setFuelLevelInput(activeVeh.tankCapacityGal?.toFixed(1) || '');
        setSaveFeedback('Logged Full Tank (100%)!');
        setFuelStateVersion(version => version + 1);
        setTimeout(() => setSaveFeedback(null), 2500);
    };

    const handleSaveFuelLevel = () => {
        if (!activeVeh) return;
        const gallons = parseFloat(fuelLevelInput);
        if (!Number.isFinite(gallons) || gallons < 0) return;
        vehicleFuelService.setFuelLevel(gallons, activeVeh, 'manual');
        if (activeVeh.tankCapacityGal) {
            setSliderPercent(Math.min(100, Math.max(0, Math.round((gallons / activeVeh.tankCapacityGal) * 100))));
        }
        setSaveFeedback(`Saved ~${gallons.toFixed(1)} gal!`);
        setFuelStateVersion(version => version + 1);
        setTimeout(() => setSaveFeedback(null), 2500);
    };

    const handleMarkTankFull = () => {
        if (!activeVeh) return;
        const gallonsAdded = parseFloat(fillUpGallonsInput);
        if (Number.isFinite(gallonsAdded) && gallonsAdded > 0) {
            vehicleFuelService.recordFullFillUp(gallonsAdded, activeVeh);
            setSaveFeedback(`Logged fill-up: ${gallonsAdded.toFixed(1)} gal added!`);
        } else {
            vehicleFuelService.markTankFull(activeVeh);
            setSaveFeedback('Logged Full Tank (100%)!');
        }
        setSliderPercent(100);
        setFuelLevelInput(activeVeh.tankCapacityGal?.toFixed(1) || '');
        setFillUpGallonsInput('');
        setFuelStateVersion(version => version + 1);
        setTimeout(() => setSaveFeedback(null), 2500);
    };

    return (
        <div className="space-y-4">
            {/* Active Vehicle Badge / Card */}
            {activeVeh ? (
                <div className={`p-3.5 rounded-2xl border relative overflow-hidden transition-all shadow-sm ${
                    theme === 'dark' ? 'bg-indigo-950/40 border-indigo-500/30' : 'bg-indigo-50/80 border-indigo-200'
                }`}>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <span className="text-xl shrink-0">
                                {activeVeh.make === 'Jeep' ? '🚙' : activeVeh.fuelType === 'electric' ? '⚡' : activeVeh.fuelType === 'hybrid' ? '🌿' : '🚗'}
                            </span>
                            <div className="min-w-0 flex-1">
                                <h4 className={`text-xs font-black truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                    {activeVeh.name}
                                </h4>
                                <p className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider">
                                    Active Driving Profile
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 ml-2">
                            <span className="text-xs font-black px-2 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-600 dark:text-indigo-300">
                                {activeVeh.mpg} {activeVeh.fuelType === 'electric' ? 'MPGe' : 'MPG'}
                            </span>
                            {/* Delete [✕] button directly on the active profile card */}
                            <button
                                type="button"
                                onClick={handleDeleteActiveVehicle}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer font-bold text-xs"
                                title="Remove Active Vehicle"
                                aria-label="Remove Active Vehicle"
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-indigo-500/20 text-[11px]">
                        <div>
                            <span className="text-slate-500 dark:text-slate-400">Fuel Type: </span>
                            <span className="font-bold capitalize text-slate-800 dark:text-slate-200">{activeVeh.fuelType}</span>
                        </div>
                        <div>
                            <span className="text-slate-500 dark:text-slate-400">Gas Price: </span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">${gasPriceInput}/gal</span>
                        </div>
                    </div>
                </div>
            ) : (
                /* Empty state when garage has been completely cleared */
                <div className={`p-4 rounded-2xl border border-dashed text-center transition-all ${
                    theme === 'dark' ? 'bg-white/5 border-slate-700' : 'bg-slate-50 border-slate-300'
                }`}>
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-xl mx-auto mb-2">
                        🚘
                    </div>
                    <h4 className={`text-xs font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                        No Active Vehicle Selected
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-xs mx-auto">
                        Your garage is empty. Tap an instant preset below or add a custom vehicle to set your active driving profile.
                    </p>
                </div>
            )}

            {/* Local Gas Price Setting */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/5">
                <div>
                    <h4 className={`text-xs font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Gas Price ($/gal)</h4>
                    <p className="text-[10px] text-slate-400">Used for per-trip and annual fuel estimates</p>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400">$</span>
                    <input
                        type="number"
                        step="0.05"
                        value={gasPriceInput}
                        onChange={(e) => handleGasPriceChange(e.target.value)}
                        className={`w-16 px-2 py-1 text-xs font-bold rounded-lg text-center border ${
                            theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-300 text-slate-900'
                        }`}
                    />
                </div>
            </div>

            {/* Fuel state — Fraction-First Visual Tank Tracker */}
            {activeVeh?.fuelType !== 'electric' && activeVeh?.tankCapacityGal ? (() => {
                const capacity = activeVeh.tankCapacityGal;
                const mpg = activeVeh.mpg || 20;
                const previewGallons = (capacity * sliderPercent) / 100;
                const previewRange = Math.round(previewGallons * mpg);
                const fractionName = getFractionName(sliderPercent);
                const isReserve = sliderPercent <= 15;
                const isLow = sliderPercent <= 25;

                return (
                    <div key={fuelStateVersion} className={`p-3 rounded-2xl border transition-all ${
                        theme === 'dark' 
                            ? 'bg-gradient-to-b from-slate-900/90 to-emerald-950/20 border-emerald-500/20 shadow-lg' 
                            : 'bg-gradient-to-b from-white to-emerald-50/60 border-emerald-200 shadow-sm'
                    }`}>
                        {/* Header */}
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                                    theme === 'dark' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                                }`}>
                                    <Fuel className="w-4 h-4" />
                                </div>
                                <div>
                                    <h4 className={`text-xs font-black flex items-center gap-1.5 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                        <span>Fuel level</span>
                                        {fuelStatus && (
                                            <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                                                Active
                                            </span>
                                        )}
                                    </h4>
                                    <p className="text-[10px] text-slate-400 mt-0.5">
                                        {previewGallons.toFixed(1)} gal • ~{previewRange} mi range
                                    </p>
                                </div>
                            </div>
                            {fuelStatus ? (
                                <span className={`text-[10px] font-black px-2 py-1 rounded-lg shrink-0 ${
                                    fuelStatus.percentRemaining <= 25 ? 'bg-amber-500/15 text-amber-600' : 'bg-emerald-500/15 text-emerald-600'
                                }`}>
                                    {fuelStatus.percentRemaining}% • {getFractionName(fuelStatus.percentRemaining)}
                                </span>
                            ) : (
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-500 border border-amber-500/20 shrink-0">
                                    Not Set
                                </span>
                            )}
                        </div>

                        {/* Save feedback banner */}
                        {saveFeedback && (
                            <div className="mt-2.5 p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>{saveFeedback}</span>
                            </div>
                        )}

                        {/* Fraction Preset Chips */}
                        <div className="mt-2.5">
                            <div className="grid grid-cols-5 gap-1.5">
                                {FRACTION_CHIPS.map((chip) => {
                                    const isSelected = Math.abs(sliderPercent - chip.percent) <= 5;
                                    return (
                                        <button
                                            key={chip.label}
                                            type="button"
                                            onClick={() => handleSelectFraction(chip.percent)}
                                            aria-label={`Set fuel to ${chip.name}`}
                                            className={`h-9 px-1 rounded-xl text-center transition-all cursor-pointer border ${
                                                isSelected
                                                    ? 'bg-emerald-600 text-white font-black border-emerald-400 shadow-md shadow-emerald-500/20 scale-105'
                                                    : theme === 'dark'
                                                        ? 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                                                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                                            }`}
                                        >
                                            <div className="text-xs font-black leading-none">{chip.label}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Interactive Automotive Fuel Gauge Bar / Scrubber */}
                        <div className={`mt-2.5 rounded-xl border px-2.5 py-2 ${theme === 'dark' ? 'border-white/10 bg-black/20' : 'border-emerald-100 bg-white/70'}`}>
                            <div className="flex items-center justify-between text-xs font-black mb-1.5">
                                <span className="flex items-center gap-1.5">
                                    <span className={isReserve ? 'text-rose-400 animate-pulse' : isLow ? 'text-amber-400' : 'text-emerald-400'}>
                                        {fractionName}
                                    </span>
                                    <span className="text-slate-400 font-normal">
                                        ({sliderPercent}%)
                                    </span>
                                </span>
                                <span className={theme === 'dark' ? 'text-slate-200 font-bold' : 'text-slate-700 font-bold'}>
                                    {previewGallons.toFixed(1)} <span className="text-slate-400 font-normal">/ {capacity} gal</span>
                                </span>
                            </div>

                            {/* Range slider bar */}
                            <div className="relative flex items-center my-1">
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    step="1"
                                    value={sliderPercent}
                                    onChange={(e) => handleSelectFraction(Number(e.target.value))}
                                    className="w-full h-2.5 rounded-lg appearance-none cursor-pointer accent-emerald-500 bg-slate-700/60"
                                    style={{
                                        background: `linear-gradient(to right, ${
                                            isReserve ? '#f43f5e' : isLow ? '#f59e0b' : '#10b981'
                                        } 0%, ${
                                            isReserve ? '#f43f5e' : isLow ? '#f59e0b' : '#10b981'
                                        } ${sliderPercent}%, ${theme === 'dark' ? '#334155' : '#cbd5e1'} ${sliderPercent}%, ${theme === 'dark' ? '#334155' : '#cbd5e1'} 100%)`
                                    }}
                                />
                            </div>

                            {/* Dashboard tick labels */}
                            <div className="flex justify-between text-[9px] font-black tracking-widest text-slate-400 px-0.5">
                                <span className="text-rose-400">E</span>
                                <span>1/4</span>
                                <span>1/2</span>
                                <span>3/4</span>
                                <span className="text-emerald-400">F</span>
                            </div>

                            {/* Range & Reserve Readout */}
                            <div className="pt-1.5 mt-1.5 border-t border-white/10 text-[10px] text-slate-400">
                                <span className="text-slate-400">
                                    Estimated range <strong className={isReserve ? 'text-amber-500' : 'text-emerald-500'}>~{previewRange} mi</strong>
                                </span>
                            </div>
                        </div>

                        {/* Action Buttons: Save Selected Fraction & 1-Tap Fill-Up */}
                        <div className="grid grid-cols-2 gap-2 mt-2.5">
                            <button
                                type="button"
                                onClick={handleSaveSliderFuel}
                                className="py-2.5 px-3 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
                            >
                                <Check className="w-3.5 h-3.5" />
                                <span>Save</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleQuickFillUp}
                                className="py-2.5 px-3 rounded-xl text-xs font-black border border-emerald-400/40 text-emerald-500 hover:bg-emerald-500/10 transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
                            >
                                <Fuel className="w-3.5 h-3.5" />
                                <span>Full tank</span>
                            </button>
                        </div>

                        {/* Advanced Expandable Accordion: Pump Gallons (MPG Learning) & Custom Numbers */}
                        <div className="mt-2.5 pt-2 border-t border-white/5">
                            <button
                                type="button"
                                onClick={() => setShowAdvancedInputs(!showAdvancedInputs)}
                                className="w-full flex items-center justify-between text-[10px] font-bold text-slate-400 hover:text-slate-300 py-1 transition-colors cursor-pointer"
                            >
                                <span>Advanced: Exact Gallons or Pump Receipt</span>
                                {showAdvancedInputs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>

                            {showAdvancedInputs && (
                                <div className="mt-2 space-y-2 animate-in fade-in">
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={fillUpGallonsInput}
                                            onChange={(e) => setFillUpGallonsInput(e.target.value)}
                                            placeholder="Pump receipt gallons (for MPG learning)"
                                            className={`min-w-0 flex-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-xl border ${
                                                theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-emerald-200 text-slate-900'
                                            }`}
                                            aria-label="Gallons added at fill-up"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleMarkTankFull}
                                            className="px-3 py-1.5 rounded-xl text-[11px] font-black bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer shrink-0"
                                        >
                                            Log Fill-Up
                                        </button>
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            min="0"
                                            max={capacity}
                                            step="0.1"
                                            value={fuelLevelInput}
                                            onChange={(e) => {
                                                setFuelLevelInput(e.target.value);
                                                const parsed = parseFloat(e.target.value);
                                                if (Number.isFinite(parsed) && capacity > 0) {
                                                    setSliderPercent(Math.min(100, Math.max(0, Math.round((parsed / capacity) * 100))));
                                                }
                                            }}
                                            placeholder={`Exact gallons (max ${capacity})`}
                                            className={`min-w-0 flex-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-xl border ${
                                                theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-emerald-200 text-slate-900'
                                            }`}
                                            aria-label="Current exact gallons in tank"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleSaveFuelLevel}
                                            className="px-3 py-1.5 rounded-xl text-[11px] font-black border border-white/10 text-slate-300 hover:bg-white/5 transition-colors cursor-pointer shrink-0"
                                        >
                                            Save Gal
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })() : null}

            {/* My Garage */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <h4 className={`text-xs font-black uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                        My Garage ({vehicles.length})
                    </h4>
                    <button
                        type="button"
                        onClick={() => setIsWizardOpen(!isWizardOpen)}
                        className={`text-xs font-black px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95 ${
                            isWizardOpen
                                ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30'
                                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                        }`}
                    >
                        {isWizardOpen ? (
                            '✕ Close Wizard'
                        ) : (
                            <>
                                <Plus className="w-3.5 h-3.5" />
                                <span>Add Vehicle</span>
                            </>
                        )}
                    </button>
                </div>

                {/* Vehicle Setup Wizard */}
                {isWizardOpen && (
                    <div className="mb-3">
                        <VehicleAddWizard
                            theme={theme}
                            onAddVehicle={handleAddVehicleFromWizard}
                            onCancel={() => setIsWizardOpen(false)}
                        />
                    </div>
                )}

                {/* Saved Vehicles List */}
                <div className="space-y-1.5">
                    {vehicles.length === 0 ? (
                        <div className={`p-4 rounded-xl border border-dashed text-center text-xs space-y-2 ${
                            theme === 'dark' ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500'
                        }`}>
                            <p className="font-bold">No saved vehicles in garage.</p>
                            <p className="text-[11px] text-slate-400">
                                Launch the wizard to add your car with pre-filled factory EPA specs.
                            </p>
                            {!isWizardOpen && (
                                <button
                                    type="button"
                                    onClick={() => setIsWizardOpen(true)}
                                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md transition-all cursor-pointer inline-flex items-center gap-1"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    Launch Vehicle Wizard
                                </button>
                            )}
                        </div>
                    ) : (
                        vehicles.map(v => {
                            const isSelected = activeVeh?.id === v.id;
                            return (
                                <div
                                    key={v.id}
                                    onClick={() => handleSelectActiveVehicle(v.id)}
                                    className={`p-2.5 rounded-xl border cursor-pointer flex items-center justify-between gap-2 transition-all ${
                                        isSelected
                                            ? 'bg-indigo-600/20 border-indigo-500 shadow-sm ring-1 ring-indigo-500/40'
                                            : theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-white border-slate-200 hover:bg-slate-50'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <span className="text-base">
                                            {v.make === 'Jeep' ? '🚙' : v.fuelType === 'electric' ? '⚡' : v.fuelType === 'hybrid' ? '🌿' : '🚗'}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className={`text-xs font-bold truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                                {v.name}
                                            </p>
                                            <p className="text-[10px] text-slate-400 capitalize">
                                                {v.mpg} {v.fuelType === 'electric' ? 'MPGe' : 'MPG'} • {v.fuelType}
                                                {v.tankCapacityGal ? ` • ${v.tankCapacityGal} gal tank` : ''}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        {isSelected && (
                                            <span className="text-[9px] font-black px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-400 dark:text-indigo-300">
                                                Active
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteVehicle(v.id);
                                            }}
                                            className="text-[11px] text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-500/10 transition-colors cursor-pointer"
                                            title="Delete vehicle"
                                            aria-label={`Delete ${v.name}`}
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default VehicleGarageModule;
