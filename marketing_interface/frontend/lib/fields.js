export const TABLES = {
    JOBS: 'Jobs',
    MINERS: 'Miners',
    PROMPTS: 'Prompts',
};

export const JOB_FIELDS = {
    TITLE: 'Title',
    UPWORK_ID: 'Upwork ID',
    URL: 'URL',
    DESCRIPTION: 'Description',
    SKILLS: 'Skills',
    BUDGET: 'Budget',
    HOURLY_MIN: 'Hourly Min',
    HOURLY_MAX: 'Hourly Max',
    EXPERIENCE_LEVEL: 'Experience Level',
    APPLICANTS: 'Applicants',
    CLIENT_HIRES: 'Client Hires',
    CLIENT_SPENT: 'Client Spent',
    CLIENT_FEEDBACK: 'Client Feedback',
    CLIENT_VERIFIED: 'Client Verified',
    CLIENT_COUNTRY: 'Client Country',
    POSTED_AT: 'Posted At',
    STATUS: 'Status',
    PRIORITY: 'Priority',
    RANK: 'Rank',
    COVER_LETTER: 'Cover Letter',
    AI_SCORE: 'AI Score',
    SUMMARY: 'Summary',
    FILTER_STAGE: 'Filter Stage',
    SEARCH_LABEL: 'Search Label',
    FETCHED_AT: 'Fetched At',
    CONNECTS_COST: 'Connects Cost',
    COMMENTS: 'Comments',
    PROPOSAL_VIEWED: 'Proposal Viewed',
    PROPOSAL_IGNORED: 'Proposal Ignored',
    COVER_LETTER_TYPE: 'Cover Letter Type',
    BOOSTED: 'Boosted',
};

export const STATUSES = {
    NEW_JOBS: 'New Jobs',
    QUALIFIED: 'Qualified',
    SEND: 'Send',
    SUBMITTED: 'Submitted',
    ENGAGED: 'Engaged',
    DISCARDED: 'Discarded',
};

export const PIPELINE_STAGES = ['Qualified', 'Send', 'Submitted', 'Engaged'];

export const PRIORITIES = ['P1', 'P2', 'P3'];

export const MINER_FIELDS = {
    NAME: 'Name',
    SEARCH_URL: 'Search URL',
    SEARCH_EXPRESSION: 'Search Expression',
    SEARCH_DESCRIPTION: 'Search Description',
    OUR_OFFERING: 'Our Offering',
    SUPERFICIAL_PROMPT: 'Superficial Prompt',
    DEEP_PROMPT: 'Deep Prompt',
    ACTIVE: 'Active',
    MAX_PAGES: 'Max Pages',
    RUN_INTERVAL: 'Run Interval',
    LAST_RUN: 'Last Run',
    LAST_RUN_JOBS_FOUND: 'Last Run Jobs Found',
    NOTES: 'Notes',
    JOBS: 'Jobs',
};

export const PROMPT_FIELDS = {
    NAME: 'Name',
    TYPE: 'Type',
    MODEL: 'Model',
    SYSTEM_PROMPT: 'System Prompt',
    FIELDS_TO_CHECK: 'Fields to Check',
    THRESHOLD: 'Threshold',
    NOTES: 'Notes',
};
