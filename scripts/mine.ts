/**
 * Miner Worker: reads config from Airtable, runs search + filter, pushes results back.
 *
 * Flow:
 *   1. Reads all active Miners from Airtable
 *   2. For each miner: fetches linked Superficial + Deep prompts
 *   3. Searches Upwork using miner's Search Expression
 *   4. Dedupes against existing Jobs in Airtable
 *   5. Stage 0: rule-based filter (hardcoded rules)
 *   6. Stage 1: Superficial prompt (cheap model, subset of fields)
 *   7. Stage 2: Deep prompt (thinking model, all fields) — only survivors
 *   8. Pushes passing jobs to Airtable linked to the miner
 *   9. Updates miner's Last Run + Last Run Jobs Found
 *
 * Usage:
 *   npm run mine                     # runs all active miners
 *   npm run mine -- "Web Dev Expert" # runs only the named miner
 *
 * Prereqs: data/tokens.json (from npm run test:auth), .env configured
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const content = readFileSync(resolve(process.cwd(), file), "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = value;
      }
    } catch {}
  }
}
loadEnv();

const DATA_DIR = process.env.DATA_DIR || resolve(process.cwd(), "data");
const REJECTED_PATH = resolve(DATA_DIR, "rejected.jsonl");
const TOKENS_PATH = resolve(DATA_DIR, "tokens.json");
const GRAPHQL_URL = "https://api.upwork.com/graphql";
const TOKEN_URL = "https://www.upwork.com/api/v3/oauth2/token";

const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const UPWORK_CLIENT_ID = process.env.UPWORK_CLIENT_ID!;
const UPWORK_CLIENT_SECRET = process.env.UPWORK_CLIENT_SECRET!;

const FILTER_MINER_NAME = process.argv[2] || null;

// --- Hardcoded rules (Stage 0) ---
const RULES = {
  maxApplicants: 50,
  maxAgeDays: 14,
  minHourlyRate: 30,
  excludeKeywords: ["data entry", "virtual assistant", "transcription", "copy paste"],
  excludeLanguages: ["french", "german", "portuguese", "italian", "arabic", "mandarin", "chinese", "japanese", "korean", "hindi", "russian", "dutch", "turkish", "polish", "swedish", "norwegian", "danish", "finnish", "greek", "hebrew", "thai", "vietnamese", "indonesian", "malay", "tagalog", "filipino"],
};

// --- Airtable helpers ---

async function airtableGet(table: string, params?: Record<string, string>): Promise<any[]> {
  const records: any[] = [];
  let offset: string | undefined;
  do {
    const qs = new URLSearchParams(params || {});
    if (offset) qs.set("offset", offset);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?${qs}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } });
    if (!res.ok) throw new Error(`Airtable GET ${table} ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

async function airtableCreate(table: string, records: any[]) {
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch.map(fields => ({ fields })) }),
    });
    if (!res.ok) throw new Error(`Airtable POST ${table} ${res.status}: ${await res.text()}`);
  }
}

async function airtableUpdate(table: string, recordId: string, fields: Record<string, any>) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable PATCH ${table} ${res.status}: ${await res.text()}`);
}

// --- Load config from Airtable ---

interface PromptConfig {
  id: string;
  name: string;
  type: string;
  model: string;
  systemPrompt: string;
  fieldsToCheck: string[];
  threshold: number;
}

interface MinerConfig {
  id: string;
  name: string;
  searchExpression: string;
  searchDescription: string;
  ourOffering: string;
  maxPages: number;
  runIntervalMinutes: number;
  lastRun: string | null;
  superficialPrompt: PromptConfig | null;
  deepPrompt: PromptConfig | null;
}

async function loadMiners(): Promise<MinerConfig[]> {
  // Load all prompts first
  const promptRecords = await airtableGet("Prompts");
  const promptsById = new Map<string, PromptConfig>();
  for (const rec of promptRecords) {
    promptsById.set(rec.id, {
      id: rec.id,
      name: rec.fields["Name"] || "",
      type: rec.fields["Type"] || "",
      model: rec.fields["Model"] || "gpt-5.4-mini",
      systemPrompt: rec.fields["System Prompt"] || "",
      fieldsToCheck: (rec.fields["Fields to Check"] || "ALL").split(",").map((s: string) => s.trim()),
      threshold: rec.fields["Threshold"] ?? 4,
    });
  }

  // Load active miners
  const minerRecords = await airtableGet("Miners", {
    filterByFormula: FILTER_MINER_NAME
      ? `AND({Active}, {Name}='${FILTER_MINER_NAME}')`
      : "{Active}",
  });

  return minerRecords.map(rec => {
    const superficialIds: string[] = rec.fields["Superficial Prompt"] || [];
    const deepIds: string[] = rec.fields["Deep Prompt"] || [];

    return {
      id: rec.id,
      name: rec.fields["Name"] || "Unnamed",
      searchExpression: rec.fields["Search Expression"] || "",
      searchDescription: rec.fields["Search Description"] || "",
      ourOffering: rec.fields["Our Offering"] || "",
      maxPages: rec.fields["Max Pages"] || 3,
      runIntervalMinutes: parseInt(rec.fields["Run Interval"] || "10", 10) || 10,
      lastRun: rec.fields["Last Run"] || null,
      superficialPrompt: superficialIds[0] ? promptsById.get(superficialIds[0]) || null : null,
      deepPrompt: deepIds[0] ? promptsById.get(deepIds[0]) || null : null,
    };
  });
}

// --- Upwork search ---

const SEARCH_QUERY = `
query SearchJobs($filter: MarketplaceJobPostingsSearchFilter) {
  marketplaceJobPostingsSearch(
    marketPlaceJobFilter: $filter
    searchType: USER_JOBS_SEARCH
    sortAttributes: [{ field: RECENCY }]
  ) {
    totalCount
    edges {
      cursor
      node {
        id
        title
        description
        ciphertext
        duration
        amount { displayValue currency }
        experienceLevel
        category
        subcategory
        totalApplicants
        createdDateTime
        skills { name prettyName }
        hourlyBudgetMin { displayValue currency }
        hourlyBudgetMax { displayValue currency }
        client {
          totalHires
          totalPostedJobs
          totalSpent { displayValue currency }
          totalReviews
          totalFeedback
          verificationStatus
          location { country }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

async function fetchJobs(accessToken: string, searchExpression: string, maxPages: number): Promise<any[]> {
  const allJobs: any[] = [];
  let cursor: string | null = null;

  // First page to get initial cursor
  process.stdout.write(`    Page 1/${maxPages}...`);
  const firstRes = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: SEARCH_QUERY,
      variables: {
        filter: {
          searchExpression_eq: searchExpression,
          pagination_eq: { after: "0", first: 50 },
        },
      },
    }),
  });
  if (!firstRes.ok) throw new Error(`Upwork API ${firstRes.status}: ${await firstRes.text()}`);
  const firstJson: any = await firstRes.json();
  if (firstJson.errors?.length) console.warn(`\n    Warning: ${firstJson.errors[0].message}`);

  const firstSearch: any = firstJson.data?.marketplaceJobPostingsSearch;
  if (!firstSearch) return allJobs;
  for (const edge of firstSearch.edges) allJobs.push(edge.node);
  console.log(` ${firstSearch.edges.length} jobs`);

  if (!firstSearch.pageInfo.hasNextPage || maxPages <= 1) return allJobs;
  cursor = firstSearch.pageInfo.endCursor;

  // Remaining pages sequentially (need cursor from previous)
  for (let page = 1; page < maxPages; page++) {
    process.stdout.write(`    Page ${page + 1}/${maxPages}...`);
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: {
          filter: {
            searchExpression_eq: searchExpression,
            pagination_eq: { after: cursor, first: 50 },
          },
        },
      }),
    });

    if (!res.ok) throw new Error(`Upwork API ${res.status}: ${await res.text()}`);
    const json: any = await res.json();
    if (json.errors?.length) console.warn(`\n    Warning: ${json.errors[0].message}`);

    const search: any = json.data?.marketplaceJobPostingsSearch;
    if (!search) break;

    for (const edge of search.edges) allJobs.push(edge.node);
    console.log(` ${search.edges.length} jobs`);

    if (!search.pageInfo.hasNextPage) break;
    cursor = search.pageInfo.endCursor;
  }
  return allJobs;
}

// --- Filters ---

function applyRules(job: any): { passed: boolean; reason?: string } {
  if (job.totalApplicants > RULES.maxApplicants) {
    return { passed: false, reason: `${job.totalApplicants} applicants` };
  }

  // Age check: discard if older than 14 days
  if (job.createdDateTime) {
    const postedAt = new Date(job.createdDateTime).getTime();
    const ageMs = Date.now() - postedAt;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > RULES.maxAgeDays) {
      return { passed: false, reason: `Too old: ${Math.round(ageDays)} days` };
    }
  }

  // Hourly rate floor: discard if max hourly is below $30
  if (job.hourlyBudgetMax) {
    const maxRate = parseFloat(job.hourlyBudgetMax.displayValue?.replace(/[^0-9.]/g, "") || "0");
    if (maxRate > 0 && maxRate < RULES.minHourlyRate) {
      return { passed: false, reason: `Low rate: $${maxRate}/hr (min $${RULES.minHourlyRate})` };
    }
  }

  const text = `${job.title} ${job.description} ${job.skills?.map((s: any) => s.prettyName).join(" ") || ""}`.toLowerCase();

  // Language check: discard if requires non-English/Spanish languages
  for (const lang of RULES.excludeLanguages) {
    if (text.includes(lang)) {
      return { passed: false, reason: `Language: "${lang}"` };
    }
  }

  for (const kw of RULES.excludeKeywords) {
    if (text.includes(kw.toLowerCase())) {
      return { passed: false, reason: `Keyword: "${kw}"` };
    }
  }
  return { passed: true };
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function formatJobFields(job: any, fieldsToCheck: string[]): string {
  const all = fieldsToCheck.includes("ALL");
  const lines: string[] = [];

  if (all || fieldsToCheck.includes("title")) lines.push(`Title: ${job.title}`);
  if (all || fieldsToCheck.includes("description")) lines.push(`Description: ${job.description?.slice(0, 3000)}`);
  if (all || fieldsToCheck.includes("skills")) lines.push(`Skills: ${job.skills?.map((s: any) => s.prettyName).join(", ") || "N/A"}`);
  if (all || fieldsToCheck.includes("budget")) lines.push(`Budget: ${job.amount?.displayValue || "N/A"}`);
  if (all || fieldsToCheck.includes("hourly_range")) lines.push(`Hourly: ${job.hourlyBudgetMin?.displayValue || "?"}-${job.hourlyBudgetMax?.displayValue || "?"}`);
  if (all || fieldsToCheck.includes("applicants")) lines.push(`Applicants: ${job.totalApplicants}`);
  if (all || fieldsToCheck.includes("client_hires")) lines.push(`Client hires: ${job.client?.totalHires}`);
  if (all || fieldsToCheck.includes("client_spent")) lines.push(`Client spent: ${job.client?.totalSpent?.displayValue || "?"}`);
  if (all || fieldsToCheck.includes("client_verified")) lines.push(`Client verified: ${job.client?.verificationStatus || "?"}`);
  if (all || fieldsToCheck.includes("experience_level")) lines.push(`Experience: ${job.experienceLevel || "?"}`);
  if (all || fieldsToCheck.includes("country")) lines.push(`Country: ${job.client?.location?.country || "?"}`);
  if (all || fieldsToCheck.includes("duration")) lines.push(`Duration: ${job.duration || "?"}`);
  if (all || fieldsToCheck.includes("category")) lines.push(`Category: ${job.category || "?"}`);

  return lines.join("\n");
}

const JSON_FORMAT_INSTRUCTION = `\n\nRespond ONLY with JSON in this exact format: {"score": <number 0-10>, "reason": "<one sentence>"}`;

async function runLLMFilter(job: any, prompt: PromptConfig, miner: MinerConfig): Promise<{ score: number; reason: string }> {
  const userContent = formatJobFields(job, prompt.fieldsToCheck);

  let systemContent = prompt.systemPrompt;
  if (miner.searchDescription || miner.ourOffering) {
    systemContent += "\n\n--- CONTEXT ---";
    if (miner.searchDescription) systemContent += `\nWhat this search targets: ${miner.searchDescription}`;
    if (miner.ourOffering) systemContent += `\nWhat we offer/sell: ${miner.ourOffering}`;
  }
  systemContent += JSON_FORMAT_INSTRUCTION;

  const response = await openai.chat.completions.create({
    model: prompt.model,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
    max_completion_tokens: 150,
  });

  const content = response.choices[0]?.message?.content || "";
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    const parsed = JSON.parse(match[0]);
    return { score: Number(parsed.score), reason: String(parsed.reason) };
  }
  return { score: 0, reason: `Parse error: ${content.slice(0, 80)}` };
}

// --- Transform to Airtable ---

function toAirtableFields(job: any, miner: MinerConfig, score: number, reason: string, stage: string): Record<string, any> {
  const fields: Record<string, any> = {
    Title: job.title,
    "Upwork ID": job.id,
    URL: `https://www.upwork.com/jobs/${job.ciphertext}`,
    Description: job.description?.slice(0, 10000),
    Skills: job.skills?.map((s: any) => s.prettyName).join(", ") || "",
    Applicants: job.totalApplicants,
    "Client Hires": job.client?.totalHires,
    "Client Verified": job.client?.verificationStatus === "VERIFIED",
    "Client Country": job.client?.location?.country || "",
    "Posted At": job.createdDateTime,
    Status: "New Jobs",
    "AI Score": score,
    Summary: reason,
    "Filter Stage": stage,
    "Search Label": miner.searchExpression,
    "Fetched At": new Date().toISOString(),
    Miner: [miner.id],
  };

  const budget = job.amount?.displayValue ? parseFloat(job.amount.displayValue.replace(/[^0-9.]/g, "")) : null;
  if (budget) fields.Budget = budget;
  if (job.hourlyBudgetMin) fields["Hourly Min"] = parseFloat(job.hourlyBudgetMin.displayValue.replace(/[^0-9.]/g, ""));
  if (job.hourlyBudgetMax) fields["Hourly Max"] = parseFloat(job.hourlyBudgetMax.displayValue.replace(/[^0-9.]/g, ""));
  if (job.experienceLevel) {
    const expMap: Record<string, string> = { ENTRY_LEVEL: "Entry", INTERMEDIATE: "Intermediate", EXPERT: "Expert" };
    const mapped = expMap[job.experienceLevel];
    if (mapped) fields["Experience Level"] = mapped;
  }
  if (job.client?.totalSpent?.displayValue) fields["Client Spent"] = parseFloat(job.client.totalSpent.displayValue.replace(/[^0-9.]/g, ""));
  if (job.client?.totalFeedback) fields["Client Feedback"] = parseFloat(job.client.totalFeedback);

  return fields;
}

// --- Main ---

const CONCURRENCY = 10;

async function runBatch<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function runMiner(miner: MinerConfig, accessToken: string, existingIds: Set<string>) {
  console.log(`\n  [${miner.name}] search="${miner.searchExpression}" pages=${miner.maxPages}`);

  if (!miner.superficialPrompt) {
    console.log("    SKIP: no superficial prompt linked");
    return 0;
  }

  // Fetch
  const jobs = await fetchJobs(accessToken, miner.searchExpression, miner.maxPages);
  const newJobs = jobs.filter(j => !existingIds.has(j.id));
  // Mark all fetched jobs as seen immediately to prevent cross-miner dupes
  for (const j of newJobs) existingIds.add(j.id);
  console.log(`    Fetched ${jobs.length}, new: ${newJobs.length}`);

  if (newJobs.length === 0) return 0;

  // Stage 0: Rules (instant, no concurrency needed)
  const afterRules: any[] = [];
  let rejRules = 0;
  for (const job of newJobs) {
    const rule = applyRules(job);
    if (!rule.passed) {
      rejRules++;
      appendFileSync(REJECTED_PATH, JSON.stringify({ id: job.id, title: job.title, miner: miner.name, stage: "rules", reason: rule.reason, ts: new Date().toISOString() }) + "\n");
    } else {
      afterRules.push(job);
    }
  }
  console.log(`    After rules: ${afterRules.length} remain (${rejRules} rejected)`);

  // Stage 1: Superficial — parallel batches
  const superficialResults = await runBatch(afterRules, async (job) => {
    const result = await runLLMFilter(job, miner.superficialPrompt!, miner);
    return { job, result };
  });

  const afterSuperficial: { job: any; supResult: { score: number; reason: string } }[] = [];
  let rejSuperficial = 0;
  for (const { job, result } of superficialResults) {
    if (result.score < miner.superficialPrompt.threshold) {
      rejSuperficial++;
      appendFileSync(REJECTED_PATH, JSON.stringify({ id: job.id, title: job.title, miner: miner.name, stage: "superficial", score: result.score, reason: result.reason, ts: new Date().toISOString() }) + "\n");
    } else {
      afterSuperficial.push({ job, supResult: result });
    }
  }
  console.log(`    After superficial: ${afterSuperficial.length} remain (${rejSuperficial} rejected)`);

  // Stage 2: Deep — parallel batches (only survivors)
  const passing: Record<string, any>[] = [];
  let rejDeep = 0;
  const MIN_SCORE_TO_PUSH = 6;

  if (miner.deepPrompt && afterSuperficial.length > 0) {
    const deepResults = await runBatch(afterSuperficial, async ({ job }) => {
      const result = await runLLMFilter(job, miner.deepPrompt!, miner);
      return { job, result };
    });

    for (const { job, result } of deepResults) {
      if (result.score < MIN_SCORE_TO_PUSH) {
        rejDeep++;
        appendFileSync(REJECTED_PATH, JSON.stringify({ id: job.id, title: job.title, miner: miner.name, stage: "deep", score: result.score, reason: result.reason, ts: new Date().toISOString() }) + "\n");
      } else {
        passing.push(toAirtableFields(job, miner, result.score, result.reason, "stage2_deep"));
      }
    }
  } else {
    for (const { job, supResult } of afterSuperficial) {
      if (supResult.score < MIN_SCORE_TO_PUSH) {
        rejDeep++;
        appendFileSync(REJECTED_PATH, JSON.stringify({ id: job.id, title: job.title, miner: miner.name, stage: "superficial_floor", score: supResult.score, reason: supResult.reason, ts: new Date().toISOString() }) + "\n");
      } else {
        passing.push(toAirtableFields(job, miner, supResult.score, supResult.reason, "stage1_superficial"));
      }
    }
  }

  console.log(`    After deep: ${passing.length} passed (${rejDeep} rejected, min score=${MIN_SCORE_TO_PUSH})`);

  // Push to Airtable
  if (passing.length > 0) {
    await airtableCreate("Jobs", passing);
  }

  // Update miner stats
  await airtableUpdate("Miners", miner.id, {
    "Last Run": new Date().toISOString(),
    "Last Run Jobs Found": passing.length,
  });

  console.log(`    Results: rules=-${rejRules} superficial=-${rejSuperficial} deep=-${rejDeep} passed=${passing.length}`);
  return passing.length;
}

// --- Token management with auto-refresh ---

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: UPWORK_CLIENT_ID,
      client_secret: UPWORK_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function getValidToken(): Promise<string> {
  if (!existsSync(TOKENS_PATH)) {
    throw new Error("No tokens found. Run `npm run auth` to authenticate.");
  }

  const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf-8"));
  const expiresAt = new Date(tokens.expires_at);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // refresh 5 min before expiry

  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    return tokens.access_token;
  }

  // Token expired or about to expire — try refresh
  console.log("  Token expired or expiring soon. Refreshing...");

  if (!tokens.refresh_token) {
    throw new Error("No refresh token available. Run `npm run auth` to re-authenticate.");
  }
  if (!UPWORK_CLIENT_ID || !UPWORK_CLIENT_SECRET) {
    throw new Error("Missing UPWORK_CLIENT_ID or UPWORK_CLIENT_SECRET in .env for token refresh.");
  }

  const refreshed = await refreshAccessToken(tokens.refresh_token);

  const newTokens = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
  };
  writeFileSync(TOKENS_PATH, JSON.stringify(newTokens, null, 2));
  console.log(`  Token refreshed. New expiry: ${newTokens.expires_at}`);

  return newTokens.access_token;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
    console.error("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID in .env");
    process.exit(1);
  }

  let accessToken: string;
  try {
    accessToken = await getValidToken();
  } catch (err: any) {
    console.error(`\nAUTH ERROR: ${err.message}`);
    console.error("Operator action: run `npm run auth` on the server to re-authenticate.\n");
    process.exit(1);
  }

  const startTime = Date.now();

  // Load config from Airtable
  console.log("\n[mine] Loading config from Airtable...");
  const miners = await loadMiners();

  if (miners.length === 0) {
    console.log("  No active miners found." + (FILTER_MINER_NAME ? ` (filter: "${FILTER_MINER_NAME}")` : ""));
    return;
  }
  console.log(`  Found ${miners.length} active miner(s): ${miners.map(m => m.name).join(", ")}`);

  // Load existing job IDs for dedupe
  console.log("  Loading existing job IDs for dedup...");
  const existingIds = new Set<string>();
  const jobRecords = await airtableGet("Jobs", { "fields[]": "Upwork ID" });
  for (const rec of jobRecords) {
    if (rec.fields["Upwork ID"]) existingIds.add(rec.fields["Upwork ID"]);
  }
  console.log(`  ${existingIds.size} existing jobs in Airtable`);

  // Pipeline limiter: pause if too many unprocessed jobs
  const MAX_UNPROCESSED = 500;
  const unprocessedRecords = await airtableGet("Jobs", {
    filterByFormula: "{Status}='New Jobs'",
    "fields[]": "Title",
  });
  const unprocessedCount = unprocessedRecords.length;
  console.log(`  Unprocessed jobs (New Jobs): ${unprocessedCount}/${MAX_UNPROCESSED}`);

  if (unprocessedCount >= MAX_UNPROCESSED) {
    console.log(`\n  PAUSED — ${unprocessedCount} unprocessed jobs in pipeline (limit: ${MAX_UNPROCESSED}).`);
    console.log(`  Filter/triage existing jobs before miners will run again.\n`);
    return;
  }
  // Filter miners that are due to run based on their interval
  const now = Date.now();
  const dueMiners = miners.filter(miner => {
    if (!miner.lastRun) return true;
    const lastRunMs = new Date(miner.lastRun).getTime();
    const elapsedMin = (now - lastRunMs) / 60_000;
    if (elapsedMin < miner.runIntervalMinutes) {
      console.log(`  [${miner.name}] SKIP — ran ${Math.round(elapsedMin)}m ago, interval is ${miner.runIntervalMinutes}m`);
      return false;
    }
    return true;
  });

  if (dueMiners.length === 0) {
    console.log("\n  No miners due to run. Done.");
    return;
  }
  console.log(`  ${dueMiners.length} miner(s) due to run\n`);

  // Run due miners sequentially (shared existingIds prevents cross-miner dupes)
  let totalPassed = 0;
  for (const miner of dueMiners) {
    totalPassed += await runMiner(miner, accessToken, existingIds);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(40)}`);
  console.log(`  DONE (${elapsed}s) — ${totalPassed} new jobs pushed to Airtable`);
  console.log(`${"=".repeat(40)}\n`);
}

main().catch(err => {
  console.error("\nFATAL:", err.message || err);
  process.exit(1);
});
