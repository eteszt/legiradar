export type RoutePoint = { lat: number; lon: number };

export type RouteScanAircraft = Record<string, unknown>;

export const operatorIcaoFamilies: Record<string, readonly string[]> = {
  // A U2 kereskedelmi kód alatt easyJet UK, Switzerland és Europe
  // operatív hívójelei is előfordulhatnak; a végső egyezést mindig a
  // jelenlegi, pontos live-flight identity ellenőrzi.
  U2: ["EZY", "EZS", "EJU"],
};

function normalized(value: unknown) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function operatorPrefixesForCommercialFlight(
  flight: string,
  primaryIcao?: string | null,
) {
  const commercial = normalized(flight);
  const iata = commercial.match(/^([A-Z0-9]{2})\d/)?.[1] || "";
  return Array.from(new Set([
    primaryIcao ? normalized(primaryIcao) : "",
    ...(operatorIcaoFamilies[iata] || []),
  ].filter((prefix) => /^[A-Z]{3}$/.test(prefix))));
}

export function routeDistanceKm(a: RoutePoint, b: RoutePoint) {
  const radius = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function routeSamplePoints(origin: RoutePoint, destination: RoutePoint) {
  return [0.25, 0.5, 0.75].map((ratio) => ({
    lat: origin.lat + (destination.lat - origin.lat) * ratio,
    lon: origin.lon + (destination.lon - origin.lon) * ratio,
  }));
}

export function rankRouteAircraft(
  aircraft: RouteScanAircraft[],
  origin: RoutePoint,
  destination: RoutePoint,
  operatorPrefixes: string[],
  limit = 8,
) {
  const prefixes = new Set(operatorPrefixes.map(normalized));
  const directKm = routeDistanceKm(origin, destination);
  return aircraft
    .map((item) => {
      const callsign = normalized(item.flight);
      const lat = numeric(item.lat);
      const lon = numeric(item.lon);
      const altitudeFt = item.alt_baro === "ground" ? 0 : numeric(item.alt_baro);
      const speedKt = numeric(item.gs);
      const prefix = callsign.slice(0, 3);
      if (!callsign || lat == null || lon == null || !prefixes.has(prefix)) return null;
      if (!((altitudeFt != null && altitudeFt > 1000) || (speedKt != null && speedKt > 80))) return null;
      const detourKm = routeDistanceKm(origin, { lat, lon })
        + routeDistanceKm({ lat, lon }, destination)
        - directKm;
      if (detourKm > directKm * 0.3 + 200) return null;
      return { aircraft: item, callsign, detourKm };
    })
    .filter((item): item is { aircraft: RouteScanAircraft; callsign: string; detourKm: number } => Boolean(item))
    .sort((a, b) => a.detourKm - b.detourKm)
    .slice(0, limit);
}

export function routesMatch(
  expected: { origin: { iata?: string; icao?: string }; destination: { iata?: string; icao?: string } },
  actual: { origin: { iata?: string; icao?: string }; destination: { iata?: string; icao?: string } },
) {
  const airportMatches = (
    expectedAirport: { iata?: string; icao?: string },
    actualAirport: { iata?: string; icao?: string },
  ) => {
    const expectedIds = [expectedAirport.iata, expectedAirport.icao].map(normalized).filter(Boolean);
    const actualIds = new Set([actualAirport.iata, actualAirport.icao].map(normalized).filter(Boolean));
    return expectedIds.some((id) => actualIds.has(id));
  };
  return airportMatches(expected.origin, actual.origin)
    && airportMatches(expected.destination, actual.destination);
}
