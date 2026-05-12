/*
 * Glitch action — horizontal slice displacement over the object's bbox.
 *
 * The captureCanvas is already in display space (mirrored at capture), so
 * we can slice rows of the bbox out of it and re-blit them displaced. The
 * displacement is time-modulated so the glitch shimmers instead of being
 * a single frozen offset.
 *
 * Rendered ON TOP of the styled source so it reads as a second, broken copy
 * of the object — the additive feel is what makes it look glitchy rather
 * than like a clean cut.
 */

export function applyGlitch(ctx, { object, action, intensity, captureCanvas, timeMs }) {
  const [x, y, bw, bh] = object.bbox;
  if (bw < 2 || bh < 2) return;

  const slices = Math.max(2, Math.floor(2 + action.sliceAmount * 18));
  const sliceH = bh / slices;
  const maxDisp = bw * action.displacement * 0.45 * intensity;
  if (maxDisp < 0.5) return;

  ctx.save();
  ctx.globalAlpha = action.opacity * intensity;
  for (let i = 0; i < slices; i++) {
    const sy = y + i * sliceH;
    const t = timeMs * 0.001 + i * 1.73;
    const disp = (Math.sin(t * (1.0 + i * 0.13)) + Math.sin(t * 3.7)) * 0.5 * maxDisp;
    ctx.drawImage(
      captureCanvas,
      x,
      Math.max(0, sy),
      bw,
      Math.max(1, sliceH),
      x + disp,
      Math.max(0, sy),
      bw,
      Math.max(1, sliceH),
    );
  }
  ctx.restore();
}
