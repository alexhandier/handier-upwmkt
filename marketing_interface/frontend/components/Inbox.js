import {useState, useMemo, useCallback, useRef} from 'react';
import {useGlobalConfig} from '@airtable/blocks/interface/ui';
import {Check, X, CaretDown, Prohibit} from '@phosphor-icons/react';
import {JOB_FIELDS, STATUSES, PRIORITIES} from '../lib/fields';
import {formatBudget, formatTimeAgo} from '../lib/hooks';
import JobDetail from './JobDetail';

const SWIPE_THRESHOLD = 80;

export default function Inbox({table, records}) {
    const [selectedId, setSelectedId] = useState(null);
    const [filter, setFilter] = useState('all');

    // Discard modal
    const [discardTarget, setDiscardTarget] = useState(null);
    const [discardReason, setDiscardReason] = useState('');

    // Cover letter modal
    const [coverTarget, setCoverTarget] = useState(null);
    const [coverDraft, setCoverDraft] = useState('');

    // Read tracking via GlobalConfig
    const globalConfig = useGlobalConfig();
    const readIds = useMemo(() => {
        const stored = globalConfig.get('readJobIds');
        return new Set(Array.isArray(stored) ? stored : []);
    }, [globalConfig]);

    const markAsRead = useCallback(async (recordId) => {
        if (readIds.has(recordId)) return;
        const next = [...readIds, recordId];
        if (globalConfig.hasPermissionToSet('readJobIds', next)) {
            await globalConfig.setAsync('readJobIds', next);
        }
    }, [globalConfig, readIds]);

    const filteredJobs = useMemo(() => {
        if (!records) return [];
        return records
            .filter(r => {
                const status = r.getCellValueAsString(JOB_FIELDS.STATUS);
                if (filter === 'all') return status === STATUSES.NEW_JOBS;
                if (filter === 'qualified') return status === STATUSES.QUALIFIED;
                if (filter === 'discarded') return status === STATUSES.DISCARDED;
                return status === STATUSES.NEW_JOBS;
            })
            .sort((a, b) => {
                const scoreA = a.getCellValue(JOB_FIELDS.AI_SCORE) || 0;
                const scoreB = b.getCellValue(JOB_FIELDS.AI_SCORE) || 0;
                return scoreB - scoreA;
            });
    }, [records, filter]);

    const selectedRecord = useMemo(() => {
        if (!selectedId || !records) return null;
        return records.find(r => r.id === selectedId) || null;
    }, [selectedId, records]);

    const handleSelect = useCallback((recordId) => {
        setSelectedId(recordId);
        markAsRead(recordId);
    }, [markAsRead]);

    // Qualify action
    const handleQualify = useCallback(async (record) => {
        if (!table.hasPermissionToUpdateRecord(record)) return;
        await table.updateRecordAsync(record, {
            [JOB_FIELDS.STATUS]: {name: STATUSES.QUALIFIED},
        });
    }, [table]);

    // Open discard modal
    const handleDiscardRequest = useCallback((record) => {
        setDiscardTarget(record);
        setDiscardReason('');
    }, []);

    // Confirm discard
    const confirmDiscard = useCallback(async () => {
        if (!discardTarget || !discardReason.trim()) return;
        if (!table.hasPermissionToUpdateRecord(discardTarget)) return;
        await table.updateRecordAsync(discardTarget, {
            [JOB_FIELDS.STATUS]: {name: STATUSES.DISCARDED},
            [JOB_FIELDS.COMMENTS]: discardReason.trim(),
        });
        setDiscardTarget(null);
        setDiscardReason('');
    }, [table, discardTarget, discardReason]);

    // Priority
    const handlePriority = useCallback(async (record, priority) => {
        if (!table.hasPermissionToUpdateRecord(record)) return;
        await table.updateRecordAsync(record, {
            [JOB_FIELDS.PRIORITY]: {name: priority},
        });
    }, [table]);

    // Cover letter modal
    const openCoverModal = useCallback((record) => {
        const existing = record.getCellValueAsString(JOB_FIELDS.COVER_LETTER) || '';
        setCoverDraft(existing);
        setCoverTarget(record);
    }, []);

    const saveCoverLetter = useCallback(async () => {
        if (!coverTarget) return;
        if (!table.hasPermissionToUpdateRecord(coverTarget)) return;
        await table.updateRecordAsync(coverTarget, {
            [JOB_FIELDS.COVER_LETTER]: coverDraft || null,
        });
        setCoverTarget(null);
        setCoverDraft('');
    }, [table, coverTarget, coverDraft]);

    const filterLabel = {all: 'New', qualified: 'Qualified', discarded: 'Discarded'}[filter] || 'New';
    const count = filteredJobs.length;

    return (
        <div className="flex h-full relative">
            {/* Left: Job list */}
            <div className="w-[340px] shrink-0 border-r border-gray-gray100 dark:border-gray-gray700 flex flex-col">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-gray100 dark:border-gray-gray700">
                    <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold">{filterLabel}</h2>
                        <span className="text-xs text-gray-gray400 tabular-nums">{count}</span>
                    </div>
                    <div className="relative">
                        <select
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                            className="appearance-none bg-transparent text-xs text-gray-gray400 pr-4 cursor-pointer focus:outline-none"
                        >
                            <option value="all">New Jobs</option>
                            <option value="qualified">Qualified</option>
                            <option value="discarded">Discarded</option>
                        </select>
                        <CaretDown size={10} className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-gray400 pointer-events-none" />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {filteredJobs.length === 0 && (
                        <div className="px-4 py-12 text-center text-gray-gray400 text-sm">
                            No jobs to review
                        </div>
                    )}
                    {filteredJobs.map(record => (
                        <SwipeableJobRow
                            key={record.id}
                            record={record}
                            selected={record.id === selectedId}
                            isRead={readIds.has(record.id)}
                            onClick={() => handleSelect(record.id)}
                            onQualify={() => handleQualify(record)}
                            onDiscard={() => handleDiscardRequest(record)}
                        />
                    ))}
                </div>
            </div>

            {/* Right: Detail pane */}
            <div className="flex-1 overflow-y-auto">
                {selectedRecord ? (
                    <JobDetail
                        record={selectedRecord}
                        table={table}
                        onQualify={() => handleQualify(selectedRecord)}
                        onDiscard={() => handleDiscardRequest(selectedRecord)}
                        onPriority={(p) => handlePriority(selectedRecord, p)}
                        onCoverLetter={() => openCoverModal(selectedRecord)}
                    />
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-gray-gray300 dark:text-gray-gray500 text-sm">
                            Select a job to review
                        </p>
                    </div>
                )}
            </div>

            {/* Discard modal */}
            {discardTarget && (
                <ModalOverlay onClose={() => setDiscardTarget(null)}>
                    <div className="w-full max-w-sm">
                        <h3 className="text-sm font-semibold mb-1">Discard job</h3>
                        <p className="text-xs text-gray-gray400 mb-4 truncate">
                            {discardTarget.getCellValueAsString(JOB_FIELDS.TITLE)}
                        </p>
                        <textarea
                            value={discardReason}
                            onChange={e => setDiscardReason(e.target.value)}
                            placeholder="Why are you discarding this?"
                            rows={3}
                            className="w-full text-sm border border-gray-gray200 dark:border-gray-gray600 rounded-md p-3 bg-transparent focus:outline-none focus:border-red-red resize-none mb-3"
                            autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setDiscardTarget(null)}
                                className="text-xs px-3 py-1.5 text-gray-gray400 hover:text-gray-gray600 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDiscard}
                                disabled={!discardReason.trim()}
                                className="text-xs px-3 py-1.5 rounded-md bg-red-red text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                            >
                                Discard
                            </button>
                        </div>
                    </div>
                </ModalOverlay>
            )}

            {/* Cover letter modal */}
            {coverTarget && (
                <ModalOverlay onClose={() => setCoverTarget(null)}>
                    <div className="w-full max-w-lg">
                        <h3 className="text-sm font-semibold mb-1">Cover Letter</h3>
                        <p className="text-xs text-gray-gray400 mb-4 truncate">
                            {coverTarget.getCellValueAsString(JOB_FIELDS.TITLE)}
                        </p>
                        <textarea
                            value={coverDraft}
                            onChange={e => setCoverDraft(e.target.value)}
                            placeholder="Dear client..."
                            rows={12}
                            className="w-full text-sm border border-gray-gray200 dark:border-gray-gray600 rounded-md p-4 bg-transparent focus:outline-none focus:border-blue-blue resize-none mb-3 leading-relaxed"
                            autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setCoverTarget(null)}
                                className="text-xs px-3 py-1.5 text-gray-gray400 hover:text-gray-gray600 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveCoverLetter}
                                className="text-xs px-3 py-1.5 rounded-md bg-gray-gray900 dark:bg-white text-white dark:text-gray-gray900 font-medium hover:opacity-90 transition-opacity"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </ModalOverlay>
            )}
        </div>
    );
}

