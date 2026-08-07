const MAX_PLAUSIBLE_GROUND_SPEED_KMH = 1_300;

export function plausibleFlightDurationMinutes(
  providerDurationMinutes: number | null,
  routeDistanceKm: number,
) {
  if (providerDurationMinutes == null || !Number.isFinite(providerDurationMinutes)) return null;
  const minimumByDistance = routeDistanceKm > 0
    ? Math.ceil(routeDistanceKm / MAX_PLAUSIBLE_GROUND_SPEED_KMH * 60)
    : 20;
  return providerDurationMinutes >= Math.max(20, minimumByDistance)
    && providerDurationMinutes <= 24 * 60
    ? providerDurationMinutes
    : null;
}

export function reconciledArrivalTime(
  nowMs: number,
  departureAtMs: number,
  providerArrivalAtMs: number | null,
  timingConflictsWithPosition: boolean,
  plausibleDurationMinutes: number | null,
  geographicRemainingMinutes: number,
) {
  if (!timingConflictsWithPosition) {
    return providerArrivalAtMs == null ? null : new Date(providerArrivalAtMs);
  }
  if (plausibleDurationMinutes != null) {
    return new Date(departureAtMs + plausibleDurationMinutes * 60_000);
  }
  return new Date(nowMs + geographicRemainingMinutes * 60_000);
}

export function geographicArrivalFromActualDeparture(
  actualDepartureAtMs: number,
  totalKm: number,
  effectiveSpeedKmh: number,
): Date | null {
  if (!Number.isFinite(actualDepartureAtMs) || totalKm <= 0 || effectiveSpeedKmh <= 0) return null;
  const totalMinutes = Math.round((totalKm / effectiveSpeedKmh) * 60);
  if (totalMinutes < 5 || totalMinutes > 24 * 60) return null;
  return new Date(actualDepartureAtMs + totalMinutes * 60_000);
}
