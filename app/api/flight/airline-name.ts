export type AirlineMetadata = {
  name: string | null;
  iata: string | null;
  icao: string | null;
  radioCallsign: string | null;
  country: string | null;
  countryIso: string | null;
};

export type AirlineNamedRoute = {
  airlineName: string | null;
  airline?: AirlineMetadata | null;
};

export function withFallbackAirline<T extends AirlineNamedRoute>(
  route: T | null,
  fallbackRoute: AirlineNamedRoute | null | undefined,
): T | null {
  if (!route || !fallbackRoute) return route;
  const fallbackName = fallbackRoute.airlineName?.trim() || null;
  const fallbackMetadata = fallbackRoute.airline || null;
  const airlineName = route.airlineName || fallbackName;
  const namesCompatible = !route.airlineName
    || !fallbackName
    || route.airlineName.trim().localeCompare(fallbackName, undefined, { sensitivity: "accent" }) === 0;
  const airline = route.airline || (namesCompatible ? fallbackMetadata : null);
  if (airlineName === route.airlineName && airline === (route.airline || null)) return route;
  return {
    ...route,
    airlineName,
    airline,
  };
}
