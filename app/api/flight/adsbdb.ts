export type AdsbdbFlightRouteRecord = {
  callsign?: string | null;
  callsign_icao?: string | null;
  callsign_iata?: string | null;
  airline?: {
    name?: string | null;
    iata?: string | null;
    icao?: string | null;
    callsign?: string | null;
    country?: string | null;
    country_iso?: string | null;
  } | null;
  origin?: Record<string, unknown>;
  destination?: Record<string, unknown>;
};

export type AdsbdbCallsignLookup = {
  record: AdsbdbFlightRouteRecord;
  callsignIcao: string | null;
  callsignIata: string | null;
  matchedInput: string;
  cacheHit: boolean;
};

type CacheEntry = {
  expiresAt: number;
  value: Omit<AdsbdbCallsignLookup, "cacheHit"> | null;
};

type ClientOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  successTtlMs?: number;
  missTtlMs?: number;
};

const normalize = (value: unknown) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function parseAdsbdbCallsignPayload(payload: unknown, requestedCallsign: string) {
  const requested = normalize(requestedCallsign);
  if (!/^[A-Z0-9]{3,10}$/.test(requested)) return null;
  const response = payload && typeof payload === "object"
    ? (payload as { response?: unknown }).response
    : null;
  const route = response && typeof response === "object"
    ? (response as { flightroute?: unknown }).flightroute
    : null;
  if (!route || typeof route !== "object") return null;
  const record = route as AdsbdbFlightRouteRecord;
  const callsign = normalize(record.callsign);
  const callsignIcao = normalize(record.callsign_icao) || null;
  const callsignIata = normalize(record.callsign_iata) || null;
  if (![callsign, callsignIcao, callsignIata].includes(requested)) return null;
  if (!callsignIcao && !callsignIata) return null;
  return {
    record,
    callsignIcao,
    callsignIata,
    matchedInput: requested,
  };
}

export function createAdsbdbClient(options: ClientOptions = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const timeoutMs = options.timeoutMs ?? 2_500;
  const successTtlMs = options.successTtlMs ?? 12 * 60 * 60_000;
  const missTtlMs = options.missTtlMs ?? 10 * 60_000;
  const cache = new Map<string, CacheEntry>();

  return async function lookupAdsbdbCallsign(input: string): Promise<AdsbdbCallsignLookup | null> {
    const callsign = normalize(input);
    if (!/^[A-Z0-9]{3,10}$/.test(callsign)) return null;
    const cached = cache.get(callsign);
    if (cached && cached.expiresAt > now()) {
      return cached.value ? { ...cached.value, cacheHit: true } : null;
    }

    const response = await fetchImpl(
      `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (response.status === 400 || response.status === 404) {
      cache.set(callsign, { expiresAt: now() + missTtlMs, value: null });
      return null;
    }
    if (!response.ok) throw new Error(`ADSBDB HTTP ${response.status}`);
    const parsed = parseAdsbdbCallsignPayload(await response.json(), callsign);
    cache.set(callsign, {
      expiresAt: now() + (parsed ? successTtlMs : missTtlMs),
      value: parsed,
    });
    return parsed ? { ...parsed, cacheHit: false } : null;
  };
}

export const lookupAdsbdbCallsign = createAdsbdbClient();
