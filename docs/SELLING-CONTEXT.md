# Selling Context: Filtering Upwork Jobs to Sell Handier

> Purpose: give any LLM (or human) enough context to write, tune, or debug the
> job-filtering prompts used by the miner pipeline (`scripts/mine.ts`). This
> explains **what we sell**, **who we're looking for**, and **the shallow/deep
> prompt strategy** for surfacing sales prospects — not just literal matches.

---

## 1. What Handier is

Handier is an **outbound lead-generation system**. It automates finding business
leads, cleaning/enriching their contact info, and distributing them to cold
email campaigns. Think of it as a factory pipeline: **Mine → Clean → Allocate →
Distribute**.

First use case was real estate: scrape Redfin for listings, extract the listing
agent, find their email via AI, verify it, push them into cold email via
Smartlead.

### Old model (retired)
Originally a SaaS platform: Python workers on AWS, Supabase (Postgres + RLS, 30+
migrations), a React/TS dashboard on Vercel (9 pages), one client ("Okane" /
Perfect Renders, a real estate co., now cancelled). Problem: over-engineered for
selling. Clients don't want to log into a dashboard and operate outbound infra —
they want leads in their inbox.

### The pivot (July 2026)
Handier is now a **packaged outbound operating system**, not a SaaS product.

- **Client interface:** Airtable (bases + interfaces), not a custom dashboard.
- **Integrations:** n8n (open-source, client-visible/editable), replaces Lambda.
- **Miners:** isolated per-client servers with SQLite; only cleaned/qualified
  leads get pushed to the client's Airtable.
- **Cold email:** client's choice — Smartlead, Instantly, Lemlist, etc.,
  connected via n8n.
- **Supabase:** being retired. **React dashboard:** mothballed.
- **Key principle:** the client owns their system; it works without Handier. The
  proprietary part is the miner logic (scraping, AI enrichment, classification).

## 2. What we sell (the offer)

Two ways to win the same client:

1. **OWN IT** — a done-for-you outbound system the client owns and runs.
   - **~$5K setup** (range $3–6K depending on scope)
   - **3 months free maintenance** included
   - **$200/mo managed tier** — support, updates, monitoring, data archiving
   - **$500/mo strategy tier** — active campaign optimization, experiments,
     hands-on outbound ops
2. **USE IT** — for clients who don't want to own/operate anything, we run the
   entire outbound pipeline for them as a managed service at a **steeper monthly
   fee**.

### Team
- **Alex** — founder, technical lead, salesperson. Builds miners, architects
  systems, closes deals.
