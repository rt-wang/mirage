/*
 * Local edges action — recolor and composite the Canny mask from ObjectGeometry.
 *
 * The mask comes in as a white-alpha ImageData. We pour it into a pooled tint
 * canvas, then use a source-in composite + fillRect to recolor the mask to
 * `action.color`. The result is a tinted edge layer the same size as the
 * crop, which we drawImage onto the output with screen blend and an optional
 * shadow halo scaled by `glow` + `thickness`.
 */

const _tint = document.createElement("canvas");
const _tintCtx = _tint.getContext("2d");

export function applyLocalEdges(ctx, { geometry, action, intensity, w }) {
  if (!geometry || !geometry.localEdges) return;
  const img = geometry.localEdges;

  if (_tint.width !== img.width) _tint.width = img.width;
  if (_tint.height !== img.height) _tint.height = img.height;

  _tintCtx.save();
  _tintCtx.globalCompositeOperation = "source-over";
  _tintCtx.clearRect(0, 0, img.width, img.height);
  _tintCtx.putImageData(img, 0, 0);
  _tintCtx.globalCompositeOperation = "source-in";
  _tintCtx.fillStyle = `rgb(${action.color[0]},${action.color[1]},${action.color[2]})`;
  _tintCtx.fillRect(0, 0, img.width, img.height);
  _tintCtx.restore();

  const [ox, oy] = geometry.localEdgesOrigin;
  ctx.save();
  ctx.globalAlpha = action.opacity * intensity;
  ctx.globalCompositeOperation = "screen";
  const glow = action.glow * 24 + action.thickness * 16;
  if (glow > 0.5) {
    ctx.shadowBlur = glow;
    ctx.shadowColor = `rgb(${action.color[0]},${action.color[1]},${action.color[2]})`;
  }
  ctx.drawImage(_tint, ox, oy);
  // Second pass at lower alpha gives the visual feel of "thicker" edges
  // without dilating the mask itself (which would be a CV-side op).
  if (action.thickness > 0.4) {
    ctx.globalAlpha *= 0.55;
    ctx.drawImage(_tint, ox, oy);
  }
  ctx.restore();
}
