/*
 * Latent Canvas — Phase 3.
 *
 * Pipeline:
 *   getUserMedia → hidden <video>
 *     → captureCanvas (mirrored at capture, so all downstream coords are
 *       already in display space)
 *       → COCO-SSD → raw detections
 *         → tracker → DetectedObject[] (stable ids, smoothed bboxes)
 *           → object-local CV → Map<id, ObjectGeometry>
 *             → renderer:
 *                 - neutral preset → drawNeutralPreview
 *                 - styled preset → drawStyledPlan(plan, intensity)
 *
 * Intensity is exponentially smoothed toward its target every frame so slider
 * drags and preset switches feel continuous instead of stepping. A preset
 * change also briefly ducks the current intensity to zero then back to the
 * slider value, which keeps action transitions from popping.
 */

import { loadDetector, detect } from "./analysis/objectDetector.js";
import { createTracker } from "./analysis/objectTracker.js";
import { computeObjectGeometry, isReady as isCvReady } from "./analysis/objectLocalCv.js";
import { drawNeutralPreview } from "./render/neutralPreview.js";
import { drawStyledPlan } from "./render/actionRenderer.js";
import { resetTrail } from "./render/actions/trail.js";
import { PRESETS, findPreset } from "./llm/defaultPlans.js";

const video = document.getElementById("video");
const outputCanvas = document.getElementById("output");
const outputCtx = outputCanvas.getContext("2d");

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

const ui = {
  fps: document.getElementById("fps"),
  status: document.getElementById("status"),
  countBadge: document.getElementById("countBadge"),
  planTitle: document.getElementById("planTitle"),
  presetRow: document.getElementById("presetRow"),
  intensitySlider: document.getElementById("intensitySlider"),
  intensityValue: document.getElementById("intensityValue"),
  boot: document.getElementById("boot"),
  bootStep: document.getElementById("bootStep"),
  bootBar: document.getElementById("bootBar"),
};

const state = {
  detector: null,
  tracker: createTracker(),
  objects: [],
  geometries: new Map(),
  presetId: "neutral",
  // Master intensity: targetIntensity is what the slider asks for; current
  // chases it via EMA so changes don't snap.
  targetIntensity: 0.8,
  currentIntensity: 0.8,
  // When a preset changes we duck briefly: clamp current intensity to 0 then
  // let it ramp back up to target. presetSwitchAt is the timestamp of the duck.
  presetSwitchAt: 0,
  fpsAcc: { last: performance.now(), frames: 0 },
};

const INTENSITY_SMOOTHING = 0.12; // 0..1 per frame
const PRESET_DUCK_MS = 220;

function setStatus(text, ready = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("is-ready", ready);
}

function setBootStep(text, pct) {
  ui.bootStep.textContent = text;
  if (typeof pct === "number") ui.bootBar.style.width = `${pct}%`;
}

function hideBoot() {
  ui.boot.classList.add("is-hidden");
}

async function setupCamera() {
  setBootStep("requesting camera…", 10);
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: "user",
    },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  await video.play();
  sizeCanvases();
  setBootStep("camera ready", 40);
}

function sizeCanvases() {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  outputCanvas.width = w;
  outputCanvas.height = h;
  captureCanvas.width = w;
  captureCanvas.height = h;
}

function captureFrame() {
  const w = captureCanvas.width;
  const h = captureCanvas.height;
  captureCtx.save();
  captureCtx.setTransform(-1, 0, 0, 1, w, 0);
  captureCtx.drawImage(video, 0, 0, w, h);
  captureCtx.restore();
}

function updateCountBadge(objects) {
  const live = objects.filter((o) => !o.stale).length;
  ui.countBadge.textContent = `${live} ${live === 1 ? "object" : "objects"}`;
}

