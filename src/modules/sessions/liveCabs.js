import { DriverSession } from './session.model.js';
import { getLivePosition } from './sessions.live.js';
import { toMapCab } from './mapCab.js';
import { CAB_FRESH_MS } from '../../config/constants.js';

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
    if (pos) out.push(toMapCab(s, pos, s.routeId?.name));
  }
  return out;
}