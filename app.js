/*
 * Latent Canvas — Phase 1.
 *
 * Pipeline:
 *   getUserMedia → hidden <video>
 *     → captureCanvas (per-frame source pixels)
 *       → COCO-SSD → raw detections
 *         → tracker → DetectedObject[] (stable ids, smoothed bboxes)
 *           → neutral preview renderer → outputCanvas
 *
 * Object detection is the only analysis root. There is no mode switching;
 * future phases will layer object-local CV and the styled renderer on top of
 * this same DetectedObject stream.
 */

import { loadDetector, detect } from "./analysis/objectDetector.js";
import { createTracker } from "./analysis/objectTracker.js";
import { drawNeutralPreview } from "./render/neutralPreview.js";

const video = document.getElementById("video");
const outputCanvas = document.getElementById("output");
const outputCtx = outputCanvas.getContext("2d");

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

const ui = {
  fps: document.getElementById("fps"),
  status: document.getElementById("status"),
  countBadge: document.getElementById("countBadge"),
  boot: document.getElementById("boot"),
  bootStep: document.getElementById("bootStep"),
  bootBar: document.getElementById("bootBar"),
};

const state = {
  detector: null,
  tracker: createTracker(),
  objects: [],
  fpsAcc: { last: performance.now(), frames: 0 },
};

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
  captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
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

async function loop() {
  if (video.readyState >= 2 && state.detector) {
    captureFrame();
    try {
      const raw = await detect(state.detector, captureCanvas);
      const now = performance.now();
      state.objects = state.tracker.update(raw, {
        canvasWidth: captureCanvas.width,
        canvasHeight: captureCanvas.height,
        now,
      });
      drawNeutralPreview(outputCtx, captureCanvas, state.objects);
      updateCountBadge(state.objects);
    } catch (err) {
      console.error("[loop] error:", err);
    }
  }
  tickFps(performance.now());
  requestAnimationFrame(loop);
}

async function main() {
  try {
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
