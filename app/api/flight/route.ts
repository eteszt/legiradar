import { NextRequest, NextResponse } from "next/server";
import airlines from "airline-codes/airlines.json";
import airports from "@nwpr/airport-codes";
import {
  findNext24hSchedule,
  findTargetedAirborne,
  type Fr24Airport,
  type Fr24LiveFlight,
  type Fr24ScheduleOccurrence,
} from "./fr24";
import {
  commercialFlightFromCallsign,
  operatorIcaoOverrides,
  staticCallsignCandidates,
  trustedCommercialAlias,
} from "./identifiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdsbAircraft = Record<string, unknown>;
type RouteAirport = {
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
};
type FlightRoute = {
  origin: RouteAirport;
  destination: RouteAirport;
  airlineName: string | null;
};
type RouteLookup = {
  route: FlightRoute | null;
  callsignIcao: string | null;
  callsignIata: string | null;
};
type LiveFlightIdentity = {
  flight: string;
  callsign: string;
  route: FlightRoute | null;
};

type AviationstackFlight = {
  inferred?: boolean;
  flight_date?: string;
  flight_status?: string;
  departure?: {
    airport?: string; timezone?: string; iata?: string; icao?: string;
    terminal?: string | null; gate?: string | null; delay?: number | null;
    scheduled?: string | null; estimated?: string | null; actual?: string | null;
  };
  arrival?: {
    airport?: string; timezone?: string; iata?: string; icao?: string;
    terminal?: string | null; gate?: string | null;
    scheduled?: string | null; estimated?: string | null; actual?: string | null;
  };
  airline?: { name?: string };
  flight?: { iata?: string; icao?: string };
  aircraft?: {
    registration?: string | null;
    iata?: string | null;
    icao?: string | null;
    icao24?: string | null;
  } | null;
  live?: {
    updated?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    altitude?: number | null;
    direction?: number | null;
    speed_horizontal?: number | null;
    speed_vertical?: number | null;
    is_ground?: boolean | null;
  } | null;
};

type ScheduledFlightInfo = {
  flight: string;
  callsign: string;
  status: string;
  airlineName: string | null;
  origin: { airport: string | null; iata: string | null; icao: string | null; timezone: string | null; terminal: string | null; gate: string | null };
  destination: { airport: string | null; iata: string | null; icao: string | null; timezone: string | null; terminal: string | null; gate: string | null };
  scheduledDepartureAt: string | null;
  estimatedDepartureAt: string | null;
  actualDepartureAt: string | null;
  scheduledArrivalAt: string | null;
  estimatedArrivalAt: string | null;
  actualArrivalAt: string | null;
  delayMinutes: number | null;
  aircraft: {
    registration: string | null;
    typeIata: string | null;
    typeIcao: string | null;
    icao24: string | null;
  };
  live: {
    updatedAt: string | null;
    lat: number;
    lon: number;
    altitudeM: number | null;
    directionDeg: number | null;
    speedKmh: number | null;
    verticalRateMs: number | null;
    onGround: boolean;
  } | null;
  source: string;
};

const scheduleCache = new Map<string, { expiresAt: number; value: ScheduledFlightInfo | null }>();
const liveIdentityCache = new Map<string, { expiresAt: number; value: LiveFlightIdentity }>();
const liveFlightCache = new Map<string, {
  freshUntil: number;
  staleUntil: number;
  value: Record<string, unknown>;
}>();

function liveResponse(cacheKey: string, value: Record<string, unknown>) {
  const now = Date.now();
  liveFlightCache.set(cacheKey, {
    freshUntil: now + 20_000,
    staleUntil: now + 2 * 60_000,
    value,
  });
  return NextResponse.json(value);
}

const communityProviders = [
  { baseUrl: "https://api.airplanes.live", label: "airplanes.live" },
  { baseUrl: "https://api.adsb.lol", label: "adsb.lol" },
  { baseUrl: "https://opendata.adsb.fi/api", label: "ADSB.fi" },
] as const;

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function convert(value: unknown, factor: number, digits = 0) {
  const parsed = number(value);
  return parsed == null ? null : Number((parsed * factor).toFixed(digits));
}

async function fetchProvider(baseUrl: string, selector: "callsign" | "hex" | "reg", value: string) {
  const response = await fetch(`${baseUrl}/v2/${selector}/${encodeURIComponent(value)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(6500),
  });
  if (!response.ok) throw new Error(`${baseUrl}: HTTP ${response.status}`);
  const payload = (await response.json()) as { ac?: AdsbAircraft[] };
  const aircraft = payload.ac?.find((item) => number(item.lat) != null && number(item.lon) != null) ?? null;
  if (!aircraft) throw new Error(`${baseUrl}: nincs ilyen repülőgép`);
  return aircraft;
}

async function fetchOpenSkyByHex(hex: string): Promise<AdsbAircraft> {
  const normalized = hex.toLowerCase().replace(/[^a-f0-9]/g, "");
  if (!/^[a-f0-9]{6}$/.test(normalized)) throw new Error("Érvénytelen ICAO24 azonosító.");
  const response = await fetch(`https://opensky-network.org/api/states/all?icao24=${normalized}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(6500),
  });
  if (!response.ok) throw new Error(`OpenSky: HTTP ${response.status}`);
  const payload = (await response.json()) as { states?: unknown[][] | null };
  const state = payload.states?.[0];
  if (!state || number(state[5]) == null || number(state[6]) == null) {
    throw new Error("OpenSky: nincs friss pozíció.");
  }
  const altitudeM = number(state[7]);
  const speedMs = number(state[9]);
  const verticalRateMs = number(state[11]);
  return {
    hex: normalized,
    flight: typeof state[1] === "string" ? state[1].trim() : "",
    lon: state[5],
    lat: state[6],
    alt_baro: state[8] === true ? "ground" : altitudeM == null ? null : altitudeM / 0.3048,
    gs: speedMs == null ? null : speedMs * 1.943844,
    track: state[10],
    baro_rate: verticalRateMs == null ? null : verticalRateMs / 0.00508,
    squawk: state[14],
    category: state[17],
    seen: number(state[4]) == null ? null : Math.max(0, Date.now() / 1000 - Number(state[4])),
    seen_pos: number(state[3]) == null ? null : Math.max(0, Date.now() / 1000 - Number(state[3])),
  };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radius = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routeFromRecord(route: {
  airline?: { name?: string } | null;
  origin?: Record<string, unknown>;
  destination?: Record<string, unknown>;
} | null | undefined): FlightRoute | null {
  const origin = route?.origin;
  const destination = route?.destination;
  const originLat = number(origin?.latitude);
  const originLon = number(origin?.longitude);
  const destinationLat = number(destination?.latitude);
  const destinationLon = number(destination?.longitude);
  if (!origin || !destination || originLat == null || originLon == null || destinationLat == null || destinationLon == null) {
    return null;
  }
  const airport = (data: Record<string, unknown>, lat: number, lon: number): RouteAirport => ({
    iata: String(data.iata_code || ""),
    icao: String(data.icao_code || ""),
    name: String(data.name || ""),
    city: String(data.municipality || ""),
    country: String(data.country_name || ""),
    lat,
    lon,
  });
  return {
    origin: airport(origin, originLat, originLon),
    destination: airport(destination, destinationLat, destinationLon),
    airlineName: route?.airline?.name ? String(route.airline.name) : null,
  };
}

