/**
 * Manual re-authentication for the operator.
 * Run this when the miner reports "AUTH ERROR" — it means the refresh token
 * has expired (happens after ~2 weeks of no use).
 *
 * What it does:
 *   1. Opens a browser to Upwork's OAuth page
 *   2. You click "Authorize"
 *   3. It saves fresh tokens to data/tokens.json
 *   4. The miner will auto-refresh from there for the next 2 weeks
 *
 * Usage: npm run auth
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
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

const CLIENT_ID = process.env.UPWORK_CLIENT_ID!;
const CLIENT_SECRET = process.env.UPWORK_CLIENT_SECRET!;
const CALLBACK_PORT = 7842;
const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}/callback`;
const AUTH_URL = "https://www.upwork.com/ab/account-security/oauth2/authorize";
const TOKEN_URL = "https://www.upwork.com/api/v3/oauth2/token";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing UPWORK_CLIENT_ID or UPWORK_CLIENT_SECRET in .env");
  process.exit(1);
}

async function exchangeCode(code: string) {
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

function main() {
  const dataDir = resolve(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });

  console.log("\n========================================");
  console.log("  UPWORK RE-AUTHENTICATION");
  console.log("========================================\n");
  console.log("A browser window will open. Click 'Authorize' on Upwork.\n");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${CALLBACK_PORT}`);

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400);
        res.end("Missing code");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html><body style="font-family:system-ui;text-align:center;padding:60px">
          <h1 style="color:#22c55e">Authentication successful!</h1>
          <p>You can close this window. The miner will resume automatically.</p>
        </body></html>
      `);

      try {
        const tokens = await exchangeCode(code);

        const saved = {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        };

        writeFileSync(resolve(dataDir, "tokens.json"), JSON.stringify(saved, null, 2));

        console.log("Done! Tokens saved.\n");
        console.log(`  Access token expires: ${saved.expires_at}`);
        console.log("  Refresh token: valid for ~2 weeks (auto-refreshed by miner)\n");
        console.log("You can close this terminal. The miner will pick up the new tokens automatically.\n");
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
    console.log(`Waiting for authorization on port ${CALLBACK_PORT}...\n`);

    try {
      execSync(`open "${authUrl}"`);
    } catch {
      console.log("Could not open browser. Visit this URL manually:\n");
      console.log(`  ${authUrl}\n`);
    }
  });
}

main();
