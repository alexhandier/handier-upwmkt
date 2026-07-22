import {useCallback} from 'react';
import {ArrowSquareOut, Check, X, PencilLine, SkipForward} from '@phosphor-icons/react';
import {JOB_FIELDS, STATUSES, PRIORITIES} from '../lib/fields';
import {formatBudget, formatTimeAgo} from '../lib/hooks';
import {safeGetString, safeGetValue} from '../lib/safe';
import TemplateQuickPicker from './TemplateQuickPicker';

const COVER_LETTER_TYPES = ['template', 'personalized'];
const BOOST_OPTIONS = ['yes', 'no', 'outbid'];

export default function JobDetail({record, table, onSkip, onQualify, onDiscard, onPriority, onCoverLetter, onApplyTemplate}) {
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
    const searchLabel = record.getCellValueAsString(JOB_FIELDS.SEARCH_LABEL);
    const proposalViewed = safeGetString(record, JOB_FIELDS.PROPOSAL_VIEWED);
    const proposalIgnored = safeGetString(record, JOB_FIELDS.PROPOSAL_IGNORED);
    const coverLetterType = safeGetString(record, JOB_FIELDS.COVER_LETTER_TYPE);
    const boosted = safeGetString(record, JOB_FIELDS.BOOSTED);

    const isActionable = status === STATUSES.NEW_JOBS;
    const isSubmittedOrEngaged = status === STATUSES.SUBMITTED || status === STATUSES.ENGAGED;

    const updateField = useCallback(async (field, value) => {
        if (!table.hasPermissionToUpdateRecord(record)) return;
        await table.updateRecordAsync(record, {[field]: value});
    }, [table, record]);

    return (
        <div className="px-5 py-4">
            {/* Action bar */}
            <div className="flex items-center gap-2 mb-4">
                {isActionable && (
                    <>
                        <ActionButton
                            onClick={onQualify}
                            icon={<Check size={14} weight="bold" />}
                            label="Qualify"
                            variant="primary"
                        />
                        <ActionButton
                            onClick={onDiscard}
                            icon={<X size={14} weight="bold" />}
                            label="Discard"
                            variant="ghost"
                        />
                        {onSkip && (
                            <ActionButton
                                onClick={onSkip}
                                icon={<SkipForward size={14} />}
                                label="Skip"
                                variant="ghost"
                            />
                        )}
                    </>
                )}

                <ActionButton
                    onClick={onCoverLetter}
                    icon={<PencilLine size={14} />}
                    label={coverLetter ? 'Edit Cover Letter' : 'Write Cover Letter'}
                    variant="ghost"
                />
                <TemplateQuickPicker onApply={onApplyTemplate} />

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
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300 transition-colors ml-2"
                    >
                        <ArrowSquareOut size={14} />
                        Upwork
                    </a>
                )}
            </div>

            {/* Title + meta */}
            <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-sm font-semibold leading-tight">{title}</h2>
                {searchLabel && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-gray75 dark:bg-gray-gray700 text-gray-gray500 dark:text-gray-gray400 shrink-0">{searchLabel}</span>
                )}
            </div>
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
                <p className="text-xs text-gray-gray500 dark:text-gray-gray400 mb-4 italic">
                    {summary}
                </p>
            )}

            {/* Discard reason */}
            {status === STATUSES.DISCARDED && discardComment && (
                <div className="flex items-start gap-2 text-xs text-red-redDark1 dark:text-red-redLight1 bg-red-redLight3 dark:bg-red-red/10 rounded-md px-3 py-2 mb-4">
                    <X size={12} weight="bold" className="mt-0.5 shrink-0" />
                    <span>{discardComment}</span>
                </div>
            )}

            {/* Client info */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-gray400 dark:text-gray-gray500 mb-4 pb-4 border-b border-gray-gray75 dark:border-gray-gray700">
                <ClientStat label="Country" value={clientCountry} />
                <ClientStat label="Hires" value={clientHires} />
                <ClientStat label="Spent" value={clientSpent != null ? `$${Number(clientSpent).toLocaleString()}` : null} />
                <ClientStat label="Feedback" value={clientFeedback != null ? `${clientFeedback}/5` : null} />
                {clientVerified && <span className="text-green-green">Verified</span>}
            </div>

            {/* Skills */}
            {skills && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                    {skills.split(',').map((s, i) => (
                        <span
                            key={i}
                            className="text-xs px-2 py-0.5 rounded-full bg-gray-gray75 dark:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300"
                        >
                            {s.trim()}
                        </span>
                    ))}
                </div>
            )}

            {/* Description */}
            <div className="text-xs text-gray-gray600 dark:text-gray-gray300 leading-relaxed whitespace-pre-wrap mb-4">
                {description}
            </div>

            {/* Cover Letter (read-only display) */}
            {coverLetter && (
                <div className="border-t border-gray-gray75 dark:border-gray-gray700 pt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-gray400 mb-2">
                        Cover Letter
                    </h3>
                    <div className="text-xs text-gray-gray600 dark:text-gray-gray300 whitespace-pre-wrap">
                        {coverLetter}
                    </div>
                </div>
            )}

            {/* Proposal tracking — visible for Submitted / Engaged */}
            {isSubmittedOrEngaged && (
                <div className="border-t border-gray-gray75 dark:border-gray-gray700 pt-4 mt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-gray400 mb-3">
                        Proposal Tracking
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                        <ToggleChip
                            label="Viewed"
                            active={proposalViewed === 'yes'}
                            onClick={() => updateField(JOB_FIELDS.PROPOSAL_VIEWED, proposalViewed === 'yes' ? 'no' : 'yes')}
                        />
                        <ToggleChip
                            label="Ignored"
                            active={proposalIgnored === 'yes'}
                            onClick={() => updateField(JOB_FIELDS.PROPOSAL_IGNORED, proposalIgnored === 'yes' ? 'no' : 'yes')}
                        />
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-gray400 dark:text-gray-gray500">Letter</span>
                            {COVER_LETTER_TYPES.map(t => (
                                <button
                                    key={t}
                                    onClick={() => updateField(JOB_FIELDS.COVER_LETTER_TYPE, t)}
                                    className={`text-xs px-2 py-0.5 rounded-md transition-colors ${
                                        coverLetterType === t
                                            ? 'bg-gray-gray100 dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200 font-medium'
                                            : 'text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300'
                                    }`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-gray400 dark:text-gray-gray500">Boosted</span>
                            {BOOST_OPTIONS.map(b => (
                                <button
                                    key={b}
                                    onClick={() => updateField(JOB_FIELDS.BOOSTED, b)}
                                    className={`text-xs px-2 py-0.5 rounded-md transition-colors ${
                                        boosted === b
                                            ? 'bg-gray-gray100 dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200 font-medium'
                                            : 'text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300'
                                    }`}
                                >
                                    {b}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function ActionButton({onClick, icon, label, variant}) {
    const base = variant === 'primary'
        ? 'bg-gray-gray900 dark:bg-white text-white dark:text-gray-gray900 hover:opacity-90'
        : 'text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300 hover:bg-gray-gray75 dark:hover:bg-gray-gray700';
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-all ${base}`}
        >
            {icon}
            {label}
        </button>
    );
}

function StatusBadge({status}) {
    const colorMap = {
        'New Jobs': 'bg-blue-blueLight2 text-blue-blueDark1 dark:bg-blue-blue/20 dark:text-blue-blueLight1',
        'Qualified': 'bg-green-greenLight2 text-green-greenDark1 dark:bg-green-green/20 dark:text-green-greenLight1',
        'Send': 'bg-yellow-yellowLight2 text-yellow-yellowDark1 dark:bg-yellow-yellow/20 dark:text-yellow-yellowLight1',
        'Submitted': 'bg-orange-orangeLight2 text-orange-orangeDark1 dark:bg-orange-orange/20 dark:text-orange-orangeLight1',
        'Engaged': 'bg-purple-purpleLight2 text-purple-purpleDark1 dark:bg-purple-purple/20 dark:text-purple-purpleLight1',
        'Discarded': 'bg-gray-gray100 text-gray-gray500 dark:bg-gray-gray700 dark:text-gray-gray400',
    };
    return (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorMap[status] || 'bg-gray-gray100 text-gray-gray500'}`}>
            {status}
        </span>
    );
}

function ToggleChip({label, active, onClick}) {
    return (
        <button
            onClick={onClick}
            className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                active
                    ? 'bg-blue-blueLight2 text-blue-blueDark1 dark:bg-blue-blue/20 dark:text-blue-blueLight1'
                    : 'bg-gray-gray50 dark:bg-gray-gray800 text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300'
            }`}
        >
            {label}
        </button>
    );
}

function ClientStat({label, value}) {
    if (!value) return null;
    return (
        <span>
            <span className="text-gray-gray300 dark:text-gray-gray600">{label}</span>{' '}
            {value}
        </span>
    );
}