async function fetchRouteLookup(callsigns: string[]): Promise<RouteLookup> {
  for (const callsign of callsigns) {
    try {
      const response = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        response?: {
          flightroute?: {
            callsign_icao?: string | null;
            callsign_iata?: string | null;
            airline?: { name?: string } | null;
            origin?: Record<string, unknown>;
            destination?: Record<string, unknown>;
          };
        };
      };
      const route = payload.response?.flightroute;
      const callsignIcao = route?.callsign_icao ? String(route.callsign_icao).toUpperCase() : null;
      const callsignIata = route?.callsign_iata ? String(route.callsign_iata).toUpperCase() : null;
      const parsedRoute = routeFromRecord(route);
      if (!parsedRoute) {
        if (callsignIcao || callsignIata) {
          return { route: null, callsignIcao, callsignIata };
        }
        continue;
      }
      return {
        route: parsedRoute,
        callsignIcao,
        callsignIata,
      };
    } catch {
      // Ha nincs útvonaladat, a valós idejű telemetria továbbra is megjelenik.
    }
  }
  return { route: null, callsignIcao: null, callsignIata: null };
}

async function resolveAirlineIcao(iata: string): Promise<string | null> {
  // A kézzel karbantartott lista a jelenlegi operatív ICAO-kódokat tartalmazza;
  // ezt részesítjük előnyben az airline-codes csomag esetenként elavult adataival
  // szemben (például W4: WMT, nem WER).
  if (operatorIcaoOverrides[iata]) return operatorIcaoOverrides[iata];
  const localMatch = (
    airlines as Array<{ iata?: string; icao?: string; active?: string }>
  ).find(
    (airline) =>
      String(airline.iata || "").toUpperCase() === iata &&
      airline.active === "Y" &&
      airline.icao,
  );
  if (localMatch?.icao) return localMatch.icao.toUpperCase();
  return null;
}

async function resolveFlightNumber(input: string) {
  const normalized = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const iataMatch = normalized.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/);
  const airlineIcao = iataMatch ? await resolveAirlineIcao(iataMatch[1]) : null;
  const staticCandidates = staticCallsignCandidates(normalized, airlineIcao);
  // A kereskedelmi járatszámból képzett hívójel nem mindig egyezik az adott
  // napon használt operatív callsignnal (pl. számok helyett betűs rövidítés).
  // Az ADSBDB járatútvonal-feloldása mindkét azonosítót visszaadhatja, ezért
  // még az élő pozíció keresése előtt hozzáadjuk ezeket a jelölteket.
  const routeLookup = await fetchRouteLookup(staticCandidates);
  const providerIata = routeLookup.callsignIata;
  const resolvedIcao = routeLookup.callsignIcao;
  const curatedCommercialFlight = iataMatch ? normalized : commercialFlightFromCallsign(normalized);
  const resolvedIata = trustedCommercialAlias(providerIata, curatedCommercialFlight);
  const resolvedOperator = resolvedIcao?.match(/^([A-Z]{3})/)?.[1] || airlineIcao;
  const curatedCandidates = curatedCommercialFlight
    ? staticCallsignCandidates(curatedCommercialFlight, resolvedOperator)
    : [];
  const resolvedCandidates = resolvedIata
    ? staticCallsignCandidates(resolvedIata, resolvedOperator)
    : [];
  const candidates = Array.from(new Set([
    resolvedIcao,
    ...curatedCandidates,
    ...resolvedCandidates,
    ...staticCandidates,
    resolvedIata,
  ].filter((candidate): candidate is string => Boolean(candidate))));
  return {
    candidates,
    routeLookup,
    // Kereskedelmi inputnál az eredeti IATA-járatszám megbízhatóbb a statikus
    // route-adatbázis esetenként elavult callsign_iata mezőjénél (FH/FHY esetén
    // az utóbbi XD kódot ad). Ismert ICAO-prefixnél a kézi override visszafelé
    // is biztonságosan feloldható.
    flightNumber: curatedCommercialFlight,
    resolvedAirlineIcao: airlineIcao,
    commercialInput: Boolean(iataMatch),
  };
}

function dateValue(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Az Aviationstack időbélyegeiben a dátum és az óra a repülőtér helyi ideje,
 * miközben az ISO-eltolás több válaszban +00:00 marad. Ezért az időbélyeg
 * naptári részét a külön megadott IANA-időzónában kell értelmezni.
 */
function airportDateValue(value: string | null | undefined, timeZone: string | null | undefined) {
  if (!value) return null;
  if (!timeZone) return dateValue(value);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return dateValue(value);

  const wanted = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] || 0),
  };
  const wantedAsUtc = Date.UTC(
    wanted.year, wanted.month - 1, wanted.day,
    wanted.hour, wanted.minute, wanted.second,
  );
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    });
    let guess = wantedAsUtc;
    // Két lépés a nyári/téli időszámítás határán is stabil eredményt ad.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(guess))
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, Number(part.value)]),
      ) as Record<string, number>;
      const representedAsUtc = Date.UTC(
        parts.year, parts.month - 1, parts.day,
        parts.hour, parts.minute, parts.second,
      );
      guess += wantedAsUtc - representedAsUtc;
    }
    const parsed = new Date(guess);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return dateValue(value);
  }
}