function tickFps(now) {
  state.fpsAcc.frames += 1;
  const elapsed = now - state.fpsAcc.last;
  if (elapsed >= 500) {
    const fps = (state.fpsAcc.frames * 1000) / elapsed;
    ui.fps.textContent = `${fps.toFixed(0)} fps`;
    state.fpsAcc.frames = 0;
    state.fpsAcc.last = now;
  }
}

function effectiveTargetIntensity(now) {
  // During the duck window after a preset switch we pull target to 0 so the
  // EMA falls; once the window expires it rises back to the slider value.
  const dt = now - state.presetSwitchAt;
  if (dt < PRESET_DUCK_MS) {
    return 0;
  }
  return state.targetIntensity;
}

function updateIntensitySliderFill(value) {
  ui.intensitySlider.style.setProperty("--fill", `${value * 100}%`);
  ui.intensityValue.textContent = String(Math.round(value * 100));
}

function selectPreset(id) {
  const preset = findPreset(id);
  if (preset.id === state.presetId) return;
  state.presetId = preset.id;
  state.presetSwitchAt = performance.now();
  ui.planTitle.textContent = preset.plan ? preset.plan.title : preset.title;
  // Reset any persistent layers (the trail canvas) so the new preset starts
  // clean instead of inheriting smear from the previous one.
  resetTrail();
  for (const btn of ui.presetRow.children) {
    const active = btn.dataset.preset === id;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
}

function buildPresetUi() {
  for (const p of PRESETS) {
    const btn = document.createElement("button");
    btn.className = "preset" + (p.id === state.presetId ? " is-active" : "");
    btn.type = "button";
    btn.dataset.preset = p.id;
    btn.textContent = p.title;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", p.id === state.presetId ? "true" : "false");
    btn.addEventListener("click", () => selectPreset(p.id));
    ui.presetRow.appendChild(btn);
  }
}

function wireUi() {
  buildPresetUi();
  const onSlider = () => {
    const v = Number(ui.intensitySlider.value) / 100;
    state.targetIntensity = v;
    updateIntensitySliderFill(v);
  };
  ui.intensitySlider.addEventListener("input", onSlider);
  onSlider();

  // Keyboard shortcuts: 1..N picks presets in order.
  window.addEventListener("keydown", (e) => {
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= PRESETS.length) {
      selectPreset(PRESETS[n - 1].id);
    }
  });
}

async function loop() {
  const now = performance.now();
  if (video.readyState >= 2 && state.detector) {
    captureFrame();
    try {
      const raw = await detect(state.detector, captureCanvas);
      state.objects = state.tracker.update(raw, {
        canvasWidth: captureCanvas.width,
        canvasHeight: captureCanvas.height,
        now,
      });
      state.geometries = isCvReady()
        ? computeObjectGeometry(captureCanvas, state.objects)
        : new Map();

      // EMA the master intensity toward its effective target (duck-aware).
      const target = effectiveTargetIntensity(now);
      state.currentIntensity += (target - state.currentIntensity) * INTENSITY_SMOOTHING;
      if (state.currentIntensity < 0.001) state.currentIntensity = 0;

      const preset = findPreset(state.presetId);
      if (preset.plan && state.currentIntensity > 0.01) {
        drawStyledPlan(
          outputCtx,
          captureCanvas,
          state.objects,
          state.geometries,
          preset.plan,
          { intensity: state.currentIntensity, timeMs: now },
        );
      } else {
        drawNeutralPreview(outputCtx, captureCanvas, state.objects, state.geometries);
      }

      updateCountBadge(state.objects);
    } catch (err) {
      console.error("[loop] error:", err);
    }
  }
  tickFps(now);
  requestAnimationFrame(loop);
}

async function main() {
  try {
    wireUi();
    await setupCamera();
    setBootStep("loading detector…", 60);
    state.detector = await loadDetector();
    setBootStep("ready", 100);
    setStatus("ready", true);
    hideBoot();
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    setBootStep(`error: ${err.message || err}`, 100);
    setStatus("error");
  }
}

main();
