/**
 * Archive: moves old Discarded jobs from Airtable to local JSONL.
 * Run weekly to keep the board clean.
 *
 * Usage: npm run archive
 * What it does:
 *   - Finds all "Discarded" jobs older than 7 days
 *   - Appends them to data/archived.jsonl
 *   - Deletes them from Airtable
 */

import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

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

const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_TABLE = process.env.AIRTABLE_JOBS_TABLE || "Jobs";
const DATA_DIR = process.env.DATA_DIR || resolve(process.cwd(), "data");
const ARCHIVE_PATH = resolve(DATA_DIR, "archived.jsonl");
const DAYS_THRESHOLD = 7;

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

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
    console.error("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID in .env");
    process.exit(1);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS_THRESHOLD);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  console.log(`[archive] Finding Discarded jobs older than ${cutoffStr}...\n`);

  // Fetch discarded jobs with Fetched At before cutoff
  const formula = encodeURIComponent(
    `AND({Status}='Discarded', IS_BEFORE({Fetched At}, '${cutoffStr}'))`
  );

  const toDelete: { id: string; fields: any }[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ filterByFormula: decodeURIComponent(formula), pageSize: "100" });
    if (offset) params.set("offset", offset);
    const data: any = await airtableFetch(`?${params}`);
    for (const rec of data.records) {
      toDelete.push({ id: rec.id, fields: rec.fields });
    }
    offset = data.offset;
  } while (offset);

  console.log(`  Found ${toDelete.length} records to archive.\n`);

  if (toDelete.length === 0) {
    console.log("  Nothing to archive. Done.");
    return;
  }

  // Archive locally
  for (const rec of toDelete) {
    appendFileSync(ARCHIVE_PATH, JSON.stringify({ ...rec.fields, _airtable_id: rec.id, _archived_at: new Date().toISOString() }) + "\n");
  }
  console.log(`  Appended to ${ARCHIVE_PATH}`);

  // Delete from Airtable (max 10 per request)
  for (let i = 0; i < toDelete.length; i += 10) {
    const batch = toDelete.slice(i, i + 10);
    const ids = batch.map(r => `records[]=${r.id}`).join("&");
    await airtableFetch(`?${ids}`, { method: "DELETE" });
    console.log(`  Deleted batch ${Math.floor(i / 10) + 1} (${batch.length} records)`);
  }

  console.log(`\n  Done. Archived ${toDelete.length} records.`);
}

main().catch(err => {
  console.error("\nFATAL:", err.message || err);
  process.exit(1);
});
