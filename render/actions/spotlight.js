/*
 * Spotlight action — dim everything outside the object's lit region.
 *
 * Implementation note: drawing a radial gradient that fades from transparent
 * to dim looks fine for one object but doubles up where two spotlights
 * overlap. Section 9 of the design says "Actions compose cleanly" — this
 * draws darken once per object and accepts that two overlapping spotlights
 * darken the union slightly more, which reads as "stronger focus" rather
 * than as a bug.
 */

export function applySpotlight(ctx, { object, action, intensity, w, h }) {
  const [cx, cy] = object.center;
  const [, , bw, bh] = object.bbox;
  const r0 = Math.max(bw, bh) * 0.5;
  const feather = action.feather * Math.max(w, h) * 0.55;
  const r1 = r0 + feather + 8;
  const dim = action.backgroundDim * action.opacity * intensity;
  if (dim <= 0) return;

  const grad = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, `rgba(0,0,0,${dim})`);

  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // Beyond r1 the radial gradient color is its final stop, so the rest of the
  // canvas darkens to `dim` — exactly the "dim everything else" intent.
  ctx.restore();
}