function ModalOverlay({children, onClose}) {
    return (
        <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white dark:bg-gray-gray800 rounded-lg shadow-xl p-6 mx-4" onClick={e => e.stopPropagation()}>
                {children}
            </div>
        </div>
    );
}

function SwipeableJobRow({record, selected, isRead, onClick, onQualify, onDiscard}) {
    const [offsetX, setOffsetX] = useState(0);
    const [swiping, setSwiping] = useState(false);
    const startX = useRef(0);
    const currentX = useRef(0);
    const rowRef = useRef(null);

    const handlePointerDown = useCallback((e) => {
        startX.current = e.clientX;
        currentX.current = e.clientX;
        setSwiping(true);
        e.currentTarget.setPointerCapture(e.pointerId);
    }, []);

    const handlePointerMove = useCallback((e) => {
        if (!swiping) return;
        currentX.current = e.clientX;
        const dx = currentX.current - startX.current;
        const clamped = Math.max(-120, Math.min(120, dx));
        setOffsetX(clamped);
    }, [swiping]);

    const handlePointerUp = useCallback(() => {
        if (!swiping) return;
        setSwiping(false);
        if (offsetX > SWIPE_THRESHOLD) {
            onQualify();
        } else if (offsetX < -SWIPE_THRESHOLD) {
            onDiscard();
        }
        setOffsetX(0);
    }, [swiping, offsetX, onQualify, onDiscard]);

    const title = record.getCellValueAsString(JOB_FIELDS.TITLE);
    const score = record.getCellValue(JOB_FIELDS.AI_SCORE);
    const budget = formatBudget(record);
    const country = record.getCellValueAsString(JOB_FIELDS.CLIENT_COUNTRY);
    const posted = record.getCellValueAsString(JOB_FIELDS.POSTED_AT);
    const summary = record.getCellValueAsString(JOB_FIELDS.SUMMARY);
    const priority = record.getCellValueAsString(JOB_FIELDS.PRIORITY);
    const status = record.getCellValueAsString(JOB_FIELDS.STATUS);
    const searchLabel = record.getCellValueAsString(JOB_FIELDS.SEARCH_LABEL);
    const isNew = status === STATUSES.NEW_JOBS && !isRead;
    const isDiscarded = status === STATUSES.DISCARDED;

    const swipeRightActive = offsetX > 30;
    const swipeLeftActive = offsetX < -30;

    return (
        <div className="relative overflow-hidden border-b border-gray-gray75 dark:border-gray-gray700">
            {/* Swipe backgrounds */}
            <div className="absolute inset-0 flex">
                <div className={`flex-1 flex items-center pl-4 transition-colors ${
                    swipeRightActive ? 'bg-green-greenLight2 dark:bg-green-green/20' : 'bg-transparent'
                }`}>
                    {swipeRightActive && <Check size={16} weight="bold" className="text-green-greenDark1 dark:text-green-greenLight1" />}
                </div>
                <div className={`flex-1 flex items-center justify-end pr-4 transition-colors ${
                    swipeLeftActive ? 'bg-red-redLight2 dark:bg-red-red/20' : 'bg-transparent'
                }`}>
                    {swipeLeftActive && <Prohibit size={16} weight="bold" className="text-red-redDark1 dark:text-red-redLight1" />}
                </div>
            </div>

            {/* Row content */}
            <button
                ref={rowRef}
                onClick={onClick}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => { setSwiping(false); setOffsetX(0); }}
                style={{transform: `translateX(${offsetX}px)`, transition: swiping ? 'none' : 'transform 0.2s ease-out'}}
                className={`relative w-full text-left px-4 py-3 touch-pan-y select-none
                    ${selected
                        ? 'bg-gray-gray50 dark:bg-gray-gray700'
                        : 'bg-white dark:bg-gray-gray900 hover:bg-gray-gray25 dark:hover:bg-gray-gray800'
                    }
                    ${isDiscarded ? 'opacity-50' : ''}
                `}
            >
                <div className="flex items-start gap-2">
                    {isNew && (
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-blue mt-1.5 shrink-0" />
                    )}
                    {isDiscarded && (
                        <Prohibit size={12} className="text-red-red mt-1 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                            <span className={`text-sm truncate ${isNew ? 'font-medium' : ''}`}>
                                {title}
                            </span>
                            {score != null && (
                                <span className={`text-xs tabular-nums shrink-0 ${
                                    score >= 7 ? 'text-green-green' : score >= 4 ? 'text-yellow-yellowDark1' : 'text-gray-gray400'
                                }`}>
                                    {score}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-gray400 dark:text-gray-gray500 truncate mt-0.5">
                            {summary}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-gray300 dark:text-gray-gray500">
                            {searchLabel && <span className="text-gray-gray400 dark:text-gray-gray500">{searchLabel}</span>}
                            {budget && <span>{budget}</span>}
                            {country && <span>{country}</span>}
                            {posted && <span>{formatTimeAgo(posted)}</span>}
                            {priority && (
                                <span className={`font-medium ${
                                    priority === 'P1' ? 'text-red-red' : priority === 'P2' ? 'text-yellow-yellowDark1' : 'text-gray-gray400'
                                }`}>
                                    {priority}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </button>
        </div>
    );
}
