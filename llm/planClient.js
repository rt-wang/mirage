/*
 * Browser-side planner client.
 *
 * Tries the real /api/plan endpoint first. On any failure (no backend, 404,
 * timeout, non-OK response, invalid plan) falls back to a deterministic local
 * mock so the prompt UI is still functional in the static-only dev path.
 *
 * Always validates the result locally — even when the server is the one
 * that validated it. The renderer never sees a non-sanitized plan.
 */

import { validateActionPlan } from "./validateActionPlan.js";
import { mockPlanFromPrompt } from "./mockPlanner.js";

const ENDPOINT = "/api/plan";
const TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function requestActionPlan(payload) {
  const detectedClasses = Array.isArray(payload.detectedClasses) ? payload.detectedClasses : [];
  // 1. Attempt real backend.
  try {
    const res = await fetchWithTimeout(
      ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`http_${res.status}`);
    const json = await res.json();
    if (!json || json.ok === false || !json.plan) {
      throw new Error((json && json.errors ? json.errors.join(",") : "invalid_response"));
    }
    const v = validateActionPlan(json.plan, { detectedClasses });
    if (!v.ok) throw new Error(v.errors.join(","));
    return { plan: v.plan, source: "llm", warnings: v.errors };
  } catch (err) {
    // 2. Mock fallback.
    const mock = mockPlanFromPrompt(payload.userPrompt || "", payload);
    const v = validateActionPlan(mock, { detectedClasses });
    return {
      plan: v.plan,
      source: "mock",
      warnings: [`backend_unavailable:${err.message || err}`, ...v.errors],
    };
  }
}
