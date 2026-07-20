import {useState, useMemo, useCallback} from 'react';
import {expandRecord, useGlobalConfig} from '@airtable/blocks/interface/ui';
import {Lightning, LightningSlash, Trash, Plus, ArrowSquareOut, CaretDown, CaretRight, Key, Warning} from '@phosphor-icons/react';
import {MINER_FIELDS, PROMPT_FIELDS} from '../lib/fields';
import {formatTimeAgo} from '../lib/hooks';
import {safeGetString, safeGetValue, hasField} from '../lib/safe';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export default function Miners({minersTable, minerRecords, promptsTable, promptRecords}) {
    const [subTab, setSubTab] = useState('miners');
    const [creatingMiner, setCreatingMiner] = useState(false);
    const [creatingPrompt, setCreatingPrompt] = useState(false);
    const [expandedMinerId, setExpandedMinerId] = useState(null);
    const [expandedPromptId, setExpandedPromptId] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteType, setDeleteType] = useState(null);

    const globalConfig = useGlobalConfig();
    const authUrl = globalConfig.get('authServiceUrl');

    const runStale = useMemo(() => {
        if (!minerRecords || minerRecords.length === 0) return false;
        const activeMiner = minerRecords.find(r => safeGetValue(r, MINER_FIELDS.ACTIVE));
        if (!activeMiner) return false;
        let latestRun = 0;
        for (const r of minerRecords) {
            if (!safeGetValue(r, MINER_FIELDS.ACTIVE)) continue;
            const lr = safeGetString(r, MINER_FIELDS.LAST_RUN);
            if (lr) {
                const ts = new Date(lr).getTime();
                if (ts > latestRun) latestRun = ts;
            }
        }
        if (latestRun === 0) return true;
        return Date.now() - latestRun > STALE_THRESHOLD_MS;
    }, [minerRecords]);

    const handleReauth = useCallback(() => {
        if (authUrl) window.open(authUrl, '_blank');
    }, [authUrl]);

    if (!minersTable || !promptsTable) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-gray-gray400 text-sm">
                    Add the Miners and Prompts tables as data sources.
                </p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-gray100 dark:border-gray-gray700">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setSubTab('miners')}
                        className={`text-sm font-medium transition-colors ${
                            subTab === 'miners' ? 'text-gray-gray900 dark:text-white' : 'text-gray-gray400 hover:text-gray-gray600'
                        }`}
                    >
                        Miners
                    </button>
                    <button
                        onClick={() => setSubTab('prompts')}
                        className={`text-sm font-medium transition-colors ${
                            subTab === 'prompts' ? 'text-gray-gray900 dark:text-white' : 'text-gray-gray400 hover:text-gray-gray600'
                        }`}
                    >
                        Prompts
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleReauth}
                        disabled={!authUrl}
                        title={authUrl ? 'Re-authorize Upwork OAuth' : 'Auth service URL not configured'}
                        className={`relative flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md transition-colors ${
                            authUrl
                                ? 'text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300 hover:bg-gray-gray75 dark:hover:bg-gray-gray700'
                                : 'text-gray-gray300 dark:text-gray-gray600 cursor-not-allowed'
                        }`}
                    >
                        <Key size={12} />
                        Re-auth
                        {runStale && authUrl && (
                            <Warning size={10} weight="fill" className="text-yellow-yellow ml-0.5" />
                        )}
                    </button>
                    <button
                        onClick={() => subTab === 'miners' ? setCreatingMiner(true) : setCreatingPrompt(true)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-gray-gray900 dark:bg-white text-white dark:text-gray-gray900 font-medium hover:opacity-90 transition-opacity"
                    >
                        <Plus size={12} weight="bold" />
                        {subTab === 'miners' ? 'New Miner' : 'New Prompt'}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
                {subTab === 'miners' ? (
                    <MinersList
                        table={minersTable}
                        records={minerRecords}
                        promptRecords={promptRecords}
                        expandedId={expandedMinerId}
                        onToggleExpand={id => setExpandedMinerId(expandedMinerId === id ? null : id)}
                        creating={creatingMiner}
                        onCancelCreate={() => setCreatingMiner(false)}
                        onDeleteRequest={rec => { setDeleteTarget(rec); setDeleteType('miner'); }}
                    />
                ) : (
                    <PromptsList
                        table={promptsTable}
                        records={promptRecords}
                        expandedId={expandedPromptId}
                        onToggleExpand={id => setExpandedPromptId(expandedPromptId === id ? null : id)}
                        creating={creatingPrompt}
                        onCancelCreate={() => setCreatingPrompt(false)}
                        onDeleteRequest={rec => { setDeleteTarget(rec); setDeleteType('prompt'); }}
                    />
                )}
            </div>

            {deleteTarget && (
                <DeleteModal
                    record={deleteTarget}
                    table={deleteType === 'miner' ? minersTable : promptsTable}
                    label={deleteType === 'miner' ? 'miner' : 'prompt'}
                    nameField={deleteType === 'miner' ? MINER_FIELDS.NAME : PROMPT_FIELDS.NAME}
                    onClose={() => { setDeleteTarget(null); setDeleteType(null); }}
                />
            )}
        </div>
    );
}

