// Commission-free trial for new drivers. It starts the day a driver is approved (older drivers: the day they applied),
// lasts DRIVER_TRIAL_DAYS, and ends on its own. Nothing is stored, so changing the length applies to everyone.
const DAY = 24 * 60 * 60 * 1000;

export function trialInfo(driver, { trialDays, commissionPercent, now = Date.now() }) {
  const start = driver?.approvedAt || driver?.createdAt;
  if (!trialDays || !start) return { days: trialDays || 0, commissionPercent, active: false, endsAt: null, daysLeft: 0 };
  const endsAt = new Date(new Date(start).getTime() + trialDays * DAY);
  const active = now < endsAt.getTime();
  return { days: trialDays, commissionPercent, active, endsAt, daysLeft: active ? Math.ceil((endsAt.getTime() - now) / DAY) : 0 };
}

/** The commission % to take from a trip finished at `when`. */
export const commissionFor = (driver, { trialDays, commissionPercent, when = Date.now() }) =>
  trialInfo(driver, { trialDays, commissionPercent, now: new Date(when).getTime() }).active ? 0 : commissionPercent;
