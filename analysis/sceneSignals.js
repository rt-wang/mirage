/*
 * Scene-level summaries derived from the tracker's DetectedObject[].
 *
 * Sent to the planner so prompts like "make the largest object a relic" or
 * "make devices poisonous" can resolve without the model ever seeing pixels.
 */

const DEVICE_CLASSES = new Set([
  "laptop",
  "cell phone",
  "tv",
  "keyboard",
  "mouse",
  "remote",
]);

export function computeSceneSignals(objects) {
  const live = objects.filter((o) => !o.stale);
  const classes = [...new Set(live.map((o) => o.className))];
  const largest = live.reduce(
    (best, o) => (o.areaNorm > (best?.areaNorm || 0) ? o : best),
    null,
  );
  const avgMotion = live.length
    ? live.reduce((sum, o) => sum + Math.hypot(o.velocity[0], o.velocity[1]), 0) /
      live.length
    : 0;
  return {
    objectCount: live.length,
    classes,
    personCount: live.filter((o) => o.className === "person").length,
    deviceCount: live.filter((o) => DEVICE_CLASSES.has(o.className)).length,
    largestObjectClass: largest?.className || null,
    largestObjectArea: largest?.areaNorm || 0,
    averageMotion: Math.min(1, avgMotion / 80),
    sceneCrowdedness: Math.min(1, live.length / 6),
    selectedObjectClass: live.find((o) => o.selected)?.className || null,
  };
}
