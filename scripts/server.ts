/**
 * Production HTTP server for the miner service.
 * Handles OAuth re-authentication and health/status checks.
 *
 * Routes:
 *   GET /           — health check
 *   GET /auth       — redirects to Upwork OAuth
 *   GET /auth/callback — exchanges code, saves tokens
 *   GET /status     — token expiry, last run info
 *
 * Usage: npx tsx scripts/server.ts
 * Env: PORT (default 8080), UPWORK_CLIENT_ID, UPWORK_CLIENT_SECRET, UPWORK_REDIRECT_URI
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
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

const PORT = parseInt(process.env.PORT || "8080", 10);
const DATA_DIR = process.env.DATA_DIR || resolve(process.cwd(), "data");
const TOKENS_PATH = resolve(DATA_DIR, "tokens.json");

const CLIENT_ID = process.env.UPWORK_CLIENT_ID!;
const CLIENT_SECRET = process.env.UPWORK_CLIENT_SECRET!;
const REDIRECT_URI = process.env.UPWORK_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const AUTH_URL = "https://www.upwork.com/ab/account-security/oauth2/authorize";
const TOKEN_URL = "https://www.upwork.com/api/v3/oauth2/token";

mkdirSync(DATA_DIR, { recursive: true });

async function exchangeCode(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

function getTokenStatus(): { exists: boolean; expires_at?: string; expired?: boolean; refresh_token?: boolean } {
  if (!existsSync(TOKENS_PATH)) return { exists: false };
  try {
    const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf-8"));
    return {
      exists: true,
      expires_at: tokens.expires_at,
      expired: new Date(tokens.expires_at) < new Date(),
      refresh_token: !!tokens.refresh_token,
    };
  } catch {
    return { exists: false };
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);

  // CORS headers for Airtable extension
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  if (url.pathname === "/" || url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "upwork-miner", timestamp: new Date().toISOString() }));
    return;
  }

  if (url.pathname === "/auth") {
    const authUrl = `${AUTH_URL}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  if (url.pathname === "/auth/callback") {
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h1>Error: missing code parameter</h1>");
      return;
    }

    try {
      const tokens = await exchangeCode(code);
      const saved = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      };
      writeFileSync(TOKENS_PATH, JSON.stringify(saved, null, 2));

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html><body style="font-family:system-ui;text-align:center;padding:60px;background:#0a0a0a;color:#fafafa">
          <h1 style="color:#22c55e">Authentication successful</h1>
          <p style="color:#a1a1aa;margin-top:16px">Tokens saved. The miner will resume on its next scheduled run.</p>
          <p style="color:#a1a1aa;font-size:14px;margin-top:32px">Token expires: ${saved.expires_at}</p>
          <p style="color:#52525b;font-size:12px;margin-top:8px">You can close this tab.</p>
        </body></html>
      `);
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`
        <html><body style="font-family:system-ui;text-align:center;padding:60px;background:#0a0a0a;color:#fafafa">
          <h1 style="color:#ef4444">Authentication failed</h1>
          <p style="color:#a1a1aa">${err.message}</p>
          <p style="color:#52525b;margin-top:16px">Try again or check server logs.</p>
        </body></html>
      `);
    }
    return;
  }

  if (url.pathname === "/status") {
    const tokenStatus = getTokenStatus();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      service: "upwork-miner",
      timestamp: new Date().toISOString(),
      tokens: tokenStatus,
      data_dir: DATA_DIR,
    }, null, 2));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  console.log(`[server] Auth URL: ${REDIRECT_URI.replace("/auth/callback", "/auth")}`);
  console.log(`[server] Data dir: ${DATA_DIR}`);
  console.log(`[server] Tokens: ${existsSync(TOKENS_PATH) ? "found" : "not found (needs auth)"}`);
});
