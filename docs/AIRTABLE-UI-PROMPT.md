# Airtable Interface Build Prompt

Build a 3-section UI using **Airtable Interfaces** for an Upwork job mining pipeline.

## Base Structure

Three tables in the "Marketing" base:

1. **Prompts** — Library of LLM filter prompts
2. **Miners** — Search + prompt configs (the "bots" that find jobs)
3. **Jobs** — The output pipeline (what humans work in)

---

## Section 1: INBOX

**Purpose:** Dal opens this first thing. It's her email inbox of new jobs to triage.

**Design:** Minimalist list. Gmail-like. Tesla aesthetic — clean, monochrome, no clutter. As little UI friction as possible between "see job" and "qualify or discard."

**Implementation:** List layout, filtered to `Status = "New Jobs"`, sorted by AI Score descending (best first).

**Visible columns per row:**
- Title (bold, primary)
- Summary (the AI one-liner — this is what Dal reads to decide)
- Posted At (relative: "2h ago", "yesterday")
- AI Score (small badge)
- Miner (which miner found it — context on source)

**Actions on each row (buttons or quick actions):**
- Qualify → sets Status to "Qualified", prompts for Priority (P1/P2/P3)
- Discard → sets Status to "Discarded"
- Expand → shows full record (description, client stats, skills)

**Key behavior:**
- When Dal qualifies a job, it disappears from the inbox (no longer "New Jobs")
- Inbox should feel like a feed that empties as you work through it
- No pagination needed — show all New Jobs in one scrollable list

---

## Section 2: PIPELINE

**Purpose:** The work-in-progress board. Shows jobs moving through stages.

**Design:** Grouped list (NOT kanban — kanban gets bloated with cards). Think of it as sections/headers with compact rows under each.

**Implementation:** List layout, grouped by Status, filtered to exclude "New Jobs" and "Discarded".

**Group order:**
1. Qualified (Dal approved, Alex needs to review)
2. Send (Cover letter ready, waiting to submit)
3. Submitted (Proposal sent, waiting for response)
4. Engaged (Client responded)

**Visible columns per row:**
- Title
- Priority (P1/P2/P3 badge — color coded)
- Summary
- Connects Cost (if filled)
- Posted At

**Sorting within groups:** Priority first (P1 → P2 → P3), then Rank, then AI Score

**Record expand shows:**
- All fields from the record
- Cover Letter (editable)
- Connects Cost (editable)
- Priority (editable)
- Rank (editable)
- Status dropdown (to move between stages)
- Built-in Airtable record comments at the bottom

**Key behavior:**
- This is where Alex writes cover letters and Dal submits proposals
- Status transitions happen by editing the Status field on a record
- The grouped view auto-updates as status changes

---

## Section 3: MINERS

**Purpose:** Configuration panel. Create/edit miners, swap prompts, monitor activity.

**Design:** Simple table/grid view of the Miners table. This is the "settings" area.

**Implementation:** Grid view of Miners table.

**Visible columns:**
- Name
- Active (checkbox — toggle on/off)
- Search Expression
- Superficial Prompt (linked record name)
- Deep Prompt (linked record name)
- Last Run
- Last Run Jobs Found
- Run Interval

**Record expand shows:**
- All miner fields
- The linked Prompt records (can click through to see/edit the prompt text)
- Search URL
- Notes

**Secondary view: Prompts grid**
- Also include a grid view of the Prompts table
- Columns: Name, Type, Model, Threshold, Notes
- Expand to see/edit the full System Prompt text and Fields to Check

---

## Workflow Summary

1. **Configure** in Miners section: set up searches + prompts, toggle active
2. **Worker runs** (cron): reads Miners config, searches Upwork, filters, pushes to Jobs as "New Jobs"
3. **Dal triages** in Inbox: reads summaries, qualifies good ones (P1/P2/P3) or discards
4. **Alex reviews** in Pipeline: writes cover letters for Qualified jobs, moves to Send
5. **Dal submits** in Pipeline: submits proposals, fills Connects Cost, moves to Submitted
6. **Tracking** in Pipeline: Engaged = client responded

---

## Design Principles

- **Inbox zero mentality**: the inbox empties as you work. Fast triage.
- **No noise**: hide metadata behind record expand. Surface only what's needed to decide.
- **Speed**: minimize clicks between seeing a job and acting on it.
- **Tesla aesthetic**: monochrome, minimal, functional. No decorative elements.
- **Comments**: use Airtable's built-in record comments for all job commentary (no separate table).
