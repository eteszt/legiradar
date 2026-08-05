import { execFile } from "node:child_process";
import { promisify } from "node:util";
import airportCodes from "@nwpr/airport-codes";

const airports = Array.isArray(airportCodes)
  ? airportCodes
  : (airportCodes as unknown as { airports: typeof airportCodes }).airports;

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

export type Fr24AirframeLiveIdentity = {
  flight: string;
  callsign: string;
  registration: string;
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

async function fetchTextViaCurl(url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  const headerArgs = Object.entries(extraHeaders).flatMap(([name, value]) => ["-H", `${name}: ${value}`]);
  const { stdout } = await execFileAsync("curl", [
    "-fsSL", "--retry", "2", "--retry-delay", "1", "--max-time", "30",
    "-A", USER_AGENT, "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    ...headerArgs,
    "-e", HEADERS.Referer, url,
  ], { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

async function fetchJson(url: string, attempts = 2, curlFallback = true): Promise<unknown> {
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
  if (!curlFallback) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  try {
    return await fetchJsonViaCurl(url);
  } catch (curlError) {
    const fetchMessage = lastError instanceof Error ? lastError.message : String(lastError);
    const curlMessage = curlError instanceof Error ? curlError.message : String(curlError);
    throw new Error(`${fetchMessage}; curl fallback: ${curlMessage}`);
  }
}

async function fetchText(
  url: string,
  attempts = 2,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          ...HEADERS,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...extraHeaders,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
  try {
    return await fetchTextViaCurl(url, extraHeaders);
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

export function mapAirframeLiveIdentityCandidate(
  item: unknown,
  registration: string,
  identifiers: Iterable<string>,
): Fr24AirframeLiveIdentity | null {
  const candidate = object(item);
  if (candidate.type !== "live" || !candidate.id) return null;
  const detail = object(candidate.detail);
  const expectedRegistration = normalizeFlightIdentifier(registration);
  const candidateRegistration = normalizeFlightIdentifier(detail.reg);
  const flight = normalizeFlightIdentifier(detail.flight);
  const callsign = normalizeFlightIdentifier(detail.callsign);
  const wanted = new Set(Array.from(identifiers, normalizeFlightIdentifier).filter(Boolean));
  if (!expectedRegistration || candidateRegistration !== expectedRegistration) return null;
  if (!flight || !callsign || (!wanted.has(flight) && !wanted.has(callsign))) return null;
  return { flight, callsign, registration: String(detail.reg).trim().toUpperCase() };
}

export function commercialLiveIdentityQueries(input: string) {
  const normalized = normalizeFlightIdentifier(input);
  return /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(normalized) ? [normalized] : [];
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
    // A FR24 keresési index több edge-pillanatképből szolgál ki; ugyanaz az aktív
    // járat egy friss példányon megjelenhet, miközben egy másikon rövid ideig még
    // hiányzik. Az üres, de technikailag sikeres választ ezért cache-busterrel is
    // újrapróbáljuk, nem csak a hálózati/HTTP hibákat.
    for (let snapshotAttempt = 0; snapshotAttempt < 3; snapshotAttempt += 1) {
      let search: unknown;
      const cacheBuster = `${Date.now()}-${snapshotAttempt}`;
      try {
        search = await fetchJson(
          `https://www.flightradar24.com/v1/search/web/find?query=${encodeURIComponent(identifier)}&limit=20&_=${cacheBuster}`,
        );
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
            `https://data-live.flightradar24.com/clickhandler/?version=1.5&flight=${encodeURIComponent(id)}&_=${cacheBuster}`,
          );
          const mapped = mapTargetedAirborneDetail(detail, candidate, Date.now(), wanted);
          if (mapped) return mapped;
        } catch {
          // Egy hibás/stale live-ID után a következő pontos jelöltet is megvizsgáljuk.
        }
      }
      if (snapshotAttempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (snapshotAttempt + 1)));
      }
    }
  }
  return null;
}

export async function findLiveIdentityByAirframe(
  registration: string,
  identifiers: string[],
): Promise<Fr24AirframeLiveIdentity | null> {
  const normalizedRegistration = normalizeFlightIdentifier(registration);
  const wanted = Array.from(new Set(identifiers.map(normalizeFlightIdentifier).filter(Boolean)));
  if (!normalizedRegistration || wanted.length === 0) return null;
  for (let snapshotAttempt = 0; snapshotAttempt < 3; snapshotAttempt += 1) {
    try {
      const cacheBuster = `${Date.now()}-${snapshotAttempt}`;
      const search = await fetchJson(
        `https://www.flightradar24.com/v1/search/web/find?query=${encodeURIComponent(registration)}&limit=20&_=${cacheBuster}`,
      );
      const results = nested(search, "results");
      if (Array.isArray(results)) {
        for (const item of results) {
          const identity = mapAirframeLiveIdentityCandidate(item, registration, wanted);
          if (identity) return identity;
        }
      }
    } catch {
      // Az üres vagy blokkolt edge-választ friss pillanatképpel próbáljuk újra.
    }
    if (snapshotAttempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (snapshotAttempt + 1)));
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

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function rowText(html: string) {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function mapSchedulePageRows(html: string, flight: string): Fr24ScheduleOccurrence[] {
  const normalizedFlight = normalizeFlightIdentifier(flight);
  const rows: Fr24ScheduleOccurrence[] = [];
  const rowPattern = /<tr\b[^>]*\bclass=["'][^"']*\bdata-row\b[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi;
  for (const match of html.matchAll(rowPattern)) {
    const row = match[0];
    const departureSeconds = finiteNumber(row.match(/<tr\b[^>]*\bdata-timestamp=["'](\d+)["']/i)?.[1]);
    if (departureSeconds == null) continue;
    const departureAt = new Date(departureSeconds * 1000).toISOString();
    const timestamps = Array.from(row.matchAll(/\bdata-timestamp=["'](\d+)["']/gi))
      .map((item) => finiteNumber(item[1]))
      .filter((value): value is number => value != null && value > 0);
    const arrivalSeconds = timestamps.filter((value) => value !== departureSeconds).at(-1) ?? null;
    const airportCodes = Array.from(row.matchAll(/href=["']\/data\/airports\/([a-z0-9]{3})["']/gi))
      .map((item) => item[1].toUpperCase())
      .filter((value, index, array) => array.indexOf(value) === index);
    if (airportCodes.length < 2) continue;
    const statusText = rowText(row);
    const statusMatch = statusText.match(/\b(Cancelled|Canceled|Estimated|Delayed|Landed|Scheduled)\b/i);
    rows.push({
      flight: normalizedFlight,
      callsign: null,
      status: statusMatch?.[1] || "scheduled",
      departureAt,
      estimatedDepartureAt: null,
      actualDepartureAt: null,
      arrivalAt: arrivalSeconds == null ? null : new Date(arrivalSeconds * 1000).toISOString(),
      estimatedArrivalAt: null,
      actualArrivalAt: null,
      origin: { iata: airportCodes[0], icao: null, name: null, city: null, country: null, lat: null, lon: null },
      destination: { iata: airportCodes[1], icao: null, name: null, city: null, country: null, lat: null, lon: null },
      registration: null,
      aircraftType: text(statusText.match(/\b([A-Z0-9]{3,4})\b\s+[—-]\s+\d{1,2}:\d{2}/)?.[1]),
      hex: null,
    });
  }
  return rows;
}

const MONTH_INDEX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function markdownAirport(value: string): Fr24Airport | null {
  const iata = value.match(/\/data\/airports\/([a-z0-9]{3})/i)?.[1]?.toUpperCase();
  if (!iata) return null;
  const data = airports.find((item) => item.iata === iata);
  return {
    iata,
    icao: data?.icao || null,
    name: data?.name || null,
    city: data?.city || null,
    country: data?.country || null,
    lat: finiteNumber(data?.latitude),
    lon: finiteNumber(data?.longitude),
  };
}

function localTimeParts(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return { hour, minute: Number(match[2]) };
}

function airportLocalIso(date: string, time: string, iata: string) {
  const dateMatch = date.trim().match(/^(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})$/);
  const clock = localTimeParts(time);
  const data = airports.find((item) => item.iata === iata);
  const month = dateMatch ? MONTH_INDEX[dateMatch[2]] : undefined;
  if (!dateMatch || !clock || month == null || !data) return null;
  const wanted = {
    year: Number(dateMatch[3]), month, day: Number(dateMatch[1]),
    hour: clock.hour, minute: clock.minute,
  };
  const wantedAsUtc = Date.UTC(wanted.year, wanted.month, wanted.day, wanted.hour, wanted.minute);
  if (!data.tz) {
    const offsetHours = finiteNumber(data.timezone);
    return new Date(wantedAsUtc - (offsetHours || 0) * 60 * 60_000).toISOString();
  }
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: data.tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    let guess = wantedAsUtc;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(guess))
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, Number(part.value)]),
      ) as Record<string, number>;
      const representedAsUtc = Date.UTC(
        parts.year, parts.month - 1, parts.day, parts.hour, parts.minute,
      );
      guess += wantedAsUtc - representedAsUtc;
    }
    return new Date(guess).toISOString();
  } catch {
    const offsetHours = finiteNumber(data.timezone);
    return new Date(wantedAsUtc - (offsetHours || 0) * 60 * 60_000).toISOString();
  }
}

/** Parse the rendered FR24 history table returned by Jina Reader as Markdown. */
export function mapScheduleMarkdownRows(markdown: string, flight: string): Fr24ScheduleOccurrence[] {
  const normalizedFlight = normalizeFlightIdentifier(flight);
  const rows: Fr24ScheduleOccurrence[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|") || /^\|\s*-+/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 12) continue;
    const origin = markdownAirport(cells[3]);
    const destination = markdownAirport(cells[4]);
    if (!origin?.iata || !destination?.iata) continue;
    const departureAt = airportLocalIso(cells[2], cells[7], origin.iata);
    let arrivalAt = airportLocalIso(cells[2], cells[9], destination.iata);
    if (!departureAt) continue;
    if (arrivalAt && Date.parse(arrivalAt) <= Date.parse(departureAt)) {
      arrivalAt = new Date(Date.parse(arrivalAt) + 24 * 60 * 60_000).toISOString();
    }
    const aircraftType = cells[5].match(/^([A-Z0-9]{3,4})\b/)?.[1] || null;
    const registration = cells[5].match(/\[\(([A-Z0-9-]+)\)\]/i)?.[1] || null;
    const status = cells[11] || "scheduled";
    rows.push({
      flight: normalizedFlight,
      callsign: null,
      status,
      departureAt,
      estimatedDepartureAt: /estimated/i.test(status) ? departureAt : null,
      actualDepartureAt: cells[8] && cells[8] !== "—"
        ? airportLocalIso(cells[2], cells[8], origin.iata)
        : null,
      arrivalAt,
      estimatedArrivalAt: null,
      actualArrivalAt: null,
      origin,
      destination,
      registration,
      aircraftType,
      hex: null,
    });
  }
  return rows;
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

export function selectCurrentAirframeOccurrence(
  occurrences: Fr24ScheduleOccurrence[],
  identifiers: string[],
  now = Date.now(),
) {
  const wanted = new Set(identifiers.map(normalizeFlightIdentifier).filter(Boolean));
  return occurrences
    .filter((item) => {
      const departure = Date.parse(item.actualDepartureAt || item.estimatedDepartureAt || item.departureAt);
      const arrival = Date.parse(item.estimatedArrivalAt || item.arrivalAt || "");
      const status = item.status.toLowerCase();
      return wanted.has(normalizeFlightIdentifier(item.flight))
        && Boolean(item.registration)
        && !status.includes("cancel")
        && !status.includes("landed")
        && Number.isFinite(departure)
        && Number.isFinite(arrival)
        && departure <= now + 30 * 60_000
        && arrival >= now - 45 * 60_000;
    })
    .sort((left, right) => {
      const leftDeparture = Date.parse(left.actualDepartureAt || left.estimatedDepartureAt || left.departureAt);
      const rightDeparture = Date.parse(right.actualDepartureAt || right.estimatedDepartureAt || right.departureAt);
      return Math.abs(now - leftDeparture) - Math.abs(now - rightDeparture);
    })[0] || null;
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
      const payload = await fetchJson(`https://www.flightradar24.com/v1/search/web/find?${params}`, 1, false);
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
      const payload = await fetchJson(`https://api.flightradar24.com/common/v1/flight/list.json?${params}`, 1, false);
      const data = nested(payload, "result", "response", "data");
      const occurrences = Array.isArray(data)
        ? data.map(mapScheduleItem).filter((item): item is Fr24ScheduleOccurrence => item != null)
        : [];
      const selected = selectNext24hOccurrence(occurrences, selectionIdentifiers, now);
      if (selected) return selected;
    } catch {
      // A JSON lista Railwayről időnként 429-et kap. Ilyenkor ugyanazon pontos
      // kereskedelmi azonosító Jina által renderelt, dátumozott tábláját olvassuk.
    }
    try {
      const readerUrl = `https://r.jina.ai/https://www.flightradar24.com/data/flights/${encodeURIComponent(query.toLowerCase())}`;
      const markdown = await fetchText(readerUrl, 1);
      const selected = selectNext24hOccurrence(
        mapScheduleMarkdownRows(markdown, query),
        selectionIdentifiers,
        now,
      );
      if (selected) return selected;
    } catch {
      // A Jina Reader átmeneti hibája esetén a közvetlen nyilvános oldalt próbáljuk.
    }
    try {
      const html = await fetchText(`https://www.flightradar24.com/data/flights/${encodeURIComponent(query.toLowerCase())}`, 1);
      const selected = selectNext24hOccurrence(mapSchedulePageRows(html, query), selectionIdentifiers, now);
      if (selected) return selected;
    } catch {
      // A következő, pontosan feloldott kereskedelmi azonosítót is megpróbáljuk.
    }
  }
  return null;
}

export async function findCurrentAirframeOccurrence(
  identifiers: string[],
  now = Date.now(),
): Promise<Fr24ScheduleOccurrence | null> {
  const wanted = Array.from(new Set(identifiers.map(normalizeFlightIdentifier).filter(Boolean)));
  const queries = await resolveScheduleQueries(wanted);
  const selectionIdentifiers = Array.from(new Set([...wanted, ...queries]));
  for (const query of queries) {
    try {
      const readerUrl = `https://r.jina.ai/https://www.flightradar24.com/data/flights/${encodeURIComponent(query.toLowerCase())}`;
      const markdown = await fetchText(readerUrl, 1);
      const selected = selectCurrentAirframeOccurrence(
        mapScheduleMarkdownRows(markdown, query),
        selectionIdentifiers,
        now,
      );
      if (selected) return selected;
    } catch {
      // A közvetlen nyilvános oldal ugyanazt a dátumozott előfordulást adhatja.
    }
    try {
      const html = await fetchText(`https://www.flightradar24.com/data/flights/${encodeURIComponent(query.toLowerCase())}`, 1);
      const selected = selectCurrentAirframeOccurrence(
        mapSchedulePageRows(html, query),
        selectionIdentifiers,
        now,
      );
      if (selected) return selected;
    } catch {
      // A következő pontos kereskedelmi azonosítót próbáljuk.
    }
  }
  return null;
}
