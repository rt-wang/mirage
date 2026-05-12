/*
 * Local lines action — draw Hough segments with style and optional jitter.
 *
 * Line endpoints already arrive in full-canvas coords from the local CV pass.
 * `jitter` randomly perturbs each endpoint per frame, giving a hand-drawn /
 * shaking-camera quality.
 */

export function applyLocalLines(ctx, { geometry, action, intensity, w }) {
  if (!geometry || !geometry.localLines || geometry.localLines.length === 0) return;

  ctx.save();
  ctx.globalAlpha = action.opacity * intensity;
  ctx.strokeStyle = `rgb(${action.color[0]},${action.color[1]},${action.color[2]})`;
  ctx.lineWidth = Math.max(1, w * 0.001 + action.thickness * w * 0.005);
  ctx.lineCap = "round";
  ctx.shadowBlur = 8 + action.thickness * 12;
  ctx.shadowColor = ctx.strokeStyle;

  const jitter = action.jitter * 8;
  for (const [x1, y1, x2, y2] of geometry.localLines) {
    let ax = x1;
    let ay = y1;
    let bx = x2;
    let by = y2;
    if (jitter > 0) {
      ax += (Math.random() - 0.5) * jitter;
      ay += (Math.random() - 0.5) * jitter;
      bx += (Math.random() - 0.5) * jitter;
      by += (Math.random() - 0.5) * jitter;
    }
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.restore();
}
