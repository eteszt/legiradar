"use client";

import { type CSSProperties, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoGraticule10, geoInterpolate, geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";

type Telemetry = {
  flight: string;
  callsign: string;
  hex: string;
  lat: number;
  lon: number;
  altitudeM: number | null;
  geometricAltitudeM: number | null;
  groundSpeedKmh: number | null;
  trueAirspeedKmh: number | null;
  indicatedAirspeedKmh: number | null;
  trackDeg: number | null;
  magneticHeadingDeg: number | null;
  trueHeadingDeg: number | null;
  verticalRateMs: number | null;
  geometricRateMs: number | null;
  mach: number | null;
  rollDeg: number | null;
  navQnhHpa: number | null;
  selectedAltitudeM: number | null;
  navHeadingDeg: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  outsideAirTempC: number | null;
  totalAirTempC: number | null;
  squawk: number | null;
  category: number | null;
  messages: number | null;
  rssiDbfs: number | null;
  seenSeconds: number | null;
  positionAgeSeconds: number | null;
  distanceFromReceiverKm: number | null;
  bearingFromReceiverDeg: number | null;
  signalIntegrity: number | null;
  containmentRadiusM: number | null;
  emergency: string | null;
  onGround: boolean;
  source: string;
  updatedAt: string;
  journey: {
    origin: RouteAirport;
    destination: RouteAirport;
    airlineName: string | null;
    flownKm: number;
    remainingKm: number;
    totalKm: number;
    progressPercent: number | null;
    elapsedMinutes: number;
    remainingMinutes: number;
    estimatedDepartureAt: string | null;
    estimatedArrivalAt: string | null;
    timingType: string;
  } | null;
};

type RouteAirport = {
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
};

type ScheduledFlight = {
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
  source: string;
  route: {
    origin: RouteAirport;
    destination: RouteAirport;
    airlineName: string | null;
  } | null;
};

type WeatherFlight = {
  lat: number;
  lon: number;
  altitudeM: number | null;
  updatedAt: string;
  journey: NonNullable<Telemetry["journey"]>;
  preflight?: boolean;
};

type AirportWeather = {
  icao: string;
  name: string | null;
  targetAt: string | null;
  targetTemperature: {
    validAt: string;
    temperatureC: number;
    apparentTemperatureC: number | null;
    precipitationMm: number | null;
    precipitationProbabilityPct: number | null;
    source: string;
  } | null;
  current: {
    observedAt: string | null;
    temperatureC: number | null;
    dewpointC: number | null;
    windDirectionDeg: number | null;
    windVariable: boolean;
    windSpeedKt: number | null;
    visibility: string | null;
    pressureHpa: number | null;
    cloudSummary: string | null;
    clouds: Array<{ cover: string; baseFt: number | null; type: string | null }>;
    flightCategory: string | null;
    raw: string | null;
  } | null;
  forecast: {
    issuedAt: string | null;
    validFrom: string | null;
    validTo: string | null;
    raw: string | null;
    periods: Array<{
      from: string | null;
      to: string | null;
      becomingAt: string | null;
      change: string | null;
      probability: number | null;
      windDirectionDeg: number | null;
      windVariable: boolean;
      windSpeedKt: number | null;
      windGustKt: number | null;
      visibility: string | null;
      weather: string | null;
      clouds: Array<{ cover: string; baseFt: number | null; type: string | null }>;
    }>;
  } | null;
};

type AirportForecastPeriod = NonNullable<AirportWeather["forecast"]>["periods"][number];

type AirportWeatherPayload = {
  airports: AirportWeather[];
  source: string;
  updatedAt: string;
};

type TurbulenceFeature = {
  type: "Feature";
  properties: {
    source: string;
    hazard: string;
    severity: string;
    area: string | null;
    base: string;
    top: string;
    validFrom: string | null;
    validTo: string | null;
  };
  geometry: { type: string; coordinates: unknown };
};

type AirlineBrand = {
  name: string;
  primary: string;
  secondary: string;
  rgb: string;
  monogram: string;
};

type RouteWeatherImpact = {
  id: string;
  index: number;
  feature: TurbulenceFeature;
  entryPercent: number;
  exitPercent: number;
  entryPoint: [number, number];
  exitPoint: [number, number];
  entryEtaMinutes: number | null;
  exitEtaMinutes: number | null;
  affectedKm: number | null;
  durationMinutes: number | null;
  altitudeRelevant: boolean;
  temporalStatus: "overlaps" | "expires-before-entry" | "starts-after-exit" | "unknown";
  temporallyRelevant: boolean;
};

type RouteSample = {
  routePercent: number;
  progress: number;
  point: [number, number];
  crossSection: [number, number][];
};

const ROUTE_CORRIDOR_HALF_WIDTH_KM = 40;

function weatherFeatureForD3(feature: TurbulenceFeature): TurbulenceFeature {
  // A NOAA szabványos GeoJSON gyűrűirányt használ, a d3-geo gömbi
  // poligonértelmezése viszont ennek ellenkezőjét várja. Megfordítás nélkül a
  // veszélyterület helyett annak teljes földgömbnyi komplementere színeződhet ki.
  if (feature.geometry.type === "Polygon") {
    const rings = feature.geometry.coordinates as number[][][];
    return {
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: rings.map((ring) => [...ring].reverse()),
      },
    };
  }
  if (feature.geometry.type === "MultiPolygon") {
    const polygons = feature.geometry.coordinates as number[][][][];
    return {
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: polygons.map((polygon) =>
          polygon.map((ring) => [...ring].reverse()),
        ),
      },
    };
  }
  return feature;
}

const BUDAPEST_TIME_ZONE = "Europe/Budapest";

function fmt(value: number | null, digits = 0) {
  return value == null || Number.isNaN(value)
    ? "—"
    : value.toLocaleString("hu-HU", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
}

function compass(deg: number | null) {
  if (deg == null) return "—";
  const points = ["É", "ÉK", "K", "DK", "D", "DNy", "Ny", "ÉNy"];
  return `${fmt(deg)}° ${points[Math.round(deg / 45) % 8]}`;
}

function duration(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const hours = Math.floor(minutes / 60);
  const mins = Math.max(0, Math.round(minutes % 60));
  return hours > 0 ? `${hours} ó ${String(mins).padStart(2, "0")} p` : `${mins} perc`;
}

function clockTime(iso: string | null | undefined, fallbackMinutes: number | null, now: Date | null, direction: -1 | 1) {
  const date = iso ? new Date(iso) : now && fallbackMinutes != null ? new Date(now.getTime() + direction * fallbackMinutes * 60_000) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleTimeString("hu-HU", {
        timeZone: BUDAPEST_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

function budapestDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("hu-HU", {
    timeZone: BUDAPEST_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    scheduled: "INDULÁSRA VÁR", active: "AKTÍV", cancelled: "TÖRÖLVE",
    estimated: "VÁRHATÓ", delayed: "KÉSIK", incident: "ESEMÉNY",
    diverted: "ÁTIRÁNYÍTVA", landed: "LESZÁLLT",
  };
  return labels[status.toLowerCase()] || status.toUpperCase();
}

function airlineBrand(name: string | null | undefined, callsign: string | null | undefined): AirlineBrand {
  const source = `${name || ""} ${callsign || ""}`.toLowerCase();
  const brands: Array<[RegExp, Omit<AirlineBrand, "name" | "monogram">]> = [
    [/wizz|wzz/, { primary: "#c6007e", secondary: "#f2b7db", rgb: "198, 0, 126" }],
    [/turkish|thy/, { primary: "#e31b23", secondary: "#ffffff", rgb: "227, 27, 35" }],
    [/ryanair|ryr/, { primary: "#2b63b7", secondary: "#f1c40f", rgb: "43, 99, 183" }],
    [/lufthansa|dlh/, { primary: "#f9ba00", secondary: "#ffffff", rgb: "249, 186, 0" }],
    [/emirates|uae/, { primary: "#d71920", secondary: "#ffffff", rgb: "215, 25, 32" }],
    [/klm/, { primary: "#00a1de", secondary: "#ffffff", rgb: "0, 161, 222" }],
    [/easyjet|ezy/, { primary: "#ff6600", secondary: "#ffffff", rgb: "255, 102, 0" }],
    [/british airways|baw/, { primary: "#4d7fb8", secondary: "#ffffff", rgb: "77, 127, 184" }],
    [/air france|afr/, { primary: "#3f70bb", secondary: "#ffffff", rgb: "63, 112, 187" }],
  ];
  const matched = brands.find(([pattern]) => pattern.test(source))?.[1] || {
    primary: "#35d6e9", secondary: "#ffffff", rgb: "53, 214, 233",
  };
  const displayName = name || "Légitársaság nem ismert";
  const monogram = displayName === "Légitársaság nem ismert"
    ? "✈"
    : displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return { name: displayName, monogram, ...matched };
}

function flightLevelNumber(value: string) {
  if (value === "SFC") return 0;
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function pointInRing(point: [number, number], rawRing: unknown) {
  if (!Array.isArray(rawRing) || rawRing.length < 3) return false;
  const ring = rawRing as number[][];
  const [pointLon, pointLat] = point;
  const normalizedLon = (value: number) => {
    let lon = value;
    while (lon - pointLon > 180) lon -= 360;
    while (lon - pointLon < -180) lon += 360;
    return lon;
  };
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) continue;
    const currentLon = normalizedLon(currentPoint[0] ?? 0);
    const currentLat = currentPoint[1] ?? 0;
    const previousLon = normalizedLon(previousPoint[0] ?? 0);
    const previousLat = previousPoint[1] ?? 0;
    const intersects = ((currentLat > pointLat) !== (previousLat > pointLat))
      && pointLon < ((previousLon - currentLon) * (pointLat - currentLat)) / (previousLat - currentLat) + currentLon;
    if (intersects) inside = !inside;
  }
  return inside;
}

function weatherContainsPoint(feature: TurbulenceFeature, point: [number, number]) {
  const containsPolygon = (rawPolygon: unknown) => {
    if (!Array.isArray(rawPolygon) || !rawPolygon[0] || !pointInRing(point, rawPolygon[0])) return false;
    return !rawPolygon.slice(1).some((hole) => pointInRing(point, hole));
  };
  const coordinates = feature.geometry.coordinates;
  if (feature.geometry.type === "Polygon") return containsPolygon(coordinates);
  if (feature.geometry.type === "MultiPolygon" && Array.isArray(coordinates)) {
    return coordinates.some((polygon) => containsPolygon(polygon));
  }
  return false;
}

function bearingBetween(from: [number, number], to: [number, number]) {
  const toRad = (value: number) => value * Math.PI / 180;
  const toDeg = (value: number) => value * 180 / Math.PI;
  const lon1 = toRad(from[0]);
  const lat1 = toRad(from[1]);
  const lon2 = toRad(to[0]);
  const lat2 = toRad(to[1]);
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function offsetPoint(point: [number, number], distanceKm: number, bearingDeg: number): [number, number] {
  const radiusKm = 6371;
  const angularDistance = distanceKm / radiusKm;
  const bearing = bearingDeg * Math.PI / 180;
  const lat1 = point[1] * Math.PI / 180;
  const lon1 = point[0] * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance)
      + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return [((lon2 * 180 / Math.PI + 540) % 360) - 180, lat2 * 180 / Math.PI];
}

function greatCircleKm(from: [number, number], to: [number, number]) {
  const toRad = (value: number) => value * Math.PI / 180;
  const [lon1, lat1] = from.map(toRad);
  const [lon2, lat2] = to.map(toRad);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function greatCircleCoordinates(
  start: [number, number],
  end: [number, number],
  sampleCount = 201,
): [number, number][] {
  const interpolate = geoInterpolate(start, end);
  return Array.from({ length: Math.max(2, sampleCount) }, (_, index) =>
    interpolate(index / (Math.max(2, sampleCount) - 1)) as [number, number],
  );
}

function remainingRouteSamples(telemetry: WeatherFlight, sampleCount = 201): RouteSample[] {
  if (!telemetry.journey) return [];
  const start: [number, number] = [telemetry.lon, telemetry.lat];
  const destination: [number, number] = [telemetry.journey.destination.lon, telemetry.journey.destination.lat];
  const currentProgress = telemetry.journey.progressPercent ?? 0;
  const points = greatCircleCoordinates(start, destination, sampleCount);
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)] || point;
    const next = points[Math.min(points.length - 1, index + 1)] || point;
    const bearing = bearingBetween(previous, next);
    const progress = index / (sampleCount - 1);
    return {
      progress,
      routePercent: currentProgress + progress * (100 - currentProgress),
      point,
      crossSection: [-ROUTE_CORRIDOR_HALF_WIDTH_KM, -ROUTE_CORRIDOR_HALF_WIDTH_KM / 2, 0, ROUTE_CORRIDOR_HALF_WIDTH_KM / 2, ROUTE_CORRIDOR_HALF_WIDTH_KM]
        .map((offset) => offset === 0 ? point : offsetPoint(point, Math.abs(offset), bearing + (offset < 0 ? -90 : 90))),
    };
  });
}

function routeCorridorPolygon(samples: RouteSample[]) {
  if (samples.length < 2) return [] as [number, number][];
  const left = samples.map((sample) => sample.crossSection[0]).filter(Boolean) as [number, number][];
  const right = samples.map((sample) => sample.crossSection.at(-1)).filter(Boolean).reverse() as [number, number][];
  return [...left, ...right, left[0]].filter(Boolean) as [number, number][];
}

