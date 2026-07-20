# Architecture: Upwork Job Mining Pipeline

## Problem

Filtering Upwork jobs manually: 30-40/hr with ~5% fit rate = ~2 fit jobs/hr.
Target: 300-400 screened/hr via AI → 15-20 fit jobs/hr surfaced for human review.

## System Overview

```
┌────────────────────────────────────────────────────────────────┐
│  AIRTABLE (config store + output + UI)                         │
│                                                                │
│  Prompts table   ←── library of LLM prompts (superficial/deep)│
│  Miners table    ←── search + prompt configs (workers read)    │
│  Jobs table      ←── pipeline output (humans work here)        │
│                                                                │
│  UI: Inbox | Pipeline | Miners (Airtable Interfaces)           │
└────────────────────────────────────────────────────────────────┘
          ▲ read config           │ push results
          │                       ▼
┌────────────────────────────────────────────────────────────────┐
│  MINER WORKER (scripts/mine.ts, deployed as cron)              │
│                                                                │
│  For each active Miner:                                        │
│    1. Read search expression + linked prompts from Airtable    │
│    2. Search Upwork via GraphQL API                            │
│    3. Dedupe against existing Jobs                             │
│    4. Stage 0: rule filter (free)                              │
│    5. Stage 1: Superficial prompt (cheap model, few fields)    │
│    6. Stage 2: Deep prompt (thinking model, all fields)        │
│    7. Push survivors → Jobs table, linked to miner             │
│    8. Rejected → local data/rejected.jsonl                     │
└────────────────────────────────────────────────────────────────┘
```

## Airtable Tables

### Prompts (`tblw3M5TMOz0OVC99`)

Library of reusable LLM prompts. Miners link to one superficial + one deep.

| Field | Type | Purpose |
|-------|------|---------|
| Name | singleLineText | e.g. "Default Superficial", "Strict Deep" |
| Type | singleSelect | Superficial / Deep |
| Model | singleSelect | gpt-5.4-mini / gpt-5.4 |
| System Prompt | multilineText | Full prompt text sent to the LLM |
| Fields to Check | multilineText | Comma-separated: which job fields to include. "ALL" = everything |
| Threshold | number | Min score (0-10) to pass |
| Notes | multilineText | Version notes, changelog |

### Miners (`tblIHI4PvvErXrrCR`)

Each miner = a search + prompt pair. Workers read this table to know what to do.

| Field | Type | Purpose |
|-------|------|---------|
| Name | singleLineText | e.g. "Web Dev Expert" |
| Search URL | url | Upwork search URL (reference) |
| Search Expression | singleLineText | Query passed to GraphQL API |
| Superficial Prompt | link → Prompts | Cheap first-pass filter |
| Deep Prompt | link → Prompts | Expensive second-pass filter |
| Active | checkbox | Only active miners are run |
| Max Pages | number | Pages to fetch per run (50 jobs/page) |
| Run Interval | singleLineText | e.g. "30m", "1h", "4h" |
| Last Run | dateTime | Updated by worker after each run |
| Last Run Jobs Found | number | How many passed last run |
| Notes | multilineText | Internal notes |

### Jobs (`tblUAe7zHETsRluDI`)

The pipeline. Humans work here.

**Primary (visible in Inbox/Pipeline):**

| Field | Type | Purpose |
|-------|------|---------|
| Title | singleLineText | Job title |
| URL | url | Direct link to Upwork job |
| Summary | singleLineText | AI one-liner: why it's a fit |
| Status | singleSelect | New Jobs, Qualified, Send, Submitted, Engaged, Discarded |
| Priority | singleSelect | P1, P2, P3 |
| Cover Letter | multilineText | Proposal text |
| Connects Cost | number | Connects to apply |
| Posted At | dateTime | When posted |
| Miner | link → Miners | Which miner found this |

**Metadata (on record expand):**

| Field | Type |
|-------|------|
| Upwork ID | singleLineText |
| Description | multilineText |
| Skills | multilineText |
| Budget | currency |
| Hourly Min / Max | number |
| Experience Level | singleSelect |
| Applicants | number |
| Client Hires / Spent / Feedback | number |
| Client Verified | checkbox |
| Client Country | singleLineText |
| AI Score | number |
| Filter Stage | singleLineText |
| Search Label | singleLineText |
| Rank | number |
| Fetched At | dateTime |

## Filter Cascade

```
Job from Upwork API
  │
  ├─ Stage 0: Rules (free, instant)
  │   └─ maxApplicants, excluded keywords, etc.
  │
  ├─ Stage 1: Superficial (gpt-5.4-mini, ~$0.0001/job)
  │   └─ Checks subset of fields defined in the prompt config
  │   └─ Score < threshold → rejected
  │
  └─ Stage 2: Deep (gpt-5.4, ~$0.005/job)
      └─ Checks ALL fields including full description
      └─ Score < threshold → rejected
      └─ PASS → pushed to Airtable as "New Jobs"
```

## UI: 3 Sections (Airtable Interfaces)

### 1. Inbox
- Gmail-like minimalist list of "New Jobs"
- Each row: Title | Summary | Posted At | AI Score
- Click to expand full record
- Action: Qualify (set priority, move to Qualified) or Discard

### 2. Pipeline
- Grouped list by Status (not kanban — less bloat)
- Groups: Qualified → Send → Submitted → Engaged
- Within each group: sorted by Priority (P1 first), then Rank
- Compact rows, expandable details

### 3. Miners
- Table view of all miners
- Shows: Name, Active, Search Expression, Last Run, Last Run Jobs Found
- Click to edit: swap prompts, change search, toggle active

## Data Source: Upwork GraphQL API

Endpoint: `https://api.upwork.com/graphql`
Auth: OAuth 2.0 (tokens in `data/tokens.json`)
Query: `marketplaceJobPostingsSearch`
Rate: 300 req/min, 50 results/page, cursor pagination

## Status Flow

```
New Jobs → Qualified → Send → Submitted → Engaged
    ↓          ↓         ↓        ↓
 Discarded  Discarded Discarded Discarded
```

## Rejected Jobs (local only)

`data/rejected.jsonl` — one JSON per line. Includes miner name, stage, score, reason, timestamp. Never stored in Airtable. Future training data.

## File Structure

```
scripts/
  mine.ts               ← Worker: reads Airtable config, runs pipeline
  archive.ts            ← Weekly: cleans old Discarded from Airtable
  test-upwork-auth.ts   ← Phase 0: OAuth setup
  test-filter.ts        ← Phase 1: LLM test
  test-pipeline.ts      ← Phase 2: end-to-end test
data/
  tokens.json           ← Upwork OAuth tokens (gitignored)
  rejected.jsonl        ← AI-rejected jobs (local training data)
  archived.jsonl        ← Old discarded jobs from Airtable
docs/
  ARCHITECTURE.md       ← This file
  AIRTABLE-UI-PROMPT.md ← Prompt for building the Interface
.env                    ← Secrets (gitignored)
package.json
tsconfig.json
```

## Running

```bash
npm run test:auth          # OAuth + save tokens
npm run mine               # Run all active miners
npm run mine -- "Web Dev"  # Run specific miner
npm run archive            # Weekly cleanup
```
