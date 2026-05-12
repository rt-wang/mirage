/*
 * Hardcoded preset ActionPlans for Phase 3.
 *
 * These exist so the action vocabulary can be exercised without the LLM.
 * Each preset is intentionally different in feel so switching between them
 * makes it obvious that the system can produce meaningfully different looks
 * from the same detected objects.
 *
 * `neutral` has a null plan — the host falls back to neutralPreview for it.
 */

export const PRESETS = [
  {
    id: "neutral",
    title: "Neutral",
    plan: null,
  },
  {
    id: "sacred-contamination",
    title: "Sacred Contamination",
    plan: {
      title: "Sacred Contamination",
      globalStyle: {
        sourceOpacity: 0.78,
        tint: [195, 215, 185],
        contrast: 0.58,
        saturation: 0.46,
        grain: 0.14,
        trailLength: 0.18,
        blendMode: "screen",
      },
      objectRules: [
        {
          selector: { classes: ["person"], minScore: 0.4 },
          label: { mode: "poetic", text: "witness" },
          actions: [
            { type: "aura", opacity: 0.85, color: [235, 210, 130], radius: 0.45, pulse: 0.22 },
            { type: "spotlight", opacity: 0.7, backgroundDim: 0.32, feather: 0.55 },
          ],
        },
        {
          selector: {
            classes: ["laptop", "cell phone", "tv", "keyboard", "remote", "mouse"],
            minScore: 0.4,
          },
          label: { mode: "poetic", text: "poison engine" },
          actions: [
            { type: "glitch", opacity: 0.72, sliceAmount: 0.5, displacement: 0.32 },
            {
              type: "localEdges",
              opacity: 0.88,
              glow: 0.55,
              color: [90, 255, 150],
              thickness: 0.35,
            },
          ],
        },
      ],
    },
  },
  {
    id: "cold-mirror",
    title: "Cold Mirror",
    plan: {
      title: "Cold Mirror",
      globalStyle: {
        sourceOpacity: 0.6,
        tint: [120, 160, 220],
        contrast: 0.72,
        saturation: 0.18,
        grain: 0.08,
        trailLength: 0.0,
        blendMode: "multiply",
      },
      objectRules: [
        {
          selector: {},
          label: { mode: "literal" },
          actions: [
            {
              type: "localLines",
              opacity: 0.9,
              color: [185, 225, 255],
              thickness: 0.28,
              jitter: 0.04,
            },
            {
              type: "localEdges",
              opacity: 0.55,
              glow: 0.35,
              color: [205, 235, 255],
              thickness: 0.2,
            },
          ],
        },
      ],
    },
  },
  {
    id: "glitch-storm",
    title: "Glitch Storm",
    plan: {
      title: "Glitch Storm",
      globalStyle: {
        sourceOpacity: 0.85,
        tint: [255, 110, 200],
        contrast: 0.65,
        saturation: 0.85,
        grain: 0.32,
        trailLength: 0.45,
        blendMode: "difference",
      },
      objectRules: [
        {
          selector: {},
          label: { mode: "hidden" },
          actions: [
            { type: "trail", opacity: 0.65, length: 0.72, smear: 0.3 },
            { type: "glitch", opacity: 0.9, sliceAmount: 0.7, displacement: 0.55 },
            { type: "aura", opacity: 0.4, color: [255, 100, 200], radius: 0.32, pulse: 0.65 },
          ],
        },
      ],
    },
  },
];

export function findPreset(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}
