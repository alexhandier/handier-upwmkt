import {useState, useMemo, useCallback, useRef} from 'react';
import {useGlobalConfig} from '@airtable/blocks/interface/ui';
import {Check, X, CaretDown, Prohibit, MagnifyingGlass, SkipForward} from '@phosphor-icons/react';
import {JOB_FIELDS, STATUSES, PRIORITIES} from '../lib/fields';
import {formatBudget, formatTimeAgo} from '../lib/hooks';
import JobDetail from './JobDetail';
import CoverLetterModal from './CoverLetterModal';

const SWIPE_THRESHOLD = 80;

export default function Inbox({table, records}) {
    const [selectedId, setSelectedId] = useState(null);
    const [filter, setFilter] = useState('all');
    const [sortBy, setSortBy] = useState('recent');
    const [search, setSearch] = useState('');

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
        const q = search.trim().toLowerCase();
        return records
            .filter(r => {
                const status = r.getCellValueAsString(JOB_FIELDS.STATUS);
                if (filter === 'all' && status !== STATUSES.NEW_JOBS) return false;
                if (filter === 'qualified' && status !== STATUSES.QUALIFIED) return false;
                if (filter === 'discarded' && status !== STATUSES.DISCARDED) return false;
                if (q) {
                    const title = r.getCellValueAsString(JOB_FIELDS.TITLE).toLowerCase();
                    const summary = r.getCellValueAsString(JOB_FIELDS.SUMMARY).toLowerCase();
                    const skills = r.getCellValueAsString(JOB_FIELDS.SKILLS).toLowerCase();
                    const label = r.getCellValueAsString(JOB_FIELDS.SEARCH_LABEL).toLowerCase();
                    if (!title.includes(q) && !summary.includes(q) && !skills.includes(q) && !label.includes(q)) return false;
                }
                return true;
            })
            .sort((a, b) => {
                const scoreA = a.getCellValue(JOB_FIELDS.AI_SCORE) || 0;
                const scoreB = b.getCellValue(JOB_FIELDS.AI_SCORE) || 0;
                const dateA = a.getCellValue(JOB_FIELDS.POSTED_AT);
                const dateB = b.getCellValue(JOB_FIELDS.POSTED_AT);
                const timeA = dateA ? new Date(dateA).getTime() : 0;
                const timeB = dateB ? new Date(dateB).getTime() : 0;
                if (sortBy === 'score') {
                    if (scoreA !== scoreB) return scoreB - scoreA;
                    return timeB - timeA;
                }
                if (timeA !== timeB) return timeB - timeA;
                return scoreB - scoreA;
            });
    }, [records, filter, sortBy, search]);

    const selectedRecord = useMemo(() => {
        if (!selectedId || !records) return null;
        return records.find(r => r.id === selectedId) || null;
    }, [selectedId, records]);

    const handleSelect = useCallback((recordId) => {
        setSelectedId(recordId);
        markAsRead(recordId);
    }, [markAsRead]);

    const handleSkip = useCallback(() => {
        if (!selectedId || filteredJobs.length === 0) return;
        const idx = filteredJobs.findIndex(r => r.id === selectedId);
        const nextIdx = idx + 1 < filteredJobs.length ? idx + 1 : 0;
        const nextId = filteredJobs[nextIdx].id;
        setSelectedId(nextId);
        markAsRead(nextId);
    }, [selectedId, filteredJobs, markAsRead]);

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

    // Confirm discard (with or without comment)
    const confirmDiscard = useCallback(async (skipComment) => {
        if (!discardTarget) return;
        if (!skipComment && !discardReason.trim()) return;
        if (!table.hasPermissionToUpdateRecord(discardTarget)) return;
        const fields = {[JOB_FIELDS.STATUS]: {name: STATUSES.DISCARDED}};
        if (discardReason.trim()) fields[JOB_FIELDS.COMMENTS] = discardReason.trim();
        await table.updateRecordAsync(discardTarget, fields);
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

    // Apply template directly (no modal)
    const applyTemplate = useCallback(async (record, text) => {
        if (!table.hasPermissionToUpdateRecord(record)) return;
        await table.updateRecordAsync(record, {
            [JOB_FIELDS.COVER_LETTER]: text || null,
        });
    }, [table]);

    // Cover letter modal
    const openCoverModal = useCallback((record) => {
        setCoverDraft(record.getCellValueAsString(JOB_FIELDS.COVER_LETTER) || '');
        setCoverTarget(record);
    }, []);

    const saveCoverLetter = useCallback(async (text) => {
        if (!coverTarget) return;
        if (!table.hasPermissionToUpdateRecord(coverTarget)) return;
        await table.updateRecordAsync(coverTarget, {
            [JOB_FIELDS.COVER_LETTER]: text || null,
        });
        setCoverTarget(null);
        setCoverDraft('');
    }, [table, coverTarget]);

    // Resizable left pane
    const [paneWidth, setPaneWidth] = useState(340);
    const dragging = useRef(false);
    const dragStartX = useRef(0);
    const dragStartWidth = useRef(0);

    const onResizeStart = useCallback((e) => {
        e.preventDefault();
        dragging.current = true;
        dragStartX.current = e.clientX;
        dragStartWidth.current = paneWidth;
        const onMove = (ev) => {
            if (!dragging.current) return;
            const dx = ev.clientX - dragStartX.current;
            setPaneWidth(Math.max(240, Math.min(700, dragStartWidth.current + dx)));
        };
        const onUp = () => {
            dragging.current = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [paneWidth]);

    const filterLabel = {all: 'New', qualified: 'Qualified', discarded: 'Discarded'}[filter] || 'New';
    const count = filteredJobs.length;

    return (
        <div className="flex h-full min-h-0 relative">
            {/* Left: Job list */}
            <div style={{width: paneWidth}} className="shrink-0 flex flex-col min-h-0">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-gray100 dark:border-gray-gray700">
                    <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold">{filterLabel}</h2>
                        <span className="text-xs text-gray-gray400 tabular-nums">{count}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-0.5 bg-gray-gray50 dark:bg-gray-gray800 rounded-md p-0.5">
                            <button
                                onClick={() => setSortBy('recent')}
                                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                                    sortBy === 'recent'
                                        ? 'bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200 shadow-sm'
                                        : 'text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300'
                                }`}
                            >
                                Recent
                            </button>
                            <button
                                onClick={() => setSortBy('score')}
                                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                                    sortBy === 'score'
                                        ? 'bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200 shadow-sm'
                                        : 'text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300'
                                }`}
                            >
                                Top rated
                            </button>
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
                </div>

                <div className="relative px-3 py-2 border-b border-gray-gray75 dark:border-gray-gray800">
                    <MagnifyingGlass size={12} className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-gray300 dark:text-gray-gray500" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search jobs..."
                        className="w-full text-xs bg-gray-gray25 dark:bg-gray-gray800 rounded-md pl-7 pr-3 py-1.5 text-gray-gray700 dark:text-gray-gray200 placeholder-gray-gray300 dark:placeholder-gray-gray600 focus:outline-none focus:ring-1 focus:ring-gray-gray200 dark:focus:ring-gray-gray600"
                    />
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

            {/* Resize handle */}
            <div
                onMouseDown={onResizeStart}
                className="w-1 cursor-col-resize hover:bg-blue-blue/30 active:bg-blue-blue/50 transition-colors shrink-0"
            />

            {/* Right: Detail pane */}
            <div className="flex-1 overflow-y-auto min-w-0">
                {selectedRecord ? (
                    <JobDetail
                        record={selectedRecord}
                        table={table}
                        onSkip={handleSkip}
                        onQualify={() => handleQualify(selectedRecord)}
                        onDiscard={() => handleDiscardRequest(selectedRecord)}
                        onPriority={(p) => handlePriority(selectedRecord, p)}
                        onCoverLetter={() => openCoverModal(selectedRecord)}
                        onApplyTemplate={(text) => applyTemplate(selectedRecord, text)}
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
                        <div className="flex items-center justify-between">
                            <button
                                onClick={() => confirmDiscard(true)}
                                className="text-xs text-gray-gray300 dark:text-gray-gray600 hover:text-gray-gray400 dark:hover:text-gray-gray500 transition-colors"
                            >
                                Skip comment
                            </button>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setDiscardTarget(null)}
                                    className="text-xs px-3 py-1.5 text-gray-gray400 hover:text-gray-gray600 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => confirmDiscard(false)}
                                    disabled={!discardReason.trim()}
                                    className="text-xs px-3 py-1.5 rounded-md bg-red-red text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                                >
                                    Discard
                                </button>
                            </div>
                        </div>
                    </div>
                </ModalOverlay>
            )}

            {/* Cover letter modal */}
            {coverTarget && (
                <ModalOverlay onClose={() => setCoverTarget(null)}>
                    <CoverLetterModal
                        jobTitle={coverTarget.getCellValueAsString(JOB_FIELDS.TITLE)}
                        initialDraft={coverDraft}
                        onSave={saveCoverLetter}
                        onClose={() => setCoverTarget(null)}
                    />
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
