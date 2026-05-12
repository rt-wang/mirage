/*
 * Thin wrapper around tfjs-models/coco-ssd.
 *
 * Kept separate from the tracker so future phases can swap in YOLO/DETR or run
 * detection on a worker without touching tracking logic.
 */

export async function loadDetector() {
  if (!window.cocoSsd) throw new Error("coco-ssd library missing");
  // lite_mobilenet_v2 is the smallest backbone — fastest cold start, runs
  // comfortably at real-time on a laptop GPU via the WebGL backend.
  return window.cocoSsd.load({ base: "lite_mobilenet_v2" });
}

export async function detect(model, source, { maxDetections = 20, minScore = 0.5 } = {}) {
  return model.detect(source, maxDetections, minScore);
}
