// Remembers, for a short time, which riders recently looked for a cab at which stop.
// Memory only (nothing is saved to the database). Counts are all that leave this file.
export function createInterestStore({ windowMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const routes = new Map(); // routeId -> Map(stopId -> Map(userId -> lastSeenMs))

  return {
    record(userId, routeId, stopId) {
      if (!routes.has(routeId)) routes.set(routeId, new Map());
      const stops = routes.get(routeId);
      if (!stops.has(stopId)) stops.set(stopId, new Map());
      stops.get(stopId).set(userId, now());
    },

    /** Returns Map(stopId -> [userIds]) for riders seen within the window, and forgets older ones. */
    activeByStop(routeId) {
      const out = new Map();
      const stops = routes.get(routeId);
      if (!stops) return out;
      const cutoff = now() - windowMs;
      for (const [stopId, users] of stops) {
        for (const [userId, at] of users) if (at < cutoff) users.delete(userId);
        if (users.size === 0) stops.delete(stopId);
        else out.set(stopId, [...users.keys()]);
      }
      if (stops.size === 0) routes.delete(routeId);
      return out;
    },
  };
}
