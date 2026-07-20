/**
 * Phase 2: Full pipeline — search Upwork, filter, push passing jobs to Airtable.
 *
 * 1. Loads tokens from data/tokens.json (saved by Phase 0)
 * 2. Searches Upwork for jobs (configurable query)
 * 3. Dedupes against Airtable (Upwork ID lookup)
 * 4. Runs Stage 0 rules filter
 * 5. Runs Stage 1 cheap LLM filter (gpt-5.4-mini)
 * 6. Pushes passing jobs to Airtable as "New Jobs"
 * 7. Appends rejected jobs to data/rejected.jsonl (local only)
 *
 * Usage: npm run test:pipeline [search query]
 * Prereqs: data/tokens.json exists, OPENAI_API_KEY + AIRTABLE_PAT set in .env
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";

function loadEnv() {
  const candidates = [".env.local", ".env"];
  for (const file of candidates) {
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

const GRAPHQL_URL = "https://api.upwork.com/graphql";
const DATA_DIR = resolve(process.cwd(), "data");
const REJECTED_PATH = resolve(DATA_DIR, "rejected.jsonl");
const TOKENS_PATH = resolve(DATA_DIR, "tokens.json");

const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_TABLE = process.env.AIRTABLE_JOBS_TABLE || "Jobs";

const SEARCH_EXPRESSION = process.argv[2] || "web development";
const MAX_PAGES = 2;
const PAGE_SIZE = 20;
const RULES = {
  maxApplicants: 50,
  excludeKeywords: ["data entry", "virtual assistant", "transcription"],
};
const LLM_THRESHOLD = 4;

// --- Airtable helpers ---

async function airtableFetch(path: string, opts: RequestInit = {}) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getExistingUpworkIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ "fields[]": "Upwork ID", pageSize: "100" });
    if (offset) params.set("offset", offset);
    const data: any = await airtableFetch(`?${params}`);
    for (const rec of data.records) {
      if (rec.fields["Upwork ID"]) ids.add(rec.fields["Upwork ID"]);
    }
    offset = data.offset;
  } while (offset);
  return ids;
}

async function pushJobsToAirtable(jobs: any[]) {
  // Airtable max 10 records per create request
  for (let i = 0; i < jobs.length; i += 10) {
    const batch = jobs.slice(i, i + 10);
    const records = batch.map(job => ({ fields: job }));
    await airtableFetch("", {
      method: "POST",
      body: JSON.stringify({ records }),
    });
  }
}

// --- Upwork Search ---

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

async function fetchJobs(accessToken: string): Promise<any[]> {
  const allJobs: any[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    console.log(`  Fetching page ${page + 1}...`);

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
            searchExpression_eq: SEARCH_EXPRESSION,
            pagination_eq: { after: cursor || "0", first: PAGE_SIZE },
          },
        },
      }),
    });

    if (!res.ok) throw new Error(`API error (${res.status}): ${await res.text()}`);

    const json: any = await res.json();
    if (json.errors?.length) console.warn("  GraphQL warnings:", json.errors[0].message);

    const search: any = json.data?.marketplaceJobPostingsSearch;
    if (!search) break;

    for (const edge of search.edges) allJobs.push(edge.node);
    if (!search.pageInfo.hasNextPage) break;
    cursor = search.pageInfo.endCursor;
  }

  return allJobs;
}

// --- Stage 0: Rules ---

function applyRules(job: any): { passed: boolean; reason?: string } {
  if (job.totalApplicants > RULES.maxApplicants) {
    return { passed: false, reason: `Too many applicants: ${job.totalApplicants}` };
  }
  const text = `${job.title} ${job.description}`.toLowerCase();
  for (const kw of RULES.excludeKeywords) {
    if (text.includes(kw.toLowerCase())) {
      return { passed: false, reason: `Excluded keyword: "${kw}"` };
    }
  }
  return { passed: true };
}

// --- Stage 1: Cheap LLM ---

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a job filter for a web development and marketing agency. Rate this job 0-10.
0-3: Not a fit. 4-6: Maybe. 7-10: Strong fit.
Respond ONLY with JSON: {"score": <number>, "reason": "<one sentence>"}`;

function formatJobForLLM(job: any): string {
  return [
    `Title: ${job.title}`,
    `Description: ${job.description?.slice(0, 2000)}`,
    `Skills: ${job.skills?.map((s: any) => s.prettyName).join(", ") || "N/A"}`,
    `Budget: ${job.amount?.displayValue || "N/A"}`,
    `Hourly: ${job.hourlyBudgetMin?.displayValue || "?"} - ${job.hourlyBudgetMax?.displayValue || "?"}`,
    `Applicants: ${job.totalApplicants}`,
    `Client hires: ${job.client?.totalHires}, spent: ${job.client?.totalSpent?.displayValue || "?"}`,
    `Client verified: ${job.client?.verificationStatus || "N/A"}`,
  ].join("\n");
}

async function classifyJob(job: any): Promise<{ score: number; reason: string }> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: formatJobForLLM(job) },
    ],
    temperature: 0.1,
    max_tokens: 100,
  });

  const content = response.choices[0]?.message?.content || "";
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    const parsed = JSON.parse(match[0]);
    return { score: Number(parsed.score), reason: String(parsed.reason) };
  }
  return { score: 0, reason: `Parse error: ${content.slice(0, 80)}` };
}

// --- Transform Upwork job → Airtable record fields ---

function jobToAirtableFields(job: any, llmResult: { score: number; reason: string }): Record<string, any> {
  const budget = job.amount?.displayValue
    ? parseFloat(job.amount.displayValue.replace(/[^0-9.]/g, ""))
    : undefined;

  return {
    Title: job.title,
    "Upwork ID": job.id,
    URL: `https://www.upwork.com/jobs/${job.ciphertext}`,
    Description: job.description?.slice(0, 10000),
    Skills: job.skills?.map((s: any) => s.prettyName).join(", ") || "",
    ...(budget ? { Budget: budget } : {}),
    "Hourly Min": job.hourlyBudgetMin ? parseFloat(job.hourlyBudgetMin.displayValue.replace(/[^0-9.]/g, "")) : undefined,
    "Hourly Max": job.hourlyBudgetMax ? parseFloat(job.hourlyBudgetMax.displayValue.replace(/[^0-9.]/g, "")) : undefined,
    "Experience Level": job.experienceLevel || undefined,
    Applicants: job.totalApplicants,
    "Client Hires": job.client?.totalHires,
    "Client Spent": job.client?.totalSpent?.displayValue
      ? parseFloat(job.client.totalSpent.displayValue.replace(/[^0-9.]/g, ""))
      : undefined,
    "Client Feedback": job.client?.totalFeedback ? parseFloat(job.client.totalFeedback) : undefined,
    "Client Verified": job.client?.verificationStatus === "VERIFIED",
    "Client Country": job.client?.location?.country || "",
    "Posted At": job.createdDateTime,
    Status: "New Jobs",
    "AI Score": llmResult.score,
    Summary: llmResult.reason,
    "Filter Stage": "stage1_cheap",
    "Search Label": SEARCH_EXPRESSION,
    "Fetched At": new Date().toISOString(),
  };
}

// --- Main Pipeline ---

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
    console.error("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID in .env");
    process.exit(1);
  }

  if (!existsSync(TOKENS_PATH)) {
    console.error("No tokens found. Run `npm run test:auth` first.");
    process.exit(1);
  }
  const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf-8"));

  if (new Date(tokens.expires_at) < new Date()) {
    console.error("Token expired. Run `npm run test:auth` again.");
    process.exit(1);
  }

  console.log(`\nPipeline: searching "${SEARCH_EXPRESSION}"...\n`);

  // Fetch from Upwork
  const jobs = await fetchJobs(tokens.access_token);
  console.log(`\nFetched ${jobs.length} jobs from Upwork.\n`);

  // Dedupe against Airtable
  console.log("Checking Airtable for existing jobs...");
  const existingIds = await getExistingUpworkIds();
  const newJobs = jobs.filter(j => !existingIds.has(j.id));
  console.log(`After dedupe: ${newJobs.length} new (${jobs.length - newJobs.length} already in Airtable)\n`);

  // Process
  const passing: any[] = [];
  let rejectedRules = 0;
  let rejectedLLM = 0;

  for (const job of newJobs) {
    // Stage 0
    const ruleCheck = applyRules(job);
    if (!ruleCheck.passed) {
      rejectedRules++;
      appendFileSync(REJECTED_PATH, JSON.stringify({
        id: job.id, title: job.title, stage: "rules", reason: ruleCheck.reason, ts: new Date().toISOString(),
      }) + "\n");
      continue;
    }

    // Stage 1
    const llmResult = await classifyJob(job);
    if (llmResult.score < LLM_THRESHOLD) {
      rejectedLLM++;
      appendFileSync(REJECTED_PATH, JSON.stringify({
        id: job.id, title: job.title, stage: "cheap_llm", score: llmResult.score, reason: llmResult.reason, ts: new Date().toISOString(),
      }) + "\n");
    } else {
      passing.push(jobToAirtableFields(job, llmResult));
    }

    await new Promise(r => setTimeout(r, 200));
  }

  // Push to Airtable
  if (passing.length > 0) {
    console.log(`Pushing ${passing.length} jobs to Airtable...`);
    await pushJobsToAirtable(passing);
    console.log("Done.\n");
  }

  // Summary
  console.log("========================================");
  console.log("  PIPELINE RESULTS");
  console.log("========================================\n");
  console.log(`Total fetched:     ${jobs.length}`);
  console.log(`Duplicates:        ${jobs.length - newJobs.length}`);
  console.log(`New jobs:          ${newJobs.length}`);
  console.log(`Rejected (rules):  ${rejectedRules}`);
  console.log(`Rejected (LLM):    ${rejectedLLM}`);
  console.log(`Pushed to Airtable: ${passing.length}`);
  console.log(`\nRejected jobs logged to: data/rejected.jsonl`);

  if (passing.length > 0) {
    console.log("\n--- PUSHED TO AIRTABLE ---");
    for (const r of passing) {
      console.log(`  [${r["AI Score"]}/10] ${r.Title}`);
      console.log(`    ${r.URL}`);
      console.log(`    ${r.Summary}\n`);
    }
  }
}

main().catch(console.error);
