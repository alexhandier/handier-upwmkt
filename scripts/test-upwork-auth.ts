/**
 * Phase 0: Prove we can authenticate with Upwork and pull job data.
 *
 * What this does:
 * 1. Starts a tiny HTTP server on port 7842 (matching your API key's callback URL)
 * 2. Opens your browser to Upwork's OAuth consent page
 * 3. Receives the auth code callback
 * 4. Exchanges code for access + refresh tokens
 * 5. Runs one marketplaceJobPostingsSearch query (10 jobs)
 * 6. Prints field inventory, description lengths, token estimates
 * 7. Saves raw results to data/sample-jobs.json for Phase 1
 *
 * Usage: npm run test:auth
 * Prereq: UPWORK_CLIENT_ID and UPWORK_CLIENT_SECRET in .env.local
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

// Load .env.local or .env
function loadEnv() {
  const candidates = [".env.local", ".env"];
  for (const file of candidates) {
    try {
      const envPath = resolve(process.cwd(), file);
      const content = readFileSync(envPath, "utf-8");
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

const CLIENT_ID = process.env.UPWORK_CLIENT_ID!;
const CLIENT_SECRET = process.env.UPWORK_CLIENT_SECRET!;
const CALLBACK_PORT = 7842;
const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}/callback`;
const AUTH_URL = "https://www.upwork.com/ab/account-security/oauth2/authorize";
const TOKEN_URL = "https://www.upwork.com/api/v3/oauth2/token";
const GRAPHQL_URL = "https://api.upwork.com/graphql";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing UPWORK_CLIENT_ID or UPWORK_CLIENT_SECRET in .env.local");
  process.exit(1);
}

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
        durationLabel
        engagement
        amount { displayValue currency }
        experienceLevel
        category
        subcategory
        totalApplicants
        createdDateTime
        publishedDateTime
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
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: CALLBACK_URL,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function searchJobs(accessToken: string) {
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
          searchExpression_eq: "web development",
          pagination_eq: { after: "0", first: 10 },
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GraphQL request failed (${res.status}): ${text}`);
  }

  return res.json();
}

function printResults(data: any) {
  const search = data.data?.marketplaceJobPostingsSearch;
  if (!search) {
    console.error("\nNo search data in response:");
    console.error(JSON.stringify(data, null, 2));
    return;
  }

  console.log("\n========================================");
  console.log("  UPWORK API PROBE RESULTS");
  console.log("========================================\n");
  console.log(`Total matching jobs: ${search.totalCount}`);
  console.log(`Jobs returned: ${search.edges.length}`);
  console.log(`Has next page: ${search.pageInfo.hasNextPage}\n`);

  let totalChars = 0;
  const jobs: any[] = [];

  for (const edge of search.edges) {
    const job = edge.node;
    jobs.push(job);
    const descLen = job.description?.length || 0;
    totalChars += JSON.stringify(job).length;

    console.log(`--- ${job.title} ---`);
    console.log(`  ID: ${job.id}`);
    console.log(`  URL: https://www.upwork.com/jobs/${job.ciphertext}`);
    console.log(`  Description: ${descLen} chars`);
    console.log(`  Skills: ${job.skills?.map((s: any) => s.prettyName).join(", ") || "none"}`);
    console.log(`  Budget: ${job.amount?.displayValue || "N/A"} ${job.amount?.currency || ""}`);
    console.log(`  Hourly: ${job.hourlyBudgetMin?.displayValue || "?"} - ${job.hourlyBudgetMax?.displayValue || "?"}`);
    console.log(`  Experience: ${job.experienceLevel}`);
    console.log(`  Applicants: ${job.totalApplicants}`);
    console.log(`  Client: hires=${job.client?.totalHires}, spent=${job.client?.totalSpent?.displayValue || "?"}, feedback=${job.client?.totalFeedback}, verified=${job.client?.verificationStatus}`);
    console.log(`  Country: ${job.client?.location?.country || "?"}`);
    console.log(`  Posted: ${job.createdDateTime}`);
    console.log("");
  }

  const avgChars = Math.ceil(totalChars / search.edges.length);
  const avgTokens = Math.ceil(avgChars / 4);

  console.log("========================================");
  console.log("  COST ESTIMATES");
  console.log("========================================\n");
  console.log(`Avg chars per job (full JSON): ${avgChars}`);
  console.log(`Avg tokens per job (est.): ~${avgTokens}`);
  console.log(`For 50 jobs batch:`);
  console.log(`  gpt-5.4-mini input: ~$${((avgTokens * 50 * 0.15) / 1_000_000).toFixed(4)}`);
  console.log(`  gpt-5.4 input:      ~$${((avgTokens * 50 * 2.5) / 1_000_000).toFixed(4)}`);
  console.log(`For 400 jobs (target/hr):`);
  console.log(`  gpt-5.4-mini input: ~$${((avgTokens * 400 * 0.15) / 1_000_000).toFixed(4)}`);
  console.log(`  gpt-5.4 input:      ~$${((avgTokens * 400 * 2.5) / 1_000_000).toFixed(4)}`);

  // Save sample data
  mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  writeFileSync(
    resolve(process.cwd(), "data/sample-jobs.json"),
    JSON.stringify(jobs, null, 2)
  );
  console.log("\nSample jobs saved to data/sample-jobs.json");
}

// Main: start server, open browser, wait for callback
function main() {
  console.log("Starting Upwork OAuth flow...\n");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${CALLBACK_PORT}`);

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400);
        res.end("Missing code parameter");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Auth successful! Check your terminal.</h1><script>window.close()</script>");

      console.log("Received auth code. Exchanging for token...\n");

      try {
        const tokens = await exchangeCode(code);
        console.log(`Access token: ${tokens.access_token.slice(0, 30)}...`);
        console.log(`Refresh token: ${tokens.refresh_token.slice(0, 20)}...`);
        console.log(`Expires in: ${tokens.expires_in}s`);

        // Save tokens for later scripts
        writeFileSync(
          resolve(process.cwd(), "data/tokens.json"),
          JSON.stringify({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          }, null, 2)
        );
        console.log("Tokens saved to data/tokens.json\n");

        console.log("Running search query...");
        const results = await searchJobs(tokens.access_token);

        if (results.errors) {
          console.error("GraphQL errors:", JSON.stringify(results.errors, null, 2));
        }

        printResults(results);
      } catch (err) {
        console.error("Error:", err);
      } finally {
        server.close();
        process.exit(0);
      }
    }
  });

  server.listen(CALLBACK_PORT, () => {
    const authUrl = `${AUTH_URL}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(CALLBACK_URL)}`;
    console.log(`Callback server listening on port ${CALLBACK_PORT}`);
    console.log(`\nOpening browser to:\n${authUrl}\n`);

    // Open browser (macOS)
    try {
      execSync(`open "${authUrl}"`);
    } catch {
      console.log("Could not open browser automatically. Visit the URL above.");
    }
  });
}

main();
