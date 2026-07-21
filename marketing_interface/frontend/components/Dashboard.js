import {useState, useMemo} from 'react';
import {JOB_FIELDS, STATUSES} from '../lib/fields';

const CONNECT_RATE = 0.15;

const RANGES = [
    {id: 'today', label: 'Today', days: 1},
    {id: '7d', label: '7 days', days: 7},
    {id: '30d', label: '30 days', days: 30},
    {id: '90d', label: '90 days', days: 90},
    {id: 'all', label: 'All', days: null},
];

function getDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

export default function Dashboard({records}) {
    const [range, setRange] = useState('30d');

    const data = useMemo(() => {
        if (!records) return null;

        const rangeDef = RANGES.find(r => r.id === range);
        const now = new Date();
        const cutoff = rangeDef.days ? startOfDay(new Date(now.getTime() - rangeDef.days * 86400000)) : null;

        const filtered = cutoff
            ? records.filter(r => {
                const fetched = r.getCellValue(JOB_FIELDS.FETCHED_AT);
                return fetched && new Date(fetched) >= cutoff;
            })
            : records;

        const counts = {};
        Object.values(STATUSES).forEach(s => counts[s] = 0);
        let totalConnects = 0;

        for (const r of filtered) {
            const status = r.getCellValueAsString(JOB_FIELDS.STATUS);
            if (counts[status] !== undefined) counts[status]++;
            const connects = r.getCellValue(JOB_FIELDS.CONNECTS_COST);
            if (connects) totalConnects += Number(connects);
        }

        const total = filtered.length;
        const qualified = counts[STATUSES.QUALIFIED] + counts[STATUSES.SEND] + counts[STATUSES.SUBMITTED] + counts[STATUSES.ENGAGED];
        const discarded = counts[STATUSES.DISCARDED];
        const qualifyRate = total > 0 ? ((qualified / total) * 100) : 0;
        const engageRate = qualified > 0 ? ((counts[STATUSES.ENGAGED] / qualified) * 100) : 0;

        // Activity grid: daily counts for the grid period
        const gridDays = rangeDef.days || 90;
        const gridStart = startOfDay(new Date(now.getTime() - (gridDays - 1) * 86400000));
        const dailyCounts = {};
        for (const r of records) {
            const fetched = r.getCellValue(JOB_FIELDS.FETCHED_AT);
            if (!fetched) continue;
            const d = new Date(fetched);
            if (d < gridStart) continue;
            const key = getDateKey(d);
            dailyCounts[key] = (dailyCounts[key] || 0) + 1;
        }

        const days = [];
        for (let i = 0; i < gridDays; i++) {
            const d = new Date(gridStart.getTime() + i * 86400000);
            const key = getDateKey(d);
            days.push({key, date: d, count: dailyCounts[key] || 0});
        }
        const maxCount = Math.max(1, ...days.map(d => d.count));

        return {total, qualified, discarded, counts, totalConnects, qualifyRate, engageRate, days, maxCount};
    }, [records, range]);

    if (!data) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-gray-gray400 text-sm">Loading...</p>
            </div>
        );
    }

    const {total, qualified, discarded, counts, totalConnects, qualifyRate, engageRate, days, maxCount} = data;

    return (
        <div className="h-full overflow-y-auto">
            <div className="px-6 py-5">

                {/* Range filter */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-0.5 bg-gray-gray50 dark:bg-gray-gray800 rounded-md p-0.5">
                        {RANGES.map(r => (
                            <button
                                key={r.id}
                                onClick={() => setRange(r.id)}
                                className={`text-xs px-2.5 py-1 rounded transition-colors ${
                                    range === r.id
                                        ? 'bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200 shadow-sm'
                                        : 'text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300'
                                }`}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Key numbers — single row */}
                <div className="flex items-baseline gap-6 mb-6">
                    <Stat value={total} label="found" />
                    <Stat value={qualified} label="qualified" />
                    <Stat value={counts[STATUSES.SEND]} label="send" />
                    <Stat value={counts[STATUSES.SUBMITTED]} label="submitted" />
                    <Stat value={counts[STATUSES.ENGAGED]} label="engaged" />
                    <Stat value={discarded} label="discarded" dim />
                    <div className="w-px h-5 bg-gray-gray100 dark:bg-gray-gray700" />
                    <Stat value={`${qualifyRate.toFixed(0)}%`} label="qualify rate" />
                    <Stat value={`${engageRate.toFixed(0)}%`} label="engage rate" />
                    <div className="w-px h-5 bg-gray-gray100 dark:bg-gray-gray700" />
                    <Stat value={totalConnects} label="connects" />
                    <Stat value={`$${(totalConnects * CONNECT_RATE).toFixed(0)}`} label="spent" />
                </div>

                {/* Activity grid — GitHub style */}
                <div>
                    <h3 className="text-xs text-gray-gray400 dark:text-gray-gray500 mb-2">
                        {total} jobs found in this period
                    </h3>
                    <div className="flex gap-[3px] flex-wrap">
                        {days.map(day => {
                            const intensity = day.count === 0
                                ? 0
                                : Math.min(4, Math.ceil((day.count / maxCount) * 4));
                            return (
                                <div
                                    key={day.key}
                                    title={`${day.date.toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}: ${day.count} jobs`}
                                    className={`w-[11px] h-[11px] rounded-sm ${INTENSITY[intensity]}`}
                                />
                            );
                        })}
                    </div>
                    <div className="flex items-center gap-1 mt-2">
                        <span className="text-[10px] text-gray-gray400 dark:text-gray-gray500 mr-1">Less</span>
                        {[0, 1, 2, 3, 4].map(i => (
                            <div key={i} className={`w-[11px] h-[11px] rounded-sm ${INTENSITY[i]}`} />
                        ))}
                        <span className="text-[10px] text-gray-gray400 dark:text-gray-gray500 ml-1">More</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

const INTENSITY = [
    'bg-gray-gray75 dark:bg-gray-gray800',
    'bg-green-greenLight2 dark:bg-green-green/20',
    'bg-green-greenLight1 dark:bg-green-green/40',
    'bg-green-green dark:bg-green-green/70',
    'bg-green-greenDark1 dark:bg-green-greenLight1',
];

function Stat({value, label, dim}) {
    return (
        <div className="flex items-baseline gap-1.5">
            <span className={`text-sm font-semibold tabular-nums ${dim ? 'text-gray-gray400 dark:text-gray-gray500' : ''}`}>
                {value}
            </span>
            <span className="text-xs text-gray-gray400 dark:text-gray-gray500">{label}</span>
        </div>
    );
}