function normalizedAirportDate(value: string | null | undefined, timeZone: string | null | undefined) {
  return airportDateValue(value, timeZone)?.toISOString() || null;
}

async function fetchAviationstackScheduledFlight(flight: string, candidates: string[]): Promise<ScheduledFlightInfo | null> {
  const cacheKey = `${flight}:${candidates.join(",")}`;
  const cached = scheduleCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const apiKey = process.env.AVIATIONSTACK_API_KEY;
  if (!apiKey) throw new Error("A menetrendi adatforrás nincs beállítva.");

  const iataInput = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(flight);
  const icaoCandidate = candidates.find((candidate) => /^[A-Z]{3}\d/.test(candidate));
  const params = new URLSearchParams({ access_key: apiKey, limit: "20" });
  params.set(iataInput ? "flight_iata" : "flight_icao", iataInput ? flight : (icaoCandidate || flight));

  const response = await fetch(`https://api.aviationstack.com/v1/flights?${params}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`A menetrendi adatforrás nem elérhető (${response.status}).`);

  const payload = (await response.json()) as {
    data?: AviationstackFlight[];
    error?: { message?: string };
  };
  if (payload.error) throw new Error(payload.error.message || "A menetrendi lekérdezés sikertelen.");

  const now = Date.now();
  const availableFlights = payload.data || [];
  const item: AviationstackFlight | null = availableFlights
    .filter((candidate) => {
      const departure = airportDateValue(
        candidate.departure?.estimated || candidate.departure?.scheduled,
        candidate.departure?.timezone,
      );
      const status = String(candidate.flight_status || "").toLowerCase();
      if (["landed", "cancelled"].includes(status) || departure == null) return false;
      return status === "active"
        ? departure.getTime() >= now - 18 * 60 * 60 * 1000
        : departure.getTime() >= now;
    })
    .sort((a, b) => {
      const aActive = String(a.flight_status || "").toLowerCase() === "active" ? 0 : 1;
      const bActive = String(b.flight_status || "").toLowerCase() === "active" ? 0 : 1;
      return aActive - bActive ||
        (airportDateValue(
          a.departure?.estimated || a.departure?.scheduled,
          a.departure?.timezone,
        )?.getTime() ?? Infinity)
        - (airportDateValue(
          b.departure?.estimated || b.departure?.scheduled,
          b.departure?.timezone,
        )?.getTime() ?? Infinity);
    })[0] ?? null;

  if (!item) {
    scheduleCache.set(cacheKey, { expiresAt: now + 5 * 60_000, value: null });
    return null;
  }
  const result: ScheduledFlightInfo = {
    flight: item.flight?.iata || item.flight?.icao || flight,
    callsign: item.flight?.icao || item.flight?.iata || flight,
    status: item.flight_status || "scheduled",
    airlineName: item.airline?.name || null,
    origin: {
      airport: item.departure?.airport || null, iata: item.departure?.iata || null,
      icao: item.departure?.icao || null, timezone: item.departure?.timezone || null,
      terminal: item.departure?.terminal || null, gate: item.departure?.gate || null,
    },
    destination: {
      airport: item.arrival?.airport || null, iata: item.arrival?.iata || null,
      icao: item.arrival?.icao || null, timezone: item.arrival?.timezone || null,
      terminal: item.arrival?.terminal || null, gate: item.arrival?.gate || null,
    },
    scheduledDepartureAt: normalizedAirportDate(item.departure?.scheduled, item.departure?.timezone),
    estimatedDepartureAt: normalizedAirportDate(
      item.departure?.estimated || item.departure?.scheduled,
      item.departure?.timezone,
    ),
    actualDepartureAt: normalizedAirportDate(item.departure?.actual, item.departure?.timezone),
    scheduledArrivalAt: normalizedAirportDate(item.arrival?.scheduled, item.arrival?.timezone),
    estimatedArrivalAt: normalizedAirportDate(
      item.arrival?.estimated || item.arrival?.scheduled,
      item.arrival?.timezone,
    ),
    actualArrivalAt: normalizedAirportDate(item.arrival?.actual, item.arrival?.timezone),
    delayMinutes: number(item.departure?.delay),
    aircraft: {
      registration: item.aircraft?.registration || null,
      typeIata: item.aircraft?.iata || null,
      typeIcao: item.aircraft?.icao || null,
      icao24: item.aircraft?.icao24?.replace(/[^A-Fa-f0-9]/g, "").toLowerCase() || null,
    },
    live: number(item.live?.latitude) != null && number(item.live?.longitude) != null ? {
      updatedAt: item.live?.updated || null,
      lat: number(item.live?.latitude) as number,
      lon: number(item.live?.longitude) as number,
      altitudeM: number(item.live?.altitude),
      directionDeg: number(item.live?.direction),
      speedKmh: number(item.live?.speed_horizontal),
      verticalRateMs: number(item.live?.speed_vertical),
      onGround: Boolean(item.live?.is_ground),
    } : null,
    source: item.inferred
      ? "Korábbi Aviationstack menetrendből becsült következő indulás"
      : "Aviationstack menetrendi adat",
  };
  scheduleCache.set(cacheKey, { expiresAt: now + 15 * 60_000, value: result });
  return result;
}

function scheduledInfoFromFr24(item: Fr24ScheduleOccurrence): ScheduledFlightInfo {
  const endpoint = (value: Fr24Airport | null) => ({
    airport: value?.name || null,
    iata: value?.iata || null,
    icao: value?.icao || null,
    timezone: null,
    terminal: null,
    gate: null,
  });
  return {
    flight: item.flight,
    // Jövőbeli járatnál csak a friss menetrendi indexben ténylegesen közölt
    // callsignt mutatjuk; statikus prefixből nem gyártunk operatív hívójelet.
    callsign: item.callsign || item.flight,
    status: item.status || "scheduled",
    airlineName: null,
    origin: endpoint(item.origin),
    destination: endpoint(item.destination),
    scheduledDepartureAt: item.departureAt,
    estimatedDepartureAt: item.estimatedDepartureAt || item.departureAt,
    actualDepartureAt: item.actualDepartureAt,
    scheduledArrivalAt: item.arrivalAt,
    estimatedArrivalAt: item.estimatedArrivalAt || item.arrivalAt,
    actualArrivalAt: item.actualArrivalAt,
    delayMinutes: null,
    aircraft: {
      registration: item.registration,
      typeIata: item.aircraftType,
      typeIcao: item.aircraftType,
      icao24: item.hex?.toLowerCase() || null,
    },
    live: null,
    source: "Flightradar24 · valós, 24 órán belüli menetrendi találat",
  };
}

async function fetchScheduledFlight(flight: string, candidates: string[]): Promise<ScheduledFlightInfo | null> {
  const cacheKey = `active-first:${flight}:${candidates.join(",")}`;
  const cached = scheduleCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const identifiers = Array.from(new Set([flight, ...candidates].filter(Boolean)));

  try {
    const fr24 = await findNext24hSchedule(identifiers);
    if (fr24) {
      const result = scheduledInfoFromFr24(fr24);
      scheduleCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60_000, value: result });
      return result;
    }
  } catch {
    // A licencelt Aviationstack marad független tartalékforrásként.
  }

  let aviationstack: ScheduledFlightInfo | null = null;
  try {
    aviationstack = await fetchAviationstackScheduledFlight(flight, candidates);
  } catch (error) {
    // A tartalék menetrendi forrás rate-limitje nem jelent valódi „nincs járat”
    // állapotot. Ha FR24 sem adott találatot, a hívó 404/menetrendi fallback
    // irányba mehet tovább, ne 502-vel álljon meg.
    if (error instanceof Error && /\(429\)/.test(error.message)) {
      scheduleCache.set(cacheKey, { expiresAt: Date.now() + 60_000, value: null });
      return null;
    }
    throw error;
  }
  if (!aviationstack) {
    scheduleCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value: null });
    return null;
  }
  const departure = dateValue(
    aviationstack.actualDepartureAt
    || aviationstack.estimatedDepartureAt
    || aviationstack.scheduledDepartureAt,
  );
  const active = aviationstack.status.toLowerCase() === "active";
  const now = Date.now();
  if (!departure || (!active && (departure.getTime() < now || departure.getTime() > now + 24 * 60 * 60_000))) {
    scheduleCache.set(cacheKey, { expiresAt: now + 5 * 60_000, value: null });
    return null;
  }
  scheduleCache.set(cacheKey, { expiresAt: now + 10 * 60_000, value: aviationstack });
  return aviationstack;
}

async function routeFromSchedule(schedule: ScheduledFlightInfo | null): Promise<FlightRoute | null> {
  if (!schedule) return null;
  try {
    const lookup = (iata: string | null, icao: string | null) => airports.find((airport) =>
      (iata && airport.iata === iata) || (icao && airport.icao === icao),
    ) || null;
    const originData = lookup(schedule.origin.iata, schedule.origin.icao);
    const destinationData = lookup(schedule.destination.iata, schedule.destination.icao);
    if (!originData || !destinationData) return null;
    const airport = (
      data: typeof originData,
      scheduledAirport: ScheduledFlightInfo["origin"],
    ): RouteAirport => ({
      iata: scheduledAirport.iata || data.iata || "",
      icao: scheduledAirport.icao || data.icao || "",
      name: scheduledAirport.airport || data.name || "",
      city: data.city || scheduledAirport.iata || data.iata || data.icao || "",
      country: data.country || "",
      lat: Number(data.latitude),
      lon: Number(data.longitude),
    });
    return {
      origin: airport(originData, schedule.origin),
      destination: airport(destinationData, schedule.destination),
      airlineName: schedule.airlineName,
    };
  } catch {
    return null;
  }
}

function routeFromIataPair(originIata: string, destinationIata: string, airlineName: string | null) {
  const originData = airports.find((airport) => airport.iata === originIata) || null;
  const destinationData = airports.find((airport) => airport.iata === destinationIata) || null;
  if (!originData || !destinationData) return null;
  const airport = (data: typeof originData): RouteAirport => ({
    iata: data.iata || "",
    icao: data.icao || "",
    name: data.name || "",
    city: data.city || data.iata || data.icao || "",
    country: data.country || "",
    lat: Number(data.latitude),
    lon: Number(data.longitude),
  });
  return {
    origin: airport(originData),
    destination: airport(destinationData),
    airlineName,
  };
}

function routeFromTargetedLive(live: Fr24LiveFlight, airlineName: string | null): FlightRoute | null {
  const endpoint = (value: Fr24Airport | null): RouteAirport | null => {
    if (!value || value.lat == null || value.lon == null) return null;
    return {
      iata: value.iata || "",
      icao: value.icao || "",
      name: value.name || value.iata || value.icao || "",
      city: value.city || value.iata || value.icao || "",
      country: value.country || "",
      lat: value.lat,
      lon: value.lon,
    };
  };
  const origin = endpoint(live.origin);
  const destination = endpoint(live.destination);
  return origin && destination ? { origin, destination, airlineName } : null;
}

function scheduleFromTargetedLive(live: Fr24LiveFlight): ScheduledFlightInfo {
  const endpoint = (value: Fr24Airport | null) => ({
    airport: value?.name || null,
    iata: value?.iata || null,
    icao: value?.icao || null,
    timezone: null,
    terminal: null,
    gate: null,
  });
  return {
    flight: live.flight || live.callsign || "",
    callsign: live.callsign || live.flight || "",
    status: "active",
    airlineName: null,
    origin: endpoint(live.origin),
    destination: endpoint(live.destination),
    scheduledDepartureAt: live.scheduledDepartureAt,
    estimatedDepartureAt: live.actualDepartureAt || live.scheduledDepartureAt,
    actualDepartureAt: live.actualDepartureAt,
    scheduledArrivalAt: live.scheduledArrivalAt,
    estimatedArrivalAt: live.estimatedArrivalAt || live.scheduledArrivalAt,
    actualArrivalAt: null,
    delayMinutes: null,
    aircraft: {
      registration: live.registration,
      typeIata: live.aircraftType,
      typeIcao: live.aircraftType,
      icao24: live.hex?.toLowerCase() || null,
    },
    live: null,
    source: "Flightradar24 · célzott live-ID és teljes járatrekord",
  };
}

function aircraftFromTargetedLive(live: Fr24LiveFlight): AdsbAircraft {
  const ageSeconds = Math.max(0, (Date.now() - Date.parse(live.observedAt)) / 1000);
  return {
    flight: live.callsign || live.flight || "",
    hex: live.hex || "",
    lat: live.lat,
    lon: live.lon,
    alt_baro: live.altitudeFt,
    gs: live.groundSpeedKt,
    track: live.trackDeg,
    true_heading: live.trackDeg,
    baro_rate: live.verticalRateFpm,
    seen: ageSeconds,
    seen_pos: ageSeconds,
  };
}

async function fetchLiveFlightIdentity(
  aircraft: AdsbAircraft,
  callsign: string,
  airlineName: string | null,
): Promise<LiveFlightIdentity | null> {
  const hex = String(aircraft.hex || "").trim().toUpperCase();
  const normalizedCallsign = callsign.trim().toUpperCase();
  const cacheKey = hex || normalizedCallsign;
  const cached = liveIdentityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const lat = number(aircraft.lat);
  const lon = number(aircraft.lon);
  if (lat == null || lon == null) return null;

  const baseParams = {
    faa: "1", satellite: "1", mlat: "1", flarm: "1", adsb: "1",
    gnd: "1", air: "1", vehicles: "1", estimated: "1", maxage: "14400",
    gliders: "1", stats: "1",
  };
  const boundsCandidates = [
    `${Math.min(90, lat + 4)},${Math.max(-90, lat - 4)},${Math.max(-180, lon - 6)},${Math.min(180, lon + 6)}`,
    "90,-90,-180,180",
  ];
  let row: unknown[] | null = null;
  let lastError: unknown = null;
  for (const bounds of boundsCandidates) {
    try {
      const params = new URLSearchParams({ bounds, ...baseParams });
      const response = await fetch(`https://data-cloud.flightradar24.com/zones/fcgi/feed.js?${params}`, {
        headers: {
          Accept: "application/json",
          Referer: "https://www.flightradar24.com/",
          "User-Agent": "Mozilla/5.0",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(6500),
      });
      if (!response.ok) throw new Error(`Élő járatazonosítás: HTTP ${response.status}`);
      const payload = (await response.json()) as Record<string, unknown>;
      const rows = Object.values(payload).filter((value): value is unknown[] => Array.isArray(value));
      row = rows.find((value) => String(value[0] || "").trim().toUpperCase() === hex)
        || rows.find((value) => String(value[16] || "").trim().toUpperCase() === normalizedCallsign)
        || null;
      if (row) break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!row) {
    if (lastError) throw lastError;
    return null;
  }
  const originIata = String(row[11] || "").trim().toUpperCase();
  const destinationIata = String(row[12] || "").trim().toUpperCase();
  const flight = String(row[13] || "").trim().toUpperCase();
  const liveCallsign = String(row[16] || normalizedCallsign).trim().toUpperCase();
  if (!flight || !liveCallsign) return null;
  const value = {
    flight,
    callsign: liveCallsign,
    route: routeFromIataPair(originIata, destinationIata, airlineName),
  };
  liveIdentityCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value });
  return value;
}

