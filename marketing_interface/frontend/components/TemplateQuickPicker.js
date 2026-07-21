import {useState, useMemo, useCallback, useRef} from 'react';
import {useGlobalConfig} from '@airtable/blocks/interface/ui';
import {CaretDown} from '@phosphor-icons/react';

const TEMPLATES_KEY = 'coverLetterTemplates';

export default function TemplateQuickPicker({onApply}) {
    const [open, setOpen] = useState(false);
    const btnRef = useRef(null);
    const globalConfig = useGlobalConfig();

    const templates = useMemo(() => {
        const stored = globalConfig.get(TEMPLATES_KEY);
        return Array.isArray(stored) ? stored : [];
    }, [globalConfig]);

    const handlePick = useCallback((tpl) => {
        onApply(tpl.body);
        setOpen(false);
    }, [onApply]);

    if (templates.length === 0) return null;

    return (
        <div className="relative">
            <button
                ref={btnRef}
                onClick={() => setOpen(prev => !prev)}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300 hover:bg-gray-gray75 dark:hover:bg-gray-gray700 transition-colors"
            >
                Use template
                <CaretDown size={10} />
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] bg-white dark:bg-gray-gray800 border border-gray-gray100 dark:border-gray-gray600 rounded-md shadow-lg py-1">
                        {templates.map(t => (
                            <button
                                key={t.id}
                                onClick={() => handlePick(t)}
                                className="w-full text-left px-3 py-1.5 text-xs text-gray-gray600 dark:text-gray-gray300 hover:bg-gray-gray50 dark:hover:bg-gray-gray700 transition-colors truncate"
                            >
                                {t.name}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
