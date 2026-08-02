"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoGraticule10, geoMercator, geoPath } from "d3-geo";
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
  demo?: boolean;
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

const demoData: Telemetry = {
  flight: "W62375",
  callsign: "WZZ2375",
  hex: "471F63",
  lat: 45.7821,
  lon: 12.4386,
  altitudeM: 10668,
  geometricAltitudeM: 10805,
  groundSpeedKmh: 842,
  trueAirspeedKmh: 861,
  indicatedAirspeedKmh: 472,
  trackDeg: 247,
  magneticHeadingDeg: 244,
  trueHeadingDeg: 247,
  verticalRateMs: 1.2,
  geometricRateMs: 1.1,
  mach: 0.79,
  rollDeg: -0.7,
  navQnhHpa: 1013.2,
  selectedAltitudeM: 10973,
  navHeadingDeg: 247,
  windSpeedKmh: 74,
  windDirectionDeg: 302,
  outsideAirTempC: -51,
  totalAirTempC: -24,
  squawk: 5632,
  category: 3,
  messages: 28416,
  rssiDbfs: -18.4,
  seenSeconds: 0.4,
  positionAgeSeconds: 0.7,
  distanceFromReceiverKm: 412,
  bearingFromReceiverDeg: 261,
  signalIntegrity: 8,
  containmentRadiusM: 186,
  emergency: "nincs",
  onGround: false,
  source: "Szimulált bemutatóadat",
  updatedAt: new Date().toISOString(),
  journey: {
    origin: {
      iata: "BUD",
      icao: "LHBP",
      name: "Liszt Ferenc Nemzetközi Repülőtér",
      city: "Budapest",
      country: "Magyarország",
      lat: 47.439,
      lon: 19.261,
    },
    destination: {
      iata: "BCN",
      icao: "LEBL",
      name: "Josep Tarradellas Barcelona–El Prat",
      city: "Barcelona",
      country: "Spanyolország",
      lat: 41.297,
      lon: 2.083,
    },
    airlineName: "Wizz Air",
    flownKm: 572,
    remainingKm: 742,
    totalKm: 1314,
    progressPercent: 44,
    elapsedMinutes: 58,
    remainingMinutes: 53,
    estimatedDepartureAt: null,
    estimatedArrivalAt: null,
    timingType: "Szimulált bemutatóadat",
  },
  demo: true,
};

const budapest: [number, number] = [47.439, 19.261];
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
    incident: "ESEMÉNY", diverted: "ÁTIRÁNYÍTVA", landed: "LESZÁLLT",
  };
  return labels[status.toLowerCase()] || status.toUpperCase();
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

