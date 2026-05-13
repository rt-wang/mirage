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
  feedToggle: document.getElementById("feedToggle"),
  cameraBtn: document.getElementById("cameraBtn"),
  videoUpload: document.getElementById("videoUpload"),
  uploadLabel: document.getElementById("uploadLabel"),
  sourceFilename: document.getElementById("sourceFilename"),
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
  hideFeed: false,
  sourceMode: "camera",
  mirrorCapture: true,
  cameraStream: null,
  videoObjectUrl: null,
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

async function startCamera() {
  video.src = "";
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: "user",
    },
    audio: false,
  });
  state.cameraStream = stream;
  video.srcObject = stream;
  video.loop = false;
  state.mirrorCapture = true;
  state.sourceMode = "camera";
  await new Promise((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  await video.play();
  sizeCanvases();
}

async function setupCamera() {
  setBootStep("requesting camera…", 10);
  await startCamera();
  setBootStep("camera ready", 40);
}

async function setupVideoFile(file) {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
    video.srcObject = null;
  }
  if (state.videoObjectUrl) {
    URL.revokeObjectURL(state.videoObjectUrl);
  }
  state.videoObjectUrl = URL.createObjectURL(file);
  video.src = state.videoObjectUrl;
  video.loop = true;
  state.mirrorCapture = false;
  state.sourceMode = "video";
  await new Promise((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  await video.play();
  sizeCanvases();
  updateSourceUi(file.name);
}

async function switchToCamera() {
  if (state.sourceMode === "camera") return;
  video.pause();
  if (state.videoObjectUrl) {
    URL.revokeObjectURL(state.videoObjectUrl);
    state.videoObjectUrl = null;
  }
  try {
    await startCamera();
    updateSourceUi(null);
  } catch (err) {
    console.error("[switchToCamera]", err);
    setStatus("camera error");
  }
}

function updateSourceUi(filename) {
  const inVideo = state.sourceMode === "video";
  ui.cameraBtn.classList.toggle("is-active", !inVideo);
  ui.uploadLabel.classList.toggle("is-active", inVideo);
  if (filename) {
    const short = filename.length > 30 ? filename.slice(0, 28) + "…" : filename;
    ui.sourceFilename.textContent = short;
  } else {
    ui.sourceFilename.textContent = "";
  }
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
  if (state.mirrorCapture) {
    captureCtx.setTransform(-1, 0, 0, 1, w, 0);
  }
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

  ui.feedToggle.addEventListener("click", () => {
    state.hideFeed = !state.hideFeed;
    ui.feedToggle.classList.toggle("is-active", state.hideFeed);
    ui.feedToggle.setAttribute("aria-pressed", state.hideFeed ? "true" : "false");
    ui.feedToggle.textContent = state.hideFeed ? "Show Feed" : "Hide Feed";
  });

  ui.cameraBtn.addEventListener("click", switchToCamera);
  ui.videoUpload.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await setupVideoFile(file);
    } catch (err) {
      console.error("[videoUpload]", err);
      setStatus("video error");
    }
    e.target.value = "";
  });

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
          { intensity: state.currentIntensity, timeMs: now, hideFeed: state.hideFeed },
        );
      } else {
        drawNeutralPreview(outputCtx, captureCanvas, state.objects, state.geometries, { hideFeed: state.hideFeed });
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