- **Dal** (Alex's wife) — operations manager. Project-manages Alex, runs client
  delivery, owns finance. Flat salary + 10% commission on client income after 5
  clients. Will eventually hire/manage a delivery team.

### Status (July 2026)
- **No active clients.** Okane cancelled early July. Old pipeline is in cold
  standby on AWS (re-enableable).
- **Selling phase.** Priority: Upwork outbound, 5 proposals/day with Dal. Target:
  first client ASAP, baseline of 5. **Upwork budget:** $500/mo in credits.
- Mantra: **"Is this selling or building?"** No building until a paying client
  exists to build for.
- 22 Linear issues exist for the full build but are deprioritized until revenue
  proves demand.

### Assets from the old build (cold standby, reusable)
- **Redfinator** — Playwright Redfin scraper + OpenAI vision verification.
- **Refinery** — AI email finder (OpenAI web search) + validator (EmailListVerify).
- **Distribution** — inventory allocation, Smartlead upload, reply sync, AI
  behavior classification.
- **325K+ mining entities** and **10K+ contacts** in Supabase from Okane.
These engines get re-used and adapted to output to Airtable for new clients.

---

## 3. The prospecting problem (why filtering is non-trivial)

We are filtering Upwork jobs to find **clients to sell to**, using the
shallow/deep filter cascade described in `docs/ARCHITECTURE.md`.

**Critical caveat:** prospects almost **never ask for "a packaged outbound
lead-generation system" by name.** They describe a *symptom* ("we need more
clients") or a *task* ("scrape me a list", "run cold email", "set appointments").

So the filter must find the **underlying need** (more pipeline / leads / outbound)
and the client's **willingness** to accept a done-for-you system or managed
service — not keyword-match the product.

Two fits per prospect:
- **OWN** — client wants control/ownership or to build capability → sell setup +
  tiers.
- **USE** — client doesn't want to operate anything, wants results only → sell
  the managed service at a higher monthly fee.

**Positive need signals (however phrased):**
- Direct: lead generation, list building, prospecting, cold email/outreach,
  outbound sales, appointment setting/setter, SDR/BDR, demand/pipeline/growth,
  "we need more clients/customers/leads/bookings".
- Tooling proxies: Apollo, Instantly, Smartlead, Lemlist, Clay, HubSpot/CRM for
  outreach, email deliverability/domain warmup, web scraping/data mining for
  contacts, email finding/verification, sales automation, n8n/Zapier/Make for
  outreach.
- Adjacent: top-of-funnel sales funnels, B2B marketing that implies acquiring
  contacts, a small business recruiting a sales/growth person, "help me get more
  business".

**Willingness signals (raise score):** "done for you", "set up a system",
"ongoing", "monthly", "manage it", "consultant/agency", frustration with current
lead flow, prior spend, verified client, real budget, existing sales motion.

**Low-willingness signals (lower score):** wants a cheap one-off gig, wants to
personally operate everything and just needs a tool, insists on a W2 employee,
extreme price sensitivity, tiny throwaway task.

**Reject:** no genuine outbound/lead-acquisition need, pure unrelated
dev/design/content/SEO/social/admin/data-entry, micro-tasks with no pipeline
value, clients who only want a tool they'll run alone with no room for our
service, spam, no-budget/unqualified clients.

---

## 4. How the prompts plug into the pipeline

(See `docs/ARCHITECTURE.md` and `scripts/mine.ts` for full detail.)

- Each prompt lives in the **`System Prompt`** field of a `Prompts` record.
- The worker **auto-appends** a context block from the miner's `Search
  Description` and `Our Offering` fields — so keep the offer details in the miner
  config, not hardcoded in the prompt:

  ```
  --- CONTEXT ---
  What this search targets: {Search Description}
  What we offer/sell: {Our Offering}
  ```

- **Output contract (both prompts):** the model must reply ONLY with
  `{"score": <0-10>, "reason": "<one sentence>"}`. It's regex-extracted; `reason`
  becomes the Airtable `Summary`. `max_completion_tokens` is 150, so `reason`
  must stay a single short sentence.
- **Superficial** = cheap model (`gpt-5.4-mini`), a subset of fields, **high-recall**
  gate (be generous). **Deep** = `gpt-5.4`, `ALL` fields incl. full description,
  **precision** gate.
- Filter cascade: Stage 0 rules (free) → Stage 1 Superficial → Stage 2 Deep →
  survivors pushed to Jobs as "New Jobs"; rejects go to `data/rejected.jsonl`.

### Recommended miner config
- **Our Offering:**
  > We install a done-for-you outbound lead-generation system (automated lead
  > mining/scraping + AI email enrichment & verification + connection to the
  > client's cold-email tool) that the client owns and runs — ~$3-6K setup with
  > $200/mo managed and $500/mo strategy tiers. Alternatively, for clients who
  > don't want to operate anything, we run the entire outbound pipeline as a
  > managed service at a higher monthly fee.
- **Search Description** (tune per miner), e.g.:
  > Businesses hiring for lead generation, cold email, prospecting, list
  > building, appointment setting, SDR/outbound sales, or scraping/data mining
  > for contacts — i.e. companies whose real need is more sales pipeline.
- **Search Expression** ideas (one miner each so signals don't blur):
  `"lead generation"`, `"cold email"`, `"appointment setter"`, `"list building"`,
  `"outbound sales"`, `"web scraping" leads`.
- **Superficial** — Fields to Check: `title, skills, category, budget,
  hourly_range, experience_level`; Threshold `3`.
- **Deep** — Fields to Check: `ALL`; Threshold `6`.

---

## 5. The two prompts (paste into `Prompts.System Prompt`)

### 5.1 Superficial (shallow, high-recall) — `gpt-5.4-mini`

```text
You are the first-pass filter for an outbound lead-generation company. Your ONLY job is to decide whether a job posting plausibly signals a business that needs MORE leads, more pipeline, or more outbound/sales activity — regardless of how they phrase it.

CRITICAL: Most good prospects will NOT ask for a "lead generation system" by name. They describe a symptom or a task. Treat ALL of the following as positive signals of the underlying need we serve:
- Direct: lead generation, list building, prospecting, cold email, cold outreach, outbound sales, appointment setting, appointment setter, SDR/BDR, demand/pipeline/growth, "we need more clients/customers/leads/bookings".
- Tooling proxies: Apollo, Instantly, Smartlead, Lemlist, Clay, HubSpot/CRM setup for outreach, email deliverability/domain warmup, web scraping or data mining for contacts, email finding/verification, sales automation, n8n/Zapier/Make for outreach.
- Adjacent: sales funnel top-of-funnel, B2B marketing that implies acquiring contacts, recruiting a sales/growth person for a small business, "help me get more business".

This is a CHEAP recall gate. Be generous: when in doubt, PASS it up to the deep filter. Only reject things that are clearly NOT about acquiring customers/leads/outbound at all.

Reject (score 0-2): pure product/web/app engineering with no acquisition angle, graphic design only, content writing/SEO/social-media-only with no outbound, data entry, transcription, bookkeeping, admin/VA tasks, unrelated trades, spam.
Borderline (score 3-5): vague or thin postings that COULD involve getting customers, or marketing tasks that might have an outbound component.
Strong (score 6-10): clear outbound/lead-gen/prospecting/cold-email/sales-pipeline intent.

You are seeing only a few fields (title, skills, category, budget). Do not over-penalize missing detail — that is the deep filter's job.

Respond ONLY with valid JSON: {"score": <number 0-10>, "reason": "<one short sentence: the need signal you detected>"}
```

### 5.2 Deep (precision + willingness + tier) — `gpt-5.4`

```text
You are the final-pass filter for an outbound lead-generation company. You have the FULL job posting (description, skills, budget, client history, country, experience level). Decide how good a SALES PROSPECT this client is for us, and how we'd sell to them.

WHAT WE SELL (two ways to win the same client):
1. OWN IT — a packaged, done-for-you outbound system the client owns and runs: automated lead mining/scraping, AI email enrichment + verification, and connection into their cold-email tool. Sold as a ~$3-6K setup + ongoing managed/strategy tiers ($200-$500/mo).
2. USE IT — for clients who don't want to own or operate anything, we run the whole outbound pipeline for them as a managed service at a steeper monthly fee.

KEY PRINCIPLE: The prospect almost never asks for "an outbound system." They express a NEED (more leads, more meetings, more clients) or a TASK (scrape a list, run cold email, set appointments). Your job is to judge whether that need is one we can credibly satisfy AND whether the client is likely to accept a done-for-you system or managed service.

SCORE 0-10 based on three things together:
A. Need fit — is the real problem "acquire more customers/leads via outbound"? Higher if lead gen, prospecting, cold email, list building, appointment setting, SDR/outbound, or scraping-for-contacts is central. Lower if outbound is incidental or absent.
B. Willingness / seriousness — signals they'd accept and pay for a system or managed service: framing like "done for you", "set up a system", "ongoing", "monthly", "manage it", "consultant/agency", frustration with current lead flow, prior spend, verified client, real budget, existing sales motion. Lower willingness: wants a cheap one-off gig, wants to personally operate everything and just needs a tool, insists on a W2 employee, extreme price sensitivity, tiny throwaway task.
C. Reachability/quality — verified client, reasonable budget/hourly, meaningful client spend or hires raise the score; $0-budget, brand-new unverified clients, or spammy posts lower it.

TIER HINT: If they seem to want control/ownership or to build capability, lean OWN. If they explicitly don't want to manage anything, want results-only, or want someone to "just handle it", lean USE. If unclear, say either.

Reject (score 0-5): no genuine outbound/lead-acquisition need, pure unrelated dev/design/content/admin, one-off micro-tasks with no pipeline value, clients who only want a tool they'll run alone with no room for our service, spam, or no-budget/unqualified clients.
Pass (score 6-10): a real business whose problem is getting more leads/customers and who plausibly buys a done-for-you outbound system OR a managed outbound service.

In "reason", give ONE sentence that names (a) the need, (b) the fit angle, and (c) the suggested tier (OWN vs USE), e.g. "B2B agency wants steady cold-email meetings but no in-house ops — strong USE (managed) fit."

Respond ONLY with valid JSON: {"score": <number 0-10>, "reason": "<one sentence: need + angle + OWN/USE>"}
```
