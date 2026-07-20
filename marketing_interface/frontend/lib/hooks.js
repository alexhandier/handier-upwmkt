import {useMemo} from 'react';
import {JOB_FIELDS, STATUSES, PIPELINE_STAGES} from './fields';

export function useJobsByStatus(records) {
    return useMemo(() => {
        const groups = {};
        Object.values(STATUSES).forEach(s => {
            groups[s] = [];
        });
        if (!records) return groups;
        for (const r of records) {
            const status = r.getCellValueAsString(JOB_FIELDS.STATUS) || STATUSES.NEW_JOBS;
            if (!groups[status]) groups[status] = [];
            groups[status].push(r);
        }
        return groups;
    }, [records]);
}

export function usePipelineGroups(records) {
    return useMemo(() => {
        const groups = {};
        PIPELINE_STAGES.forEach(s => {
            groups[s] = [];
        });
        groups['Discarded'] = [];
        if (!records) return groups;
        for (const r of records) {
            const status = r.getCellValueAsString(JOB_FIELDS.STATUS);
            if (PIPELINE_STAGES.includes(status) || status === 'Discarded') {
                groups[status]?.push(r);
            }
        }
        return groups;
    }, [records]);
}

export function formatBudget(record) {
    const budget = record.getCellValue(JOB_FIELDS.BUDGET);
    const hMin = record.getCellValue(JOB_FIELDS.HOURLY_MIN);
    const hMax = record.getCellValue(JOB_FIELDS.HOURLY_MAX);
    if (budget) return `$${Number(budget).toLocaleString()}`;
    if (hMin || hMax) {
        const min = hMin ? `$${hMin}` : '?';
        const max = hMax ? `$${hMax}` : '?';
        return `${min}–${max}/hr`;
    }
    return null;
}

export function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
}
