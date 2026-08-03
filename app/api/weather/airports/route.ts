import { NextRequest, NextResponse } from "next/server";
import airportCodes from "@nwpr/airport-codes";
import { fetchHourlyWeather } from "./hourly";

export const runtime = "nodejs";

const AVIATION_WEATHER_BASE = "https://aviationweather.gov/api/data";
const ICAO_PATTERN = /^[A-Z0-9]{4}$/;

type MetarRecord = {
  icaoId?: string;
  name?: string;
  reportTime?: string;
  temp?: number;
  dewp?: number;
  wdir?: number | string;
  wspd?: number;
  visib?: string | number;
  altim?: number;
  cover?: string;
  fltCat?: string;
  rawOb?: string;
  clouds?: Array<{ cover?: string; base?: number | null; type?: string | null }>;
};

type TafPeriod = {
  timeFrom?: number;
  timeTo?: number;
  timeBec?: number | null;
  fcstChange?: string | null;
  probability?: number | null;
  wdir?: number | string;
  wspd?: number;
  wgst?: number | null;
  visib?: string | number;
  wxString?: string | null;
  clouds?: Array<{ cover?: string; base?: number | null; type?: string | null }>;
};

type TafRecord = {
  icaoId?: string;
  name?: string;
  issueTime?: string;
  validTimeFrom?: number;
  validTimeTo?: number;
  rawTAF?: string;
  fcsts?: TafPeriod[];
};

function epochIso(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
}

function normalizeClouds(clouds: Array<{ cover?: string; base?: number | null; type?: string | null }> | undefined) {
  return (clouds || []).map((cloud) => ({
    cover: cloud.cover || "—",
    baseFt: typeof cloud.base === "number" ? cloud.base : null,
    type: cloud.type || null,
  }));
}

async function fetchAviationWeather<T>(kind: "metar" | "taf", ids: string[]) {
  const url = `${AVIATION_WEATHER_BASE}/${kind}?ids=${encodeURIComponent(ids.join(","))}&format=json`;
  const response = await fetch(url, {
    headers: { "User-Agent": "legiradar/1.0 airport-weather" },
    next: { revalidate: kind === "metar" ? 300 : 900 },
  });
  if (!response.ok) throw new Error(`${kind.toUpperCase()} szolgáltatás: HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload) ? payload as T[] : [];
}

export async function GET(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get("ids") || "")
    .toUpperCase()
    .split(",")
    .map((id) => id.trim())
    .filter((id, index, all) => ICAO_PATTERN.test(id) && all.indexOf(id) === index)
    .slice(0, 2);

  if (ids.length === 0) {
    return NextResponse.json({ error: "Legalább egy érvényes ICAO repülőtér-kód szükséges." }, { status: 400 });
  }

  try {
    const targets = ids.map((_, index) => request.nextUrl.searchParams.get(`target${index}`));
    const [metarResult, tafResult, temperatureResult] = await Promise.allSettled([
      fetchAviationWeather<MetarRecord>("metar", ids),
      fetchAviationWeather<TafRecord>("taf", ids),
      Promise.all(ids.map(async (icao, index) => {
        const targetAt = targets[index];
        if (!targetAt || !Number.isFinite(Date.parse(targetAt))) return null;
        const airport = airportCodes.find((item) => item.icao === icao);
        const latitude = Number(airport?.latitude);
        const longitude = Number(airport?.longitude);
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
          || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
        try {
          return await fetchHourlyWeather(latitude, longitude, targetAt);
        } catch {
          // A kiegészítő hőmérsékletforrás hibája nem teheti használhatatlanná
          // a hiteles repülésmeteorológiai METAR/TAF adatokat.
          return null;
        }
      })),
    ]);
    const metars = metarResult.status === "fulfilled" ? metarResult.value : [];
    const tafs = tafResult.status === "fulfilled" ? tafResult.value : [];
    const targetTemperatures = temperatureResult.status === "fulfilled"
      ? temperatureResult.value
      : ids.map(() => null);

    const airportRecords = ids.map((icao, index) => {
      const metar = metars.find((item) => item.icaoId?.toUpperCase() === icao);
      const taf = tafs.find((item) => item.icaoId?.toUpperCase() === icao);
      return {
        icao,
        name: metar?.name || taf?.name || null,
        targetAt: targets[index] || null,
        targetTemperature: targetTemperatures[index],
        current: metar ? {
          observedAt: metar.reportTime || null,
          temperatureC: typeof metar.temp === "number" ? metar.temp : null,
          dewpointC: typeof metar.dewp === "number" ? metar.dewp : null,
          windDirectionDeg: typeof metar.wdir === "number" ? metar.wdir : null,
          windVariable: metar.wdir === "VRB",
          windSpeedKt: typeof metar.wspd === "number" ? metar.wspd : null,
          visibility: metar.visib == null ? null : String(metar.visib),
          pressureHpa: typeof metar.altim === "number" ? metar.altim : null,
          cloudSummary: metar.cover || null,
          clouds: normalizeClouds(metar.clouds),
          flightCategory: metar.fltCat || null,
          raw: metar.rawOb || null,
        } : null,
        forecast: taf ? {
          issuedAt: taf.issueTime || null,
          validFrom: epochIso(taf.validTimeFrom),
          validTo: epochIso(taf.validTimeTo),
          raw: taf.rawTAF || null,
          periods: (taf.fcsts || []).map((period) => ({
            from: epochIso(period.timeFrom),
            to: epochIso(period.timeTo),
            becomingAt: epochIso(period.timeBec || undefined),
            change: period.fcstChange || null,
            probability: typeof period.probability === "number" ? period.probability : null,
            windDirectionDeg: typeof period.wdir === "number" ? period.wdir : null,
            windVariable: period.wdir === "VRB",
            windSpeedKt: typeof period.wspd === "number" ? period.wspd : null,
            windGustKt: typeof period.wgst === "number" ? period.wgst : null,
            visibility: period.visib == null || period.visib === "" ? null : String(period.visib),
            weather: period.wxString || null,
            clouds: normalizeClouds(period.clouds),
          })),
        } : null,
      };
    });

    return NextResponse.json(
      { airports: airportRecords, source: "NOAA/NWS Aviation Weather Center", updatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=300" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "A repülőtéri időjárás nem elérhető." },
      { status: 502 },
    );
  }
}
