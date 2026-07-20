/**
 * Phase 1: Prove the LLM can classify a job with structured output.
 *
 * What this does:
 * 1. Loads sample jobs from data/sample-jobs.json (saved by Phase 0)
 * 2. Formats each job into a text prompt
 * 3. Sends to OpenAI gpt-4o-mini with a classification prompt
 * 4. Parses the structured JSON response
 * 5. Prints score + reason for each job
 *
 * Usage: npm run test:filter
 * Prereq: OPENAI_API_KEY in .env.local, data/sample-jobs.json exists (run test:auth first)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";

// Load .env.local or .env
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
    } catch {
      // try next
    }
  }
}

loadEnv();

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in .env.local");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a job filter for a web development and marketing agency. Given a job posting, determine if it could be a fit for our agency to apply to.

We do: web development, web design, marketing websites, landing pages, e-commerce, SaaS development, mobile apps, branding, UI/UX design, and related technical/creative services.

We do NOT do: data entry, virtual assistant work, content writing (articles/blogs), SEO-only services, social media management only, bookkeeping, or non-technical tasks.

Rate the job 0-10 where:
- 0-3: Clearly not a fit (wrong domain, too low budget, spam, non-technical)
- 4-6: Maybe worth a look (partially relevant, unclear scope, borderline budget)
- 7-10: Strong fit (clearly in our wheelhouse, reasonable budget, serious client)

Respond ONLY with valid JSON: {"score": <number>, "reason": "<one sentence>"}`;

function formatJob(job: any): string {
  return [
    `Title: ${job.title}`,
    `Description: ${job.description}`,
    `Skills: ${job.skills?.map((s: any) => s.prettyName || s.name).join(", ") || "N/A"}`,
    `Budget: ${job.amount?.displayValue || "N/A"} ${job.amount?.currency || ""}`,
    `Hourly: ${job.hourlyBudgetMin?.displayValue || "?"} - ${job.hourlyBudgetMax?.displayValue || "?"}`,
    `Experience: ${job.experienceLevel}`,
    `Applicants: ${job.totalApplicants}`,
    `Client hires: ${job.client?.totalHires || 0}`,
    `Client spent: ${job.client?.totalSpent?.displayValue || "N/A"}`,
    `Client feedback: ${job.client?.totalFeedback || "N/A"} (${job.client?.totalReviews || 0} reviews)`,
    `Client verified: ${job.client?.verificationStatus || "N/A"}`,
    `Client country: ${job.client?.location?.country || "N/A"}`,
  ].join("\n");
}

async function classifyJob(jobText: string): Promise<{ score: number; reason: string }> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: jobText },
    ],
    temperature: 0.1,
    max_tokens: 150,
  });

  const content = response.choices[0]?.message?.content || "";
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    const parsed = JSON.parse(match[0]);
    return { score: Number(parsed.score), reason: String(parsed.reason) };
  }
  throw new Error(`Could not parse response: ${content}`);
}

async function main() {
  const samplePath = resolve(process.cwd(), "data/sample-jobs.json");
  let jobs: any[];

  try {
    jobs = JSON.parse(readFileSync(samplePath, "utf-8"));
  } catch {
    console.error("Could not read data/sample-jobs.json");
    console.error("Run `npm run test:auth` first to generate sample data.");
    process.exit(1);
  }

  console.log(`\nClassifying ${jobs.length} jobs with gpt-5.4-mini...\n`);
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;
  const threshold = 4;

  for (const job of jobs) {
    const jobText = formatJob(job);
    const tokenEst = Math.ceil(jobText.length / 4);

    try {
      const result = await classifyJob(jobText);
      const verdict = result.score >= threshold ? "PASS" : "REJECT";
      if (result.score >= threshold) passed++;
      else failed++;

      console.log(`\n[${verdict}] (${result.score}/10) ${job.title}`);
      console.log(`  Reason: ${result.reason}`);
      console.log(`  Tokens: ~${tokenEst}`);
    } catch (err) {
      console.error(`\n[ERROR] ${job.title}: ${err}`);
      failed++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`\nResults: ${passed} passed, ${failed} rejected (threshold: ${threshold}/10)`);
  console.log(`Pass rate: ${((passed / jobs.length) * 100).toFixed(1)}%`);
}

main().catch(console.error);
