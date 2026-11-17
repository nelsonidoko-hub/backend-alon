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
    .limit(200)
    .lean();
  const out = [];
  for (const s of sessions) {
    const pos = getLivePosition(s);
    if (!pos) continue;
    try {
      const g = await getRouteGeometry(s.routeId?._id || s.routeId, { activeOnly: false });
      if (OFF_ROUTE_METERS > 0 && project(g.path, pos).distFrom > OFF_ROUTE_METERS) continue; // too far from its route
    } catch { /* route unreadable: fall through and show the cab */ }
    out.push(toMapCab(s, pos, s.routeId?.name));
  }
  return out;
}