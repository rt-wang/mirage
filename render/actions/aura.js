/*
 * Aura action — soft radial glow around an object.
 *
 * Drawn as a screen-blended radial gradient centered on the object's center.
 * `radius` scales with the object's bbox (so a big object gets a big halo).
 * `pulse` modulates the radius with a slow sine over time.
 */

export function applyAura(ctx, { object, action, intensity, timeMs }) {
  const [cx, cy] = object.center;
  const [, , bw, bh] = object.bbox;
  const maxDim = Math.max(bw, bh);
  const baseRadius = maxDim * 0.5 + action.radius * maxDim * 1.6;
  const pulse = 1 + action.pulse * 0.3 * Math.sin(timeMs * 0.0032);
  const radius = baseRadius * pulse;
  const alpha = action.opacity * intensity;
  const [r, g, b] = action.color;

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
  grad.addColorStop(0.6, `rgba(${r},${g},${b},${alpha * 0.35})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = grad;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();
}
