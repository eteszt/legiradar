export type AirlineNamedRoute = {
  airlineName: string | null;
};

export function withFallbackAirlineName<T extends AirlineNamedRoute>(
  route: T | null,
  fallbackAirlineName: string | null | undefined,
): T | null {
  if (!route || route.airlineName || !fallbackAirlineName?.trim()) return route;
  return {
    ...route,
    airlineName: fallbackAirlineName.trim(),
  };
}
