import React, { useState } from 'react';
import { Vehicle } from '../types';
import { vehicleFuelService, VEHICLE_PRESETS } from '../services/vehicleFuelService';

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
    const [isCustomAdding, setIsCustomAdding] = useState<boolean>(false);
    const [customMake, setCustomMake] = useState('');
    const [customModel, setCustomModel] = useState('');
    const [customYear, setCustomYear] = useState<number>(2024);
    const [customMpg, setCustomMpg] = useState<number>(30);
    const [customFuelType, setCustomFuelType] = useState<Vehicle['fuelType']>('gasoline');

    const handleSelectActiveVehicle = (id: string) => {
        vehicleFuelService.setActiveVehicle(id);
        const updated = vehicleFuelService.getActiveVehicleNullable();
        setActiveVeh(updated);
        setVehicles(vehicleFuelService.getVehicles());
        if (onVehicleChange) onVehicleChange(updated);
    };

    const handleAddPreset = (preset: typeof VEHICLE_PRESETS[0]) => {
        const added = vehicleFuelService.addVehicle(preset);
        setVehicles(vehicleFuelService.getVehicles());
        setActiveVeh(added);
        if (onVehicleChange) onVehicleChange(added);
    };

    const handleAddCustomVehicle = () => {
        if (!customMake.trim() || !customModel.trim()) return;
        const added = vehicleFuelService.addVehicle({
            name: `${customYear} ${customMake} ${customModel}`.trim(),
            make: customMake.trim(),
            model: customModel.trim(),
            year: customYear,
            mpg: customMpg || 28,
            fuelType: customFuelType,
            isPrimary: true
        });
        setVehicles(vehicleFuelService.getVehicles());
        setActiveVeh(added);
        if (onVehicleChange) onVehicleChange(added);
        setIsCustomAdding(false);
        setCustomMake('');
        setCustomModel('');
    };

    const handleDeleteVehicle = (id: string) => {
        vehicleFuelService.deleteVehicle(id);
        const updated = vehicleFuelService.getVehicles();
        setVehicles(updated);
        const nextActive = vehicleFuelService.getActiveVehicleNullable();
        setActiveVeh(nextActive);
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

            {/* My Garage */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <h4 className={`text-xs font-black uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                        My Garage ({vehicles.length})
                    </h4>
                    <button
                        type="button"
                        onClick={() => setIsCustomAdding(!isCustomAdding)}
                        className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                    >
                        {isCustomAdding ? '✕ Cancel' : '+ Add Custom'}
                    </button>
                </div>

                {/* Custom Vehicle Add Form */}
                {isCustomAdding && (
                    <div className={`p-3 rounded-2xl border mb-3 space-y-2.5 animate-in fade-in ${
                        theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                    }`}>
                        <p className="text-[11px] font-bold text-indigo-400">Add Vehicle to Garage</p>
                        <div className="grid grid-cols-2 gap-2">
                            <input
                                type="text"
                                placeholder="Make (e.g. Jeep, Honda)"
                                value={customMake}
                                onChange={(e) => setCustomMake(e.target.value)}
                                className={`px-2.5 py-1.5 text-xs rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-200'
                                }`}
                            />
                            <input
                                type="text"
                                placeholder="Model (e.g. Wrangler, Civic)"
                                value={customModel}
                                onChange={(e) => setCustomModel(e.target.value)}
                                className={`px-2.5 py-1.5 text-xs rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-200'
                                }`}
                            />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <input
                                type="number"
                                placeholder="Year"
                                value={customYear}
                                onChange={(e) => setCustomYear(parseInt(e.target.value) || 2024)}
                                className={`px-2.5 py-1.5 text-xs rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-200'
                                }`}
                            />
                            <input
                                type="number"
                                placeholder="MPG"
                                value={customMpg}
                                onChange={(e) => setCustomMpg(parseInt(e.target.value) || 28)}
                                className={`px-2.5 py-1.5 text-xs rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-200'
                                }`}
                            />
                            <select
                                value={customFuelType}
                                onChange={(e) => setCustomFuelType(e.target.value as any)}
                                className={`px-2 py-1.5 text-xs rounded-xl border ${
                                    theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-200'
                                }`}
                            >
                                <option value="gasoline">Gas</option>
                                <option value="hybrid">Hybrid</option>
                                <option value="electric">EV</option>
                                <option value="diesel">Diesel</option>
                            </select>
                        </div>
                        <button
                            type="button"
                            onClick={handleAddCustomVehicle}
                            className="w-full py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md transition-all active:scale-95 cursor-pointer"
                        >
                            Save & Activate Vehicle
                        </button>
                    </div>
                )}

                {/* Saved Vehicles List */}
                <div className="space-y-1.5">
                    {vehicles.length === 0 ? (
                        <div className={`p-4 rounded-xl border border-dashed text-center text-xs ${
                            theme === 'dark' ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500'
                        }`}>
                            No saved vehicles in garage. Tap an instant preset below or add a custom vehicle.
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

            {/* Quick Presets */}
            <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    Instant Vehicle Presets
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {VEHICLE_PRESETS.slice(0, 6).map((preset, idx) => (
                        <button
                            key={idx}
                            type="button"
                            onClick={() => handleAddPreset(preset)}
                            className={`p-2 rounded-xl border text-left transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98] ${
                                theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                            }`}
                        >
                            <div className="flex items-center gap-1 text-[11px] font-bold truncate">
                                <span>{preset.make === 'Jeep' ? '🚙' : preset.fuelType === 'electric' ? '⚡' : preset.fuelType === 'hybrid' ? '🌿' : '🚗'}</span>
                                <span className="truncate">{preset.name}</span>
                            </div>
                            <div className="text-[9px] text-slate-400 mt-0.5">{preset.mpg} MPG • {preset.fuelType}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default VehicleGarageModule;
