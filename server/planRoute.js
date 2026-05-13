/*
 * Latent Canvas reference server.
 *
 * Serves the static frontend AND a POST /api/plan endpoint that:
 *   - takes { userPrompt, detectedClasses, signals, currentPlan, ... }
 *   - calls Anthropic with the planner system + user prompt
 *   - parses + validates the model's JSON output with validateActionPlan
 *   - returns { ok, plan, errors }
 *
 * Single port so the frontend can hit /api/plan without CORS gymnastics.
 *
 * Requires: ANTHROPIC_API_KEY in the environment, and `npm install` at the
 * project root (depends on @anthropic-ai/sdk).
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

import { validateActionPlan } from "../llm/validateActionPlan.js";
import { SYSTEM_PROMPT, buildUserMessage } from "../llm/plannerPrompt.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8000;
const MODEL = process.env.LATENT_CANVAS_MODEL || "claude-sonnet-4-6";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;
if (!client) {
  console.warn(
    "[server] ANTHROPIC_API_KEY not set — /api/plan will return 503. " +
      "The frontend will fall back to its local mock planner.",
  );
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes > 64 * 1024) {
        req.destroy();
        reject(new Error("body_too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function handlePlan(req, res) {
  if (!client) {
    sendJson(res, 503, {
      ok: false,
      plan: null,
      errors: ["anthropic_api_key_not_configured"],
    });
    return;
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw);
  } catch (e) {
    sendJson(res, 400, { ok: false, plan: null, errors: ["invalid_request_body"] });
    return;
  }

  const detectedClasses = Array.isArray(payload?.detectedClasses)
    ? payload.detectedClasses
    : [];

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(payload) }],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const v = validateActionPlan(text, { detectedClasses });
    sendJson(res, 200, { ok: v.ok, plan: v.plan, errors: v.errors });
  } catch (err) {
    console.error("[plan] anthropic error:", err);
    sendJson(res, 500, {
      ok: false,
      plan: null,
      errors: [String(err.message || err)],
    });
  }
}

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch (_) {
    res.writeHead(400);
    res.end("bad request");
    return;
  }
  if (urlPath === "/") urlPath = "/index.html";
  const fp = path.normalize(path.join(ROOT, urlPath));
  if (!fp.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.stat(fp, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(fp).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/plan") {
    handlePlan(req, res);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Latent Canvas: http://localhost:${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log(client ? "Planner: live" : "Planner: disabled (no API key)");
});
