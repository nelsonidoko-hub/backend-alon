const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function buildPath(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));
  }
  return { points, cum, length: cum[cum.length - 1] };
}

export function project(path, p) {
  let best = { distFrom: Infinity, distAlong: 0 };
  for (let i = 0; i < path.points.length - 1; i++) {
    const a = path.points[i];
    const b = path.points[i + 1];
    const k = Math.cos(rad(a.lat));
    const bx = rad(b.lng - a.lng) * k * R;
    const by = rad(b.lat - a.lat) * R;
    const px = rad(p.lng - a.lng) * k * R;
    const py = rad(p.lat - a.lat) * R;
    const len2 = bx * bx + by * by;
    let t = len2 === 0 ? 0 : (px * bx + py * by) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - t * bx, py - t * by);
    if (d < best.distFrom) {
      best = { distFrom: d, distAlong: path.cum[i] + t * Math.sqrt(len2) };
    }
  }
  return best;
}

export function etaSeconds(distanceMeters, speedMps) {
  const v = Math.min(14, Math.max(4, Number.isFinite(speedMps) && speedMps > 0 ? speedMps : 7));
  return Math.round(Math.max(0, distanceMeters) / v);
}