function shape(
  ac: AdsbAircraft,
  flight: string,
  source: string,
  route: FlightRoute | null,
  schedule: ScheduledFlightInfo | null = null,
) {
  const lat = number(ac.lat);
  const lon = number(ac.lon);
  if (lat == null || lon == null) return null;
  const altBaro = ac.alt_baro === "ground" ? 0 : convert(ac.alt_baro, 0.3048);
  const speed = convert(ac.gs, 1.852);
  const now = Date.now();
  let journey = null;
  const directRouteKm = route
    ? haversineKm(route.origin.lat, route.origin.lon, route.destination.lat, route.destination.lon)
    : 0;
  const viaAircraftKm = route
    ? haversineKm(route.origin.lat, route.origin.lon, lat, lon)
      + haversineKm(lat, lon, route.destination.lat, route.destination.lon)
    : 0;
  // A hívójelek naponta ismétlődhetnek. A földrajzilag lehetetlen régi útvonalat
  // inkább elrejtjük, mint hogy hamis repülőteret és útvonalat rajzoljunk.
  const plausibleRoute = route && viaAircraftKm <= directRouteKm * 1.25 + 250 ? route : null;
  if (plausibleRoute) {
    const flownKm = haversineKm(plausibleRoute.origin.lat, plausibleRoute.origin.lon, lat, lon);
    const remainingKm = haversineKm(lat, lon, plausibleRoute.destination.lat, plausibleRoute.destination.lon);
    const totalKm = flownKm + remainingKm;
    const effectiveSpeed = speed && speed > 150 ? speed : 750;
    const geographicElapsedMinutes = Math.round((flownKm / effectiveSpeed) * 60);
    const geographicRemainingMinutes = Math.round((remainingKm / effectiveSpeed) * 60);
    // A szolgáltató tényleges indulási ideje a legjobb forrás. Az "estimated"
    // és "scheduled" idő azonban korai induláskor még a jövőben lehet, miközben
    // az ADS-B szerint a gép már egyértelműen repül. Ilyenkor a teljes tervezett
    // repülési idő és az útvonalon megtett arány alapján korrigáljuk az órát.
    const actualDepartureAt = dateValue(schedule?.actualDepartureAt);
    const providerDepartureAt = actualDepartureAt || dateValue(
      schedule?.estimatedDepartureAt || schedule?.scheduledDepartureAt,
    );
    const providerArrivalAt = dateValue(
      schedule?.actualArrivalAt
      || schedule?.estimatedArrivalAt
      || schedule?.scheduledArrivalAt,
    );
    const providerElapsedMinutes = providerDepartureAt
      ? Math.max(0, Math.round((now - providerDepartureAt.getTime()) / 60_000))
      : null;
    const providerDurationMinutes = providerDepartureAt && providerArrivalAt
      ? Math.round((providerArrivalAt.getTime() - providerDepartureAt.getTime()) / 60_000)
      : null;
    const plausibleDurationMinutes = providerDurationMinutes != null
      && providerDurationMinutes >= 20
      && providerDurationMinutes <= 24 * 60
      ? providerDurationMinutes
      : null;
    const routeProgress = totalKm > 0 ? flownKm / totalKm : null;
    const progressElapsedMinutes = plausibleDurationMinutes != null && routeProgress != null
      ? Math.round(plausibleDurationMinutes * routeProgress)
      : geographicElapsedMinutes;
    const clearlyAirborne = (altBaro != null && altBaro > 300) || (speed != null && speed > 150);
    const providerTimingConflictsWithPosition = !actualDepartureAt
      && clearlyAirborne
      && flownKm >= 5
      && (providerElapsedMinutes == null
        || progressElapsedMinutes > providerElapsedMinutes + 2);
    const elapsedMinutes = providerTimingConflictsWithPosition
      ? Math.max(geographicElapsedMinutes, progressElapsedMinutes)
      : (providerElapsedMinutes ?? geographicElapsedMinutes);
    const departureAt = providerTimingConflictsWithPosition || !providerDepartureAt
      ? new Date(now - elapsedMinutes * 60_000)
      : providerDepartureAt;
    const arrivalAt = providerTimingConflictsWithPosition && plausibleDurationMinutes != null
      ? new Date(departureAt.getTime() + plausibleDurationMinutes * 60_000)
      : providerArrivalAt;
    const remainingMinutes = arrivalAt
      ? Math.max(0, Math.round((arrivalAt.getTime() - now) / 60_000))
      : geographicRemainingMinutes;
    journey = {
      ...plausibleRoute,
      flownKm: Math.round(flownKm),
      remainingKm: Math.round(remainingKm),
      totalKm: Math.round(totalKm),
      progressPercent: routeProgress == null ? null : Math.round(routeProgress * 100),
      elapsedMinutes,
      remainingMinutes,
      estimatedDepartureAt: departureAt.toISOString(),
      estimatedArrivalAt: arrivalAt?.toISOString()
        || new Date(now + geographicRemainingMinutes * 60_000).toISOString(),
      timingType: actualDepartureAt
        ? "Tényleges indulási idő alapján"
        : providerTimingConflictsWithPosition
          ? "Becsült, a menetrendi időtartam és az útvonal előrehaladása alapján"
          : providerDepartureAt
            ? "Menetrendi vagy szolgáltatói becslés alapján"
            : "Becsült, az aktuális helyzet és sebesség alapján",
    };
  }
  return {
    flight,
    callsign: String(ac.flight || flight).trim(),
    hex: String(ac.hex || "—").toUpperCase(),
    lat,
    lon,
    altitudeM: altBaro,
    geometricAltitudeM: convert(ac.alt_geom, 0.3048),
    groundSpeedKmh: speed,
    trueAirspeedKmh: convert(ac.tas, 1.852),
    indicatedAirspeedKmh: convert(ac.ias, 1.852),
    trackDeg: number(ac.track),
    magneticHeadingDeg: number(ac.mag_heading),
    trueHeadingDeg: number(ac.true_heading),
    verticalRateMs: convert(ac.baro_rate, 0.00508, 1),
    geometricRateMs: convert(ac.geom_rate, 0.00508, 1),
    mach: number(ac.mach),
    rollDeg: number(ac.roll),
    navQnhHpa: number(ac.nav_qnh),
    selectedAltitudeM: convert(ac.nav_altitude_mcp ?? ac.nav_altitude_fms, 0.3048),
    navHeadingDeg: number(ac.nav_heading),
    windSpeedKmh: convert(ac.wind_speed, 1.852),
    windDirectionDeg: number(ac.wind_direction),
    outsideAirTempC: number(ac.oat),
    totalAirTempC: number(ac.tat),
    squawk: number(ac.squawk),
    category: typeof ac.category === "string" ? Number.parseInt(ac.category.replace(/\D/g, ""), 10) || null : number(ac.category),
    messages: number(ac.messages),
    rssiDbfs: number(ac.rssi),
    seenSeconds: number(ac.seen),
    positionAgeSeconds: number(ac.seen_pos),
    distanceFromReceiverKm: convert(ac.dst, 1.609344, 1),
    bearingFromReceiverDeg: number(ac.dir),
    signalIntegrity: number(ac.nic),
    containmentRadiusM: convert(ac.rc, 0.3048),
    emergency: ac.emergency ? String(ac.emergency) : null,
    onGround: ac.alt_baro === "ground",
    source,
    updatedAt: new Date().toISOString(),
    journey,
  };
}