function temporalRelationship(
  feature: TurbulenceFeature,
  referenceTimeMs: number,
  entryEtaMinutes: number | null,
  exitEtaMinutes: number | null,
) {
  const validFrom = feature.properties.validFrom ? Date.parse(feature.properties.validFrom) : Number.NaN;
  const validTo = feature.properties.validTo ? Date.parse(feature.properties.validTo) : Number.NaN;
  if (!Number.isFinite(validFrom) && !Number.isFinite(validTo)) {
    return { temporalStatus: "unknown" as const, temporallyRelevant: true };
  }
  const entryTime = referenceTimeMs + (entryEtaMinutes ?? 0) * 60_000;
  const exitTime = referenceTimeMs + (exitEtaMinutes ?? entryEtaMinutes ?? 0) * 60_000;
  if (Number.isFinite(validTo) && validTo < entryTime) {
    return { temporalStatus: "expires-before-entry" as const, temporallyRelevant: false };
  }
  if (Number.isFinite(validFrom) && validFrom > exitTime) {
    return { temporalStatus: "starts-after-exit" as const, temporallyRelevant: false };
  }
  return { temporalStatus: "overlaps" as const, temporallyRelevant: true };
}

function routeWeatherImpacts(features: TurbulenceFeature[], telemetry: WeatherFlight) {
  const journey = telemetry.journey;
  if (!journey) return [];
  const samples = remainingRouteSamples(telemetry);
  const currentFlightLevel = telemetry.altitudeM == null ? null : telemetry.altitudeM / 30.48;
  const referenceTimeMs = Number.isFinite(Date.parse(telemetry.updatedAt)) ? Date.parse(telemetry.updatedAt) : Date.now();

  return features.flatMap((weather, featureIndex): RouteWeatherImpact[] => {
    const matchingSamples = samples.map((sample, sampleIndex) => ({ sample, sampleIndex }))
      .filter(({ sample }) => sample.crossSection.some((point) => weatherContainsPoint(weather, point)));
    if (matchingSamples.length === 0) return [];

    const runs: Array<typeof matchingSamples> = [];
    for (const match of matchingSamples) {
      const currentRun = runs.at(-1);
      if (!currentRun || match.sampleIndex > (currentRun.at(-1)?.sampleIndex ?? -2) + 1) runs.push([match]);
      else currentRun.push(match);
    }

    const base = flightLevelNumber(weather.properties.base);
    const top = flightLevelNumber(weather.properties.top);
    const altitudeRelevant = currentFlightLevel == null || (
      (base == null || currentFlightLevel >= base) && (top == null || currentFlightLevel <= top)
    );

    return runs.map((run, runIndex) => {
      const entry = run[0].sample;
      const exit = run.at(-1)?.sample || entry;
      const entryEtaMinutes = journey.remainingMinutes == null ? null : Math.round(journey.remainingMinutes * entry.progress);
      const exitEtaMinutes = journey.remainingMinutes == null ? null : Math.round(journey.remainingMinutes * exit.progress);
      const temporal = temporalRelationship(weather, referenceTimeMs, entryEtaMinutes, exitEtaMinutes);
      return {
        id: `${featureIndex}-${runIndex}`,
        index: featureIndex,
        feature: weather,
        entryPercent: entry.routePercent,
        exitPercent: exit.routePercent,
        entryPoint: entry.point,
        exitPoint: exit.point,
        entryEtaMinutes,
        exitEtaMinutes,
        affectedKm: journey.remainingKm == null ? null : Math.round(journey.remainingKm * Math.max(0, exit.progress - entry.progress)),
        durationMinutes: entryEtaMinutes == null || exitEtaMinutes == null ? null : Math.max(1, exitEtaMinutes - entryEtaMinutes),
        altitudeRelevant,
        ...temporal,
      };
    });
  }).sort((a, b) =>
    Number(b.altitudeRelevant && b.temporallyRelevant) - Number(a.altitudeRelevant && a.temporallyRelevant)
      || a.entryPercent - b.entryPercent,
  );
}

