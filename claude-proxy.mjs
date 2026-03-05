#!/usr/bin/env node
// Noren — Claude Code local proxy
// Reads your Claude Code OAuth token from macOS keychain and proxies
// requests to the Anthropic API. Your extension connects to localhost:19280.
//
// Usage: node claude-proxy.mjs
//        (or: chmod +x claude-proxy.mjs && ./claude-proxy.mjs)

import { createServer } from "node:http";
import { execSync } from "node:child_process";

const PORT = 19280;
const ANTHROPIC_API = "https://api.anthropic.com";

function getCredentials() {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getAccessToken() {
  const creds = getCredentials();
  if (!creds?.claudeAiOauth?.accessToken) {
    throw new Error("No Claude Code credentials found in keychain. Make sure Claude Code is logged in.");
  }
  return creds.claudeAiOauth.accessToken;
}

async function refreshToken() {
  const creds = getCredentials();
  if (!creds?.claudeAiOauth?.refreshToken) {
    throw new Error("No refresh token available");
  }

  const res = await fetch(`${ANTHROPIC_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.claudeAiOauth.refreshToken,
      client_id: "9d1c250a-e61b-44e4-8ed0-744e079b20c8", // Claude Code's public client ID
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`);
  }

  const data = await res.json();

  // Update keychain with new tokens
  creds.claudeAiOauth.accessToken = data.access_token;
  if (data.refresh_token) {
    creds.claudeAiOauth.refreshToken = data.refresh_token;
  }

  const credsJson = JSON.stringify(creds);
  try {
    // Delete old entry and create new one
    execSync(
      'security delete-generic-password -s "Claude Code-credentials" 2>/dev/null; ' +
      `security add-generic-password -s "Claude Code-credentials" -a "$(whoami)" -w '${credsJson.replace(/'/g, "'\\''")}'`,
      { stdio: "pipe" },
    );
  } catch {
    // Non-fatal — token is still usable this session even if keychain update fails
    console.warn("[proxy] Warning: could not update keychain");
  }

  return data.access_token;
}

async function proxyRequest(req, res) {
  // CORS headers for Chrome extension
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "noren-claude-proxy" }));
    return;
  }

  // Only proxy /v1/* paths
  if (!req.url.startsWith("/v1/")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  // Read request body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  // Try with current token, refresh on 401
  let token;
  try {
    token = getAccessToken();
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
    return;
  }

  let upstream = await fetch(`${ANTHROPIC_API}${req.url}`, {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": token,
      "anthropic-version": req.headers["anthropic-version"] || "2023-06-01",
    },
    body: body.length > 0 ? body : undefined,
  });

  // Token expired — refresh and retry
  if (upstream.status === 401) {
    console.log("[proxy] Token expired, refreshing...");
    try {
      token = await refreshToken();
      console.log("[proxy] Token refreshed successfully");
      upstream = await fetch(`${ANTHROPIC_API}${req.url}`, {
        method: req.method,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": token,
          "anthropic-version": req.headers["anthropic-version"] || "2023-06-01",
        },
        body: body.length > 0 ? body : undefined,
      });
    } catch (refreshErr) {
      console.error("[proxy] Token refresh failed:", refreshErr.message);
    }
  }

  // Forward response
  const responseBody = await upstream.text();
  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || "application/json",
  });
  res.end(responseBody);
}

// Verify credentials exist before starting
try {
  getAccessToken();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const server = createServer(proxyRequest);
server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Noren Claude Proxy running on http://127.0.0.1:${PORT}`);
  console.log(`  Forwarding to ${ANTHROPIC_API}`);
  console.log(`  Press Ctrl+C to stop\n`);
});