function shapeScheduledLive(
  schedule: ScheduledFlightInfo,
  flight: string,
  route: FlightRoute | null,
) {
  if (!schedule.live) return null;
  const live = schedule.live;
  // A shape() az ADS-B szabvány szerinti láb/csomó értékeket várja, ezért az
  // Aviationstack SI-mértékegységeit itt visszaalakítjuk a közös feldolgozáshoz.
  return shape({
    flight: schedule.callsign || flight,
    hex: "—",
    lat: live.lat,
    lon: live.lon,
    alt_baro: live.onGround ? "ground" : live.altitudeM == null ? null : live.altitudeM / 0.3048,
    gs: live.speedKmh == null ? null : live.speedKmh / 1.852,
    track: live.directionDeg,
    true_heading: live.directionDeg,
    baro_rate: live.verticalRateMs == null ? null : live.verticalRateMs / 0.00508,
    seen: live.updatedAt ? Math.max(0, (Date.now() - new Date(live.updatedAt).getTime()) / 1000) : null,
  }, flight, "Aviationstack · élő pozíció", route, schedule);
}

export async function GET(request: NextRequest) {
  const flight = (request.nextUrl.searchParams.get("flight") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (flight.length < 3 || flight.length > 10) {
    return NextResponse.json({ error: "Adj meg egy érvényes járatszámot." }, { status: 400 });
  }

  const scheduleOnly = request.nextUrl.searchParams.get("schedule") === "1";
  const cachedLive = liveFlightCache.get(flight);
  if (!scheduleOnly && cachedLive && cachedLive.freshUntil > Date.now()) {
    return NextResponse.json(cachedLive.value);
  }

  const resolved = await resolveFlightNumber(flight);
  const candidates = resolved.candidates;
  const scheduleFlight = resolved.flightNumber || flight;

  if (scheduleOnly) {
    try {
      const scheduled = await fetchScheduledFlight(scheduleFlight, candidates);
      if (!scheduled) {
        return NextResponse.json({ error: `A ${flight} járathoz nem található közelgő indulás.` }, { status: 404 });
      }
      const route = await routeFromSchedule(scheduled);
      return NextResponse.json({ scheduled: { ...scheduled, route }, searchedCallsigns: candidates });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "A menetrendi adatforrás nem elérhető." },
        { status: 502 },
      );
    }
  }

  // A globális feed csak részleges minta lehet. Először ezért pontos
  // kereskedelmi szám/callsign találatot kérünk, majd a provider live-ID-jával
  // teljes járatrekordot és friss trail-pontot ellenőrzünk.
  try {
    const targeted = await findTargetedAirborne([flight, ...candidates]);
    if (targeted) {
      const route = routeFromTargetedLive(
        targeted,
        resolved.routeLookup.route?.airlineName || null,
      );
      const data = shape(
        aircraftFromTargetedLive(targeted),
        targeted.flight || resolved.flightNumber || flight,
        "Flightradar24 · célzott pontos élő keresés",
        route,
        scheduleFromTargetedLive(targeted),
      );
      if (data) {
        return liveResponse(flight, {
          data,
          searchedCallsigns: Array.from(new Set([
            targeted.callsign,
            targeted.flight,
            ...candidates,
          ].filter(Boolean))),
          resolvedAirlineIcao: resolved.resolvedAirlineIcao,
          matchedByTargetedLiveId: true,
        });
      }
    }
  } catch {
    // Szolgáltatóhiba esetén a független közösségi ADS-B utak következnek.
  }

  // A böngészőből indított közvetlen airplanes.live kérés időnként CORS-védelembe
  // ütközik. Ezért az élő keresést elsődlegesen a saját szerveroldali végpontunk
  // végzi el, és csak az eredményt küldi vissza a kliensnek.
  try {
    // Minden érvényes hívójel–szolgáltató pár egyszerre indul, így egy lassú
    // végpont nem tartja fel a működő találatot.
    const found = await Promise.any(
      candidates.flatMap((callsign) => communityProviders.map(async (provider) => ({
        aircraft: await fetchProvider(provider.baseUrl, "callsign", callsign),
        callsign,
        provider,
      }))),
    );
    const liveCallsign = String(found.aircraft.flight || "").trim().toUpperCase();
    const routeLookup = resolved.routeLookup.route
      ? resolved.routeLookup
      : await fetchRouteLookup([liveCallsign, found.callsign, ...candidates].filter(Boolean));
    let verifiedRoute: FlightRoute | null = null;
    let verifiedSchedule: ScheduledFlightInfo | null = null;
    let liveIdentity: LiveFlightIdentity | null = null;
    try {
      liveIdentity = await fetchLiveFlightIdentity(
        found.aircraft,
        liveCallsign,
        resolved.routeLookup.route?.airlineName || null,
      );
    } catch {
      // A további ellenőrzött források és az élő telemetria ettől még használhatók.
    }
    try {
      verifiedSchedule = await fetchScheduledFlight(scheduleFlight, candidates);
      verifiedRoute = await routeFromSchedule(verifiedSchedule);
    } catch {
      // A telemetria menetrendi adat nélkül is megjeleníthető.
    }
    const scheduleMatchesLiveIdentity = !liveIdentity
      || !verifiedSchedule
      || [verifiedSchedule.flight, verifiedSchedule.callsign]
        .map((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
        .includes(liveIdentity.flight);
    const trustedSchedule = scheduleMatchesLiveIdentity ? verifiedSchedule : null;
    const trustedScheduleRoute = scheduleMatchesLiveIdentity ? verifiedRoute : null;
    const effectiveRoute = liveIdentity?.route
      || trustedScheduleRoute
      || routeLookup.route;
    const data = shape(
      found.aircraft,
      resolved.flightNumber || trustedSchedule?.flight || liveIdentity?.flight || flight,
      liveIdentity
        ? `${found.provider.label} · élő járatazonosítással ellenőrizve`
        : `${found.provider.label} · szerverkapcsolat`,
      effectiveRoute,
      trustedSchedule,
    );
    const altitudeFt = found.aircraft.alt_baro === "ground"
      ? 0
      : typeof found.aircraft.alt_baro === "number" ? found.aircraft.alt_baro : null;
    const speedKt = typeof found.aircraft.gs === "number" ? found.aircraft.gs : null;
    const airborne = (altitudeFt != null && altitudeFt > 1000) || (speedKt != null && speedKt > 80);
    if (data && !airborne && effectiveRoute) {
      const nowIso = new Date().toISOString();
      const fallbackSchedule: ScheduledFlightInfo = trustedSchedule || {
        flight: resolved.flightNumber || liveIdentity?.flight || flight,
        callsign: liveIdentity?.callsign || liveCallsign || found.callsign,
        status: "active · on ground",
        airlineName: effectiveRoute.airlineName,
        origin: {
          airport: effectiveRoute.origin.name,
          iata: effectiveRoute.origin.iata,
          icao: effectiveRoute.origin.icao,
          timezone: null,
          terminal: null,
          gate: null,
        },
        destination: {
          airport: effectiveRoute.destination.name,
          iata: effectiveRoute.destination.iata,
          icao: effectiveRoute.destination.icao,
          timezone: null,
          terminal: null,
          gate: null,
        },
        scheduledDepartureAt: nowIso,
        estimatedDepartureAt: nowIso,
        actualDepartureAt: null,
        scheduledArrivalAt: data.journey?.estimatedArrivalAt || null,
        estimatedArrivalAt: data.journey?.estimatedArrivalAt || null,
        actualArrivalAt: null,
        delayMinutes: null,
        aircraft: {
          registration: String(found.aircraft.r || "") || null,
          typeIata: String(found.aircraft.t || "") || null,
          typeIcao: String(found.aircraft.t || "") || null,
          icao24: String(found.aircraft.hex || "").toLowerCase() || null,
        },
        live: null,
        source: `${found.provider.label} · földön álló pontos járat, menetrendi fallback`,
      };
      return NextResponse.json({ scheduled: { ...fallbackSchedule, route: effectiveRoute }, searchedCallsigns: candidates });
    }
    if (data) {
      return liveResponse(flight, {
        data,
        searchedCallsigns: candidates,
        resolvedAirlineIcao: resolved.resolvedAirlineIcao,
      });
    }
  } catch {
    // Egyik hívójel sem látható jelenleg az ADS-B hálózatokon.
  }

  // Egyes óceáni vagy ritkább lefedettségű járatokat a közösségi ADS-B hálózat
  // nem ad vissza callsign alapján, miközben a menetrendi szolgáltató élő
  // koordinátát közöl. Ilyenkor ezt használjuk tartalékként.
  try {
    const schedule = await fetchScheduledFlight(scheduleFlight, candidates);
    const scheduledRoute = await routeFromSchedule(schedule);
    const liveData = schedule
      ? shapeScheduledLive(schedule, schedule.flight || resolved.flightNumber || flight, scheduledRoute)
      : null;
    if (liveData) {
      return liveResponse(flight, {
        data: liveData,
        searchedCallsigns: candidates,
        resolvedAirlineIcao: resolved.resolvedAirlineIcao,
      });
    }

    if (schedule) {
      const identifiers = [
        schedule.aircraft.icao24 ? { selector: "hex" as const, value: schedule.aircraft.icao24 } : null,
        schedule.aircraft.registration ? { selector: "reg" as const, value: schedule.aircraft.registration } : null,
      ].filter((item): item is { selector: "hex" | "reg"; value: string } => item != null);
      const identityRequests: Promise<{ aircraft: AdsbAircraft; label: string }>[] = identifiers.flatMap(
        (identifier) => communityProviders.map(async (provider) => ({
          aircraft: await fetchProvider(provider.baseUrl, identifier.selector, identifier.value),
          label: provider.label,
        })),
      );
      if (schedule.aircraft.icao24) {
        identityRequests.push(fetchOpenSkyByHex(schedule.aircraft.icao24).then((aircraft) => ({
          aircraft,
          label: "OpenSky",
        })));
      }
      if (identityRequests.length) {
        try {
          const found = await Promise.any(identityRequests);
          const data = shape(
            found.aircraft,
            schedule.flight || resolved.flightNumber || flight,
            `${found.label} · repülőgép-azonosító alapján`,
            scheduledRoute,
            schedule,
          );
          if (data) {
            return liveResponse(flight, {
              data,
              searchedCallsigns: candidates,
              resolvedAirlineIcao: resolved.resolvedAirlineIcao,
            });
          }
        } catch {
          // Egyik repülőgép-azonosító alapú tartalékforrás sem adott friss pozíciót.
        }
      }
    }
  } catch {
    // A szokásos, részletes hibaüzenet következik.
  }

  if (cachedLive && cachedLive.staleUntil > Date.now()) {
    const cachedData = cachedLive.value.data;
    return NextResponse.json({
      ...cachedLive.value,
      data: cachedData && typeof cachedData === "object"
        ? {
          ...cachedData,
          source: `${String((cachedData as Record<string, unknown>).source || "Közösségi ADS-B")} · legutóbbi elérhető adat`,
        }
        : cachedData,
      cached: "stale",
    });
  }

  return NextResponse.json(
    {
      error: `A ${flight} járatszámot ${candidates.filter((candidate) => candidate !== flight).join(", ") || flight} hívójelre oldottuk fel, de a repülőgép most nem látható az ADS-B hálózaton.`,
      searchedCallsigns: candidates,
      resolvedAirlineIcao: resolved.resolvedAirlineIcao,
    },
    { status: 404 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      flight?: string;
      aircraft?: AdsbAircraft;
      flightroute?: {
        airline?: { name?: string } | null;
        origin?: Record<string, unknown>;
        destination?: Record<string, unknown>;
      } | null;
    };
    const flight = String(body.flight || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!flight || !body.aircraft) {
      return NextResponse.json({ error: "Hiányos repülési adat." }, { status: 400 });
    }
    const fallbackRoute = routeFromRecord(body.flightroute);
    let verifiedRoute: FlightRoute | null = null;
    let verifiedSchedule: ScheduledFlightInfo | null = null;
    try {
      const resolved = await resolveFlightNumber(flight);
      verifiedSchedule = await fetchScheduledFlight(flight, resolved.candidates);
      verifiedRoute = await routeFromSchedule(verifiedSchedule);
    } catch {
      // Ha a menetrendi ellenőrzés átmenetileg nem elérhető, marad a közösségi útvonaladat.
    }
    const data = shape(
      body.aircraft,
      flight,
      "airplanes.live · közvetlen kapcsolat",
      verifiedRoute || fallbackRoute,
      verifiedSchedule,
    );
    if (!data) return NextResponse.json({ error: "Nincs érvényes pozícióadat." }, { status: 400 });
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: "A repülési adat nem dolgozható fel." }, { status: 400 });
  }
}