function coordinateLabel(point: [number, number]) {
  const [lon, lat] = point;
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "É" : "D"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "K" : "Ny"}`;
}

function etaClock(referenceIso: string, etaMinutes: number | null) {
  if (etaMinutes == null) return "—";
  const reference = Date.parse(referenceIso);
  if (!Number.isFinite(reference)) return `kb. ${etaMinutes} perc múlva`;
  return new Date(reference + etaMinutes * 60_000).toLocaleTimeString("hu-HU", {
    timeZone: BUDAPEST_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function temporalStatusLabel(impact: RouteWeatherImpact) {
  if (impact.temporalStatus === "expires-before-entry") return "Lejár az odaérés előtt";
  if (impact.temporalStatus === "starts-after-exit") return "Csak az áthaladás után lép életbe";
  if (impact.temporalStatus === "unknown") return "Érvényességi idő nem ismert";
  return "Érvényes a várható áthaladáskor";
}

function turbulenceSeverity(impact: RouteWeatherImpact) {
  const raw = impact.feature.properties.severity.toUpperCase();
  const hazard = impact.feature.properties.hazard.toLocaleLowerCase("hu-HU");
  if (raw.includes("SEV")) {
    return {
      level: "severe" as const,
      label: "Súlyos",
      explanation: `A hivatalos közlemény súlyos erősségű jelenséget jelöl ezen a területen: ${hazard}.`,
    };
  }
  if (raw.includes("MOD")) {
    return {
      level: "moderate" as const,
      label: "Mérsékelt",
      explanation: `A hivatalos közlemény mérsékelt erősségű jelenséget jelöl ezen a területen: ${hazard}.`,
    };
  }
  return {
    level: "advisory" as const,
    label: "Jelzett",
    explanation: "A forrás turbulenciaveszélyt jelez, de nem ad egyértelmű erősségi fokozatot.",
  };
}

function severityLevel(impact: RouteWeatherImpact) {
  return turbulenceSeverity(impact).level;
}

function etaRelative(etaMinutes: number | null) {
  if (etaMinutes == null) return "az odaérés ideje nem számítható";
  if (etaMinutes <= 2) return "várhatóan rövidesen";
  if (etaMinutes < 60) return `várhatóan kb. ${etaMinutes} perc múlva`;
  const hours = Math.floor(etaMinutes / 60);
  const minutes = etaMinutes % 60;
  return `várhatóan kb. ${hours} óra${minutes ? ` ${minutes} perc` : ""} múlva`;
}

function aviationDateTime(value: string | null) {
  if (!value) return "nem ismert";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "nem ismert";
  return `${new Date(parsed).toLocaleDateString("hu-HU", {
    timeZone: BUDAPEST_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
  })} ${new Date(parsed).toLocaleTimeString("hu-HU", {
    timeZone: BUDAPEST_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  })} CET`;
}

function routeLocationLabel(impact: RouteWeatherImpact, telemetry: WeatherFlight) {
  const origin = telemetry.journey.origin.iata || telemetry.journey.origin.icao;
  const destination = telemetry.journey.destination.iata || telemetry.journey.destination.icao;
  const percent = Math.round(impact.entryPercent);
  const currentPercent = telemetry.journey.progressPercent ?? 0;
  const remainingFraction = Math.max(0, Math.min(1, (100 - impact.entryPercent) / Math.max(1, 100 - currentPercent)));
  const destinationDistance = telemetry.journey.remainingKm == null
    ? null
    : Math.round(telemetry.journey.remainingKm * remainingFraction);
  return `${origin}–${destination} útvonal kb. ${percent}%-ánál${destinationDistance == null ? "" : `, ${destination} előtt kb. ${destinationDistance} km-rel`}`;
}

function altitudeRelationship(impact: RouteWeatherImpact, telemetry: WeatherFlight) {
  const base = flightLevelNumber(impact.feature.properties.base);
  const top = flightLevelNumber(impact.feature.properties.top);
  const current = telemetry.altitudeM == null ? null : Math.round(telemetry.altitudeM / 30.48);
  const band = `${impact.feature.properties.base}–${impact.feature.properties.top}`;
  if (current == null) {
    return `A jelzett magassági réteg ${band}. A járat tényleges repülési szintje még nem ismert, ezért a magassági érintettség csak indulás után ellenőrizhető.`;
  }
  if (base != null && current < base) {
    return `A gép FL${current}-en repül, a jelzett ${band} réteg alatt, annak aljától kb. ${base - current} repülési szinttel alacsonyabban.`;
  }
  if (top != null && current > top) {
    return `A gép FL${current}-en repül, a jelzett ${band} réteg felett, annak tetejétől kb. ${current - top} repülési szinttel magasabban.`;
  }
  return `A gép FL${current}-en repül, vagyis a jelzett ${band} magassági rétegen belül van.`;
}

function hazardPlainLanguage(impact: RouteWeatherImpact) {
  const severity = turbulenceSeverity(impact);
  const hazard = impact.feature.properties.hazard.toLocaleLowerCase("hu-HU");
  if (!impact.temporallyRelevant) {
    return `${severity.label} besorolású területi jelzés („${hazard}”) metszi az útvonalat, de a közlemény várhatóan nem lesz aktív az áthaladáskor.`;
  }
  if (!impact.altitudeRelevant) {
    return `${severity.label} besorolású területi jelzés („${hazard}”) metszi az útvonalat, de a gép jelenlegi repülési szintje kívül esik a jelzett rétegen.`;
  }
  const duration = impact.durationMinutes == null ? "ismeretlen ideig" : `kb. ${impact.durationMinutes} percig`;
  return `${severity.label} besorolású hivatalos területi jelzés („${hazard}”) érinti az útvonalat. A járat ${etaRelative(impact.entryEtaMinutes)} érheti el, és ${duration} haladhat a jelzett szakaszban.`;
}

function FlightConditionsPanel({
  telemetry,
  impacts,
  loading,
  error,
  updatedAt,
}: {
  telemetry: WeatherFlight;
  impacts: RouteWeatherImpact[];
  loading: boolean;
  error: string | null;
  updatedAt: string | null;
}) {
  const relevant = impacts.filter((impact) => impact.altitudeRelevant && impact.temporallyRelevant);
  const severe = relevant.some((impact) => severityLevel(impact) === "severe");
  const preflight = Boolean(telemetry.preflight);
  const weatherIssuedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const plannedDepartureMs = Date.parse(telemetry.updatedAt);
  const outsideForecastHorizon = preflight
    && Number.isFinite(weatherIssuedMs)
    && Number.isFinite(plannedDepartureMs)
    && plannedDepartureMs > weatherIssuedMs + 24 * 60 * 60_000;
  const state = loading ? "loading" : error ? "unavailable" : outsideForecastHorizon ? "future" : severe ? "severe" : relevant.length > 0 ? "attention" : "clear";
  const title = loading
    ? preflight ? "Útvonal-időjárás előzetes elemzése…" : "Repülési körülmények elemzése…"
    : error
      ? "Az időjárási elemzés nem elérhető"
      : outsideForecastHorizon
        ? "Az indulás még túl távoli a rövid távú előrejelzéshez"
      : severe
        ? preflight ? "Jelentős veszélyjelzés a tervezett útvonalon" : "Jelentős veszélyjelzés az útvonal előtt"
        : relevant.length > 0
          ? preflight ? "Várhatóan érintett útvonalszakasz" : "Figyelmet igénylő útvonalszakasz"
          : preflight ? "Nincs jelenleg érvényes veszélyjelzés az útvonalra" : "Kedvező repülési körülmények";
  const message = error
    || (outsideForecastHorizon
      ? "A SIGMET és G-AIRMET közlemények rövid távra érvényesek, ezért ehhez az indulási időponthoz még nem adható megbízható útvonalértékelés. Az oldal az indulás közeledtével automatikusan az akkor aktuális közleményeket vizsgálja."
      : relevant.length > 0
      ? `${relevant.length} várhatóan releváns veszélyszakasz található a ${preflight ? "tervezett" : "hátralévő"} útvonal ±${ROUTE_CORRIDOR_HALF_WIDTH_KM} km-es folyosójában.`
      : impacts.length > 0
        ? `A folyosó ${impacts.length} jelzett területet érint, de azok várhatóan nem aktívak az odaéréskor vagy nem a vizsgált repülési szintre vonatkoznak.`
        : preflight
          ? `A jelenlegi SIGMET és G-AIRMET közlemények alapján a tervezett útvonal ±${ROUTE_CORRIDOR_HALF_WIDTH_KM} km-es folyosójában nincs az utazás várható idejére érvényes turbulenciajelzés.`
          : `A hátralévő útvonal ±${ROUTE_CORRIDOR_HALF_WIDTH_KM} km-es folyosójában nincs aktuálisan releváns turbulenciajelzés.`);

  return (
    <section className={`flight-conditions ${state}`} aria-label="Repülési körülmények összefoglaló">
      <div className="conditions-heading">
        <div className="conditions-icon">{state === "clear" ? "✓" : state === "loading" ? "◌" : state === "unavailable" ? "?" : state === "future" ? "◷" : "!"}</div>
        <div>
          <span>REPÜLÉSI KÖRÜLMÉNYEK</span>
          <h2>{title}</h2>
        </div>
      </div>
      <p>{message}</p>
      <div className="conditions-stats">
        <div><span>ÚTVONALFOLYOSÓ</span><strong>±{ROUTE_CORRIDOR_HALF_WIDTH_KM} km</strong></div>
        <div><span>AKTÍV TALÁLAT</span><strong>{loading ? "—" : relevant.length}</strong></div>
        <div><span>{preflight ? "ELEMZÉS" : "REPÜLÉSI SZINT"}</span><strong>{preflight ? "INDULÁS ELŐTT" : telemetry.altitudeM == null ? "—" : `FL${Math.round(telemetry.altitudeM / 30.48)}`}</strong></div>
      </div>
      {!loading && impacts.slice(0, 4).map((impact) => {
        const actuallyRelevant = impact.altitudeRelevant && impact.temporallyRelevant;
        const severity = turbulenceSeverity(impact);
        return (
          <article className={`hazard-card ${actuallyRelevant ? severityLevel(impact) : "inactive"}`} key={impact.id}>
            <div className="hazard-card-head">
              <div>
                <span>{severity.label} {impact.feature.properties.hazard.toLocaleLowerCase("hu-HU")}</span>
                <strong>{impact.feature.properties.source} · {impact.feature.properties.severity} · {impact.feature.properties.base}–{impact.feature.properties.top}</strong>
              </div>
              <b>{actuallyRelevant ? "RELEVÁNS" : !impact.altitudeRelevant ? "MÁS MAGASSÁG" : "NEM AKTÍV"}</b>
            </div>
            <p className="hazard-plain-summary">{hazardPlainLanguage(impact)}</p>
            <div className="hazard-route-grid">
              <div><span>VÁRHATÓ BELÉPÉS</span><strong>{impact.entryEtaMinutes == null ? "—" : `${etaClock(telemetry.updatedAt, impact.entryEtaMinutes)} CET`}</strong><small>{etaRelative(impact.entryEtaMinutes)} · {Math.round(impact.entryPercent)}%</small></div>
              <div><span>VÁRHATÓ KILÉPÉS</span><strong>{impact.exitEtaMinutes == null ? "—" : `${etaClock(telemetry.updatedAt, impact.exitEtaMinutes)} CET`}</strong><small>{impact.durationMinutes == null ? "időtartam nem számítható" : `kb. ${impact.durationMinutes} perc múlva a belépéstől`}</small></div>
            </div>
            <div className="hazard-facts">
              <span>Útvonalhelyzet <b>{routeLocationLabel(impact, telemetry)}</b></span>
              <span>Érintett szakasz <b>{impact.affectedKm == null ? "—" : impact.affectedKm < 5 ? "<5 km" : `${impact.affectedKm} km`}</b></span>
              <span>Becsült időtartam <b>{impact.durationMinutes == null ? "—" : `kb. ${impact.durationMinutes} perc`}</b></span>
              <span className={impact.temporallyRelevant ? "valid" : "expired"}>{temporalStatusLabel(impact)}</span>
            </div>
            <details className="hazard-details">
              <summary>Részletes értelmezés <span>útvonal · magasság · érvényesség</span></summary>
              <div className="hazard-details-body">
                <section>
                  <span>MIT JELENT?</span>
                  <p>{severity.explanation} Ez területi veszélyjelzés, nem annak bizonyítéka, hogy a gépen biztosan ilyen erősségű hatás lesz tapasztalható.</p>
                </section>
                <section>
                  <span>MAGASSÁGI ÉRINTETTSÉG</span>
                  <p>{altitudeRelationship(impact, telemetry)}</p>
                </section>
                <section>
                  <span>HELY ÉS IDŐ</span>
                  <p>{routeLocationLabel(impact, telemetry)}. Becsült belépési pont: {coordinateLabel(impact.entryPoint)}; kilépési pont: {coordinateLabel(impact.exitPoint)}.</p>
                </section>
                <dl>
                  <div><dt>Forrás</dt><dd>{impact.feature.properties.source}</dd></div>
                  <div><dt>Terület</dt><dd>{impact.feature.properties.area || "nincs megadva"}</dd></div>
                  <div><dt>Érvényes ettől</dt><dd>{aviationDateTime(impact.feature.properties.validFrom)}</dd></div>
                  <div><dt>Érvényes eddig</dt><dd>{aviationDateTime(impact.feature.properties.validTo)}</dd></div>
                </dl>
                <small className="hazard-confidence">Döntéstámogató becslés: az útvonal ±{ROUTE_CORRIDOR_HALF_WIDTH_KM} km-es folyosójának mintavétele alapján. A tényleges útvonal, repülési szint és időzítés változhat.</small>
              </div>
            </details>
          </article>
        );
      })}
      {impacts.length > 4 && <small className="more-hazards">További {impacts.length - 4} útvonal-metszés a térképen látható.</small>}
      <footer>NOAA/NWS SIGMET és G-AIRMET · {updatedAt ? `frissítve ${new Date(updatedAt).toLocaleTimeString("hu-HU", { timeZone: BUDAPEST_TIME_ZONE, hour: "2-digit", minute: "2-digit" })}` : "frissítés folyamatban"} · {preflight ? "előzetes útvonalbecslés, indulás előtt frissítendő" : "döntéstámogató becslés"}</footer>
    </section>
  );
}

function airportWind(direction: number | null, variable: boolean, speed: number | null, gust: number | null = null) {
  if (speed == null) return "—";
  const heading = variable ? "változó" : direction == null ? "—" : `${Math.round(direction)}°`;
  return `${heading} · ${Math.round(speed)} kt${gust == null ? "" : `, lökés ${Math.round(gust)} kt`} · ${Math.round(speed * 1.852)} km/h`;
}

function metricWind(direction: number | null, variable: boolean, speedKt: number | null, gustKt: number | null = null) {
  if (speedKt == null) return { value: "—", detail: "nincs széladat" };
  const directionText = variable ? "változó irányból" : direction == null ? "irányadat nélkül" : `${compass(direction).split(" ").at(-1)} felől`;
  const gust = gustKt == null ? "" : ` · széllökés ${Math.round(gustKt * 1.852)} km/h`;
  return { value: `${Math.round(speedKt * 1.852)} km/h`, detail: `${directionText}${gust}` };
}

function metricVisibility(raw: string | null) {
  if (!raw) return { value: "—", detail: "nincs látástávolság-adat" };
  const atLeast = /[+P]/i.test(raw);
  const miles = Number.parseFloat(raw.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(miles)) return { value: "—", detail: `eredeti adat: ${raw} SM` };
  const km = miles * 1.609344;
  const rounded = km >= 9.5 ? Math.round(km) : Math.round(km * 10) / 10;
  return { value: `${atLeast ? "legalább " : ""}${fmt(rounded, rounded % 1 === 0 ? 0 : 1)} km`, detail: atLeast ? "ennél messzebbre is ellátni" : "vízszintes látástávolság" };
}

function aviationPhenomenon(code: string | null | undefined) {
  const value = (code || "").toUpperCase();
  if (!value) return null;
  const intensity = value.includes("+") ? "Erős " : value.includes("-") ? "Gyenge " : "";
  if (value.includes("TS") && value.includes("RA")) return `${intensity}zivatar esővel`;
  if (value.includes("TS")) return `${intensity}zivatar`;
  if (value.includes("SHRA")) return `${intensity}zápor`;
  if (value.includes("FZRA")) return `${intensity}ónos eső`;
  if (value.includes("RA")) return `${intensity}eső`;
  if (value.includes("DZ")) return `${intensity}szitálás`;
  if (value.includes("SN")) return `${intensity}havazás`;
  if (value.includes("GR") || value.includes("GS")) return `${intensity}jégeső`;
  return null;
}

function friendlyConditional(period: AirportForecastPeriod) {
  const phenomenon = aviationPhenomenon(period.weather) || "kedvezőtlenebb időjárás";
  const chance = period.probability == null ? null : `${period.probability}% esély`;
  const temporary = period.change === "TEMPO" ? "átmenetileg" : null;
  const lead = [chance, temporary].filter(Boolean).join(" · ");
  return `${lead ? `${lead}: ` : ""}${phenomenon.toLocaleLowerCase("hu-HU")}`;
}

function cloudText(clouds: Array<{ cover: string; baseFt: number | null; type: string | null }>, fallback = "—") {
  if (clouds.length === 0) return fallback;
  return clouds.map((cloud) => `${cloud.cover}${cloud.baseFt == null ? "" : ` ${cloud.baseFt} ft`}${cloud.type ? ` ${cloud.type}` : ""}`).join(" · ");
}

type AirportLandingAlert = {
  severity: "danger" | "warning";
  label: string;
  reasons: string[];
};

function visibilityMiles(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/SM$/, "");
  const mixed = normalized.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = normalized.match(/^M?(\d+)\/(\d+)/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const parsed = Number.parseFloat(normalized.replace("P", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function airportLandingAlert(weather: AirportWeather | null, targetAt: string | null): AirportLandingAlert | null {
  if (!weather) return null;
  const findings: Array<{ severity: "danger" | "warning"; label: string; reason: string }> = [];
  const add = (severity: "danger" | "warning", label: string, reason: string) => {
    findings.push({ severity, label, reason });
  };
  const weatherCodes = (text: string | null, source: string, probability: number | null = null) => {
    const tokens = (text || "").toUpperCase().split(/\s+/).filter(Boolean);
    const probabilityPrefix = probability == null ? "" : `${probability}% eséllyel `;
    const probabilisticSeverity = probability != null && probability < 40 ? "warning" : "danger";
    if (tokens.some((token) => /^(?:\+|-)?(?:VC)?TS/.test(token))) {
      add(probabilisticSeverity, "ZIVATAR", `${source}: ${probabilityPrefix}zivatar`);
    }
    if (tokens.some((token) => /^(?:\+|-)?(?:SQ|FC|GR|GS)$/.test(token))) {
      add(probabilisticSeverity, "VIHAR", `${source}: ${probabilityPrefix}viharos jelenség vagy jégeső`);
    }
    if (tokens.some((token) => /^(?:FZ|MI|BC|PR)?FG$/.test(token))) {
      add("danger", "KÖD", `${source}: köd`);
    }
    if (tokens.some((token) => /^(?:\+)?(?:FZRA|FZDZ|RA|SN|SHRA|SHSN)$/.test(token) && (token.startsWith("+") || token.includes("FZ")))) {
      add("warning", "ERŐS CSAPADÉK", `${source}: erős vagy fagyott csapadék`);
    }
  };
  const wind = (speed: number | null, gust: number | null, source: string) => {
    if ((gust ?? 0) >= 35 || (speed ?? 0) >= 30) {
      add("danger", "VIHAROS SZÉL", `${source}: ${gust != null ? `${Math.round(gust)} kt széllökés` : `${Math.round(speed as number)} kt szél`}`);
    } else if ((gust ?? 0) >= 25 || (speed ?? 0) >= 20) {
      add("warning", "ERŐS SZÉL", `${source}: ${gust != null ? `${Math.round(gust)} kt széllökés` : `${Math.round(speed as number)} kt szél`}`);
    }
  };
  const visibility = (value: string | null, source: string) => {
    const miles = visibilityMiles(value);
    if (miles != null && miles <= 1) add("danger", "ROSSZ LÁTÁS", `${source}: ${value} SM látástávolság`);
    else if (miles != null && miles <= 3) add("warning", "ROSSZ LÁTÁS", `${source}: ${value} SM látástávolság`);
  };
  const ceiling = (clouds: Array<{ cover: string; baseFt: number | null; type: string | null }>, source: string) => {
    const lowest = clouds
      .filter((cloud) => ["BKN", "OVC", "VV"].includes(cloud.cover) && cloud.baseFt != null)
      .reduce<number | null>((min, cloud) => min == null ? cloud.baseFt : Math.min(min, cloud.baseFt as number), null);
    if (lowest != null && lowest <= 500) add("danger", "ALACSONY FELHŐ", `${source}: ${lowest} ft felhőalap`);
    else if (lowest != null && lowest <= 1000) add("warning", "ALACSONY FELHŐ", `${source}: ${lowest} ft felhőalap`);
  };

  const targetMs = targetAt ? Date.parse(targetAt) : Number.NaN;
  const forecast = weather.forecast;
  if (forecast && Number.isFinite(targetMs)) {
    for (const period of forecast.periods) {
      if (!period.from || !period.to || targetMs < Date.parse(period.from) || targetMs >= Date.parse(period.to)) continue;
      weatherCodes(period.weather, "érkezéskori TAF", period.probability);
      wind(period.windSpeedKt, period.windGustKt, "érkezéskori TAF");
      visibility(period.visibility, "érkezéskori TAF");
      ceiling(period.clouds, "érkezéskori TAF");
    }
  }

  if (findings.length === 0) return null;
  const severity = findings.some((finding) => finding.severity === "danger") ? "danger" : "warning";
  const labelPriority: Record<string, number> = {
    VIHAR: 100,
    ZIVATAR: 95,
    "VIHAROS SZÉL": 90,
    KÖD: 85,
    "ROSSZ LÁTÁS": 80,
    "ERŐS CSAPADÉK": 75,
    "ALACSONY FELHŐ": 70,
    LIFR: 60,
    "ERŐS SZÉL": 55,
    IFR: 50,
  };
  const primary = findings
    .filter((finding) => finding.severity === severity)
    .sort((left, right) => (labelPriority[right.label] || 0) - (labelPriority[left.label] || 0))[0]
    || findings[0];
  return {
    severity,
    label: primary.label,
    reasons: Array.from(new Set(findings.map((finding) => finding.reason))),
  };
}

function AirportWeatherCard({
  role,
  airport,
  weather,
  loading,
  error,
}: {
  role: "INDULÁSI" | "ÉRKEZÉSI";
  airport: RouteAirport;
  weather: AirportWeather | null;
  loading: boolean;
  error: string | null;
}) {
  const forecastTargetAt = weather?.targetAt || null;
  const targetMs = forecastTargetAt ? Date.parse(forecastTargetAt) : Number.NaN;
  const forecast = weather?.forecast || null;
  const forecastCoversTarget = Boolean(
    forecast
      && Number.isFinite(targetMs)
      && forecast.validFrom
      && forecast.validTo
      && targetMs >= Date.parse(forecast.validFrom)
      && targetMs < Date.parse(forecast.validTo),
  );
  const matchingPeriods = forecastCoversTarget
    ? forecast?.periods.filter((period) => {
      if (!period.from || !period.to) return false;
      return targetMs >= Date.parse(period.from) && targetMs < Date.parse(period.to);
    }) || []
    : [];
  const basePeriods = matchingPeriods.filter((period) =>
    period.probability == null && period.change !== "TEMPO",
  );
  const targetPeriod = [...basePeriods]
    .sort((left, right) => Date.parse(right.from || "") - Date.parse(left.from || ""))[0]
    || matchingPeriods[0]
    || null;
  const conditionalPeriods = matchingPeriods.filter((period) =>
    period !== targetPeriod && (period.probability != null || period.change === "TEMPO"),
  );
  const targetWeather = weather?.targetTemperature || null;
  const forecastWind = metricWind(
    targetPeriod?.windDirectionDeg ?? null,
    targetPeriod?.windVariable || false,
    targetPeriod?.windSpeedKt ?? null,
    targetPeriod?.windGustKt ?? null,
  );
  const forecastVisibility = metricVisibility(targetPeriod?.visibility || null);
  const forecastPhenomenon = aviationPhenomenon(targetPeriod?.weather) || "Nem jelez jelentős csapadékot";

  return (
    <article className="airport-weather-card plain-weather-card">
      <header>
        <div>
          <span>{role} REPTÉR</span>
          <h3>{airport.iata} <small>{airport.icao}</small></h3>
          <p>{airport.city} · {weather?.name || airport.name}</p>
        </div>
      </header>
      {loading ? (
        <p className="airport-weather-state">Időjárási adatok betöltése…</p>
      ) : error ? (
        <p className="airport-weather-state error">{error}</p>
      ) : !weather ? (
        <p className="airport-weather-state">Ehhez a repülőtérhez nem érkezett időjárási adat.</p>
      ) : (
        <>
          {forecastTargetAt ? (
            <section className="airport-forecast-weather plain-weather-section">
              <div className="airport-weather-section-title">
                <span>{role === "INDULÁSI" ? "INDULÁSI" : "ÉRKEZÉSI"} IDŐPONTRA ELŐREJELZETT</span>
                <small>{`${budapestDateTime(forecastTargetAt)} · CET`}</small>
              </div>
              {!forecast ? (
                <p className="airport-weather-state">Repülőtéri előrejelzés nem érhető el.</p>
              ) : !forecastCoversTarget ? (
                <p className="airport-weather-state future">A jelenlegi előrejelzés még nem fedi le ezt az időpontot. Az utazás közeledtével automatikusan frissül.</p>
              ) : targetPeriod ? (
                <>
                  <strong className="airport-condition-summary plain">
                    {aviationPhenomenon(targetPeriod.weather) || "Várható repülőtéri időjárás"}
                  </strong>
                  <div className="plain-weather-metrics">
                    <div className="temperature"><span>HŐMÉRSÉKLET</span><strong>{targetWeather ? `${fmt(targetWeather.temperatureC, 1)} °C` : "—"}</strong><small>{targetWeather?.apparentTemperatureC == null ? "nincs hőérzetadat" : `hőérzet ${fmt(targetWeather.apparentTemperatureC, 1)} °C`}</small></div>
                    <div className="wind"><span>SZÉL</span><strong>{forecastWind.value}</strong><small>{forecastWind.detail}</small></div>
                    <div className="visibility"><span>LÁTÓTÁVOLSÁG</span><strong>{forecastVisibility.value}</strong><small>{forecastVisibility.detail}</small></div>
                    <div className="precipitation"><span>CSAPADÉK</span><strong>{targetWeather?.precipitationMm == null ? forecastPhenomenon : `${fmt(targetWeather.precipitationMm, 1)} mm`}</strong><small>{targetWeather?.precipitationProbabilityPct == null ? "nincs mennyiségi valószínűség" : <><b className="precipitation-chance">{fmt(targetWeather.precipitationProbabilityPct)}% esély</b> az adott órában</>}</small></div>
                  </div>
                  {conditionalPeriods.length > 0 && (
                    <div className="plain-weather-risk" role="note">
                      <span>LEHETSÉGES ÁTMENETI VÁLTOZÁS</span>
                      {conditionalPeriods.map((period, index) => (
                        <strong key={`${period.from}-${period.change}-${period.probability}-${index}`}>
                          {friendlyConditional(period)}
                        </strong>
                      ))}
                      <small>A százalék azt mutatja, mekkora az esélye ennek az átmeneti jelenségnek. Nem jelenti azt, hogy biztosan bekövetkezik.</small>
                    </div>
                  )}
                  {targetWeather && <small className="target-temperature-source">{targetWeather.source} · {budapestDateTime(targetWeather.validAt)} · CET</small>}
                </>
              ) : (
                <p className="airport-weather-state">Az előrejelzés érvényes, de az adott időponthoz nincs külön szakasz.</p>
              )}
            </section>
          ) : (
            <p className="airport-weather-state">A járat időpontja nem ismert, ezért időpontra illesztett előrejelzés nem kérhető le.</p>
          )}

          {forecast && (
            <details className="professional-weather-details">
              <summary>Repülésmeteorológiai részletek <span>TAF</span></summary>
              <div className="professional-weather-body">
                {forecast && targetPeriod && (
                  <section>
                    <h4>Célidőpontra illesztett TAF</h4>
                    <dl>
                      <div><dt>Változás</dt><dd>{targetPeriod.change || "alapidőszak"}</dd></div>
                      <div><dt>Időjáráskód</dt><dd>{targetPeriod.weather || "—"}</dd></div>
                      <div><dt>Szél</dt><dd>{airportWind(targetPeriod.windDirectionDeg, targetPeriod.windVariable, targetPeriod.windSpeedKt, targetPeriod.windGustKt)}</dd></div>
                      <div><dt>Látástávolság</dt><dd>{targetPeriod.visibility ? `${targetPeriod.visibility} SM` : "—"}</dd></div>
                      <div><dt>Felhőzet</dt><dd>{cloudText(targetPeriod.clouds)}</dd></div>
                    </dl>
                    {conditionalPeriods.length > 0 && (
                      <div className="professional-conditional-periods">
                        <b>Feltételes TAF-szakaszok</b>
                        {conditionalPeriods.map((period, index) => (
                          <code key={`${period.from}-${index}`}>{[period.change, period.probability == null ? null : `PROB${period.probability}`, period.weather, airportWind(period.windDirectionDeg, period.windVariable, period.windSpeedKt, period.windGustKt)].filter(Boolean).join(" · ")}</code>
                        ))}
                      </div>
                    )}
                    {forecast.raw && <code>{forecast.raw}</code>}
                  </section>
                )}
              </div>
            </details>
          )}
        </>
      )}
    </article>
  );
}

function AirportWeatherPopover({
  role,
  airport,
  weather,
  targetAt,
  loading,
  error,
}: {
  role: "INDULÁSI" | "ÉRKEZÉSI";
  airport: RouteAirport;
  weather: AirportWeather | null;
  targetAt: string | null;
  loading: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const landingAlert = role === "ÉRKEZÉSI" && !loading && !error
    ? airportLandingAlert(weather, targetAt)
    : null;
  const alertDescription = landingAlert
    ? `${landingAlert.severity === "danger" ? "Veszélyes" : "Figyelmet igénylő"} reptéri időjárás: ${landingAlert.reasons.join("; ")}`
    : null;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div
      className={`airport-weather-popover ${role === "INDULÁSI" ? "origin" : "destination"}${landingAlert ? ` has-alert ${landingAlert.severity}` : ""}`}
      ref={rootRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="airport-code-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${airport.iata || airport.icao} ${role.toLowerCase()} repülőtér időjárása${alertDescription ? `. ${alertDescription}` : ""}`}
        title={alertDescription || undefined}
        onClick={() => setOpen(true)}
      >
        <span className="airport-code-line">
          {airport.iata || airport.icao || "—"}
          {landingAlert && <span className="airport-alert-icon" aria-hidden="true">⚠</span>}
        </span>
        <small className={landingAlert ? "airport-alert-label" : undefined} aria-hidden="true">
          {landingAlert?.label || "IDŐJÁRÁS"}
        </small>
      </button>
      {open && (
        <div className="airport-weather-floating" role="dialog" aria-label={`${airport.iata || airport.icao} repülőtéri időjárás`}>
          <button className="airport-weather-close" type="button" aria-label="Időjárási ablak bezárása" onClick={() => setOpen(false)}>×</button>
          <AirportWeatherCard
            role={role}
            airport={airport}
            weather={weather}
            loading={loading}
            error={error}
          />
          <small className="airport-weather-source">NOAA/NWS Aviation Weather Center · METAR és TAF · tájékoztató adat</small>
        </div>
      )}
    </div>
  );
}

