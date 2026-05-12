/*
 * Neutral preview renderer.
 *
 * The inspection layer — what the user sees before any styled action plan is
 * applied. Draws the raw camera, every tracked object's bbox, literal class +
 * confidence label, and the tracker-assigned ID so persistence is visible.
 *
 * Phase 2+ will add the styled renderer alongside this one; both will share
 * the same DetectedObject list.
 */

export function drawNeutralPreview(ctx, captureCanvas, objects) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(captureCanvas, 0, 0, w, h);

  const fontSize = Math.max(14, Math.floor(w * 0.018));
  const idFontSize = Math.max(10, fontSize - 4);
  const labelFont = `${fontSize}px ui-monospace, Menlo, monospace`;
  const idFont = `${idFontSize}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, w * 0.0025);

  for (const o of objects) {
    if (o.stale) continue; // drop ghosts from the visible preview
    const [x, y, bw, bh] = o.bbox;

    ctx.strokeStyle = "rgba(126, 240, 197, 0.95)";
    ctx.shadowBlur = 12;
    ctx.shadowColor = "rgba(126, 240, 197, 0.55)";
    ctx.strokeRect(x, y, bw, bh);
    ctx.shadowBlur = 0;

    // Tracker ID in the box corner so persistence across frames is visible.
    ctx.font = idFont;
    ctx.fillStyle = "rgba(126, 240, 197, 0.65)";
    ctx.fillText(o.id.replace(/^obj_/, "#"), x + 6, y + idFontSize);

    // Class + confidence label.
    ctx.font = labelFont;
    const label = `${o.className} · ${Math.round(o.score * 100)}%`;
    const padX = 8;
    const padY = 4;
    const m = ctx.measureText(label);
    const lw = m.width + padX * 2;
    const lh = fontSize + padY * 2;
    const lx = Math.max(0, x);
    const ly = Math.max(0, y - lh);

    ctx.fillStyle = "rgba(126, 240, 197, 0.95)";
    ctx.fillRect(lx, ly, lw, lh);
    ctx.fillStyle = "#06120e";
    ctx.fillText(label, lx + padX, ly + lh / 2);
  }

  ctx.restore();
}
