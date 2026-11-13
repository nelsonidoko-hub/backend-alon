const LAGOS_OFFSET_MS = 60 * 60 * 1000;

export function startOfDayLagos(date = new Date()) {
  const local = new Date(date.getTime() + LAGOS_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - LAGOS_OFFSET_MS);
}

/** Weekday (0 = Sunday) of a Lagos day, given that day's start from startOfDayLagos. */
export function lagosWeekday(dayStart) {
  return new Date(dayStart.getTime() + LAGOS_OFFSET_MS).getUTCDay();
}

/** Lagos day start for a YYYY-MM-DD string. */
export function lagosDayFromString(ymd) {
  return new Date(`${ymd}T00:00:00+01:00`);
}