function FlightTimeline({ telemetry, scheduled }: { telemetry?: Telemetry | null; scheduled?: ScheduledFlight | null }) {
  const phaseIndex = scheduled
    ? 0
    : telemetry?.onGround ? 0
    : (telemetry?.verticalRateMs ?? 0) < -1 ? 3
    : (telemetry?.altitudeM ?? 0) > 7000 ? 2
    : 1;
  const departure = scheduled?.estimatedDepartureAt || telemetry?.journey?.estimatedDepartureAt;
  const arrival = scheduled?.estimatedArrivalAt || telemetry?.journey?.estimatedArrivalAt;
  const events = [
    ["Indulás", departure ? clockTime(departure, null, null, -1) : "—"],
    ["Felszállás", phaseIndex > 0 ? "megtörtént" : "várható"],
    ["Utazómagasság", phaseIndex > 2 ? "megtörtént" : phaseIndex === 2 ? "aktuális" : "várható"],
    ["Süllyedés", phaseIndex > 3 ? "megtörtént" : phaseIndex === 3 ? "aktuális" : "várható"],
    ["Érkezés", arrival ? clockTime(arrival, null, null, 1) : "—"],
  ];
  return (
    <div className="flight-timeline" aria-label="Repülési eseményvonal">
      <div className="section-kicker">REPÜLÉSI ESEMÉNYEK</div>
      <div className="timeline-track">
        {events.map(([label, detail], index) => (
          <div className={`timeline-event ${index < phaseIndex ? "done" : index === phaseIndex ? "current" : "future"}`} key={label}>
            <i />
            <strong>{label}</strong>
            <span>{detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function metric(label: string, value: string, unit = "", accent = false) {
  return (
    <div className="metric" key={label}>
      <span>{label}</span>
      <strong className={accent ? "accent" : ""}>
        {value} {unit && <small>{unit}</small>}
      </strong>
    </div>
  );
}

function gaugePoint(angle: number, radius: number) {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: 60 + radius * Math.cos(radians), y: 60 + radius * Math.sin(radians) };
}

function gaugeArc(startAngle: number, endAngle: number, radius: number) {
  const start = gaugePoint(endAngle, radius);
  const end = gaugePoint(startAngle, radius);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${endAngle - startAngle <= 180 ? 0 : 1} 0 ${end.x} ${end.y}`;
}

function deriveWindFromMotion(telemetry: Telemetry) {
  if (
    telemetry.trueAirspeedKmh == null
    || telemetry.groundSpeedKmh == null
    || telemetry.trueHeadingDeg == null
    || telemetry.trackDeg == null
  ) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const groundEast = telemetry.groundSpeedKmh * Math.sin(radians(telemetry.trackDeg));
  const groundNorth = telemetry.groundSpeedKmh * Math.cos(radians(telemetry.trackDeg));
  const airEast = telemetry.trueAirspeedKmh * Math.sin(radians(telemetry.trueHeadingDeg));
  const airNorth = telemetry.trueAirspeedKmh * Math.cos(radians(telemetry.trueHeadingDeg));
  const windEast = groundEast - airEast;
  const windNorth = groundNorth - airNorth;
  const speed = Math.hypot(windEast, windNorth);
  if (!Number.isFinite(speed) || speed > 400) return null;
  const toward = (Math.atan2(windEast, windNorth) * 180 / Math.PI + 360) % 360;
  return { speed, direction: (toward + 180) % 360 };
}

function InstrumentDial({ label, value, min, max, display, unit, secondary, accent = "cyan" }: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  display: string;
  unit: string;
  secondary: string;
  accent?: "cyan" | "lime" | "amber";
}) {
  const ratio = value == null ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  const needleAngle = -135 + ratio * 270;
  const needleEnd = gaugePoint(needleAngle, 34);
  const progressEnd = -135 + ratio * 270;
  return (
    <article className={`instrument-card ${accent}`}>
      <div className="instrument-heading"><span>{label}</span><i>LIVE</i></div>
      <div className="instrument-dial">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <path className="dial-track" d={gaugeArc(-135, 135, 48)} />
          {value != null && <path className="dial-progress" d={gaugeArc(-135, progressEnd, 48)} />}
          {Array.from({ length: 10 }, (_, index) => {
            const angle = -135 + index * 30;
            const outer = gaugePoint(angle, 46);
            const inner = gaugePoint(angle, index % 3 === 0 ? 39 : 42);
            return <line key={angle} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} className="dial-tick" />;
          })}
          <line x1="60" y1="60" x2={needleEnd.x} y2={needleEnd.y} className="dial-needle" />
          <circle cx="60" cy="60" r="4" className="dial-hub" />
        </svg>
        <div className="instrument-readout"><strong>{display}</strong><small>{unit}</small></div>
      </div>
      <div className="instrument-secondary">{secondary}</div>
    </article>
  );
}

function TelemetryInstruments({ telemetry }: { telemetry: Telemetry }) {
  const heading = telemetry.trueHeadingDeg ?? telemetry.magneticHeadingDeg ?? telemetry.trackDeg;
  const headingRotation = heading == null ? 0 : -heading;
  const roll = telemetry.rollDeg ?? 0;
  const verticalRate = telemetry.geometricRateMs ?? telemetry.verticalRateMs;
  const signalRatio = telemetry.rssiDbfs == null ? 0 : Math.min(1, Math.max(0, (telemetry.rssiDbfs + 35) / 35));
  const derivedWind = deriveWindFromMotion(telemetry);
  const windSpeed = telemetry.windSpeedKmh ?? derivedWind?.speed ?? null;
  const windDirection = telemetry.windDirectionDeg ?? derivedWind?.direction ?? null;
  const windIsDerived = (telemetry.windSpeedKmh == null || telemetry.windDirectionDeg == null) && derivedWind != null;
  const relativeWind = heading != null && windSpeed != null && windDirection != null
    ? ((windDirection - heading + 540) % 360) - 180
    : null;
  const headwindComponent = relativeWind == null || windSpeed == null
    ? null
    : windSpeed * Math.cos(relativeWind * Math.PI / 180);
  const crosswindComponent = relativeWind == null || windSpeed == null
    ? null
    : windSpeed * Math.sin(relativeWind * Math.PI / 180);
  const windLoadLabel = headwindComponent == null
    ? "SZEMBESZÉL / HÁTSZÉL"
    : headwindComponent >= 0 ? "SZEMBESZÉL" : "HÁTSZÉL";
  const crosswindLabel = crosswindComponent == null
    ? "OLDALSZÉL"
    : crosswindComponent >= 0 ? "JOBBRÓL" : "BALRÓL";
  const atmosphereAltitude = telemetry.geometricAltitudeM ?? telemetry.altitudeM;
  const isaReferenceTemp = atmosphereAltitude == null
    ? null
    : Math.max(-56.5, 15 - 0.0065 * Math.max(0, atmosphereAltitude));
  const displayedAirTemp = telemetry.outsideAirTempC ?? isaReferenceTemp;
  const temperatureIsReference = telemetry.outsideAirTempC == null && isaReferenceTemp != null;
  const temperatureContext = temperatureIsReference
    ? "Szabványlégköri referencia · nem mérés"
    : telemetry.outsideAirTempC == null
      ? "A gép nem sugároz hőmérsékletet"
      : telemetry.outsideAirTempC <= 0 ? "Fagypont alatti külső levegő" : "Fagypont feletti külső levegő";

  return (
    <div className="instrument-console">
      <div className="console-statusbar">
        <span><i /> ADS-B MŰSZERRENDSZER</span>
        <b>{telemetry.callsign || telemetry.flight}</b>
        <small>FRISSÍTVE {fmt(telemetry.seenSeconds, 1)} s</small>
      </div>
      <div className="instrument-grid">
        <InstrumentDial label="MAGASSÁGMÉRŐ" value={telemetry.geometricAltitudeM} min={0} max={13000} display={fmt(telemetry.geometricAltitudeM)} unit="m" secondary={`Beállítva ${fmt(telemetry.selectedAltitudeM)} m`} />
        <InstrumentDial label="LÉGSEBESSÉG" value={telemetry.trueAirspeedKmh} min={0} max={1100} display={fmt(telemetry.trueAirspeedKmh)} unit="km/h TAS" secondary={`IAS ${fmt(telemetry.indicatedAirspeedKmh)} km/h · M ${fmt(telemetry.mach, 3)}`} accent="lime" />

        <article className="instrument-card heading-instrument">
          <div className="instrument-heading"><span>IRÁNYTŰ</span><i>TRUE</i></div>
          <div className="compass-dial">
            <div className="compass-lubber">▲</div>
            <div className="compass-rose" style={{ transform: `rotate(${headingRotation}deg)` }}>
              <b className="north">N</b><b className="east">E</b><b className="south">S</b><b className="west">W</b><i className="compass-axis" />
            </div>
            <div className="compass-value">{fmt(heading)}<small>°</small></div>
          </div>
          <div className="instrument-secondary">Mágneses {fmt(telemetry.magneticHeadingDeg)}° · NAV {fmt(telemetry.navHeadingDeg)}°</div>
        </article>

        <article className="instrument-card attitude-instrument amber">
          <div className="instrument-heading"><span>VARIOMÉTER · DŐLÉS</span><i>ATT</i></div>
          <div className="attitude-dial">
            <div className="attitude-world" style={{ transform: `rotate(${-roll}deg)` }}><div className="sky" /><div className="ground" /></div>
            <div className="attitude-wings"><i /><b>●</b><i /></div>
            <div className="attitude-readout"><strong>{fmt(verticalRate, 1)}</strong><small>m/s</small></div>
          </div>
          <div className="instrument-secondary">Dőlés {fmt(telemetry.rollDeg, 1)}° · geometriai emelkedés</div>
        </article>

        <article className="instrument-card environment-instrument amber">
          <div className="instrument-heading"><span>LÉGKÖR · SZÉL</span><i>AIR DATA</i></div>
          <div className="environment-body">
            <div className="temperature-module">
              <div className="thermometer-scale" aria-hidden="true"><span>+40</span><span>0</span><span>−40</span><span>−80</span></div>
              <div className="thermometer">{displayedAirTemp != null && <i style={{ height: `${Math.min(100, Math.max(8, (displayedAirTemp + 80) / 130 * 100))}%` }} />}</div>
              <div className="temperature-readout">
                <span>{temperatureIsReference ? "ISA HŐMÉRSÉKLET · REFERENCIA" : "KÜLSŐ LEVEGŐ · OAT"}</span>
                <strong>{fmt(displayedAirTemp, 1)}<small>°C</small></strong>
                <em>{temperatureContext}</em>
                <b>{telemetry.totalAirTempC == null ? "TAT NEM ÉRKEZIK" : `TAT ${fmt(telemetry.totalAirTempC, 1)} °C`}</b>
              </div>
            </div>
            <div className="wind-module">
              <div className={`wind-rose${windDirection == null ? " no-data" : ""}`} aria-label={windDirection == null ? "Nem érkezik és nem számítható széladat" : `Szél ${fmt(windDirection)} fok felől, ${fmt(windSpeed)} kilométer per óra`}>
                <span className="wind-north">N</span><span className="wind-east">E</span><span className="wind-south">S</span><span className="wind-west">W</span>
                {windDirection != null && <i className="wind-arrow" style={{ transform: `translate(-50%, -50%) rotate(${windDirection}deg)` }}>↓</i>}
                <div>{windSpeed == null ? <strong className="no-data-value">N/A</strong> : <><strong>{fmt(windSpeed)}</strong><small>km/h</small></>}</div>
              </div>
              <span className="wind-from">{windDirection == null ? "NINCS SZÉLADAT" : `${fmt(windDirection)}° FELŐL · ${windIsDerived ? "SZÁMÍTOTT" : "MÉRT"}`}</span>
            </div>
          </div>
          <div className="environment-facts">
            <span title={headwindComponent == null ? "A szélkomponenshez szélirány, szélsebesség és gépirányszög szükséges." : `${windLoadLabel.toLocaleLowerCase("hu-HU")} komponens a gép haladási irányában.`}><small>{windLoadLabel}</small><strong className={headwindComponent == null ? "no-data-value" : ""}>{headwindComponent == null ? "NINCS ADAT" : <>{fmt(Math.abs(headwindComponent))} <i>km/h</i></>}</strong></span>
            <span title={crosswindComponent == null ? "Az oldalszélhez szélirány, szélsebesség és gépirányszög szükséges." : `${crosswindLabel.toLocaleLowerCase("hu-HU")} érkező oldalszél-komponens.`}><small>{crosswindLabel}</small><strong className={crosswindComponent == null ? "no-data-value" : ""}>{crosswindComponent == null ? "NINCS ADAT" : <>{fmt(Math.abs(crosswindComponent))} <i>km/h</i></>}</strong></span>
            <span title="A repülőgép fedélzeti rendszerében beállított légnyomás; nem helyi meteorológiai mérés."><small>QNH · FEDÉLZETI</small><strong className={telemetry.navQnhHpa == null ? "no-data-value" : ""}>{telemetry.navQnhHpa == null ? "NEM ÉRKEZIK" : <>{fmt(telemetry.navQnhHpa, 1)} <i>hPa</i></>}</strong></span>
          </div>
        </article>

        <article className="instrument-card signal-instrument lime">
          <div className="instrument-heading"><span>JELMINŐSÉG</span><i>RX</i></div>
          <div className="signal-body">
            <div className="signal-bars" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <i key={index} className={index / 7 < signalRatio ? "active" : ""} />)}</div>
            <div className="signal-value"><strong>{fmt(telemetry.rssiDbfs, 1)}</strong><small>dBFS</small></div>
            <div className="integrity-ring"><span>NIC</span><strong>{fmt(telemetry.signalIntegrity)}</strong><small>± {fmt(telemetry.containmentRadiusM)} m</small></div>
          </div>
          <div className="instrument-secondary">{fmt(telemetry.messages)} üzenet · pozíció {fmt(telemetry.positionAgeSeconds, 1)} s</div>
        </article>
      </div>
    </div>
  );
}

type AltitudeSample = { at: number; altitudeM: number };

function AltitudeChart({ samples, currentAltitude }: { samples: AltitudeSample[]; currentAltitude: number | null }) {
  const width = 420;
  const height = 104;
  const plotLeft = 42;
  const plotRight = 410;
  const plotTop = 8;
  const plotBottom = 76;
  // A diagram időablakát az utolsó méréshez rögzítjük. Így a render
  // determinisztikus marad, és új adat érkezésekor természetesen továbblép.
  const now = samples.at(-1)?.at ?? 0;
  const windowStart = now - 30 * 60_000;
  const visible = samples.filter((sample) => sample.at >= windowStart && Number.isFinite(sample.altitudeM));
  const highest = Math.max(1000, ...visible.map((sample) => sample.altitudeM), currentAltitude || 0);
  const ceiling = Math.ceil((highest * 1.12) / 1000) * 1000;
  const x = (at: number) => plotLeft + ((Math.max(windowStart, Math.min(now, at)) - windowStart) / (now - windowStart)) * (plotRight - plotLeft);
  const y = (altitude: number) => plotBottom - (Math.max(0, altitude) / ceiling) * (plotBottom - plotTop);
  const points = visible.map((sample) => `${x(sample.at).toFixed(1)},${y(sample.altitudeM).toFixed(1)}`).join(" ");
  const area = visible.length > 1
    ? `M${x(visible[0].at).toFixed(1)} ${plotBottom} L${points.replaceAll(" ", " L")} L${x(visible[visible.length - 1].at).toFixed(1)} ${plotBottom} Z`
    : "";
  const latest = visible[visible.length - 1];

  return (
    <div className="mini-chart" aria-label="Az utolsó 30 perc mért magasságadatai">
      <div className="chart-head">
        <span>MAGASSÁG · UTOLSÓ 30 PERC</span>
        <b>{fmt(currentAltitude)} m</b>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Valós ADS-B magasságmérések az utolsó 30 percből</title>
        <defs>
          <linearGradient id="altitudeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#35d6e9" stopOpacity=".35" />
            <stop offset="1" stopColor="#35d6e9" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="gridline" d={`M${plotLeft} ${plotTop}H${plotRight} M${plotLeft} ${(plotTop + plotBottom) / 2}H${plotRight} M${plotLeft} ${plotBottom}H${plotRight}`} />
        <text className="axis-label y-axis" x="0" y={plotTop + 4}>{fmt(ceiling)} m</text>
        <text className="axis-label y-axis" x="0" y={plotBottom + 4}>0 m</text>
        <text className="axis-label" x={plotLeft} y="98">−30 p</text>
        <text className="axis-label" x={(plotLeft + plotRight) / 2} y="98" textAnchor="middle">−15 p</text>
        <text className="axis-label" x={plotRight} y="98" textAnchor="end">most</text>
        {area && <path className="area" d={area} />}
        {visible.length > 1 && <polyline className="line" points={points} />}
        {latest && <circle className="current-point" cx={x(latest.at)} cy={y(latest.altitudeM)} r="3.5" />}
        {visible.length === 0 && <text className="empty-chart" x={(plotLeft + plotRight) / 2} y="46" textAnchor="middle">Az adatgyűjtés a keresés után indul</text>}
      </svg>
    </div>
  );
}

function PlannedRouteMap({ flight, activeWithoutSignal }: { flight: WeatherFlight; activeWithoutSignal: boolean }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const dimensions = { width: 1100, height: 740 };
  const { origin, destination } = flight.journey;
  const routeCoordinates = greatCircleCoordinates(
    [origin.lon, origin.lat],
    [destination.lon, destination.lat],
    241,
  );
  const routeMidpoint = routeCoordinates[Math.floor(routeCoordinates.length / 2)];
  const projection = geoMercator()
    .rotate([-routeMidpoint[0], 0])
    .fitExtent(
      [[100, 90], [1000, 650]],
      { type: "LineString", coordinates: routeCoordinates } as never,
    );
  const path = geoPath(projection);
  const countries = feature(
    world as never,
    (world.objects as unknown as { countries: never }).countries,
  );
  const originPoint = projection([origin.lon, origin.lat]);
  const destinationPoint = projection([destination.lon, destination.lat]);
  const routePath = path({ type: "LineString", coordinates: routeCoordinates } as never) ?? "";
  const mapTransform = `translate(${pan.x} ${pan.y}) translate(${dimensions.width / 2} ${dimensions.height / 2}) scale(${zoom}) translate(${-dimensions.width / 2} ${-dimensions.height / 2})`;

  function changeZoom(factor: number) {
    setZoom((value) => Math.min(10, Math.max(.2, value * factor)));
  }

  return (
    <div className="map planned-route-map">
      <svg
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        role="img"
        aria-label={`A(z) ${origin.iata || origin.icao} és ${destination.iata || destination.icao} közötti tervezett útvonal`}
        onWheel={(event) => {
          event.preventDefault();
          changeZoom(event.deltaY < 0 ? 1.25 : .8);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const scale = dimensions.width / Math.max(1, event.currentTarget.clientWidth);
          setPan({
            x: drag.panX + (event.clientX - drag.x) * scale,
            y: drag.panY + (event.clientY - drag.y) * scale,
          });
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => { dragRef.current = null; }}
      >
        <defs>
          <radialGradient id="plannedMapGlow">
            <stop offset="0" stopColor="#123551" stopOpacity=".5" />
            <stop offset="1" stopColor="#06101d" stopOpacity="0" />
          </radialGradient>
          <filter id="plannedRouteGlow">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect width="1100" height="740" fill="#06101d" />
        <g className="map-viewport" transform={mapTransform}>
          <circle cx="550" cy="370" r="430" fill="url(#plannedMapGlow)" />
          <path className="graticule" d={path(geoGraticule10()) ?? ""} />
          <path className="countries" d={path(countries) ?? ""} />
          <path className="flight-route planned" d={routePath} filter="url(#plannedRouteGlow)">
            <title>Tervezett nagykörű útvonal</title>
          </path>
          {originPoint && (
            <g className="airport-point planned-origin">
              <circle cx={originPoint[0]} cy={originPoint[1]} r="7" />
              <text x={originPoint[0] + 12} y={originPoint[1] - 10}>{origin.city} · {origin.iata || origin.icao}</text>
            </g>
          )}
          {destinationPoint && (
            <g className="airport-point planned-destination">
              <circle cx={destinationPoint[0]} cy={destinationPoint[1]} r="7" />
              <text x={destinationPoint[0] + 12} y={destinationPoint[1] - 10}>{destination.city} · {destination.iata || destination.icao}</text>
            </g>
          )}
        </g>
      </svg>
      <div className="map-controls" aria-label="Térkép nagyítása">
        <button onClick={() => changeZoom(1.5)} aria-label="Nagyítás">+</button>
        <button onClick={() => changeZoom(1 / 1.5)} aria-label="Kicsinyítés">−</button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Alaphelyzet">◎</button>
      </div>
      <div className="planned-route-badge">
        <span>{activeWithoutSignal ? "AKTÍV · POZÍCIÓ NEM ELÉRHETŐ" : "MENETREND SZERINTI JÁRAT"}</span>
        <strong>TERVEZETT ÚTVONAL</strong>
        <small>{origin.iata || origin.icao} → {destination.iata || destination.icao}</small>
      </div>
    </div>
  );
}

function RadarMap({
  telemetry,
  trail,
  turbulence,
  weatherImpacts,
  weatherLoading,
  weatherError,
  weatherUpdatedAt,
}: {
  telemetry: Telemetry;
  trail: [number, number][];
  turbulence: TurbulenceFeature[];
  weatherImpacts: RouteWeatherImpact[];
  weatherLoading: boolean;
  weatherError: string | null;
  weatherUpdatedAt: string | null;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [weatherEnabled, setWeatherEnabled] = useState(true);
  const displayedTrack =
    telemetry.trackDeg ?? telemetry.trueHeadingDeg ?? telemetry.magneticHeadingDeg ?? 0;
  const dimensions = { width: 1100, height: 740 };
  const journey = telemetry.journey;
  const routeImpactIndexes = new Set(weatherImpacts.map((impact) => impact.index));
  const activeImpactIndexes = new Set(weatherImpacts.filter((impact) => impact.altitudeRelevant && impact.temporallyRelevant).map((impact) => impact.index));
  const relevantWeatherImpacts = weatherImpacts.filter((impact) => impact.altitudeRelevant && impact.temporallyRelevant);
  const nextWeatherImpact = relevantWeatherImpacts[0] || weatherImpacts[0];
  const fullRouteCoordinates = journey
    ? greatCircleCoordinates(
      [journey.origin.lon, journey.origin.lat],
      [journey.destination.lon, journey.destination.lat],
      241,
    )
    : null;
  const routeMidpoint = fullRouteCoordinates?.[Math.floor(fullRouteCoordinates.length / 2)] || null;
  const center: [number, number] = [telemetry.lon, telemetry.lat];
  const projection = geoMercator();
  if (fullRouteCoordinates && routeMidpoint) {
    // A nagykör középpontját forgatjuk a térkép közepére. Így az útvonal
    // dátumválasztó-vonalon áthaladó része nem a Mercator-vetület szélén szakad el.
    projection
      .rotate([-routeMidpoint[0], 0])
      .fitExtent(
        [[100, 90], [1000, 650]],
        {
          type: "GeometryCollection",
          geometries: [
            { type: "LineString", coordinates: fullRouteCoordinates },
            { type: "Point", coordinates: [telemetry.lon, telemetry.lat] },
          ],
        } as never,
      );
  } else {
    projection
      .center(center)
      .translate([dimensions.width / 2, dimensions.height / 2])
      .scale(920);
  }
  const path = geoPath(projection);
  const countries = feature(
    world as never,
    (world.objects as unknown as { countries: never }).countries,
  );
  const current = projection([telemetry.lon, telemetry.lat]) ?? [dimensions.width / 2, dimensions.height / 2];
  const originPoint = journey ? projection([journey.origin.lon, journey.origin.lat]) : null;
  const destinationPoint = journey ? projection([journey.destination.lon, journey.destination.lat]) : null;
  const pastCoordinates = journey
    ? greatCircleCoordinates([journey.origin.lon, journey.origin.lat], [telemetry.lon, telemetry.lat], 181)
    : [...trail.map(([lat, lon]): [number, number] => [lon, lat]), [telemetry.lon, telemetry.lat] as [number, number]];
  const pastRoute = pastCoordinates.length > 1
    ? path({ type: "LineString", coordinates: pastCoordinates } as never) ?? ""
    : "";
  const routeSamples = journey ? remainingRouteSamples({ ...telemetry, journey }) : [];
  const futureCoordinates = routeSamples.map((sample) => sample.point);
  const futureRoute = futureCoordinates.length > 1
    ? path({ type: "LineString", coordinates: futureCoordinates } as never) ?? ""
    : "";
  const corridorCoordinates = routeCorridorPolygon(routeSamples);
  const corridorPath = corridorCoordinates.length > 3
    ? path({ type: "Polygon", coordinates: [corridorCoordinates] } as never) ?? ""
    : "";
  const impactSegments = weatherImpacts.map((impact) => {
    const segment = routeSamples
      .filter((sample) => sample.routePercent >= impact.entryPercent && sample.routePercent <= impact.exitPercent)
      .map((sample) => sample.point);
    return {
      ...impact,
      path: segment.length > 1 ? path({ type: "LineString", coordinates: segment } as never) ?? "" : "",
      entry: projection(impact.entryPoint),
      exit: projection(impact.exitPoint),
    };
  });
  const mapTransform = `translate(${pan.x} ${pan.y}) translate(${current[0]} ${current[1]}) scale(${zoom}) translate(${-current[0]} ${-current[1]})`;

  function changeZoom(factor: number) {
    setZoom((value) => Math.min(10, Math.max(.2, value * factor)));
  }

  function weatherClass(feature: TurbulenceFeature) {
    if (feature.properties.hazard === "Hegyi hullám") return "mountain-wave";
    return feature.properties.severity.toUpperCase().includes("SEV") ? "severe" : "moderate";
  }

  return (
    <div className="map">
      <svg
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        role="img"
        aria-label="A repülőgép aktuális helyzete; a térkép egérrel mozgatható és görgővel nagyítható"
        onWheel={(event) => {
          event.preventDefault();
          changeZoom(event.deltaY < 0 ? 1.25 : .8);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const scale = dimensions.width / Math.max(1, event.currentTarget.clientWidth);
          setPan({
            x: drag.panX + (event.clientX - drag.x) * scale,
            y: drag.panY + (event.clientY - drag.y) * scale,
          });
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => { dragRef.current = null; }}
      >
        <defs>
          <radialGradient id="mapGlow">
            <stop offset="0" stopColor="#123551" stopOpacity=".5" />
            <stop offset="1" stopColor="#06101d" stopOpacity="0" />
          </radialGradient>
          <filter id="routeGlow">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect width="1100" height="740" fill="#06101d" />
        <g className="map-viewport" transform={mapTransform}>
        <circle cx="550" cy="370" r="430" fill="url(#mapGlow)" />
        <path className="graticule" d={path(geoGraticule10()) ?? ""} />
        <path className="countries" d={path(countries) ?? ""} />
        {corridorPath && <path className="route-corridor" d={corridorPath}><title>Hátralévő útvonal ±{ROUTE_CORRIDOR_HALF_WIDTH_KM} km-es elemzési folyosója</title></path>}
        {weatherEnabled && turbulence.map((area, index) => (
          <path
            className={`turbulence-area ${weatherClass(area)} ${activeImpactIndexes.has(index) ? "route-impact active-impact" : routeImpactIndexes.has(index) ? "route-impact inactive-impact" : ""}`}
            d={path(weatherFeatureForD3(area) as never) ?? ""}
            key={`${area.properties.source}-${area.properties.area}-${index}`}
          >
            <title>{`${area.properties.hazard} · ${area.properties.severity} · ${area.properties.base}–${area.properties.top}${area.properties.area ? ` · ${area.properties.area}` : ""}`}</title>
          </path>
        ))}
        {pastRoute && <path className="flight-route" d={pastRoute} filter="url(#routeGlow)" />}
        {futureRoute && <path className="flight-route future" d={futureRoute} />}
        {weatherEnabled && impactSegments.map((impact) => (
          <g className={`impact-segment ${impact.altitudeRelevant && impact.temporallyRelevant ? "active" : "inactive"}`} key={impact.id}>
            {impact.path && <path d={impact.path} />}
            {impact.entry && <g className="impact-marker entry" transform={`translate(${impact.entry[0]} ${impact.entry[1]})`}><circle r="7" /><text x="-11" y="-11" textAnchor="end">BELÉPÉS</text></g>}
            {impact.exit && <g className="impact-marker exit" transform={`translate(${impact.exit[0]} ${impact.exit[1]})`}><circle r="7" /><text x="11" y="21">KILÉPÉS</text></g>}
          </g>
        ))}
        {journey && originPoint && (
          <g className="airport-point">
            <circle cx={originPoint[0]} cy={originPoint[1]} r="6" />
            <text x={originPoint[0] + 12} y={originPoint[1] - 10}>{journey.origin.city} · {journey.origin.iata || journey.origin.icao}</text>
          </g>
        )}
        {journey && destinationPoint && (
          <g className="airport-point">
            <circle cx={destinationPoint[0]} cy={destinationPoint[1]} r="6" />
            <text x={destinationPoint[0] + 12} y={destinationPoint[1] - 10}>{journey.destination.city} · {journey.destination.iata || journey.destination.icao}</text>
          </g>
        )}
        <g className="plane-marker" transform={`translate(${current[0]} ${current[1]})`}>
          <g className="plane-marker-scale" transform={`scale(${1 / zoom})`}>
            <circle r="41" />
            <circle r="25" />
            <g className="plane-icon" transform={`rotate(${displayedTrack})`}>
              <path d="M0-21 5-7 19 2 19 7 5 3 4 15 10 20 10 24 0 20-10 24-10 20-4 15-5 3-19 7-19 2-5-7Z" />
            </g>
            <title>{`Haladási irány: ${fmt(displayedTrack)}°`}</title>
          </g>
        </g>
        </g>
      </svg>
      <div className="map-controls" aria-label="Térkép nagyítása">
        <button onClick={() => changeZoom(1.5)} aria-label="Nagyítás">+</button>
        <button onClick={() => changeZoom(1 / 1.5)} aria-label="Kicsinyítés">−</button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Alaphelyzet">◎</button>
      </div>
      <div className="weather-control">
        <button
          className={weatherEnabled ? "active" : ""}
          onClick={() => setWeatherEnabled((value) => !value)}
          aria-pressed={weatherEnabled}
        >
          <span>≋</span> TURBULENCIA
        </button>
        {weatherEnabled && (
          <div className="weather-legend">
            <strong>Repülésmeteorológiai veszélyjelzések</strong>
            <span><i className="moderate" /> Mérsékelt turbulencia</span>
            <span><i className="severe" /> Erős turbulencia</span>
            <span><i className="mountain-wave" /> Hegyi hullám</span>
            {weatherLoading && <small>Frissítés…</small>}
            {weatherError && <small className="weather-error">{weatherError}</small>}
            {!weatherLoading && !weatherError && (
              <small>{turbulence.length} aktív terület · {weatherUpdatedAt ? new Date(weatherUpdatedAt).toLocaleTimeString("hu-HU", { timeZone: BUDAPEST_TIME_ZONE, hour: "2-digit", minute: "2-digit" }) : "—"}</small>
            )}
          </div>
        )}
      </div>
      <div className="coordinate-band">
        {fmt(telemetry.lat, 4)}° {telemetry.lat >= 0 ? "N" : "S"} · {fmt(telemetry.lon, 4)}° {telemetry.lon >= 0 ? "E" : "W"}
      </div>
      {journey && (
        <div className={`route-weather-brief ${nextWeatherImpact?.altitudeRelevant ? "warning" : "clear"}`}>
          <span>ÚTVONAL-IDŐJÁRÁS</span>
          {weatherLoading ? (
            <strong>Aktuális veszélyjelzések elemzése…</strong>
          ) : weatherError ? (
            <strong>{weatherError}</strong>
          ) : nextWeatherImpact?.altitudeRelevant && nextWeatherImpact.temporallyRelevant ? (
            <>
              <strong>{relevantWeatherImpacts.length} releváns veszélyszakasz a folyosóban</strong>
              <small>{nextWeatherImpact.feature.properties.hazard} · {nextWeatherImpact.feature.properties.severity} · {nextWeatherImpact.feature.properties.base}–{nextWeatherImpact.feature.properties.top}{nextWeatherImpact.entryEtaMinutes != null ? ` · belépés kb. ${nextWeatherImpact.entryEtaMinutes} perc múlva` : ""}{nextWeatherImpact.durationMinutes != null ? ` · ${nextWeatherImpact.durationMinutes} percig` : ""}</small>
            </>
          ) : nextWeatherImpact && !nextWeatherImpact.altitudeRelevant ? (
            <>
              <strong>A folyosó érint veszélyzónát, de nem a jelenlegi repülési szinten</strong>
              <small>{nextWeatherImpact.feature.properties.base}–{nextWeatherImpact.feature.properties.top}</small>
            </>
          ) : nextWeatherImpact ? (
            <>
              <strong>A folyosó metszi a zónát, de az nem érvényes a várható áthaladáskor</strong>
              <small>{temporalStatusLabel(nextWeatherImpact)}</small>
            </>
          ) : (
            <>
              <strong>Nincs az útvonalat érintő aktív turbulenciajelzés</strong>
              <small>NOAA/NWS SIGMET és G-AIRMET alapján</small>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledFlight | null>(null);
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "live" | "scheduled" | "active-no-signal" | "error">("idle");
  const [message, setMessage] = useState("Adj meg egy járatszámot az élő kereséshez");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [altitudeHistory, setAltitudeHistory] = useState<AltitudeSample[]>([]);
  const [shareLabel, setShareLabel] = useState("Link másolása");
  const [turbulence, setTurbulence] = useState<TurbulenceFeature[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState<string | null>(null);
  const [airportWeather, setAirportWeather] = useState<AirportWeather[]>([]);
  const [airportWeatherLoading, setAirportWeatherLoading] = useState(false);
  const [airportWeatherError, setAirportWeatherError] = useState<string | null>(null);
  const activeQuery = useRef<string | null>(null);

  const loadFlight = useCallback(async (flight: string, silent = false) => {
    const normalized = flight.trim().toUpperCase().replace(/\s+/g, "");
    if (!normalized) return;
    if (!silent) {
      setTelemetry(null);
      setScheduled(null);
      setAirportWeather([]);
      setAirportWeatherError(null);
      setStatus("loading");
      setMessage("Élő ADS-B adatok keresése…");
    }
    try {
      const response = await fetch(`/api/flight?flight=${encodeURIComponent(normalized)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        data?: Telemetry;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "A repülőgép most nem látható az élő ADS-B hálózaton.");
      }
      const next = payload.data;
      setTelemetry(next);
      if (next.altitudeM != null && Number.isFinite(next.altitudeM)) {
        const sampledAt = Date.now();
        setAltitudeHistory((current) => [
          ...current.filter((sample) => sample.at >= sampledAt - 30 * 60_000),
          { at: sampledAt, altitudeM: next.altitudeM as number },
        ].slice(-121));
      }
      setScheduled(null);
      setTrail((current) => {
        const point: [number, number] = [next.lat, next.lon];
        const previous = current[current.length - 1];
        if (previous && Math.abs(previous[0] - point[0]) < 0.0001 && Math.abs(previous[1] - point[1]) < 0.0001) {
          return current;
        }
        return [...current.slice(-59), point];
      });
      setStatus("live");
      setMessage(
        normalized === next.callsign
          ? `Élő ADS-B adatkapcsolat · ${next.callsign}`
          : `Élő ADS-B adatkapcsolat · ${normalized} → ${next.callsign}`,
      );
      setLastSync(new Date());
      activeQuery.current = normalized;
    } catch (error) {
      if (!silent) {
        try {
          setMessage("A gép még nem látható – menetrendi indulás keresése…");
          const scheduleResponse = await fetch(`/api/flight?flight=${encodeURIComponent(normalized)}&schedule=1`, { cache: "no-store" });
          const schedulePayload = (await scheduleResponse.json()) as { scheduled?: ScheduledFlight; error?: string };
          if (!scheduleResponse.ok || !schedulePayload.scheduled) {
            throw new Error(schedulePayload.error || "Nem található közelgő indulás.");
          }
          const isActiveWithoutSignal = schedulePayload.scheduled.status.toLowerCase() === "active";
          setScheduled(schedulePayload.scheduled);
          setStatus(isActiveWithoutSignal ? "active-no-signal" : "scheduled");
          setMessage(
            isActiveWithoutSignal
              ? "A járat aktív, de a nyilvános forrásokban jelenleg nincs elérhető pozíció"
              : schedulePayload.scheduled.source,
          );
          setLastSync(new Date());
          // Az aktív, de jel nélküli járatot tovább keressük, így az élő jel
          // visszatérésekor a nézet automatikusan térképre vált.
          activeQuery.current = isActiveWithoutSignal ? normalized : null;
        } catch (scheduleError) {
          setStatus("error");
          setMessage(scheduleError instanceof Error ? scheduleError.message : error instanceof Error ? error.message : "Az adatforrás nem elérhető.");
          activeQuery.current = null;
        }
      }
    }
  }, []);

  useEffect(() => {
    const loadFromUrl = () => {
      const flight = new URL(window.location.href).searchParams.get("flight")?.trim().toUpperCase() || "";
      if (!flight) return;
      setQuery(flight);
      setTrail([]);
      setAltitudeHistory([]);
      void loadFlight(flight);
    };
    loadFromUrl();
    window.addEventListener("popstate", loadFromUrl);
    return () => window.removeEventListener("popstate", loadFromUrl);
  }, [loadFlight]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim().toUpperCase().replace(/\s+/g, "");
    if (!normalized) return;
    const url = new URL(window.location.href);
    url.searchParams.set("flight", normalized);
    window.history.pushState({}, "", url);
    setTrail([]);
    setAltitudeHistory([]);
    void loadFlight(normalized);
  }

  async function shareFlight() {
    const flight = scheduled?.flight || telemetry?.flight || query.trim().toUpperCase();
    if (!flight) return;
    const url = new URL(window.location.href);
    url.searchParams.set("flight", flight);
    window.history.replaceState({}, "", url);
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareLabel("Link kimásolva ✓");
    } catch {
      setShareLabel("A link az URL-sávban van");
    }
    window.setTimeout(() => setShareLabel("Link másolása"), 2200);
  }

  const loadWeather = useCallback(async () => {
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const response = await fetch("/api/weather", { cache: "no-store" });
      const payload = (await response.json()) as {
        features?: TurbulenceFeature[];
        updatedAt?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "A turbulencia-adatok nem tölthetők be.");
      setTurbulence(payload.features || []);
      setWeatherUpdatedAt(payload.updatedAt || new Date().toISOString());
    } catch (error) {
      setWeatherError(error instanceof Error ? error.message : "A turbulencia-adatok nem tölthetők be.");
    } finally {
      setWeatherLoading(false);
    }
  }, []);

  const weatherFlight = useMemo<WeatherFlight | null>(() => {
    if (telemetry?.journey) {
      return { ...telemetry, journey: telemetry.journey, preflight: false };
    }
    if (!scheduled?.route) return null;
    const { origin, destination, airlineName } = scheduled.route;
    const totalKm = greatCircleKm([origin.lon, origin.lat], [destination.lon, destination.lat]);
    const departureAt = scheduled.actualDepartureAt
      || scheduled.estimatedDepartureAt
      || scheduled.scheduledDepartureAt;
    const arrivalAt = scheduled.actualArrivalAt
      || scheduled.estimatedArrivalAt
      || scheduled.scheduledArrivalAt;
    const departureMs = departureAt ? Date.parse(departureAt) : Number.NaN;
    const arrivalMs = arrivalAt ? Date.parse(arrivalAt) : Number.NaN;
    const scheduledDuration = Number.isFinite(departureMs) && Number.isFinite(arrivalMs) && arrivalMs > departureMs
      ? Math.round((arrivalMs - departureMs) / 60_000)
      : null;
    const durationMinutes = scheduledDuration ?? Math.max(20, Math.round(totalKm / 750 * 60));
    const loadedAtMs = lastSync?.getTime() ?? (Number.isFinite(departureMs) ? departureMs : 0);
    const referenceMs = Number.isFinite(departureMs) ? Math.max(loadedAtMs, departureMs) : loadedAtMs;
    return {
      lat: origin.lat,
      lon: origin.lon,
      altitudeM: null,
      updatedAt: new Date(referenceMs).toISOString(),
      preflight: true,
      journey: {
        origin,
        destination,
        airlineName,
        flownKm: 0,
        remainingKm: Math.round(totalKm),
        totalKm: Math.round(totalKm),
        progressPercent: 0,
        elapsedMinutes: 0,
        remainingMinutes: durationMinutes,
        estimatedDepartureAt: departureAt,
        estimatedArrivalAt: arrivalAt,
        timingType: scheduled.source,
      },
    };
  }, [lastSync, scheduled, telemetry]);

  const weatherRouteKey = weatherFlight
    ? `${scheduled?.flight || telemetry?.flight}-${weatherFlight.journey.origin.icao}-${weatherFlight.journey.destination.icao}-${weatherFlight.preflight ? "preflight" : "live"}`
    : "";
  const airportWeatherIds = weatherFlight
    ? `${weatherFlight.journey.origin.icao},${weatherFlight.journey.destination.icao}`
    : "";
  const airportWeatherTargets = weatherFlight
    ? [weatherFlight.journey.estimatedDepartureAt, weatherFlight.journey.estimatedArrivalAt]
    : [null, null];
  const airportWeatherKey = airportWeatherIds
    ? `${airportWeatherIds}|${airportWeatherTargets.map((value) => value || "current").join("|")}`
    : "";

  useEffect(() => {
    if (!weatherRouteKey) return;
    const initialTimer = window.setTimeout(() => void loadWeather(), 0);
    const timer = window.setInterval(() => void loadWeather(), 10 * 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadWeather, weatherRouteKey]);

  useEffect(() => {
    if (!airportWeatherKey) return;
    const controller = new AbortController();
    const refresh = async () => {
      setAirportWeatherLoading(true);
      setAirportWeatherError(null);
      try {
        const [ids, target0, target1] = airportWeatherKey.split("|");
        const params = new URLSearchParams({ ids });
        if (target0 && target0 !== "current") params.set("target0", target0);
        if (target1 && target1 !== "current") params.set("target1", target1);
        const response = await fetch(`/api/weather/airports?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as AirportWeatherPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || "A repülőtéri időjárás nem elérhető.");
        setAirportWeather(payload.airports || []);
      } catch (error) {
        if (!controller.signal.aborted) {
          setAirportWeatherError(error instanceof Error ? error.message : "A repülőtéri időjárás nem elérhető.");
        }
      } finally {
        if (!controller.signal.aborted) setAirportWeatherLoading(false);
      }
    };
    const initialTimer = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 10 * 60_000);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [airportWeatherKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (activeQuery.current) void loadFlight(activeQuery.current, true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadFlight]);

  const secondaryMetrics = useMemo(
    () => telemetry ? [
      ["Szélesség", `${fmt(Math.abs(telemetry.lat), 4)}° ${telemetry.lat >= 0 ? "N" : "S"}`, ""],
      ["Hosszúság", `${fmt(Math.abs(telemetry.lon), 4)}° ${telemetry.lon >= 0 ? "E" : "W"}`, ""],
      ["Geometriai magasság", fmt(telemetry.geometricAltitudeM), "m"],
      ["Valós légsebesség", fmt(telemetry.trueAirspeedKmh), "km/h"],
      ["Műszer szerinti sebesség", fmt(telemetry.indicatedAirspeedKmh), "km/h"],
      ["Mach-szám", fmt(telemetry.mach, 3), ""],
      ["Mágneses irány", fmt(telemetry.magneticHeadingDeg), "°"],
      ["Valós irány", fmt(telemetry.trueHeadingDeg), "°"],
      ["Geometriai emelkedés", fmt(telemetry.geometricRateMs, 1), "m/s"],
      ["Dőlésszög", fmt(telemetry.rollDeg, 1), "°"],
      ["Légnyomás (QNH)", fmt(telemetry.navQnhHpa, 1), "hPa"],
      ["Beállított magasság", fmt(telemetry.selectedAltitudeM), "m"],
      ["Navigációs irány", fmt(telemetry.navHeadingDeg), "°"],
      ["Szélsebesség", fmt(telemetry.windSpeedKmh), "km/h"],
      ["Szélirány", fmt(telemetry.windDirectionDeg), "°"],
      ["Külső hőmérséklet", fmt(telemetry.outsideAirTempC, 1), "°C"],
      ["Teljes hőmérséklet", fmt(telemetry.totalAirTempC, 1), "°C"],
      ["Transzponderkód", telemetry.squawk == null ? "—" : String(telemetry.squawk), ""],
      ["Kategóriakód", fmt(telemetry.category), ""],
      ["Fogadott üzenetek", fmt(telemetry.messages), ""],
      ["Jelerősség", fmt(telemetry.rssiDbfs, 1), "dBFS"],
      ["Utolsó jel kora", fmt(telemetry.seenSeconds, 1), "s"],
      ["Pozíció kora", fmt(telemetry.positionAgeSeconds, 1), "s"],
      ["Vevőtől mért távolság", fmt(telemetry.distanceFromReceiverKm, 1), "km"],
      ["Vevőhöz viszonyított irány", fmt(telemetry.bearingFromReceiverDeg), "°"],
      ["Jelintegritás (NIC)", fmt(telemetry.signalIntegrity), ""],
      ["Bizonytalansági sugár", fmt(telemetry.containmentRadiusM), "m"],
    ] : [],
    [telemetry],
  );
  const weatherImpacts = useMemo(
    () => weatherFlight ? routeWeatherImpacts(turbulence, weatherFlight) : [],
    [turbulence, weatherFlight],
  );
  const brand = airlineBrand(
    telemetry?.journey?.airlineName || scheduled?.airlineName,
    telemetry?.callsign || scheduled?.callsign,
  );
  const panelStyle = {
    "--airline-color": brand.primary,
    "--airline-secondary": brand.secondary,
    "--airline-rgb": brand.rgb,
  } as CSSProperties;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Légiradar">
          <span className="radar-logo"><i /></span>
          <span>LÉGIRADAR</span>
          <small className="app-version">202608051859</small>
        </div>
        <form className="search" onSubmit={submit}>
          <label className="sr-only" htmlFor="flight-search">Járatszám vagy callsign</label>
          <input
            id="flight-search"
            value={query}
            onChange={(event) => setQuery(event.target.value.toUpperCase())}
            placeholder="Járatszám vagy callsign, pl. W62375"
            autoComplete="off"
          />
          <button type="submit" disabled={status === "loading"}>
            {status === "loading" ? "Keresés…" : "Keresés"}
          </button>
        </form>
        <div className={`live-pill ${status}`}>
          <i />
          {status === "live" ? "ÉLŐ" : status === "active-no-signal" ? "AKTÍV · POZÍCIÓ NEM ELÉRHETŐ" : status === "scheduled" ? "MENETREND" : status === "loading" ? "KAPCSOLÓDÁS" : status === "error" ? "NINCS ADAT" : "KERESÉSRE KÉSZ"}
        </div>
      </header>

      <section className="workspace">
        <div className="map-panel">
          {scheduled && weatherFlight ? (
            <PlannedRouteMap
              key={`${scheduled.flight}-${scheduled.scheduledDepartureAt || "scheduled"}`}
              flight={weatherFlight}
              activeWithoutSignal={status === "active-no-signal"}
            />
          ) : scheduled ? (
            <div className="scheduled-map">
              <div className="scheduled-plane">✈</div>
              <span>{status === "active-no-signal" ? "AKTÍV, DE A POZÍCIÓ NEM ELÉRHETŐ" : "MÉG NEM SZÁLLT FEL"}</span>
              <strong>{scheduled.origin.iata || scheduled.origin.icao || "—"} → {scheduled.destination.iata || scheduled.destination.icao || "—"}</strong>
              <p>{scheduled.origin.airport || "Indulási repülőtér"} → {scheduled.destination.airport || "Célrepülőtér"}</p>
            </div>
          ) : telemetry ? (
            <RadarMap
              telemetry={telemetry}
              trail={trail}
              turbulence={turbulence}
              weatherImpacts={weatherImpacts}
              weatherLoading={weatherLoading}
              weatherError={weatherError}
              weatherUpdatedAt={weatherUpdatedAt}
            />
          ) : (
            <div className="scheduled-map empty-state">
              <div className="scheduled-plane">⌖</div>
              <span>{status === "loading" ? "JÁRAT KERESÉSE" : "LÉGIRADAR"}</span>
              <strong>{status === "loading" ? "Kapcsolódás…" : "Adj meg egy járatszámot"}</strong>
              <p>{status === "loading" ? "Az élő ADS-B és menetrendi adatforrások ellenőrzése folyamatban van." : "Például: W62375, TK6534 vagy RYR123"}</p>
            </div>
          )}
          <div className="scanline" aria-hidden="true" />
          <div className="map-status">
            <span className="clock">◷</span>
            Utolsó frissítés: <strong>{lastSync ? lastSync.toLocaleTimeString("hu-HU", { timeZone: BUDAPEST_TIME_ZONE }) : "--:--:--"}</strong>
          </div>
          <div className="data-source">{message}</div>
        </div>

        <aside className="flight-panel" style={panelStyle}>
          {scheduled ? (
            <>
              <div className="flight-summary">
                <div className="summary-top">
                  <div className="airline-brand"><b>{brand.monogram}</b><span>{brand.name}</span></div>
                  <button className="share-button" onClick={() => void shareFlight()} type="button">↗ {shareLabel}</button>
                </div>
                <div className="eyebrow">{status === "active-no-signal" ? "AKTÍV JÁRAT · NYILVÁNOS POZÍCIÓ NÉLKÜL" : "KÖVETKEZŐ INDULÁS"}</div>
                <h1>{scheduled.flight}</h1>
                <div className="route-heading">
                  {weatherFlight ? (
                    <AirportWeatherPopover
                      key={`scheduled-origin-${weatherFlight.journey.origin.icao}`}
                      role="INDULÁSI"
                      airport={weatherFlight.journey.origin}
                      weather={airportWeather.find((item) => item.icao === weatherFlight.journey.origin.icao) || null}
                      targetAt={weatherFlight.journey.estimatedDepartureAt}
                      loading={airportWeatherLoading}
                      error={airportWeatherError}
                    />
                  ) : <strong>{scheduled.origin.iata || scheduled.origin.icao || "—"}</strong>}
                  <span>→</span>
                  {weatherFlight ? (
                    <AirportWeatherPopover
                      key={`scheduled-destination-${weatherFlight.journey.destination.icao}`}
                      role="ÉRKEZÉSI"
                      airport={weatherFlight.journey.destination}
                      weather={airportWeather.find((item) => item.icao === weatherFlight.journey.destination.icao) || null}
                      targetAt={weatherFlight.journey.estimatedArrivalAt}
                      loading={airportWeatherLoading}
                      error={airportWeatherError}
                    />
                  ) : <strong>{scheduled.destination.iata || scheduled.destination.icao || "—"}</strong>}
                </div>
                <div className="route-cities">{scheduled.origin.airport || "—"} → {scheduled.destination.airport || "—"}</div>
                <div className="callsign">{scheduled.airlineName || "Légitársaság nem ismert"} · {scheduled.callsign}</div>
                <div className="phase">{statusLabel(scheduled.status)}</div>
              </div>
              <div className="departure-card">
                <span>{status === "active-no-signal" ? "INDULÁSI IDŐ" : "VÁRHATÓ INDULÁS"}</span>
                <strong>{budapestDateTime(scheduled.estimatedDepartureAt)}</strong>
                <small>CET</small>
                {scheduled.delayMinutes != null && scheduled.delayMinutes > 0 && (
                  <b>{fmt(scheduled.delayMinutes)} perc várható késés</b>
                )}
              </div>
              <div className="schedule-grid">
                <div><span>MENETREND SZERINT · CET</span><strong>{budapestDateTime(scheduled.scheduledDepartureAt)}</strong></div>
                <div><span>VÁRHATÓ ÉRKEZÉS · CET</span><strong>{budapestDateTime(scheduled.estimatedArrivalAt)}</strong></div>
                <div><span>TERMINÁL</span><strong>{scheduled.origin.terminal || "—"}</strong></div>
                <div><span>KAPU</span><strong>{scheduled.origin.gate || "—"}</strong></div>
              </div>
              <FlightTimeline scheduled={scheduled} />
              {weatherFlight?.preflight && (
                <FlightConditionsPanel
                  telemetry={weatherFlight}
                  impacts={weatherImpacts}
                  loading={weatherLoading}
                  error={weatherError}
                  updatedAt={weatherUpdatedAt}
                />
              )}
              <p className="schedule-note">
                {status === "active-no-signal"
                  ? "A menetrendi adat szerint a járat már úton van, de jelenleg egyik helyzetforrás sem ad élő koordinátát. A rendszer 15 másodpercenként újrapróbálja, és jel érkezésekor automatikusan térképes követésre vált."
                  : "A gép jelenleg nem sugároz élő pozíciót. Felszállás után egy új kereséskor a nézet automatikusan átvált a térképes követésre."}
              </p>
            </>
          ) : telemetry ? (
          <>
          <div className="flight-summary">
            <div className="summary-top">
              <div className="airline-brand"><b>{brand.monogram}</b><span>{brand.name}</span></div>
              <button className="share-button" onClick={() => void shareFlight()} type="button">↗ {shareLabel}</button>
            </div>
            <div className="eyebrow">AKTUÁLIS JÁRAT · ADS-B HÍVÓJEL</div>
            <h1>{telemetry.callsign || telemetry.flight}</h1>
            <div className="route-heading">
              {weatherFlight ? (
                <AirportWeatherPopover
                  key={`live-origin-${weatherFlight.journey.origin.icao}`}
                  role="INDULÁSI"
                  airport={weatherFlight.journey.origin}
                  weather={airportWeather.find((item) => item.icao === weatherFlight.journey.origin.icao) || null}
                  targetAt={weatherFlight.journey.estimatedDepartureAt}
                  loading={airportWeatherLoading}
                  error={airportWeatherError}
                />
              ) : <strong>{telemetry.journey?.origin.iata || telemetry.journey?.origin.icao || "—"}</strong>}
              <span>→</span>
              {weatherFlight ? (
                <AirportWeatherPopover
                  key={`live-destination-${weatherFlight.journey.destination.icao}`}
                  role="ÉRKEZÉSI"
                  airport={weatherFlight.journey.destination}
                  weather={airportWeather.find((item) => item.icao === weatherFlight.journey.destination.icao) || null}
                  targetAt={weatherFlight.journey.estimatedArrivalAt}
                  loading={airportWeatherLoading}
                  error={airportWeatherError}
                />
              ) : <strong>{telemetry.journey?.destination.iata || telemetry.journey?.destination.icao || "—"}</strong>}
            </div>
            <div className="route-cities">
              {telemetry.journey
                ? `${telemetry.journey.origin.city} → ${telemetry.journey.destination.city}`
                : "Ehhez a járathoz nincs nyilvános útvonaladat"}
            </div>
            <div className="callsign">
              {telemetry.journey?.airlineName || "Légitársaság nem ismert"}
              {telemetry.flight && telemetry.flight !== telemetry.callsign ? ` · járatszám ${telemetry.flight}` : ""}
              {` · ICAO24 ${telemetry.hex}`}
            </div>
            <div className="phase">
              {telemetry.onGround ? "FÖLDÖN" : telemetry.verticalRateMs != null && telemetry.verticalRateMs > 1 ? "EMELKEDIK" : telemetry.verticalRateMs != null && telemetry.verticalRateMs < -1 ? "SÜLLYED" : "ÚTON"}
              <b>•</b> {!telemetry.emergency || ["nincs", "none"].includes(telemetry.emergency.toLowerCase()) ? "RENDBEN" : telemetry.emergency.toUpperCase()}
            </div>
          </div>

          <div className="journey-panel">
            <div className="journey-times">
              <div>
                <span>INDULÁS · CET <em>{telemetry.journey?.timingType.startsWith("Tényleges") ? "tényleges" : "becsült"}</em></span>
                <strong>{clockTime(telemetry.journey?.estimatedDepartureAt, telemetry.journey?.elapsedMinutes ?? null, lastSync, -1)}</strong>
              </div>
              <div>
                <span>REPÜLÉSI IDŐ EDDIG <em>becsült</em></span>
                <strong>{duration(telemetry.journey?.elapsedMinutes)}</strong>
              </div>
              <div>
                <span>ÉRKEZÉS · CET <em>becsült</em></span>
                <strong>{clockTime(telemetry.journey?.estimatedArrivalAt, telemetry.journey?.remainingMinutes ?? null, lastSync, 1)}</strong>
              </div>
              <div>
                <span>HÁTRALÉVŐ IDŐ <em>becsült</em></span>
                <strong>{duration(telemetry.journey?.remainingMinutes)}</strong>
              </div>
            </div>
            <div className="route-progress">
              <div className="progress-route-head">
                <div><b>{telemetry.journey?.origin.iata || telemetry.journey?.origin.icao || "DEP"}</b><span>{telemetry.journey ? `${fmt(telemetry.journey.flownKm)} km megtéve` : "Indulás"}</span></div>
                <strong>{telemetry.journey?.progressPercent == null ? "—" : `${telemetry.journey.progressPercent}%`}</strong>
                <div><b>{telemetry.journey?.destination.iata || telemetry.journey?.destination.icao || "ARR"}</b><span>{telemetry.journey ? `${fmt(telemetry.journey.remainingKm)} km hátra` : "Érkezés"}</span></div>
              </div>
              <div className="progress-track" aria-label={`Az útvonal ${telemetry.journey?.progressPercent ?? 0} százaléka teljesítve`}>
                <i style={{ width: `${telemetry.journey?.progressPercent ?? 0}%` }} />
                <span className="progress-origin" />
                <b style={{ left: `${telemetry.journey?.progressPercent ?? 0}%` }}>✈</b>
                <span className="progress-destination" />
              </div>
            </div>
          </div>

          <FlightTimeline telemetry={telemetry} />

          {weatherFlight && !weatherFlight.preflight && (
            <FlightConditionsPanel
              telemetry={weatherFlight}
              impacts={weatherImpacts}
              loading={weatherLoading}
              error={weatherError}
              updatedAt={weatherUpdatedAt}
            />
          )}

          <div className="section-kicker metric-kicker">PILLANATNYI REPÜLÉSI ADATOK</div>
          <div className="primary-grid">
            {metric("MAGASSÁG", fmt(telemetry.altitudeM), "m")}
            {metric("SEBESSÉG", fmt(telemetry.groundSpeedKmh), "km/h")}
            {metric("IRÁNY", compass(telemetry.trackDeg))}
            {metric("EMELKEDÉS", fmt(telemetry.verticalRateMs, 1), "m/s", (telemetry.verticalRateMs ?? 0) > 0)}
          </div>

          <div className="signal-row">
            <div><span>ADATFORRÁS</span><strong>{telemetry.source}</strong></div>
            <div><span>FRISSÍTÉS</span><strong>15 mp</strong></div>
          </div>

          <AltitudeChart samples={altitudeHistory} currentAltitude={telemetry.altitudeM} />
          </>
          ) : (
            <div className="flight-summary empty-summary">
              <div className="eyebrow">JÁRATKERESŐ</div>
              <h1>—</h1>
              <div className="route-cities">A járat adatai a keresés után jelennek meg.</div>
            </div>
          )}
        </aside>
      </section>

      {telemetry && !scheduled && <details className="details telemetry-disclosure">
        <summary className="details-title">
          <div>
            <span className="eyebrow">TELJES TELEMETRIA</span>
            <h2>Professzionális műszerfal és minden számszerű adat</h2>
            <p>Analóg repülési műszerek és részletes ADS-B leolvasás</p>
          </div>
          <span className="details-toggle"><b className="open-label">MŰSZERFAL BEZÁRÁSA</b><b className="closed-label">MŰSZERFAL MEGNYITÁSA</b><i>⌄</i></span>
        </summary>
        <div className="telemetry-body">
          <TelemetryInstruments telemetry={telemetry} />
          <div className="digital-readout-title"><span>RÉSZLETES DIGITÁLIS LEOLVASÁS</span><small>Az összes elérhető forrásmező</small></div>
          <div className="details-grid">
            {secondaryMetrics.map(([label, value, unit]) => metric(label, value, unit))}
          </div>
          <p className="note">
            A helyzet- és telemetriai adatok közösségi ADS-B vevőállomásokból, az útvonaladatok nyilvános járatadatbázisból származnak. A turbulenciaréteg a NOAA/NWS Aviation Weather Center aktuális SIGMET és G-AIRMET veszélyjelzéseit mutatja; nem jelenti azt, hogy a teljes megjelölt területen biztosan turbulencia tapasztalható. Ha a gép még nem látható élőben, a következő várható indulást az Aviationstack menetrendi adatai alapján mutatjuk. Az alkalmazás navigációs célra nem használható.
          </p>
        </div>
      </details>}
    </main>
  );
}
