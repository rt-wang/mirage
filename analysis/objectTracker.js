/*
 * Lightweight per-class IoU tracker.
 *
 * COCO-SSD returns independent detections per frame — boxes flicker, classes
 * swap, IDs don't exist. The tracker assigns a stable `id` to each detection
 * by greedy IoU matching against the previous frame's set, smooths the bbox
 * with an EMA, and keeps recently-lost objects alive briefly as `stale` so a
 * one-frame miss doesn't tear them off the screen.
 *
 * The output matches the `DetectedObject` shape from the design doc.
 */

const IOU_MATCH_THRESHOLD = 0.25;
const BBOX_SMOOTHING = 0.55; // 0 = use prev only, 1 = use new only
const STALE_GRACE_MS = 350;

function computeIou(a, b) {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;
  const union = aw * ah + bw * bh - inter;
  return union > 0 ? inter / union : 0;
}

function smoothBbox(prev, next, alpha) {
  return [
    prev[0] + (next[0] - prev[0]) * alpha,
    prev[1] + (next[1] - prev[1]) * alpha,
    prev[2] + (next[2] - prev[2]) * alpha,
    prev[3] + (next[3] - prev[3]) * alpha,
  ];
}

export function createTracker() {
  let nextId = 1;
  let tracked = new Map(); // id -> DetectedObject

  return {
    update(detections, { canvasWidth, canvasHeight, now }) {
      const claimed = new Set();
      const next = new Map();

      // Greedy matching: highest-IoU pair first, no detection or track reused.
      // For the ~5-20 boxes COCO-SSD returns, O(n²) is well within budget.
      const candidates = [];
      for (let di = 0; di < detections.length; di++) {
        for (const [tid, prev] of tracked) {
          if (prev.className !== detections[di].class) continue;
          const iou = computeIou(detections[di].bbox, prev.bbox);
          if (iou >= IOU_MATCH_THRESHOLD) {
            candidates.push({ di, tid, iou });
          }
        }
      }
      candidates.sort((a, b) => b.iou - a.iou);

      const detTaken = new Set();
      const matches = new Map(); // di -> tid
      for (const c of candidates) {
        if (detTaken.has(c.di) || claimed.has(c.tid)) continue;
        detTaken.add(c.di);
        claimed.add(c.tid);
        matches.set(c.di, c.tid);
      }

      for (let di = 0; di < detections.length; di++) {
        const det = detections[di];
        const tid = matches.get(di);
        const prev = tid ? tracked.get(tid) : null;

        const rawBbox = det.bbox;
        const bbox = prev ? smoothBbox(prev.bbox, rawBbox, BBOX_SMOOTHING) : rawBbox.slice();
        const center = [bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2];
        const velocity = prev
          ? [center[0] - prev.center[0], center[1] - prev.center[1]]
          : [0, 0];
        const id = tid ?? `obj_${nextId++}`;

        next.set(id, {
          id,
          className: det.class,
          score: det.score,
          bbox,
          center,
          areaNorm: (bbox[2] * bbox[3]) / (canvasWidth * canvasHeight),
          ageMs: prev ? prev.ageMs + Math.max(0, now - prev.lastSeenMs) : 0,
          lastSeenMs: now,
          velocity,
          selected: prev ? prev.selected : false,
          stale: false,
        });
      }

      // Carry forward unmatched objects briefly so a one-frame detection drop
      // doesn't make a stable object lose its ID.
      for (const [tid, prev] of tracked) {
        if (claimed.has(tid)) continue;
        if (next.has(tid)) continue;
        const sinceSeen = now - prev.lastSeenMs;
        if (sinceSeen <= STALE_GRACE_MS) {
          next.set(tid, { ...prev, stale: true });
        }
      }

      tracked = next;
      return Array.from(tracked.values());
    },

    setSelected(id) {
      for (const [tid, obj] of tracked) {
        tracked.set(tid, { ...obj, selected: tid === id });
      }
    },

    clear() {
      tracked = new Map();
    },
  };
}
