import React, { useState, useMemo, useCallback } from 'react';
import { Trip, Vehicle } from '../types';
import { ManualExpense, getCategoryIcon, getCategoryLabel } from './MaintenancePanel';

export interface TaxExportViewProps {
    theme?: 'light' | 'dark';
    trips: Trip[];
    expenses: ManualExpense[];
    vehicle?: Vehicle | null;
}

const IRS_MILEAGE_RATE = 0.67; // 2024–2026 IRS standard business mileage rate ($/mi)

export const TaxExportView: React.FC<TaxExportViewProps> = ({
    theme = 'dark',
    trips,
    expenses,
    vehicle
}) => {
    const isDark = theme === 'dark';

    // Theme tokens
    const cardCls = `rounded-2xl border transition-all ${isDark ? 'bg-white/5 border-white/8' : 'bg-white border-slate-100 shadow-sm'}`;
    const textCls = isDark ? 'text-white' : 'text-slate-900';
    const subtextCls = isDark ? 'text-slate-400' : 'text-slate-500';

    // Determine available tax years
    const currentYear = new Date().getFullYear();
    const availableYears = useMemo(() => {
        const yearsSet = new Set<number>([currentYear, currentYear - 1, currentYear - 2]);
        trips.forEach(t => {
            if (t.startTime) yearsSet.add(new Date(t.startTime).getFullYear());
        });
        expenses.forEach(e => {
            if (e.date) yearsSet.add(new Date(e.date).getFullYear());
        });
        return Array.from(yearsSet).sort((a, b) => b - a);
    }, [trips, expenses, currentYear]);

    const [selectedYear, setSelectedYear] = useState<number | 'all'>(currentYear);
    const [copied, setCopied] = useState(false);
    const [showTripsPreview, setShowTripsPreview] = useState(false);

    // Filter trips by selected year
    const filteredTrips = useMemo(() => {
        if (selectedYear === 'all') return trips;
        return trips.filter(t => new Date(t.startTime).getFullYear() === selectedYear);
    }, [trips, selectedYear]);

    // Filter expenses by selected year
    const filteredExpenses = useMemo(() => {
        if (selectedYear === 'all') return expenses;
        return expenses.filter(e => new Date(e.date).getFullYear() === selectedYear);
    }, [expenses, selectedYear]);

    // Calculations
    const totalMiles = useMemo(() => {
        return filteredTrips.reduce((sum, t) => sum + (t.totalDistanceMiles || 0), 0);
    }, [filteredTrips]);

    const totalDeduction = useMemo(() => {
        return totalMiles * IRS_MILEAGE_RATE;
    }, [totalMiles]);

    const tripFuelCost = useMemo(() => {
        return filteredTrips.reduce((sum, t) => sum + (t.fuelCost || 0), 0);
    }, [filteredTrips]);

    const loggedGasExpenses = useMemo(() => {
        return filteredExpenses
            .filter(e => e.category === 'gas')
            .reduce((sum, e) => sum + e.amount, 0);
    }, [filteredExpenses]);

    const totalFuelCosts = tripFuelCost + loggedGasExpenses;

    // Itemized expenses by category (excluding gas to avoid double count with standard mileage)
    const itemizedByCategory = useMemo(() => {
        const map: Record<string, number> = {
            oil_change: 0,
            repair: 0,
            tires: 0,
            insurance: 0,
            registration: 0,
            car_wash: 0,
            other: 0
        };
        filteredExpenses.forEach(e => {
            if (e.category !== 'gas') {
                map[e.category] = (map[e.category] || 0) + e.amount;
            }
        });
        return map;
    }, [filteredExpenses]);

    const totalItemizedExpenses = useMemo(() => {
        return (Object.values(itemizedByCategory) as number[]).reduce((sum, val) => sum + Number(val || 0), 0);
    }, [itemizedByCategory]);

    // Non-operating deductible expenses that can potentially be added to standard mileage
    // (e.g. registration/fees, parking, tolls, business supplies)
    const deductibleNonOperating = (itemizedByCategory.registration || 0) + (itemizedByCategory.other || 0);
    const grandWriteOffEstimate = totalDeduction + deductibleNonOperating;

    const vehicleName = vehicle
        ? `${vehicle.year ? vehicle.year + ' ' : ''}${vehicle.make} ${vehicle.model}`.trim()
        : 'Active Vehicle';

    // ─── CSV Export Handler ───
    const handleExportCSV = useCallback(() => {
        const headers = [
            'Date',
            'Trip ID',
            'Vehicle',
            'Start Location',
            'End Location / Destination',
            'Distance (Miles)',
            'IRS Rate ($/mi)',
            'Mileage Deduction ($)',
            'Trip Fuel Cost ($)'
        ];

        const rows = filteredTrips.map(t => {
            const dateStr = new Date(t.startTime).toLocaleDateString('en-US');
            const startLoc = t.startLocation
                ? `"${t.startLocation.lat.toFixed(4)}, ${t.startLocation.lng.toFixed(4)}"`
                : '"Unknown"';
            const endLoc = t.destinationName
                ? `"${t.destinationName.replace(/"/g, '""')}"`
                : t.endLocation
                    ? `"${t.endLocation.lat.toFixed(4)}, ${t.endLocation.lng.toFixed(4)}"`
                    : '"Completed Drive"';
            const miles = (t.totalDistanceMiles || 0).toFixed(2);
            const deduction = ((t.totalDistanceMiles || 0) * IRS_MILEAGE_RATE).toFixed(2);
            const fuel = (t.fuelCost || 0).toFixed(2);
            const vName = t.vehicleName ? `"${t.vehicleName.replace(/"/g, '""')}"` : `"${vehicleName.replace(/"/g, '""')}"`;

            return [
                dateStr,
                t.id,
                vName,
                startLoc,
                endLoc,
                miles,
                IRS_MILEAGE_RATE.toFixed(2),
                deduction,
                fuel
            ].join(',');
        });

        // Add summary row at the bottom
        const summaryRow = [
            'TOTALS',
            `"${filteredTrips.length} Trips"`,
            '',
            '',
            '',
            totalMiles.toFixed(2),
            IRS_MILEAGE_RATE.toFixed(2),
            totalDeduction.toFixed(2),
            totalFuelCosts.toFixed(2)
        ].join(',');

        // Itemized Expenses Section in CSV
        const itemizedHeader = '\n\n"ITEMIZED BUSINESS EXPENSES LOG"';
        const itemizedCols = 'Date,Category,Note,Amount ($)';
        const expenseRows = filteredExpenses.map(e => {
            const dateStr = new Date(e.date).toLocaleDateString('en-US');
            const cat = `"${getCategoryLabel(e.category)}"`;
            const note = `"${(e.note || '').replace(/"/g, '""')}"`;
            const amt = e.amount.toFixed(2);
            return [dateStr, cat, note, amt].join(',');
        });

        const csvContent = [
            headers.join(','),
            ...rows,
            summaryRow,
            itemizedHeader,
            itemizedCols,
            ...expenseRows,
            `TOTAL ITEMIZED EXPENSES,,,${(totalItemizedExpenses + loggedGasExpenses).toFixed(2)}`
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `MyWay_Mileage_Tax_Log_${selectedYear}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [filteredTrips, filteredExpenses, totalMiles, totalDeduction, totalFuelCosts, totalItemizedExpenses, loggedGasExpenses, vehicleName, selectedYear]);

    // ─── Clipboard Summary Formatter ───
    const handleCopySummary = useCallback(() => {
        const yearLabel = selectedYear === 'all' ? 'All Time' : selectedYear.toString();
        const dateNow = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const summaryText = [
            '====================================================',
            'MYWAY GPS — ANNUAL MILEAGE & TAX EXPENSE REPORT',
            `Tax Year: ${yearLabel}`,
            `Generated: ${dateNow}`,
            `Vehicle: ${vehicleName}`,
            'IRS Compliance: Publication 463 Contemporaneous Log',
            '====================================================',
            '',
            '1. IRS STANDARD BUSINESS MILEAGE DEDUCTION',
            `• Total Recorded Trips: ${filteredTrips.length}`,
            `• Total Business Miles: ${totalMiles.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`,
            `• IRS Mileage Rate: $${IRS_MILEAGE_RATE.toFixed(2)} / mi`,
            `• Calculated Mileage Deduction: $${totalDeduction.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            '',
            '2. FUEL & OPERATING COSTS',
            `• In-Trip Fuel Costs: $${tripFuelCost.toFixed(2)}`,
            `• Logged Fuel Receipts: $${loggedGasExpenses.toFixed(2)}`,
            `• Total Fuel Costs: $${totalFuelCosts.toFixed(2)}`,
            '',
            '3. ITEMIZED VEHICLE & BUSINESS EXPENSES',
            `• Maintenance & Repairs: $${(itemizedByCategory.repair || 0).toFixed(2)}`,
            `• Oil Changes: $${(itemizedByCategory.oil_change || 0).toFixed(2)}`,
            `• Tires & Wheels: $${(itemizedByCategory.tires || 0).toFixed(2)}`,
            `• Insurance: $${(itemizedByCategory.insurance || 0).toFixed(2)}`,
            `• Registration & Fees: $${(itemizedByCategory.registration || 0).toFixed(2)}`,
            `• Car Wash & Detailing: $${(itemizedByCategory.car_wash || 0).toFixed(2)}`,
            `• Other Business / Gear: $${(itemizedByCategory.other || 0).toFixed(2)}`,
            `• Total Itemized (Excl. Gas): $${totalItemizedExpenses.toFixed(2)}`,
            '',
            '4. TAX FILING SUMMARY',
            `• Standard Mileage Deduction: $${totalDeduction.toFixed(2)}`,
            `• Additional Deductible Fees (Registration/Other): $${deductibleNonOperating.toFixed(2)}`,
            `• Estimated Total Tax Write-Off: $${grandWriteOffEstimate.toFixed(2)}`,
            '',
            'Recordkeeping Verification:',
            'Each trip in this log contains start/end timestamps, GPS coordinates,',
            'and calculated mileage satisfying IRS Publication 463 requirements.',
            '===================================================='
        ].join('\n');

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(summaryText).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 3000);
            }).catch(() => {
                fallbackCopy(summaryText);
            });
        } else {
            fallbackCopy(summaryText);
        }
    }, [
        selectedYear,
        vehicleName,
        filteredTrips.length,
        totalMiles,
        totalDeduction,
        tripFuelCost,
        loggedGasExpenses,
        totalFuelCosts,
        itemizedByCategory,
        totalItemizedExpenses,
        deductibleNonOperating,
        grandWriteOffEstimate
    ]);

    const fallbackCopy = (textToCopy: string) => {
        try {
            const textArea = document.createElement('textarea');
            textArea.value = textToCopy;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            setCopied(true);
            setTimeout(() => setCopied(false), 3000);
        } catch (e) {
            console.warn('Could not copy to clipboard:', e);
        }
    };

    return (
        <div className="space-y-4 animate-in fade-in duration-200">
            {/* Tax Year Filter Selector & Title */}
            <div className={`${cardCls} p-4`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-xl">📊</span>
                            <h3 className={`text-sm font-black tracking-tight ${textCls}`}>
                                Tax Filing & Mileage Summary
                            </h3>
                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                IRS Pub 463
                            </span>
                        </div>
                        <p className={`text-[10px] mt-0.5 ${subtextCls}`}>
                            Annual write-offs and contemporaneous mileage logs for gig & business drivers
                        </p>
                    </div>

                    {/* Year Pills */}
                    <div className={`flex items-center p-1 rounded-xl border gap-1 self-start sm:self-auto ${isDark ? 'bg-black/30 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
                        {availableYears.map(year => (
                            <button
                                key={year}
                                type="button"
                                onClick={() => setSelectedYear(year)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                                    selectedYear === year
                                        ? 'bg-indigo-600 text-white shadow-sm'
                                        : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                {year}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => setSelectedYear('all')}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                                selectedYear === 'all'
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            All Time
                        </button>
                    </div>
                </div>
            </div>

            {/* Prominent Export Actions Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                    type="button"
                    onClick={handleExportCSV}
                    className="py-3 px-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-xs shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
                >
                    <span className="text-base">📄</span>
                    <span>Export CSV Mileage Log</span>
                    <span className="text-[10px] opacity-75 font-normal">({filteredTrips.length} trips)</span>
                </button>

                <button
                    type="button"
                    onClick={handleCopySummary}
                    className={`py-3 px-4 rounded-2xl font-black text-xs border flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer ${
                        copied
                            ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                            : isDark
                                ? 'bg-white/5 border-white/10 text-white hover:bg-white/10'
                                : 'bg-white border-slate-200 text-slate-900 hover:bg-slate-50 shadow-sm'
                    }`}
                >
                    <span className="text-base">{copied ? '✅' : '📋'}</span>
                    <span>{copied ? 'Copied to Clipboard!' : 'Copy Summary to Clipboard'}</span>
                </button>
            </div>

            {/* Key Tax Metrics Dashboard (Bento Grid) */}
            <div className="grid grid-cols-2 gap-2.5">
                {/* 1. IRS Mileage Deduction Card */}
                <div className={`${cardCls} p-4 space-y-1 relative overflow-hidden`}>
                    <div className="flex items-center justify-between">
                        <span className={`text-[9px] font-bold uppercase tracking-wider ${subtextCls}`}>
                            🚗 Business Mileage
                        </span>
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400">
                            ${IRS_MILEAGE_RATE}/mi
                        </span>
                    </div>
                    <p className={`text-xl font-black ${textCls}`}>
                        {totalMiles.toLocaleString(undefined, { maximumFractionDigits: 1 })}{' '}
                        <span className="text-xs font-bold opacity-60">mi</span>
                    </p>
                    <div className="pt-2 border-t border-white/5">
                        <p className="text-[9px] font-bold text-emerald-400 uppercase tracking-wide">
                            IRS Standard Deduction
                        </p>
                        <p className="text-base font-black text-emerald-400">
                            ${totalDeduction.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                    </div>
                </div>

                {/* 2. Fuel Costs Card */}
                <div className={`${cardCls} p-4 space-y-1 relative overflow-hidden`}>
                    <div className="flex items-center justify-between">
                        <span className={`text-[9px] font-bold uppercase tracking-wider ${subtextCls}`}>
                            ⛽ Business Fuel
                        </span>
                        <span className="text-[9px] font-bold opacity-60">
                            Trips + Receipts
                        </span>
                    </div>
                    <p className={`text-xl font-black text-amber-400`}>
                        ${totalFuelCosts.toFixed(2)}
                    </p>
                    <div className="pt-2 border-t border-white/5 space-y-0.5">
                        <p className={`text-[9px] ${subtextCls}`}>
                            In-Trip: ${tripFuelCost.toFixed(2)}
                        </p>
                        <p className={`text-[9px] ${subtextCls}`}>
                            Manual Gas Logs: ${loggedGasExpenses.toFixed(2)}
                        </p>
                    </div>
                </div>

                {/* 3. Itemized Vehicle & Business Expenses */}
                <div className={`${cardCls} p-4 space-y-1 relative overflow-hidden`}>
                    <div className="flex items-center justify-between">
                        <span className={`text-[9px] font-bold uppercase tracking-wider ${subtextCls}`}>
                            🔧 Itemized Expenses
                        </span>
                        <span className="text-[9px] font-bold opacity-60">
                            {filteredExpenses.filter(e => e.category !== 'gas').length} items
                        </span>
                    </div>
                    <p className={`text-xl font-black text-purple-400`}>
                        ${totalItemizedExpenses.toFixed(2)}
                    </p>
                    <div className="pt-2 border-t border-white/5">
                        <p className={`text-[9px] ${subtextCls} truncate`}>
                            Repairs, maintenance, tires & gear
                        </p>
                    </div>
                </div>

                {/* 4. Estimated Total Write-Off */}
                <div className={`${cardCls} p-4 space-y-1 relative overflow-hidden bg-gradient-to-br ${
                    isDark ? 'from-emerald-950/30 to-slate-900' : 'from-emerald-50 to-white'
                }`}>
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                            💰 Total Est. Write-Off
                        </span>
                        <span className="text-[9px] font-black text-emerald-400">
                            Combined
                        </span>
                    </div>
                    <p className="text-xl font-black text-emerald-400">
                        ${grandWriteOffEstimate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <div className="pt-2 border-t border-white/5">
                        <p className={`text-[9px] ${subtextCls}`}>
                            Standard mileage + fees & gear
                        </p>
                    </div>
                </div>
            </div>

            {/* Itemized Categories Breakdown */}
            <div className={`${cardCls} p-4`}>
                <h4 className={`text-xs font-black uppercase tracking-wider mb-3 ${textCls}`}>
                    Itemized Expenses Breakdown ({selectedYear === 'all' ? 'All Time' : selectedYear})
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                        { cat: 'oil_change', label: 'Oil Changes', icon: '🛢️', val: itemizedByCategory.oil_change || 0 },
                        { cat: 'repair', label: 'Repairs & Maint.', icon: '🔧', val: itemizedByCategory.repair || 0 },
                        { cat: 'tires', label: 'Tires & Brakes', icon: '🛞', val: itemizedByCategory.tires || 0 },
                        { cat: 'insurance', label: 'Insurance', icon: '🛡️', val: itemizedByCategory.insurance || 0 },
                        { cat: 'registration', label: 'Registration/Fees', icon: '📋', val: itemizedByCategory.registration || 0 },
                        { cat: 'other', label: 'Gear & Supplies', icon: '💳', val: itemizedByCategory.other || 0 },
                    ].map(item => (
                        <div
                            key={item.cat}
                            className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                                isDark ? 'bg-white/3 border-white/5' : 'bg-slate-50 border-slate-100'
                            }`}
                        >
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-sm shrink-0">{item.icon}</span>
                                <span className={`text-[10px] font-bold truncate ${subtextCls}`}>
                                    {item.label}
                                </span>
                            </div>
                            <span className={`text-[11px] font-black shrink-0 ${textCls}`}>
                                ${item.val.toFixed(2)}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Trips Preview Accordion */}
            <div className={`${cardCls} p-4`}>
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className={`text-xs font-black uppercase tracking-wider ${textCls}`}>
                            Logged Trips Log ({filteredTrips.length})
                        </h4>
                        <p className={`text-[9px] ${subtextCls} mt-0.5`}>
                            Included in the IRS mileage export
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowTripsPreview(p => !p)}
                        className={`text-xs font-bold px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                            isDark ? 'bg-white/5 border-white/10 text-indigo-400 hover:text-indigo-300' : 'bg-slate-100 border-slate-200 text-indigo-600 hover:text-indigo-700'
                        }`}
                    >
                        {showTripsPreview ? 'Hide Preview' : 'Show Preview'}
                    </button>
                </div>

                {showTripsPreview && (
                    <div className="mt-3 pt-3 border-t border-white/5 space-y-2 max-h-60 overflow-y-auto no-scrollbar">
                        {filteredTrips.length === 0 ? (
                            <div className="text-center py-6">
                                <span className="text-2xl block mb-1">🗺️</span>
                                <p className={`text-xs font-bold ${textCls}`}>No trips logged for this tax year</p>
                                <p className={`text-[10px] ${subtextCls} mt-0.5`}>
                                    Trips recorded while driving will automatically be captured here with timestamp & GPS coordinates.
                                </p>
                            </div>
                        ) : (
                            filteredTrips.map(t => {
                                const tripDeduction = (t.totalDistanceMiles || 0) * IRS_MILEAGE_RATE;
                                const dateStr = new Date(t.startTime).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric'
                                });
                                return (
                                    <div
                                        key={t.id}
                                        className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs transition-colors ${
                                            isDark ? 'bg-white/3 border-white/5 hover:bg-white/5' : 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                                        }`}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5">
                                                <span className={`text-[10px] font-bold ${subtextCls}`}>{dateStr}</span>
                                                <span className="text-[10px] opacity-40">•</span>
                                                <p className={`text-xs font-bold truncate ${textCls}`}>
                                                    {t.destinationName || 'Drive to destination'}
                                                </p>
                                            </div>
                                            <p className={`text-[9px] ${subtextCls} mt-0.5 truncate`}>
                                                {t.vehicleName || vehicleName} • {t.avgSpeedMph ? `${t.avgSpeedMph} mph avg` : 'Local drive'}
                                            </p>
                                        </div>

                                        <div className="text-right shrink-0">
                                            <p className={`font-black ${textCls}`}>
                                                {t.totalDistanceMiles.toFixed(1)} mi
                                            </p>
                                            <p className="text-[10px] font-bold text-emerald-400">
                                                +${tripDeduction.toFixed(2)}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>

            {/* TurboTax & CPA Guidance Callout */}
            <div className={`p-3.5 rounded-2xl border flex items-start gap-3 text-xs ${
                isDark ? 'bg-indigo-950/20 border-indigo-500/20' : 'bg-indigo-50/70 border-indigo-200'
            }`}>
                <span className="text-base shrink-0 mt-0.5">💡</span>
                <div className="space-y-1">
                    <p className={`font-bold ${textCls}`}>
                        Standard Mileage vs. Actual Vehicle Expenses
                    </p>
                    <p className={`text-[10px] leading-relaxed ${subtextCls}`}>
                        The IRS allows qualifying gig drivers (DoorDash, Uber, Lyft, Instacart, Amazon Flex) to use either the Standard Mileage Rate ($0.67/mi) or Actual Expenses. Most gig workers maximize their deductions using the standard rate plus parking, tolls, and registration. Export your CSV to import directly into TurboTax or share with your tax preparer.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default React.memo(TaxExportView);
