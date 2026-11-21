export const CAB_FRESH_MS = 30 * 1000;
export const CAB_STALE_MS = 60 * 1000;
export const LOCATION_DB_WRITE_MS = 10 * 1000;
export const LOCATION_MIN_GAP_MS = 1500;
export const ARRIVING_METERS = 500;
export const PASSED_METERS = 100;
export const OFF_ROUTE_METERS = Number(process.env.OFF_ROUTE_METERS ?? 1500); // 0 turns the check off. Set OFF_ROUTE_METERS on Render to change it. // a cab further than this from the route line is not really on it
// An unused booking is released after this long (set BOOKING_EXPIRY_MINUTES on Render; was 45).
export const BOOKING_EXPIRY_MS = Number(process.env.BOOKING_EXPIRY_MINUTES ?? 30) * 60 * 1000;
// Cancelling once the cab is nearly at the stop ("arriving") costs this much (wallet payers are charged it; it goes to the driver).
export const LATE_CANCEL_FEE_NAIRA = Number(process.env.LATE_CANCEL_FEE_NAIRA ?? 150);
// This many no-shows or late cancellations in 30 days and the rider can only book by wallet.
export const STRIKE_LIMIT = Number(process.env.STRIKE_LIMIT ?? 3);
export const SHARE_AFTER_TRIP_MS = 60 * 60 * 1000;
// Comfort rides: a driver who offers fewer seats than their vehicle has is a "comfort" cab. Each seat then costs
// fare x vehicle seats / seats offered (rounded up to N50), and never more than COMFORT_MAX_MULTIPLIER times the normal fare.
export const COMFORT_MAX_MULTIPLIER = Number(process.env.COMFORT_MAX_MULTIPLIER ?? 2);
export const MAX_SEATS_PER_BOOKING = 2;
// A "drop" books the whole cab. Its price is every seat's fare added up, plus this premium (rounded up to N50).
export const DROP_PREMIUM_PERCENT = Number(process.env.DROP_PREMIUM_PERCENT ?? 20);
export const ACTIVE_BOOKING_STATUSES = ['confirmed', 'arriving', 'picked_up'];
