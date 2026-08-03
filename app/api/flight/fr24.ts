import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HEADERS = {
  Accept: "application/json,text/plain,*/*",
  Referer: "https://www.flightradar24.com/",
  "User-Agent": USER_AGENT,
};

export type Fr24Airport = {
  iata: string | null;
  icao: string | null;
  name: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
};

export type Fr24LiveFlight = {
  flight: string | null;
  callsign: string | null;
  hex: string | null;
  registration: string | null;
  origin: Fr24Airport | null;
  destination: Fr24Airport | null;
  scheduledDepartureAt: string | null;
  scheduledArrivalAt: string | null;
  actualDepartureAt: string | null;
  estimatedArrivalAt: string | null;
  lat: number;
  lon: number;
  trackDeg: number | null;
  altitudeFt: number;
  groundSpeedKt: number | null;
  verticalRateFpm: number | null;
  observedAt: string;
  aircraftType: string | null;
};

export type Fr24ScheduleOccurrence = {
  flight: string;
  callsign: string | null;
  status: string;
  departureAt: string;
  estimatedDepartureAt: string | null;
  actualDepartureAt: string | null;
  arrivalAt: string | null;
  estimatedArrivalAt: string | null;
  actualArrivalAt: string | null;
  origin: Fr24Airport | null;
  destination: Fr24Airport | null;
  registration: string | null;
  aircraftType: string | null;
  hex: string | null;
};

type JsonObject = Record<string, unknown>;

