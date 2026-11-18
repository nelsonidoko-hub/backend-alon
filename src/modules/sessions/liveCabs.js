import { vehicleKind } from '../drivers/vehicle.model.js';
import { DriverSession } from './session.model.js';
import { getLivePosition } from './sessions.live.js';
import { toMapCab } from './mapCab.js';
import { getRouteGeometry } from '../routes/routes.service.js';
import { project } from '../../utils/geo.js';
import { CAB_FRESH_MS, OFF_ROUTE_METERS } from '../../config/constants.js';

export async function listMapCabs() {
  const sessions = await DriverSession.find({
    active: true,
    online: true,
    lastSeen: { $gte: new Date(Date.now() - CAB_FRESH_MS) },
  })
    .populate('routeId', 'name')
    .populate('vehicleId', 'kind seatCapacity')
    .limit(200)
    .lean();
  const out = [];
  for (const s of sessions) {
    const pos = getLivePosition(s);
    if (!pos) continue;
    // Every online cab is shown on the map. One that is far from its route is flagged, so the app can show it dimmed
    // ("online, not on its route yet") instead of hiding it. It still cannot be booked (see listLiveCabs).
    let offRoute = false;
    try {
      const g = await getRouteGeometry(s.routeId?._id || s.routeId, { activeOnly: false });
      offRoute = OFF_ROUTE_METERS > 0 && project(g.path, pos).distFrom > OFF_ROUTE_METERS;
    } catch { /* route unreadable: show the cab normally */ }
    out.push({ ...toMapCab(s, pos, s.routeId?.name), kind: vehicleKind(s.vehicleId), offRoute });
  }
  return out;
}
