/*
 * Trail action — persistent decaying motion smear over object regions.
 *
 * Uses a pooled offscreen canvas that survives across frames. Each frame the
 * orchestrator calls fadeTrailCanvas() once to attenuate the existing content,
 * then paintObjectIntoTrail() per object that has a trail action to deposit
 * fresh pixels, then compositeTrail() once to blit the layer onto the output.
 *
 * Trail length is the per-frame retention factor: higher `length` ⇒ slower
 * fade ⇒ longer smear. `smear` adds a small gaussian-ish blur via shadowBlur
 * when depositing so the smear softens with each frame.
 */

let _trail = null;
let _trailCtx = null;
let _lastFadeFrame = -1;

function ensure(w, h) {
  if (!_trail) {
    _trail = document.createElement("canvas");
    _trailCtx = _trail.getContext("2d");
  }
  if (_trail.width !== w) _trail.width = w;
  if (_trail.height !== h) _trail.height = h;
}

export function resetTrail() {
  if (_trailCtx) _trailCtx.clearRect(0, 0, _trail.width, _trail.height);
}

export function fadeTrailCanvas(w, h, length) {
  ensure(w, h);
  // Map length 0..1 to a per-frame keep-factor:
  //   length=0   ⇒ keep≈0     (immediate clear, no trail)
  //   length=1   ⇒ keep≈0.97  (very long trail)
  const keep = Math.max(0, Math.min(0.97, length * 0.97));
  const fadeAlpha = 1 - keep;
  _trailCtx.save();
  _trailCtx.globalCompositeOperation = "destination-out";
  _trailCtx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
  _trailCtx.fillRect(0, 0, w, h);
  _trailCtx.restore();
}

export function paintObjectIntoTrail(object, captureCanvas, smear) {
  if (!_trailCtx) return;
  const [x, y, bw, bh] = object.bbox;
  if (bw < 1 || bh < 1) return;
  _trailCtx.save();
  if (smear > 0) {
    _trailCtx.shadowBlur = smear * 18;
    _trailCtx.shadowColor = "rgba(255,255,255,0.6)";
  }
  _trailCtx.drawImage(
    captureCanvas,
    Math.max(0, x),
    Math.max(0, y),
    Math.max(1, bw),
    Math.max(1, bh),
    Math.max(0, x),
    Math.max(0, y),
    Math.max(1, bw),
    Math.max(1, bh),
  );
  _trailCtx.restore();
}

export function compositeTrail(ctx, opacity) {
  if (!_trail) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(_trail, 0, 0);
  ctx.restore();
}