function RadarMap({
  telemetry,
  trail,
}: {
  telemetry: Telemetry;
  trail: [number, number][];
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [weatherEnabled, setWeatherEnabled] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [turbulence, setTurbulence] = useState<TurbulenceFeature[]>([]);
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState<string | null>(null);
  const displayedTrack =
    telemetry.trackDeg ?? telemetry.trueHeadingDeg ?? telemetry.magneticHeadingDeg ?? 0;
  const dimensions = { width: 1100, height: 740 };
  const journey = telemetry.journey;
  const routeCoordinates = journey
    ? [
        [journey.origin.lon, journey.origin.lat],
        [telemetry.lon, telemetry.lat],
        [journey.destination.lon, journey.destination.lat],
      ]
    : null;
  const center: [number, number] = [telemetry.lon, telemetry.lat];
  const projection = geoMercator();
  if (routeCoordinates) {
    projection.fitExtent(
      [[100, 90], [1000, 650]],
      { type: "LineString", coordinates: routeCoordinates } as never,
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
  const points = trail.map(([lat, lon]) => projection([lon, lat])).filter(Boolean) as [number, number][];
  const current = projection([telemetry.lon, telemetry.lat]) ?? [dimensions.width / 2, dimensions.height / 2];
  const originPoint = journey ? projection([journey.origin.lon, journey.origin.lat]) : null;
  const destinationPoint = journey ? projection([journey.destination.lon, journey.destination.lat]) : null;
  const pastPoints = originPoint ? [originPoint, ...points, current] : [...points, current];
  const pastRoute = pastPoints.map((point, index) => `${index === 0 ? "M" : "L"}${point[0]},${point[1]}`).join(" ");
  const futureRoute = destinationPoint ? `M${current[0]},${current[1]} L${destinationPoint[0]},${destinationPoint[1]}` : "";
  const mapTransform = `translate(${pan.x} ${pan.y}) translate(${current[0]} ${current[1]}) scale(${zoom}) translate(${-current[0]} ${-current[1]})`;

  function changeZoom(factor: number) {
    setZoom((value) => Math.min(10, Math.max(.2, value * factor)));
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

  useEffect(() => {
    if (!weatherEnabled) return;
    const initialTimer = window.setTimeout(() => void loadWeather(), 0);
    const timer = window.setInterval(() => void loadWeather(), 10 * 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadWeather, weatherEnabled]);

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
        {weatherEnabled && turbulence.map((area, index) => (
          <path
            className={`turbulence-area ${weatherClass(area)}`}
            d={path(weatherFeatureForD3(area) as never) ?? ""}
            key={`${area.properties.source}-${area.properties.area}-${index}`}
          >
            <title>{`${area.properties.hazard} · ${area.properties.severity} · ${area.properties.base}–${area.properties.top}${area.properties.area ? ` · ${area.properties.area}` : ""}`}</title>
          </path>
        ))}
        {pastRoute && <path className="flight-route" d={pastRoute} filter="url(#routeGlow)" />}
        {futureRoute && <path className="flight-route future" d={futureRoute} />}
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
          <circle r="41" />
          <circle r="25" />
          <g className="plane-icon" transform={`rotate(${displayedTrack})`}>
            <path d="M0-21 5-7 19 2 19 7 5 3 4 15 10 20 10 24 0 20-10 24-10 20-4 15-5 3-19 7-19 2-5-7Z" />
          </g>
          <title>{`Haladási irány: ${fmt(displayedTrack)}°`}</title>
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
    </div>
  );
}

async function directFlightLookup(flight: string, candidates: string[]): Promise<Telemetry> {
  const uniqueCandidates = Array.from(new Set([flight, ...candidates].filter(Boolean)));
  const results = await Promise.all(
    uniqueCandidates.map(async (callsign) => {
      try {
        const response = await fetch(
          `https://api.airplanes.live/v2/callsign/${encodeURIComponent(callsign)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return null;
        const payload = (await response.json()) as { ac?: Array<Record<string, unknown>> };
        const aircraft = payload.ac?.find(
          (item) => typeof item.lat === "number" && typeof item.lon === "number",
        );
        return aircraft ? { aircraft, callsign } : null;
      } catch {
        return null;
      }
    }),
  );
  const found = results.find(Boolean);
  if (!found) throw new Error("A repülőgép most nem látható az élő ADS-B hálózaton.");

  const liveCallsign = String(found.aircraft.flight || found.callsign).trim().toUpperCase();
  let flightroute: Record<string, unknown> | null = null;
  for (const routeCallsign of Array.from(new Set([liveCallsign, flight, ...uniqueCandidates]))) {
    try {
      const response = await fetch(
        `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(routeCallsign)}`,
        { cache: "no-store" },
      );
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        response?: { flightroute?: Record<string, unknown> };
      };
      if (payload.response?.flightroute) {
        flightroute = payload.response.flightroute;
        break;
      }
    } catch {
      // Az élő pozíció útvonaladat nélkül is használható.
    }
  }

  const normalized = await fetch("/api/flight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      flight,
      aircraft: found.aircraft,
      flightroute,
    }),
  });
  const payload = (await normalized.json()) as { data?: Telemetry; error?: string };
  if (!normalized.ok || !payload.data) {
    throw new Error(payload.error || "Az élő adat nem dolgozható fel.");
  }
  return payload.data;
}

export default function Home() {
  const [query, setQuery] = useState("W62375");
  const [telemetry, setTelemetry] = useState<Telemetry>(demoData);
  const [scheduled, setScheduled] = useState<ScheduledFlight | null>(null);
  const [trail, setTrail] = useState<[number, number][]>([
    budapest,
    [46.91, 17.82],
    [46.51, 15.81],
    [45.96, 13.7],
    [45.7821, 12.4386],
  ]);
  const [status, setStatus] = useState<"demo" | "loading" | "live" | "scheduled" | "active-no-signal" | "error">("demo");
  const [message, setMessage] = useState("Bemutatóadatok – indíts élő keresést");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [altitudeHistory, setAltitudeHistory] = useState<AltitudeSample[]>([]);
  const activeQuery = useRef<string | null>(null);

  const loadFlight = useCallback(async (flight: string, silent = false) => {
    const normalized = flight.trim().toUpperCase().replace(/\s+/g, "");
    if (!normalized) return;
    if (!silent) {
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
        searchedCallsigns?: string[];
      };
      const next =
        response.ok && payload.data
          ? payload.data
          : await directFlightLookup(normalized, payload.searchedCallsigns || [normalized]);
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
              ? "A járat aktív, de jelenleg nincs elérhető élő pozíciójel"
              : "A repülőgép még nem szállt fel · Aviationstack menetrendi adat",
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

  function submit(event: FormEvent) {
    event.preventDefault();
    setTrail([]);
    setAltitudeHistory([]);
    void loadFlight(query);
  }

  function restoreDemo() {
    activeQuery.current = null;
    setTelemetry({ ...demoData, updatedAt: new Date().toISOString() });
    setScheduled(null);
    setTrail([budapest, [46.91, 17.82], [46.51, 15.81], [45.96, 13.7], [45.7821, 12.4386]]);
    setAltitudeHistory([{ at: Date.now(), altitudeM: demoData.altitudeM || 0 }]);
    setStatus("demo");
    setMessage("Bemutatóadatok – a működés szemléltetésére");
    setLastSync(new Date());
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (activeQuery.current) void loadFlight(activeQuery.current, true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadFlight]);

  const secondaryMetrics = useMemo(
    () => [
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
    ],
    [telemetry],
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Légiradar">
          <span className="radar-logo"><i /></span>
          <span>LÉGIRADAR</span>
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
          {status === "live" ? "ÉLŐ" : status === "active-no-signal" ? "AKTÍV · NINCS JEL" : status === "scheduled" ? "MENETREND" : status === "loading" ? "KAPCSOLÓDÁS" : status === "error" ? "NINCS JEL" : "DEMO"}
        </div>
      </header>

      <section className="workspace">
        <div className="map-panel">
          {scheduled ? (
            <div className="scheduled-map">
              <div className="scheduled-plane">✈</div>
              <span>{status === "active-no-signal" ? "AKTÍV, DE NINCS ÉLŐ JEL" : "MÉG NEM SZÁLLT FEL"}</span>
              <strong>{scheduled.origin.iata || scheduled.origin.icao || "—"} → {scheduled.destination.iata || scheduled.destination.icao || "—"}</strong>
              <p>{scheduled.origin.airport || "Indulási repülőtér"} → {scheduled.destination.airport || "Célrepülőtér"}</p>
            </div>
          ) : (
            <RadarMap telemetry={telemetry} trail={trail} />
          )}
          <div className="scanline" aria-hidden="true" />
          <div className="map-status">
            <span className="clock">◷</span>
            Utolsó frissítés: <strong>{lastSync ? lastSync.toLocaleTimeString("hu-HU", { timeZone: BUDAPEST_TIME_ZONE }) : "--:--:--"}</strong>
          </div>
          <div className="data-source">{message}</div>
        </div>

        <aside className="flight-panel">
          {scheduled ? (
            <>
              <div className="flight-summary">
                <div className="eyebrow">{status === "active-no-signal" ? "AKTÍV JÁRAT · ÉLŐ JEL NÉLKÜL" : "KÖVETKEZŐ INDULÁS"}</div>
                <h1>{scheduled.flight}</h1>
                <div className="route-heading">
                  <strong>{scheduled.origin.iata || scheduled.origin.icao || "—"}</strong>
                  <span>→</span>
                  <strong>{scheduled.destination.iata || scheduled.destination.icao || "—"}</strong>
                </div>
                <div className="route-cities">{scheduled.origin.airport || "—"} → {scheduled.destination.airport || "—"}</div>
                <div className="callsign">{scheduled.airlineName || "Légitársaság nem ismert"} · {scheduled.callsign}</div>
                <div className="phase">{statusLabel(scheduled.status)}</div>
              </div>
              <div className="departure-card">
                <span>{status === "active-no-signal" ? "INDULÁSI IDŐ" : "VÁRHATÓ INDULÁS"}</span>
                <strong>{budapestDateTime(scheduled.estimatedDepartureAt)}</strong>
                <small>Budapesti idő (Europe/Budapest)</small>
                {scheduled.delayMinutes != null && scheduled.delayMinutes > 0 && (
                  <b>{fmt(scheduled.delayMinutes)} perc várható késés</b>
                )}
              </div>
              <div className="schedule-grid">
                <div><span>MENETREND SZERINT · BUDAPEST</span><strong>{budapestDateTime(scheduled.scheduledDepartureAt)}</strong></div>
                <div><span>VÁRHATÓ ÉRKEZÉS · BUDAPEST</span><strong>{budapestDateTime(scheduled.estimatedArrivalAt)}</strong></div>
                <div><span>TERMINÁL</span><strong>{scheduled.origin.terminal || "—"}</strong></div>
                <div><span>KAPU</span><strong>{scheduled.origin.gate || "—"}</strong></div>
              </div>
              <p className="schedule-note">
                {status === "active-no-signal"
                  ? "A menetrendi adat szerint a járat már úton van, de jelenleg egyik helyzetforrás sem ad élő koordinátát. A rendszer 15 másodpercenként újrapróbálja, és jel érkezésekor automatikusan térképes követésre vált."
                  : "A gép jelenleg nem sugároz élő pozíciót. Felszállás után egy új kereséskor a nézet automatikusan átvált a térképes követésre."}
              </p>
            </>
          ) : (
          <>
          <div className="flight-summary">
            <div className="eyebrow">AKTUÁLIS JÁRAT</div>
            <h1>{telemetry.flight}</h1>
            <div className="route-heading">
              <strong>{telemetry.journey?.origin.iata || telemetry.journey?.origin.icao || "—"}</strong>
              <span>→</span>
              <strong>{telemetry.journey?.destination.iata || telemetry.journey?.destination.icao || "—"}</strong>
            </div>
            <div className="route-cities">
              {telemetry.journey
                ? `${telemetry.journey.origin.city} → ${telemetry.journey.destination.city}`
                : "Ehhez a járathoz nincs nyilvános útvonaladat"}
            </div>
            <div className="callsign">{telemetry.callsign} · ICAO24 {telemetry.hex}</div>
            <div className="phase">
              {telemetry.onGround ? "FÖLDÖN" : telemetry.verticalRateMs != null && telemetry.verticalRateMs > 1 ? "EMELKEDIK" : telemetry.verticalRateMs != null && telemetry.verticalRateMs < -1 ? "SÜLLYED" : "ÚTON"}
              <b>•</b> {!telemetry.emergency || ["nincs", "none"].includes(telemetry.emergency.toLowerCase()) ? "RENDBEN" : telemetry.emergency.toUpperCase()}
            </div>
          </div>

          <div className="journey-panel">
            <div className="journey-times">
              <div>
                <span>INDULÁS · BUDAPEST <em>becsült</em></span>
                <strong>{clockTime(telemetry.journey?.estimatedDepartureAt, telemetry.journey?.elapsedMinutes ?? null, lastSync, -1)}</strong>
              </div>
              <div>
                <span>REPÜLÉSI IDŐ EDDIG <em>becsült</em></span>
                <strong>{duration(telemetry.journey?.elapsedMinutes)}</strong>
              </div>
              <div>
                <span>ÉRKEZÉS · BUDAPEST <em>becsült</em></span>
                <strong>{clockTime(telemetry.journey?.estimatedArrivalAt, telemetry.journey?.remainingMinutes ?? null, lastSync, 1)}</strong>
              </div>
              <div>
                <span>HÁTRALÉVŐ IDŐ <em>becsült</em></span>
                <strong>{duration(telemetry.journey?.remainingMinutes)}</strong>
              </div>
            </div>
            <div className="route-progress">
              <div className="progress-labels">
                <span>{telemetry.journey ? `${fmt(telemetry.journey.flownKm)} km megtéve` : "Nincs útvonaladat"}</span>
                <b>{telemetry.journey?.progressPercent == null ? "—" : `${telemetry.journey.progressPercent}%`}</b>
                <span>{telemetry.journey ? `${fmt(telemetry.journey.remainingKm)} km hátra` : ""}</span>
              </div>
              <div className="progress-track">
                <i style={{ width: `${telemetry.journey?.progressPercent ?? 0}%` }} />
                <b style={{ left: `${telemetry.journey?.progressPercent ?? 0}%` }}>✈</b>
              </div>
            </div>
          </div>

          <div className="primary-grid">
            {metric("MAGASSÁG", fmt(telemetry.altitudeM), "m")}
            {metric("SEBESSÉG", fmt(telemetry.groundSpeedKmh), "km/h")}
            {metric("IRÁNY", compass(telemetry.trackDeg))}
            {metric("EMELKEDÉS", fmt(telemetry.verticalRateMs, 1), "m/s", (telemetry.verticalRateMs ?? 0) > 0)}
            {metric("SZÉLESSÉG", fmt(Math.abs(telemetry.lat), 4), telemetry.lat >= 0 ? "° N" : "° S")}
            {metric("HOSSZÚSÁG", fmt(Math.abs(telemetry.lon), 4), telemetry.lon >= 0 ? "° E" : "° W")}
          </div>

          <div className="signal-row">
            <div><span>ADATFORRÁS</span><strong>{telemetry.source}</strong></div>
            <div><span>FRISSÍTÉS</span><strong>15 mp</strong></div>
          </div>

          <AltitudeChart samples={altitudeHistory} currentAltitude={telemetry.altitudeM} />
          </>
          )}
        </aside>
      </section>

      {!scheduled && <section className="details">
        <div className="details-title">
          <div>
            <span className="eyebrow">TELJES TELEMETRIA</span>
            <h2>Minden elérhető számszerű adat</h2>
          </div>
          {status === "error" && <button className="ghost-button" onClick={restoreDemo}>Bemutató mód</button>}
        </div>
        <div className="details-grid">
          {secondaryMetrics.map(([label, value, unit]) => metric(label, value, unit))}
        </div>
        <p className="note">
          A helyzet- és telemetriai adatok közösségi ADS-B vevőállomásokból, az útvonaladatok nyilvános járatadatbázisból származnak. A turbulenciaréteg a NOAA/NWS Aviation Weather Center aktuális SIGMET és G-AIRMET veszélyjelzéseit mutatja; nem jelenti azt, hogy a teljes megjelölt területen biztosan turbulencia tapasztalható. Ha a gép még nem látható élőben, a következő várható indulást az Aviationstack menetrendi adatai alapján mutatjuk. Az alkalmazás navigációs célra nem használható.
        </p>
      </section>}
    </main>
  );
}