export function normalizeFlightIdentifier(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function object(value: unknown): JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function nested(root: unknown, ...keys: string[]): unknown {
  let current: unknown = root;
  for (const key of keys) current = object(current)[key];
  return current;
}

function epochIso(value: unknown) {
  const seconds = finiteNumber(value);
  return seconds != null && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function airport(value: unknown): Fr24Airport | null {
  const data = object(value);
  if (Object.keys(data).length === 0) return null;
  return {
    iata: text(nested(data, "code", "iata")),
    icao: text(nested(data, "code", "icao")),
    name: text(data.name),
    city: text(nested(data, "position", "region", "city")),
    country: text(nested(data, "position", "country", "name")),
    lat: finiteNumber(nested(data, "position", "latitude")),
    lon: finiteNumber(nested(data, "position", "longitude")),
  };
}

async function fetchJsonViaCurl(url: string): Promise<unknown> {
  const { stdout } = await execFileAsync("curl", [
    "-fsSL", "--retry", "2", "--retry-delay", "1", "--max-time", "20",
    "-A", USER_AGENT, "-H", `Accept: ${HEADERS.Accept}`, "-e", HEADERS.Referer, url,
  ], { maxBuffer: 5 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function fetchJson(url: string, attempts = 2): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: HEADERS,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
  try {
    return await fetchJsonViaCurl(url);
  } catch (curlError) {
    const fetchMessage = lastError instanceof Error ? lastError.message : String(lastError);
    const curlMessage = curlError instanceof Error ? curlError.message : String(curlError);
    throw new Error(`${fetchMessage}; curl fallback: ${curlMessage}`);
  }
}

export function isExactLiveCandidate(item: unknown, identifiers: Iterable<string>) {
  const candidate = object(item);
  if (candidate.type !== "live" || !candidate.id) return false;
  const wanted = new Set(Array.from(identifiers, normalizeFlightIdentifier).filter(Boolean));
  const detail = object(candidate.detail);
  return wanted.has(normalizeFlightIdentifier(detail.flight))
    || wanted.has(normalizeFlightIdentifier(detail.callsign));
}

export function mapTargetedAirborneDetail(
  rawDetail: unknown,
  rawCandidate: unknown,
  now = Date.now(),
  identifiers?: Iterable<string>,
): Fr24LiveFlight | null {
  const detail = object(rawDetail);
  const candidate = object(rawCandidate);
  const candidateDetail = object(candidate.detail);
  const detailFlight = normalizeFlightIdentifier(nested(detail, "identification", "number", "default"));
  const detailCallsign = normalizeFlightIdentifier(nested(detail, "identification", "callsign"));
  const wanted = new Set(
    identifiers
      ? Array.from(identifiers, normalizeFlightIdentifier).filter(Boolean)
      : [candidateDetail.flight, candidateDetail.callsign].map(normalizeFlightIdentifier).filter(Boolean),
  );
  if (!wanted.has(detailFlight) && !wanted.has(detailCallsign)) return null;
  const trail = Array.isArray(detail.trail) ? detail.trail : [];
  const point = trail
    .map(object)
    .filter((item) => finiteNumber(item.ts) != null && finiteNumber(item.lat) != null && finiteNumber(item.lng) != null)
    .sort((left, right) => (finiteNumber(right.ts) || 0) - (finiteNumber(left.ts) || 0))[0] || {};
  const altitudeFt = finiteNumber(point.alt);
  const observedSeconds = finiteNumber(point.ts);
  const observedMs = observedSeconds == null ? Number.NaN : observedSeconds * 1000;
  // Óceáni lefedettségi szünetben a pontos, provider által továbbra is live-ként
  // jelölt járat trail-pontja ritkábban frissülhet. 45 perc felett már nem
  // tekintjük használható élő pozíciónak.
  const ageMs = now - observedMs;
  const fresh = Number.isFinite(observedMs) && ageMs >= -2 * 60_000 && ageMs <= 45 * 60_000;
  if (nested(detail, "status", "live") !== true || !fresh || altitudeFt == null || altitudeFt <= 100) return null;
  const lat = finiteNumber(point.lat);
  const lon = finiteNumber(point.lng);
  if (lat == null || lat < -90 || lat > 90 || lon == null || lon < -180 || lon > 180) return null;
  return {
    flight: detailFlight || normalizeFlightIdentifier(candidateDetail.flight) || null,
    callsign: detailCallsign || normalizeFlightIdentifier(candidateDetail.callsign) || null,
    hex: normalizeFlightIdentifier(nested(detail, "aircraft", "hex")) || null,
    registration: text(nested(detail, "aircraft", "registration") || candidateDetail.reg),
    origin: airport(nested(detail, "airport", "origin")),
    destination: airport(nested(detail, "airport", "destination")),
    scheduledDepartureAt: epochIso(nested(detail, "time", "scheduled", "departure")),
    scheduledArrivalAt: epochIso(nested(detail, "time", "scheduled", "arrival")),
    actualDepartureAt: epochIso(nested(detail, "time", "real", "departure")),
    estimatedArrivalAt: epochIso(
      nested(detail, "time", "estimated", "arrival") || nested(detail, "time", "other", "eta"),
    ),
    lat,
    lon,
    trackDeg: finiteNumber(point.hd),
    altitudeFt,
    groundSpeedKt: finiteNumber(point.spd),
    verticalRateFpm: finiteNumber(point.vspeed),
    observedAt: new Date(observedMs).toISOString(),
    aircraftType: text(nested(detail, "aircraft", "model", "code") || candidateDetail.ac_type),
  };
}

export async function findTargetedAirborne(identifiers: string[]): Promise<Fr24LiveFlight | null> {
  const wanted = Array.from(new Set(identifiers.map(normalizeFlightIdentifier).filter(Boolean)));
  for (const identifier of wanted) {
    let search: unknown;
    try {
      search = await fetchJson(`https://www.flightradar24.com/v1/search/web/find?query=${encodeURIComponent(identifier)}&limit=20`);
    } catch {
      continue;
    }
    const results = nested(search, "results");
    const exactLive = Array.isArray(results)
      ? results.filter((item) => isExactLiveCandidate(item, wanted))
      : [];
    for (const candidate of exactLive) {
      const id = text(object(candidate).id);
      if (!id) continue;
      try {
        const detail = await fetchJson(
          `https://data-live.flightradar24.com/clickhandler/?version=1.5&flight=${encodeURIComponent(id)}`,
        );
        const mapped = mapTargetedAirborneDetail(detail, candidate, Date.now(), wanted);
        if (mapped) return mapped;
      } catch {
        // Egy hibás/stale live-ID után a következő pontos jelöltet is megvizsgáljuk.
      }
    }
  }
  return null;
}

export function mapScheduleItem(rawItem: unknown): Fr24ScheduleOccurrence | null {
  const item = object(rawItem);
  const flight = normalizeFlightIdentifier(nested(item, "identification", "number", "default"));
  const departureAt = epochIso(nested(item, "time", "scheduled", "departure"));
  if (!flight || !departureAt) return null;
  const statuses = [
    nested(item, "status", "generic", "status", "text"),
    nested(item, "status", "generic", "status", "type"),
    nested(item, "status", "text"),
  ].map(text).filter((value): value is string => value != null);
  return {
    flight,
    callsign: normalizeFlightIdentifier(nested(item, "identification", "callsign")) || null,
    status: statuses.join(" · ") || "scheduled",
    departureAt,
    estimatedDepartureAt: epochIso(nested(item, "time", "estimated", "departure")),
    actualDepartureAt: epochIso(nested(item, "time", "real", "departure")),
    arrivalAt: epochIso(nested(item, "time", "scheduled", "arrival")),
    estimatedArrivalAt: epochIso(
      nested(item, "time", "estimated", "arrival") || nested(item, "time", "other", "eta"),
    ),
    actualArrivalAt: epochIso(nested(item, "time", "real", "arrival")),
    origin: airport(nested(item, "airport", "origin")),
    destination: airport(nested(item, "airport", "destination")),
    registration: text(nested(item, "aircraft", "registration")),
    aircraftType: text(nested(item, "aircraft", "model", "code")),
    hex: normalizeFlightIdentifier(nested(item, "aircraft", "hex")) || null,
  };
}

export function selectNext24hOccurrence(
  occurrences: Fr24ScheduleOccurrence[],
  identifiers: string[],
  now = Date.now(),
) {
  const wanted = new Set(identifiers.map(normalizeFlightIdentifier).filter(Boolean));
  const horizon = now + 24 * 60 * 60_000;
  return occurrences
    .filter((item) => {
      const departure = Date.parse(item.departureAt);
      const status = item.status.toLowerCase();
      const exact = wanted.has(normalizeFlightIdentifier(item.flight))
        || Boolean(item.callsign && wanted.has(normalizeFlightIdentifier(item.callsign)));
      return exact
        && !status.includes("cancel")
        && Number.isFinite(departure)
        && departure >= now
        && departure <= horizon;
    })
    .sort((left, right) => Date.parse(left.departureAt) - Date.parse(right.departureAt))[0] || null;
}

export function scheduleQueriesFromSearch(rawPayload: unknown, identifiers: string[]) {
  const payload = object(rawPayload);
  const results = Array.isArray(payload.results) ? payload.results : [];
  const wanted = new Set(identifiers.map(normalizeFlightIdentifier).filter(Boolean));
  const queries: string[] = [];

  for (const rawResult of results) {
    const result = object(rawResult);
    if (text(result.type)?.toLowerCase() !== "schedule") continue;
    const detail = object(result.detail);
    const flight = normalizeFlightIdentifier(detail.flight || result.id);
    const callsign = normalizeFlightIdentifier(detail.callsign);
    if (!wanted.has(flight) && !wanted.has(callsign)) continue;
    if (/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(flight) && !queries.includes(flight)) queries.push(flight);
  }
  return queries;
}

async function resolveScheduleQueries(wanted: string[]) {
  for (const identifier of wanted.slice(0, 4)) {
    try {
      const params = new URLSearchParams({ query: identifier, limit: "50" });
      const payload = await fetchJson(`https://www.flightradar24.com/v1/search/web/find?${params}`, 1);
      const resolved = scheduleQueriesFromSearch(payload, wanted);
      if (resolved.length > 0) return resolved;
    } catch {
      // A pontos keresőindex átmeneti hibája esetén a kereskedelmi alakra esünk vissza.
    }
  }
  const commercial = wanted.filter((identifier) => /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(identifier));
  return commercial.length > 0 ? commercial.slice(0, 2) : wanted.slice(0, 1);
}

export async function findNext24hSchedule(
  identifiers: string[],
  now = Date.now(),
): Promise<Fr24ScheduleOccurrence | null> {
  const wanted = Array.from(new Set(identifiers.map(normalizeFlightIdentifier).filter(Boolean)));
  const queries = await resolveScheduleQueries(wanted);
  const selectionIdentifiers = Array.from(new Set([...wanted, ...queries]));

  // A korábbi párhuzamos aliaslekérdezések egyetlen keresésnél akár nyolc
  // FR24-kérést indítottak, ami a Railway IP-ről azonnali 429-et válthatott ki.
  // A keresőindex által igazolt kereskedelmi azonosítókat ezért sorrendben,
  // találatig kérdezzük le.
  for (const query of queries) {
    try {
      const params = new URLSearchParams({ query, fetchBy: "flight", page: "1", limit: "100" });
      const payload = await fetchJson(`https://api.flightradar24.com/common/v1/flight/list.json?${params}`, 1);
      const data = nested(payload, "result", "response", "data");
      const occurrences = Array.isArray(data)
        ? data.map(mapScheduleItem).filter((item): item is Fr24ScheduleOccurrence => item != null)
        : [];
      const selected = selectNext24hOccurrence(occurrences, selectionIdentifiers, now);
      if (selected) return selected;
    } catch {
      // A következő, pontosan feloldott kereskedelmi azonosítót is megpróbáljuk.
    }
  }
  return null;
}
