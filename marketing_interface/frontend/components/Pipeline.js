import {useState, useMemo, useCallback} from 'react';
import {CaretDown, CaretRight, Check, X, PencilLine, ArrowSquareOut, ArrowRight} from '@phosphor-icons/react';
import {JOB_FIELDS, STATUSES, PIPELINE_STAGES, PRIORITIES} from '../lib/fields';
import {formatBudget, formatTimeAgo} from '../lib/hooks';

const STAGE_DOT = {
    'Qualified': 'bg-green-green',
    'Send': 'bg-yellow-yellow',
    'Submitted': 'bg-orange-orange',
    'Engaged': 'bg-purple-purple',
    'Discarded': 'bg-gray-gray400',
};

const STAGE_ORDER = [...PIPELINE_STAGES, 'Discarded'];

export default function Pipeline({table, records}) {
    const [collapsed, setCollapsed] = useState({Discarded: true});
    const [selectedId, setSelectedId] = useState(null);

    const [discardTarget, setDiscardTarget] = useState(null);
    const [discardReason, setDiscardReason] = useState('');

    const [connectsTarget, setConnectsTarget] = useState(null);
    const [connectsCount, setConnectsCount] = useState('');

    const [coverTarget, setCoverTarget] = useState(null);
    const [coverDraft, setCoverDraft] = useState('');

    const groups = useMemo(() => {
        const g = {};
        STAGE_ORDER.forEach(s => g[s] = []);
        if (!records) return g;
        for (const r of records) {
            const status = r.getCellValueAsString(JOB_FIELDS.STATUS);
            if (g[status]) g[status].push(r);
        }
        return g;
    }, [records]);

    const selectedRecord = useMemo(() => {
        if (!selectedId || !records) return null;
        return records.find(r => r.id === selectedId) || null;
    }, [selectedId, records]);

    const toggleCollapse = useCallback((stage) => {
        setCollapsed(prev => ({...prev, [stage]: !prev[stage]}));
    }, []);

    const requestMove = useCallback((record, newStatus) => {
        if (newStatus === STATUSES.SUBMITTED) {
            setConnectsTarget(record);
            setConnectsCount('');
            return;
        }
        moveToStageDirectly(record, newStatus);
    }, []);

    const moveToStageDirectly = useCallback(async (record, newStatus, extraFields) => {
        if (!table.hasPermissionToUpdateRecord(record)) return;
        await table.updateRecordAsync(record, {
            [JOB_FIELDS.STATUS]: {name: newStatus},
            ...extraFields,
        });
        setSelectedId(null);
    }, [table]);

    const confirmSubmitted = useCallback(async () => {
        if (!connectsTarget || !connectsCount) return;
        const cost = Number(connectsCount);
        if (isNaN(cost) || cost <= 0) return;
        await moveToStageDirectly(connectsTarget, STATUSES.SUBMITTED, {
            [JOB_FIELDS.CONNECTS_COST]: cost,
        });
        setConnectsTarget(null);
        setConnectsCount('');
    }, [connectsTarget, connectsCount, moveToStageDirectly]);

    const handlePriority = useCallback(async (record, priority) => {
        if (!table.hasPermissionToUpdateRecord(record)) return;
        await table.updateRecordAsync(record, {
            [JOB_FIELDS.PRIORITY]: {name: priority},
        });
    }, [table]);

    const handleDiscardRequest = useCallback((record) => {
        setDiscardTarget(record);
        setDiscardReason('');
    }, []);

    const confirmDiscard = useCallback(async () => {
        if (!discardTarget || !discardReason.trim()) return;
        if (!table.hasPermissionToUpdateRecord(discardTarget)) return;
        await table.updateRecordAsync(discardTarget, {
            [JOB_FIELDS.STATUS]: {name: STATUSES.DISCARDED},
            [JOB_FIELDS.COMMENTS]: discardReason.trim(),
        });
        setDiscardTarget(null);
        setDiscardReason('');
        setSelectedId(null);
    }, [table, discardTarget, discardReason]);

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

    return (
        <div className="h-full overflow-y-auto relative">
            <div>
                {STAGE_ORDER.map(stage => {
                    const items = groups[stage];
                    const isCollapsed = collapsed[stage];
                    return (
                        <div key={stage}>
                            <button
                                onClick={() => toggleCollapse(stage)}
                                className="flex items-center gap-2 w-full px-5 py-2 sticky top-0 bg-white/95 dark:bg-gray-gray900/95 backdrop-blur-sm z-10 border-b border-gray-gray50 dark:border-gray-gray800"
                            >
                                {isCollapsed
                                    ? <CaretRight size={10} weight="bold" className="text-gray-gray300 dark:text-gray-gray500" />
                                    : <CaretDown size={10} weight="bold" className="text-gray-gray300 dark:text-gray-gray500" />
                                }
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STAGE_DOT[stage]}`} />
                                <span className="text-xs font-semibold text-gray-gray700 dark:text-gray-gray200">
                                    {stage}
                                </span>
                                <span className="text-xs text-gray-gray300 dark:text-gray-gray600 tabular-nums">
                                    {items.length}
                                </span>
                            </button>

                            {!isCollapsed && items.length > 0 && items.map(record => (
                                <PipelineRow
                                    key={record.id}
                                    record={record}
                                    selected={record.id === selectedId}
                                    onClick={() => setSelectedId(record.id)}
                                />
                            ))}

                            {!isCollapsed && items.length === 0 && (
                                <div className="px-5 py-3 text-xs text-gray-gray300 dark:text-gray-gray600">
                                    No jobs
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Job detail modal */}
            {selectedRecord && !discardTarget && !coverTarget && !connectsTarget && (
                <ModalOverlay onClose={() => setSelectedId(null)}>
                    <PipelineJobDetail
                        record={selectedRecord}
                        onClose={() => setSelectedId(null)}
                        onMove={(stage) => requestMove(selectedRecord, stage)}
                        onDiscard={() => handleDiscardRequest(selectedRecord)}
                        onPriority={(p) => handlePriority(selectedRecord, p)}
                        onCoverLetter={() => openCoverModal(selectedRecord)}
                    />
                </ModalOverlay>
            )}

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
                            <button onClick={() => setDiscardTarget(null)} className="text-xs px-3 py-1.5 text-gray-gray400 hover:text-gray-gray600 transition-colors">Cancel</button>
                            <button onClick={confirmDiscard} disabled={!discardReason.trim()} className="text-xs px-3 py-1.5 rounded-md bg-red-red text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40">Discard</button>
                        </div>
                    </div>
                </ModalOverlay>
            )}

            {/* Connects cost modal (Send → Submitted) */}
            {connectsTarget && (
                <ModalOverlay onClose={() => setConnectsTarget(null)}>
                    <div className="w-full max-w-xs">
                        <h3 className="text-sm font-semibold mb-1">Mark as Submitted</h3>
                        <p className="text-xs text-gray-gray400 mb-4 truncate">
                            {connectsTarget.getCellValueAsString(JOB_FIELDS.TITLE)}
                        </p>
                        <label className="block text-xs font-medium text-gray-gray400 dark:text-gray-gray500 mb-1">Connects spent</label>
                        <input
                            type="number"
                            value={connectsCount}
                            onChange={e => setConnectsCount(e.target.value)}
                            placeholder="e.g. 16"
                            min="1"
                            className="w-full text-sm border border-gray-gray200 dark:border-gray-gray600 rounded-md px-3 py-2 bg-transparent focus:outline-none focus:border-orange-orange mb-3 tabular-nums"
                            autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setConnectsTarget(null)} className="text-xs px-3 py-1.5 text-gray-gray400 hover:text-gray-gray600 transition-colors">Cancel</button>
                            <button onClick={confirmSubmitted} disabled={!connectsCount || Number(connectsCount) <= 0} className="text-xs px-3 py-1.5 rounded-md bg-gray-gray900 dark:bg-white text-white dark:text-gray-gray900 font-medium hover:opacity-90 transition-opacity disabled:opacity-40">Submit</button>
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
                            <button onClick={() => setCoverTarget(null)} className="text-xs px-3 py-1.5 text-gray-gray400 hover:text-gray-gray600 transition-colors">Cancel</button>
                            <button onClick={saveCoverLetter} className="text-xs px-3 py-1.5 rounded-md bg-gray-gray900 dark:bg-white text-white dark:text-gray-gray900 font-medium hover:opacity-90 transition-opacity">Save</button>
                        </div>
                    </div>
                </ModalOverlay>
            )}
        </div>
    );
}

function PipelineRow({record, selected, onClick}) {
    const title = record.getCellValueAsString(JOB_FIELDS.TITLE);
    const priority = record.getCellValueAsString(JOB_FIELDS.PRIORITY);
    const budget = formatBudget(record);
    const country = record.getCellValueAsString(JOB_FIELDS.CLIENT_COUNTRY);
    const score = record.getCellValue(JOB_FIELDS.AI_SCORE);
    const summary = record.getCellValueAsString(JOB_FIELDS.SUMMARY);

    return (
        <button
            onClick={onClick}
            className={`w-full text-left px-5 py-2.5 border-b border-gray-gray50 dark:border-gray-gray800 transition-colors ${
                selected ? 'bg-gray-gray50 dark:bg-gray-gray700' : 'hover:bg-gray-gray25 dark:hover:bg-gray-gray800/50'
            }`}
        >
            <div className="flex items-center gap-2">
                <span className="text-sm truncate">{title}</span>
                {priority && (
                    <span className={`text-xs font-medium shrink-0 ${
                        priority === 'P1' ? 'text-red-red'
                        : priority === 'P2' ? 'text-yellow-yellowDark1'
                        : 'text-gray-gray400'
                    }`}>{priority}</span>
                )}
            </div>
            {summary && (
                <p className="text-xs text-gray-gray400 dark:text-gray-gray500 truncate mt-0.5">{summary}</p>
            )}
            <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-gray300 dark:text-gray-gray500">
                {budget && <span>{budget}</span>}
                {country && <span>{country}</span>}
                {score != null && (
                    <span className={`tabular-nums ${score >= 7 ? 'text-green-green' : ''}`}>{score}/10</span>
                )}
            </div>
        </button>
    );
}

function PipelineJobDetail({record, onClose, onMove, onDiscard, onPriority, onCoverLetter}) {
    const title = record.getCellValueAsString(JOB_FIELDS.TITLE);
    const url = record.getCellValueAsString(JOB_FIELDS.URL);
    const description = record.getCellValueAsString(JOB_FIELDS.DESCRIPTION);
    const skills = record.getCellValueAsString(JOB_FIELDS.SKILLS);
    const budget = formatBudget(record);
    const expLevel = record.getCellValueAsString(JOB_FIELDS.EXPERIENCE_LEVEL);
    const applicants = record.getCellValue(JOB_FIELDS.APPLICANTS);
    const clientHires = record.getCellValue(JOB_FIELDS.CLIENT_HIRES);
    const clientSpent = record.getCellValue(JOB_FIELDS.CLIENT_SPENT);
    const clientFeedback = record.getCellValue(JOB_FIELDS.CLIENT_FEEDBACK);
    const clientVerified = record.getCellValue(JOB_FIELDS.CLIENT_VERIFIED);
    const clientCountry = record.getCellValueAsString(JOB_FIELDS.CLIENT_COUNTRY);
    const posted = record.getCellValueAsString(JOB_FIELDS.POSTED_AT);
    const status = record.getCellValueAsString(JOB_FIELDS.STATUS);
    const priority = record.getCellValueAsString(JOB_FIELDS.PRIORITY);
    const aiScore = record.getCellValue(JOB_FIELDS.AI_SCORE);
    const summary = record.getCellValueAsString(JOB_FIELDS.SUMMARY);
    const coverLetter = record.getCellValueAsString(JOB_FIELDS.COVER_LETTER);
    const connectsCost = record.getCellValue(JOB_FIELDS.CONNECTS_COST);
    const discardComment = record.getCellValueAsString(JOB_FIELDS.COMMENTS);

    const nextStages = STAGE_ORDER.filter(s => s !== status && s !== 'Discarded');

    return (
        <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            {/* Actions */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
                {nextStages.map(s => (
                    <button
                        key={s}
                        onClick={() => onMove(s)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-gray-gray75 dark:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300 hover:bg-gray-gray100 dark:hover:bg-gray-gray600 transition-colors"
                    >
                        <ArrowRight size={10} />
                        {s}
                    </button>
                ))}

                <button
                    onClick={onDiscard}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md text-gray-gray400 hover:text-red-red hover:bg-red-redLight3 dark:hover:bg-red-red/10 transition-colors"
                >
                    <X size={10} weight="bold" />
                    Discard
                </button>

                <button
                    onClick={onCoverLetter}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300 hover:bg-gray-gray75 dark:hover:bg-gray-gray700 transition-colors"
                >
                    <PencilLine size={10} />
                    {coverLetter ? 'Edit Letter' : 'Cover Letter'}
                </button>

                <div className="flex items-center gap-1 ml-auto">
                    {PRIORITIES.map(p => (
                        <button
                            key={p}
                            onClick={() => onPriority(p)}
                            className={`text-xs px-2 py-1 rounded-md transition-colors ${
                                priority === p
                                    ? p === 'P1' ? 'bg-red-redLight2 text-red-redDark1 dark:bg-red-red/20 dark:text-red-redLight1'
                                    : p === 'P2' ? 'bg-yellow-yellowLight2 text-yellow-yellowDark1 dark:bg-yellow-yellow/20 dark:text-yellow-yellowLight1'
                                    : 'bg-gray-gray100 text-gray-gray600 dark:bg-gray-gray700 dark:text-gray-gray300'
                                    : 'text-gray-gray400 hover:bg-gray-gray75 dark:hover:bg-gray-gray700'
                            }`}
                        >
                            {p}
                        </button>
                    ))}
                </div>

                {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300 transition-colors">
                        <ArrowSquareOut size={12} />
                        Upwork
                    </a>
                )}
            </div>

            {/* Title + meta */}
            <h2 className="text-sm font-semibold leading-tight mb-1.5">{title}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-gray400 dark:text-gray-gray500 mb-3">
                {aiScore != null && (
                    <span className={`font-medium ${aiScore >= 7 ? 'text-green-green' : aiScore >= 4 ? 'text-yellow-yellowDark1' : 'text-gray-gray400'}`}>
                        {aiScore}/10
                    </span>
                )}
                <StatusBadge status={status} />
                {budget && <span>{budget}</span>}
                {expLevel && <span>{expLevel}</span>}
                {applicants != null && <span>{applicants} applicants</span>}
                {connectsCost != null && <span>{connectsCost} connects</span>}
                {posted && <span>{formatTimeAgo(posted)}</span>}
            </div>

            {summary && (
                <p className="text-xs text-gray-gray500 dark:text-gray-gray400 mb-4 italic">{summary}</p>
            )}

            {status === STATUSES.DISCARDED && discardComment && (
                <div className="flex items-start gap-2 text-xs text-red-redDark1 dark:text-red-redLight1 bg-red-redLight3 dark:bg-red-red/10 rounded-md px-3 py-2 mb-4">
                    <X size={12} weight="bold" className="mt-0.5 shrink-0" />
                    <span>{discardComment}</span>
                </div>
            )}

            {/* Client row */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-gray400 dark:text-gray-gray500 mb-4 pb-3 border-b border-gray-gray75 dark:border-gray-gray700">
                {clientCountry && <span><span className="text-gray-gray300 dark:text-gray-gray600">Country</span> {clientCountry}</span>}
                {clientHires != null && <span><span className="text-gray-gray300 dark:text-gray-gray600">Hires</span> {clientHires}</span>}
                {clientSpent != null && <span><span className="text-gray-gray300 dark:text-gray-gray600">Spent</span> ${Number(clientSpent).toLocaleString()}</span>}
                {clientFeedback != null && <span><span className="text-gray-gray300 dark:text-gray-gray600">Feedback</span> {clientFeedback}/5</span>}
                {clientVerified && <span className="text-green-green">Verified</span>}
            </div>

            {/* Skills */}
            {skills && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                    {skills.split(',').map((s, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-gray-gray75 dark:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300">
                            {s.trim()}
                        </span>
                    ))}
                </div>
            )}

            {/* Description */}
            <div className="text-xs text-gray-gray600 dark:text-gray-gray300 leading-relaxed whitespace-pre-wrap mb-4">
                {description}
            </div>

            {/* Cover letter */}
            {coverLetter && (
                <div className="border-t border-gray-gray75 dark:border-gray-gray700 pt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-gray400 mb-2">Cover Letter</h3>
                    <div className="text-xs text-gray-gray600 dark:text-gray-gray300 whitespace-pre-wrap">{coverLetter}</div>
                </div>
            )}
        </div>
    );
}

function StatusBadge({status}) {
    const colorMap = {
        'Qualified': 'bg-green-greenLight2 text-green-greenDark1 dark:bg-green-green/20 dark:text-green-greenLight1',
        'Send': 'bg-yellow-yellowLight2 text-yellow-yellowDark1 dark:bg-yellow-yellow/20 dark:text-yellow-yellowLight1',
        'Submitted': 'bg-orange-orangeLight2 text-orange-orangeDark1 dark:bg-orange-orange/20 dark:text-orange-orangeLight1',
        'Engaged': 'bg-purple-purpleLight2 text-purple-purpleDark1 dark:bg-purple-purple/20 dark:text-purple-purpleLight1',
        'Discarded': 'bg-gray-gray100 text-gray-gray500 dark:bg-gray-gray700 dark:text-gray-gray400',
    };
    return (
        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${colorMap[status] || 'bg-gray-gray100 text-gray-gray500'}`}>
            {status}
        </span>
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
