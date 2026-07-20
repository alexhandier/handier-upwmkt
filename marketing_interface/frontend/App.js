import {useState} from 'react';
import {useBase, useRecords} from '@airtable/blocks/interface/ui';
import {Tray, MagnifyingGlass, Funnel} from '@phosphor-icons/react';
import {TABLES} from './lib/fields';
import Inbox from './components/Inbox';
import Pipeline from './components/Pipeline';
import Miners from './components/Miners';

const TABS = [
    {id: 'inbox', label: 'Inbox', icon: Tray},
    {id: 'pipeline', label: 'Pipeline', icon: Funnel},
    {id: 'miners', label: 'Miners', icon: MagnifyingGlass},
];

export default function App() {
    const [activeTab, setActiveTab] = useState('inbox');
    const base = useBase();

    const jobsTable = base.getTableByNameIfExists(TABLES.JOBS);
    const minersTable = base.getTableByNameIfExists(TABLES.MINERS);
    const promptsTable = base.getTableByNameIfExists(TABLES.PROMPTS);

    const jobRecords = useRecords(jobsTable);
    const minerRecords = useRecords(minersTable);
    const promptRecords = useRecords(promptsTable);

    if (!jobsTable) {
        return (
            <div className="fixed inset-0 flex items-center justify-center bg-white dark:bg-gray-gray900">
                <p className="text-gray-gray400 text-base">
                    Add the Jobs table as a data source to this extension.
                </p>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 flex flex-col bg-white dark:bg-gray-gray900 text-gray-gray800 dark:text-gray-gray200">
            <nav className="flex items-center border-b border-gray-gray100 dark:border-gray-gray700 px-4 h-11 shrink-0">
                <div className="flex gap-0.5">
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                                    ${active
                                        ? 'bg-gray-gray75 dark:bg-gray-gray700 text-gray-gray900 dark:text-white'
                                        : 'text-gray-gray400 hover:text-gray-gray600 dark:hover:text-gray-gray300'
                                    }`}
                            >
                                <Icon size={15} weight={active ? 'fill' : 'regular'} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </nav>

            <div className="flex-1 overflow-hidden">
                {activeTab === 'inbox' && (
                    <Inbox table={jobsTable} records={jobRecords} />
                )}
                {activeTab === 'pipeline' && (
                    <Pipeline table={jobsTable} records={jobRecords} />
                )}
                {activeTab === 'miners' && (
                    <Miners
                        minersTable={minersTable}
                        minerRecords={minerRecords}
                        promptsTable={promptsTable}
                        promptRecords={promptRecords}
                    />
                )}
            </div>
        </div>
    );
}
