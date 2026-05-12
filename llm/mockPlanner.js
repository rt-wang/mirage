/*
 * Deterministic keyword-based fallback planner.
 *
 * Used when the real /api/plan backend isn't reachable so the prompt UI still
 * does something visible in the static-only dev path. Not a substitute for the
 * LLM — it can only recognize a small set of mood keywords — but enough to
 * verify the prompt → plan → renderer pipeline end-to-end.
 *
 * The output is intentionally LOOSE; the validator will tighten it up.
 */

const DEVICE_CLASSES = ["laptop", "cell phone", "tv", "keyboard", "mouse", "remote"];

const MOODS = {
  sacred: {
    palette: [235, 210, 130],
    title: "Sacred",
    objectActions: [
      { type: "aura", opacity: 0.75, color: [255, 220, 140], radius: 0.42, pulse: 0.22 },
      { type: "spotlight", opacity: 0.6, backgroundDim: 0.32, feather: 0.55 },
    ],
    label: "witness",
  },
  holy: { alias: "sacred" },
  warm: {
    palette: [255, 200, 150],
    title: "Warm Field",
    objectActions: [
      { type: "aura", opacity: 0.6, color: [255, 200, 150], radius: 0.35, pulse: 0.1 },
    ],
    globalStyle: { tint: [255, 220, 200], saturation: 0.6, contrast: 0.55 },
  },
  poisonous: {
    palette: [90, 255, 150],
    title: "Poison Engine",
    objectActions: [
      { type: "glitch", opacity: 0.78, sliceAmount: 0.55, displacement: 0.35 },
      { type: "localEdges", opacity: 0.9, glow: 0.55, color: [90, 255, 150], thickness: 0.35 },
    ],
    label: "poison engine",
  },
  radioactive: { alias: "poisonous" },
  haunted: {
    palette: [200, 220, 255],
    title: "Haunted",
    objectActions: [
      { type: "trail", opacity: 0.6, length: 0.7, smear: 0.3 },
      { type: "localLines", opacity: 0.7, color: [220, 230, 255], thickness: 0.25, jitter: 0.12 },
    ],
    globalStyle: { saturation: 0.25, grain: 0.18 },
    label: "phantom",
  },
  cursed: { alias: "haunted" },
  cold: {
    palette: [120, 170, 255],
    title: "Cold Mirror",
    objectActions: [
      { type: "localLines", opacity: 0.85, color: [185, 225, 255], thickness: 0.3, jitter: 0.04 },
      { type: "localEdges", opacity: 0.5, glow: 0.3, color: [200, 230, 255], thickness: 0.2 },
    ],
    globalStyle: { tint: [120, 160, 220], saturation: 0.2, contrast: 0.7 },
  },
  icy: { alias: "cold" },
  glitch: {
    palette: [255, 100, 200],
    title: "Glitch Storm",
    objectActions: [
      { type: "glitch", opacity: 0.9, sliceAmount: 0.7, displacement: 0.55 },
      { type: "trail", opacity: 0.5, length: 0.55, smear: 0.25 },
    ],
    globalStyle: { tint: [255, 110, 200], grain: 0.32, blendMode: "difference" },
    label: "broken signal",
  },
  broken: { alias: "glitch" },
  dream: {
    palette: [220, 200, 255],
    title: "Soft Dream",
    objectActions: [
      { type: "aura", opacity: 0.5, color: [220, 200, 255], radius: 0.4, pulse: 0.18 },
      { type: "trail", opacity: 0.4, length: 0.6, smear: 0.35 },
    ],
    globalStyle: { sourceOpacity: 0.55, saturation: 0.45, grain: 0.2, blendMode: "screen" },
  },
  soft: { alias: "dream" },
  violent: {
    palette: [255, 70, 60],
    title: "Violent Edge",
    objectActions: [
      { type: "glitch", opacity: 0.65, sliceAmount: 0.4, displacement: 0.45 },
      { type: "localEdges", opacity: 0.95, glow: 0.7, color: [255, 70, 60], thickness: 0.4 },
    ],
    globalStyle: { tint: [255, 90, 80], contrast: 0.7, blendMode: "difference" },
  },
};

function resolveMood(name) {
  let m = MOODS[name];
  while (m && m.alias) m = MOODS[m.alias];
  return m || null;
}

const TARGET_HINTS = {
  person: ["person", "people", "self", "face", "human", "me", "myself"],
  device: ["device", "devices", "laptop", "phone", "screen", "computer", "machine", "tv"],
};

function detectTarget(prompt) {
  const lower = prompt.toLowerCase();
  for (const [target, words] of Object.entries(TARGET_HINTS)) {
    for (const w of words) {
      if (lower.includes(w)) return target;
    }
  }
  return null;
}

function findMoods(prompt) {
  const lower = prompt.toLowerCase();
  const found = [];
  for (const key of Object.keys(MOODS)) {
    if (lower.includes(key)) found.push(key);
  }
  // De-duplicate aliases (cursed → haunted)
  const seen = new Set();
  const out = [];
  for (const k of found) {
    const r = resolveMood(k);
    if (!r) continue;
    const id = r.title;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

function classesForTarget(target, detectedClasses) {
  if (!target) return null;
  if (target === "person") return ["person"];
  if (target === "device") {
    const present = detectedClasses.filter((c) => DEVICE_CLASSES.includes(c));
    return present.length > 0 ? present : DEVICE_CLASSES;
  }
  return null;
}

export function mockPlanFromPrompt(prompt, payload) {
  const detectedClasses = Array.isArray(payload?.detectedClasses) ? payload.detectedClasses : [];
  const moods = findMoods(prompt || "");
  const target = detectTarget(prompt || "");

  // Sensible default if we can't parse anything.
  if (moods.length === 0) {
    const mood = MOODS.warm;
    return {
      title: `Mock: ${prompt?.slice(0, 32) || "Warm Field"}`,
      globalStyle: mood.globalStyle || { tint: mood.palette, saturation: 0.5, contrast: 0.55 },
      objectRules: [
        { selector: {}, actions: mood.objectActions, label: { mode: "literal" } },
      ],
    };
  }

  const globalStyle = {};
  const rules = [];
  for (const mood of moods) {
    if (mood.globalStyle) Object.assign(globalStyle, mood.globalStyle);
    const cls = classesForTarget(target, detectedClasses);
    rules.push({
      selector: cls ? { classes: cls, minScore: 0.35 } : {},
      label: mood.label ? { mode: "poetic", text: mood.label } : { mode: "literal" },
      actions: mood.objectActions,
    });
  }

  return {
    title: `Mock: ${moods.map((m) => m.title).join(" + ")}`.slice(0, 48),
    globalStyle,
    objectRules: rules,
  };
}
