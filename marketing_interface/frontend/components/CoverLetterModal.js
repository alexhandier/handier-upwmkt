import {useState, useMemo, useCallback} from 'react';
import {useGlobalConfig} from '@airtable/blocks/interface/ui';
import {Trash, FloppyDisk, CaretDown} from '@phosphor-icons/react';

const TEMPLATES_KEY = 'coverLetterTemplates';

export default function CoverLetterModal({jobTitle, initialDraft, onSave, onClose}) {
    const [draft, setDraft] = useState(initialDraft || '');
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);
    const [templateName, setTemplateName] = useState('');
    const [manageMode, setManageMode] = useState(false);

    const globalConfig = useGlobalConfig();

    const templates = useMemo(() => {
        const stored = globalConfig.get(TEMPLATES_KEY);
        return Array.isArray(stored) ? stored : [];
    }, [globalConfig]);

    const saveTemplate = useCallback(async () => {
        const name = templateName.trim();
        if (!name || !draft.trim()) return;
        const newTemplate = {id: Date.now().toString(), name, body: draft.trim()};
        const next = [...templates, newTemplate];
        if (globalConfig.hasPermissionToSet(TEMPLATES_KEY, next)) {
            await globalConfig.setAsync(TEMPLATES_KEY, next);
        }
        setTemplateName('');
        setShowSaveTemplate(false);
    }, [globalConfig, templates, templateName, draft]);

    const deleteTemplate = useCallback(async (id) => {
        const next = templates.filter(t => t.id !== id);
        if (globalConfig.hasPermissionToSet(TEMPLATES_KEY, next)) {
            await globalConfig.setAsync(TEMPLATES_KEY, next);
        }
    }, [globalConfig, templates]);

    const loadTemplate = useCallback((id) => {
        const tpl = templates.find(t => t.id === id);
        if (tpl) setDraft(tpl.body);
    }, [templates]);

    return (
        <div className="w-full max-w-lg">
            <h3 className="text-sm font-semibold mb-1">Cover Letter</h3>
            <p className="text-xs text-gray-gray400 mb-3 truncate">{jobTitle}</p>

            {/* Template selector */}
            {templates.length > 0 && !manageMode && (
                <div className="flex items-center gap-2 mb-3">
                    <div className="relative flex-1">
                        <select
                            value=""
                            onChange={e => { if (e.target.value) loadTemplate(e.target.value); }}
                            className="w-full appearance-none text-xs bg-gray-gray25 dark:bg-gray-gray700 border border-gray-gray100 dark:border-gray-gray600 rounded-md px-3 py-1.5 pr-6 text-gray-gray500 dark:text-gray-gray400 cursor-pointer focus:outline-none focus:ring-1 focus:ring-gray-gray200 dark:focus:ring-gray-gray600"
                        >
                            <option value="">Load template...</option>
                            {templates.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                        <CaretDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-gray400 pointer-events-none" />
                    </div>
                    <button
                        onClick={() => setManageMode(true)}
                        className="text-xs text-gray-gray300 dark:text-gray-gray600 hover:text-gray-gray500 dark:hover:text-gray-gray400 transition-colors"
                    >
                        Manage
                    </button>
                </div>
            )}

            {/* Manage templates list */}
            {manageMode && (
                <div className="mb-3 border border-gray-gray100 dark:border-gray-gray600 rounded-md divide-y divide-gray-gray75 dark:divide-gray-gray700">
                    {templates.map(t => (
                        <div key={t.id} className="flex items-center justify-between px-3 py-2">
                            <span className="text-xs text-gray-gray600 dark:text-gray-gray300 truncate">{t.name}</span>
                            <button
                                onClick={() => deleteTemplate(t.id)}
                                className="text-gray-gray300 dark:text-gray-gray600 hover:text-red-red transition-colors shrink-0 ml-2"
                            >
                                <Trash size={12} />
                            </button>
                        </div>
                    ))}
                    <div className="px-3 py-2">
                        <button
                            onClick={() => setManageMode(false)}
                            className="text-xs text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300 transition-colors"
                        >
                            Done
                        </button>
                    </div>
                </div>
            )}

            <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="Dear client..."
                rows={12}
                className="w-full text-sm border border-gray-gray200 dark:border-gray-gray600 rounded-md p-4 bg-transparent focus:outline-none focus:border-blue-blue resize-none mb-3 leading-relaxed"
                autoFocus
            />

            {/* Save as template inline */}
            {showSaveTemplate ? (
                <div className="flex items-center gap-2 mb-3">
                    <input
                        value={templateName}
                        onChange={e => setTemplateName(e.target.value)}
                        placeholder="Template name"
                        className="flex-1 text-xs border border-gray-gray200 dark:border-gray-gray600 rounded-md px-3 py-1.5 bg-transparent focus:outline-none focus:ring-1 focus:ring-gray-gray200 dark:focus:ring-gray-gray600"
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') saveTemplate(); if (e.key === 'Escape') setShowSaveTemplate(false); }}
                    />
                    <button
                        onClick={saveTemplate}
                        disabled={!templateName.trim() || !draft.trim()}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-gray-gray75 dark:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300 hover:bg-gray-gray100 dark:hover:bg-gray-gray600 transition-colors disabled:opacity-40"
                    >
                        <FloppyDisk size={12} />
                        Save
                    </button>
                    <button
                        onClick={() => setShowSaveTemplate(false)}
                        className="text-xs text-gray-gray300 hover:text-gray-gray500 transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            ) : (
                <div className="flex items-center justify-between mb-3">
                    <button
                        onClick={() => setShowSaveTemplate(true)}
                        disabled={!draft.trim()}
                        className="text-xs text-gray-gray300 dark:text-gray-gray600 hover:text-gray-gray500 dark:hover:text-gray-gray400 transition-colors disabled:opacity-30"
                    >
                        Save as template
                    </button>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="text-xs px-3 py-1.5 text-gray-gray400 hover:text-gray-gray600 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => onSave(draft)}
                            className="text-xs px-3 py-1.5 rounded-md bg-gray-gray900 dark:bg-white text-white dark:text-gray-gray900 font-medium hover:opacity-90 transition-opacity"
                        >
                            Save
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
