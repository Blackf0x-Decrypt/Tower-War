export type Camera = { x: number; y: number; zoom: number };
export function clampCamera(
  c: Camera,
  w: number,
  h: number,
  worldW: number,
  worldH: number,
): Camera {
  const zoom = Math.max(0.35, Math.min(1.4, c.zoom));
  const cw = worldW * zoom,
    ch = worldH * zoom;
  return {
    zoom,
    // Any world point, including a corner, can reach the viewport centre.
    x: Math.max(w / 2 - cw, Math.min(w / 2, c.x)),
    y: Math.max(h / 2 - ch, Math.min(h / 2, c.y)),
  };
}
export function zoomCamera(
  c: Camera,
  zoom: number,
  x: number,
  y: number,
  w: number,
  h: number,
  worldW: number,
  worldH: number,
) {
  const z = Math.max(0.35, Math.min(1.4, zoom));
  const ratio = z / c.zoom;
  return clampCamera(
    { x: x - (x - c.x) * ratio, y: y - (y - c.y) * ratio, zoom: z },
    w,
    h,
    worldW,
    worldH,
  );
}