// ============================================================
// Create Miner
// ============================================================

function CreateMinerForm({table, onCancel}) {
    const [name, setName] = useState('');
    const [searchUrl, setSearchUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const handleCreate = useCallback(async () => {
        if (!name.trim()) return;
        setError(null);
        setSaving(true);
        try {
            const fields = {[MINER_FIELDS.NAME]: name.trim()};
            if (searchUrl.trim()) fields[MINER_FIELDS.SEARCH_URL] = searchUrl.trim();
            fields[MINER_FIELDS.ACTIVE] = true;
            fields[MINER_FIELDS.MAX_PAGES] = 3;
            await table.createRecordAsync(fields);
            onCancel();
        } catch (err) {
            console.error('Create miner failed:', err);
            setError(err.message || 'Failed to create. Check that the extension has write access to the Miners table in the interface settings.');
            setSaving(false);
        }
    }, [table, name, searchUrl, onCancel]);

    return (
        <div className="rounded-lg border-2 border-blue-blue/30 dark:border-blue-blue/20 bg-blue-blueLight3/30 dark:bg-blue-blue/5 p-5 mb-3">
            <h3 className="text-sm font-semibold mb-4">New Miner</h3>
            <div className="space-y-3">
                <Field label="Name">
                    <input value={name} onChange={e => setName(e.target.value)} className="field-input" placeholder="e.g. Web Dev Expert" autoFocus />
                </Field>
                <Field label="Search URL">
                    <input value={searchUrl} onChange={e => setSearchUrl(e.target.value)} className="field-input" placeholder="https://www.upwork.com/nx/search/jobs/?q=..." />
                </Field>
            </div>
            {error && (
                <p className="text-xs text-red-red mt-3">{error}</p>
            )}
            <div className="flex gap-2 mt-4 justify-end">
                <button onClick={onCancel} className="text-xs px-3 py-1.5 text-gray-gray400 hover:text-gray-gray600 transition-colors">Cancel</button>
                <button onClick={handleCreate} disabled={!name.trim() || saving} className="text-xs px-4 py-1.5 rounded-md bg-gray-gray900 dark:bg-white text-white dark:text-gray-gray900 font-medium hover:opacity-90 disabled:opacity-40">{saving ? 'Creating...' : 'Create'}</button>
            </div>
        </div>
    );
}

// ============================================================
// Miners List
// ============================================================

function MinersList({table, records, promptRecords, expandedId, onToggleExpand, creating, onCancelCreate, onDeleteRequest}) {
    const promptMap = useMemo(() => {
        const m = new Map();
        if (promptRecords) promptRecords.forEach(r => m.set(r.id, r));
        return m;
    }, [promptRecords]);

    const toggleActive = useCallback(async (record) => {
        if (!table.hasPermissionToUpdateRecord(record)) return;
        const current = safeGetValue(record, MINER_FIELDS.ACTIVE);
        await table.updateRecordAsync(record, {[MINER_FIELDS.ACTIVE]: !current});
    }, [table]);

    const updateField = useCallback(async (record, field, value) => {
        if (!table.hasPermissionToUpdateRecord(record)) return;
        try {
            await table.updateRecordAsync(record, {[field]: value === '' ? null : value});
        } catch (err) {
            console.error(`Update ${field} failed:`, err);
        }
    }, [table]);

    return (
        <div className="space-y-2">
            {creating && <CreateMinerForm table={table} onCancel={onCancelCreate} />}

            {(!records || records.length === 0) && !creating && (
                <div className="py-12 text-center text-gray-gray400 text-sm">No miners yet</div>
            )}

            {records?.map(record => (
                <MinerCard
                    key={record.id}
                    record={record}
                    promptMap={promptMap}
                    promptRecords={promptRecords}
                    expanded={expandedId === record.id}
                    onToggleExpand={() => onToggleExpand(record.id)}
                    onToggleActive={() => toggleActive(record)}
                    onUpdate={(field, value) => updateField(record, field, value)}
                    onDelete={() => onDeleteRequest(record)}
                />
            ))}
        </div>
    );
}

// ============================================================
// Miner Card
// ============================================================

function MinerCard({record, promptMap, promptRecords, expanded, onToggleExpand, onToggleActive, onUpdate, onDelete}) {
    const name = safeGetString(record, MINER_FIELDS.NAME);
    const searchUrl = safeGetString(record, MINER_FIELDS.SEARCH_URL);
    const searchDesc = safeGetString(record, MINER_FIELDS.SEARCH_DESCRIPTION);
    const offering = safeGetString(record, MINER_FIELDS.OUR_OFFERING);
    const active = safeGetValue(record, MINER_FIELDS.ACTIVE);
    const lastRun = safeGetString(record, MINER_FIELDS.LAST_RUN);
    const jobsFound = safeGetValue(record, MINER_FIELDS.LAST_RUN_JOBS_FOUND);
    const maxPages = safeGetValue(record, MINER_FIELDS.MAX_PAGES);
    const runInterval = safeGetValue(record, MINER_FIELDS.RUN_INTERVAL);
    const superficialLinks = safeGetValue(record, MINER_FIELDS.SUPERFICIAL_PROMPT);
    const deepLinks = safeGetValue(record, MINER_FIELDS.DEEP_PROMPT);

    const sName = superficialLinks?.[0] ? (safeGetString(promptMap.get(superficialLinks[0].id), PROMPT_FIELDS.NAME) || superficialLinks[0].name) : null;
    const dName = deepLinks?.[0] ? (safeGetString(promptMap.get(deepLinks[0].id), PROMPT_FIELDS.NAME) || deepLinks[0].name) : null;

    return (
        <div className={`rounded-lg border transition-colors ${active ? 'border-gray-gray100 dark:border-gray-gray700' : 'border-gray-gray75 dark:border-gray-gray800 opacity-50'}`}>
            <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={onToggleActive} className={`shrink-0 transition-colors ${active ? 'text-green-green' : 'text-gray-gray300 dark:text-gray-gray600'}`} title={active ? 'Active — click to pause' : 'Paused — click to activate'}>
                    {active ? <Lightning size={16} weight="fill" /> : <LightningSlash size={16} />}
                </button>

                <button onClick={onToggleExpand} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                        {expanded ? <CaretDown size={11} className="text-gray-gray400 shrink-0" /> : <CaretRight size={11} className="text-gray-gray400 shrink-0" />}
                        <span className="text-sm font-medium truncate">{name || 'Untitled'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-gray400 dark:text-gray-gray500 mt-0.5 ml-5">
                        {runInterval != null && <span>Every {runInterval}m</span>}
                        {sName && <span>S: {sName}</span>}
                        {dName && <span>D: {dName}</span>}
                        {lastRun && <span>Last: {formatTimeAgo(lastRun)}</span>}
                        {jobsFound != null && <span>{jobsFound} found</span>}
                    </div>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                    {searchUrl && (
                        <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-gray300 hover:text-gray-gray500 dark:text-gray-gray500 dark:hover:text-gray-gray300 transition-colors" title="Open on Upwork">
                            <ArrowSquareOut size={14} />
                        </a>
                    )}
                    <button onClick={onDelete} className="p-1.5 text-gray-gray300 hover:text-red-red dark:text-gray-gray600 dark:hover:text-red-redLight1 transition-colors" title="Delete miner">
                        <Trash size={14} />
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="px-4 pb-4 pt-1 border-t border-gray-gray75 dark:border-gray-gray700 space-y-3">
                    <Field label="Search URL">
                        <EditableText value={searchUrl} placeholder="https://www.upwork.com/nx/search/jobs/?q=..." onSave={v => onUpdate(MINER_FIELDS.SEARCH_URL, v)} />
                    </Field>
                    <Field label="What is this search about?">
                        <EditableText value={searchDesc} placeholder="Brief description of the kind of jobs this query targets..." multiline onSave={v => onUpdate(MINER_FIELDS.SEARCH_DESCRIPTION, v)} />
                    </Field>
                    <Field label="Our offering for this group">
                        <EditableText value={offering} placeholder="What we sell, our strengths, how we differentiate..." multiline onSave={v => onUpdate(MINER_FIELDS.OUR_OFFERING, v)} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Superficial Prompt">
                            <PromptPicker current={superficialLinks} promptRecords={promptRecords} filterType="Superficial" onSelect={id => onUpdate(MINER_FIELDS.SUPERFICIAL_PROMPT, id ? [{id}] : null)} />
                        </Field>
                        <Field label="Deep Prompt">
                            <PromptPicker current={deepLinks} promptRecords={promptRecords} filterType="Deep" onSelect={id => onUpdate(MINER_FIELDS.DEEP_PROMPT, id ? [{id}] : null)} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Run every (minutes)">
                            <EditableText value={runInterval != null ? String(runInterval) : ''} placeholder="60" onSave={v => onUpdate(MINER_FIELDS.RUN_INTERVAL, v ? Number(v) : null)} />
                        </Field>
                        <Field label="Max Pages">
                            <EditableText value={maxPages != null ? String(maxPages) : ''} placeholder="3" onSave={v => onUpdate(MINER_FIELDS.MAX_PAGES, v ? Number(v) : null)} />
                        </Field>
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================================
// Prompts List (full CRUD)
// ============================================================

function PromptsList({table, records, expandedId, onToggleExpand, creating, onCancelCreate, onDeleteRequest}) {
    const updateField = useCallback(async (record, field, value) => {
        if (!table.hasPermissionToUpdateRecord(record)) return;
        try {
            await table.updateRecordAsync(record, {[field]: value === '' ? null : value});
        } catch (err) {
            console.error(`Update prompt ${field} failed:`, err);
        }
    }, [table]);

    return (
        <div className="space-y-2">
            {creating && <CreatePromptForm table={table} onCancel={onCancelCreate} />}

            {(!records || records.length === 0) && !creating && (
                <div className="py-12 text-center text-gray-gray400 text-sm">No prompts yet</div>
            )}

            {records?.map(record => (
                <PromptCard
                    key={record.id}
                    record={record}
                    expanded={expandedId === record.id}
                    onToggleExpand={() => onToggleExpand(record.id)}
                    onUpdate={(field, value) => updateField(record, field, value)}
                    onDelete={() => onDeleteRequest(record)}
                />
            ))}
        </div>
    );
}

// ============================================================
// Create Prompt
// ============================================================

function CreatePromptForm({table, onCancel}) {
    const [name, setName] = useState('');
    const [type, setType] = useState('Superficial');
    const [model, setModel] = useState('gpt-5.4-mini');
    const [body, setBody] = useState('');
    const [threshold, setThreshold] = useState('4');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const handleCreate = useCallback(async () => {
        if (!name.trim()) return;
        setError(null);
        setSaving(true);
        try {
            const fields = {
                [PROMPT_FIELDS.NAME]: name.trim(),
                [PROMPT_FIELDS.TYPE]: {name: type},
                [PROMPT_FIELDS.MODEL]: {name: model},
                [PROMPT_FIELDS.THRESHOLD]: threshold ? Number(threshold) : 4,
            };
            if (body.trim()) fields[PROMPT_FIELDS.SYSTEM_PROMPT] = body.trim();
            await table.createRecordAsync(fields);
            onCancel();
        } catch (err) {
            console.error('Create prompt failed:', err);
            setError(err.message || 'Failed to create. Check that the extension has write access to the Prompts table in the interface settings.');
            setSaving(false);
        }
    }, [table, name, type, model, body, threshold, onCancel]);

    return (
        <div className="rounded-lg border-2 border-purple-purple/30 dark:border-purple-purple/20 bg-purple-purpleLight3/30 dark:bg-purple-purple/5 p-5 mb-3">
            <h3 className="text-sm font-semibold mb-4">New Prompt</h3>
            <div className="space-y-3">
                <Field label="Name">
                    <input value={name} onChange={e => setName(e.target.value)} className="field-input" placeholder="e.g. Web Dev Filter v1" autoFocus />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Type">
                        <select value={type} onChange={e => setType(e.target.value)} className="field-input cursor-pointer">
                            <option value="Superficial">Superficial</option>
                            <option value="Deep">Deep</option>
                        </select>
                    </Field>
                    <Field label="Model">
                        <select value={model} onChange={e => setModel(e.target.value)} className="field-input cursor-pointer">
                            <option value="gpt-5.4-mini">gpt-5.4-mini</option>
                            <option value="gpt-5.4">gpt-5.4</option>
                        </select>
                    </Field>
                </div>
                <Field label="System Prompt">
                    <textarea value={body} onChange={e => setBody(e.target.value)} className="field-input resize-none" rows={6} placeholder="You are a job filter. Rate this job 0-10..." />
                </Field>
                <Field label="Threshold (0-10)">
                    <input value={threshold} onChange={e => setThreshold(e.target.value)} className="field-input" type="number" min="0" max="10" />
                </Field>
            </div>
            {error && (
                <p className="text-xs text-red-red mt-3">{error}</p>
            )}
            <div className="flex gap-2 mt-4 justify-end">
                <button onClick={onCancel} className="text-xs px-3 py-1.5 text-gray-gray400 hover:text-gray-gray600 transition-colors">Cancel</button>
                <button onClick={handleCreate} disabled={!name.trim() || saving} className="text-xs px-4 py-1.5 rounded-md bg-gray-gray900 dark:bg-white text-white dark:text-gray-gray900 font-medium hover:opacity-90 disabled:opacity-40">{saving ? 'Creating...' : 'Create'}</button>
            </div>
        </div>
    );
}

// ============================================================
// Prompt Card (expandable + editable)
// ============================================================

function PromptCard({record, expanded, onToggleExpand, onUpdate, onDelete}) {
    const name = safeGetString(record, PROMPT_FIELDS.NAME);
    const type = safeGetString(record, PROMPT_FIELDS.TYPE);
    const model = safeGetString(record, PROMPT_FIELDS.MODEL);
    const threshold = safeGetValue(record, PROMPT_FIELDS.THRESHOLD);
    const body = safeGetString(record, PROMPT_FIELDS.SYSTEM_PROMPT);
    const fieldsToCheck = safeGetString(record, PROMPT_FIELDS.FIELDS_TO_CHECK);

    return (
        <div className="rounded-lg border border-gray-gray100 dark:border-gray-gray700">
            <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={onToggleExpand} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                        {expanded ? <CaretDown size={11} className="text-gray-gray400 shrink-0" /> : <CaretRight size={11} className="text-gray-gray400 shrink-0" />}
                        <span className="text-sm font-medium">{name || 'Untitled'}</span>
                        {type && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                type === 'Superficial'
                                    ? 'bg-cyan-cyanLight2 text-cyan-cyanDark1 dark:bg-cyan-cyan/20 dark:text-cyan-cyanLight1'
                                    : 'bg-purple-purpleLight2 text-purple-purpleDark1 dark:bg-purple-purple/20 dark:text-purple-purpleLight1'
                            }`}>{type}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-gray400 dark:text-gray-gray500 mt-0.5 ml-5">
                        {model && <span>{model}</span>}
                        {threshold != null && <span>Threshold: {threshold}</span>}
                    </div>
                </button>

                <button onClick={onDelete} className="p-1.5 text-gray-gray300 hover:text-red-red dark:text-gray-gray600 dark:hover:text-red-redLight1 transition-colors shrink-0" title="Delete prompt">
                    <Trash size={14} />
                </button>
            </div>

            {expanded && (
                <div className="px-4 pb-4 pt-1 border-t border-gray-gray75 dark:border-gray-gray700 space-y-3">
                    <Field label="Name">
                        <EditableText value={name} placeholder="Prompt name" onSave={v => onUpdate(PROMPT_FIELDS.NAME, v)} />
                    </Field>
                    <div className="grid grid-cols-3 gap-3">
                        <Field label="Type">
                            <select value={type} onChange={e => onUpdate(PROMPT_FIELDS.TYPE, e.target.value ? {name: e.target.value} : null)} className="field-input cursor-pointer">
                                <option value="Superficial">Superficial</option>
                                <option value="Deep">Deep</option>
                            </select>
                        </Field>
                        <Field label="Model">
                            <select value={model} onChange={e => onUpdate(PROMPT_FIELDS.MODEL, e.target.value ? {name: e.target.value} : null)} className="field-input cursor-pointer">
                                <option value="gpt-5.4-mini">gpt-5.4-mini</option>
                                <option value="gpt-5.4">gpt-5.4</option>
                            </select>
                        </Field>
                        <Field label="Threshold">
                            <EditableText value={threshold != null ? String(threshold) : ''} placeholder="4" onSave={v => onUpdate(PROMPT_FIELDS.THRESHOLD, v ? Number(v) : null)} />
                        </Field>
                    </div>
                    <Field label="System Prompt">
                        <EditableText value={body} placeholder="You are a job filter. Rate this job 0-10..." multiline onSave={v => onUpdate(PROMPT_FIELDS.SYSTEM_PROMPT, v)} />
                    </Field>
                    <Field label="Fields to Check (comma-separated, or ALL)">
                        <EditableText value={fieldsToCheck} placeholder="title, description, skills, budget" onSave={v => onUpdate(PROMPT_FIELDS.FIELDS_TO_CHECK, v)} />
                    </Field>
                </div>
            )}
        </div>
    );
}

// ============================================================
// Shared components
// ============================================================

function PromptPicker({current, promptRecords, filterType, onSelect}) {
    const currentId = current?.[0]?.id || '';
    const options = useMemo(() => {
        if (!promptRecords) return [];
        return promptRecords
            .filter(r => {
                const type = safeGetString(r, PROMPT_FIELDS.TYPE);
                return !filterType || type === filterType;
            })
            .map(r => ({id: r.id, name: safeGetString(r, PROMPT_FIELDS.NAME) || 'Untitled'}));
    }, [promptRecords, filterType]);

    return (
        <select value={currentId} onChange={e => onSelect(e.target.value || null)} className="field-input cursor-pointer">
            <option value="">None</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
    );
}

function EditableText({value, placeholder, multiline, onSave}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value || '');

    const startEdit = useCallback(() => { setDraft(value || ''); setEditing(true); }, [value]);
    const save = useCallback(() => { onSave(draft.trim()); setEditing(false); }, [draft, onSave]);
    const cancel = useCallback(() => setEditing(false), []);
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' && !multiline) { e.preventDefault(); save(); }
        if (e.key === 'Escape') cancel();
    }, [save, cancel, multiline]);

    if (editing) {
        const Tag = multiline ? 'textarea' : 'input';
        return (
            <Tag
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={save}
                className="w-full text-xs bg-transparent border border-blue-blue rounded-md px-2 py-1.5 text-gray-gray700 dark:text-gray-gray200 focus:outline-none resize-none"
                rows={multiline ? 4 : undefined}
                placeholder={placeholder}
                autoFocus
            />
        );
    }

    return (
        <button onClick={startEdit} className="w-full text-left text-xs px-2 py-1.5 rounded-md border border-transparent hover:border-gray-gray200 dark:hover:border-gray-gray600 transition-colors min-h-[28px]">
            {value ? (
                <span className="text-gray-gray600 dark:text-gray-gray300 whitespace-pre-wrap">{value}</span>
            ) : (
                <span className="text-gray-gray300 dark:text-gray-gray600">{placeholder}</span>
            )}
        </button>
    );
}

function DeleteModal({record, table, label, nameField, onClose}) {
    const name = safeGetString(record, nameField);
    const handleDelete = useCallback(async () => {
        if (!table.hasPermissionToDeleteRecord(record)) return;
        await table.deleteRecordAsync(record);
        onClose();
    }, [table, record, onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="bg-white dark:bg-gray-gray800 rounded-lg shadow-xl p-6 mx-4 max-w-sm w-full">
                <h3 className="text-sm font-semibold mb-2">Delete {label}</h3>
                <p className="text-xs text-gray-gray400 mb-4">
                    Are you sure you want to delete <strong>{name || `this ${label}`}</strong>?
                </p>
                <div className="flex gap-2 justify-end">
                    <button onClick={onClose} className="text-xs px-3 py-1.5 text-gray-gray400 hover:text-gray-gray600 transition-colors">Cancel</button>
                    <button onClick={handleDelete} className="text-xs px-3 py-1.5 rounded-md bg-red-red text-white font-medium hover:opacity-90 transition-opacity">Delete</button>
                </div>
            </div>
        </div>
    );
}

function Field({label, children}) {
    return (
        <div>
            <label className="block text-xs font-medium text-gray-gray400 dark:text-gray-gray500 mb-1">{label}</label>
            {children}
        </div>
    );
}
