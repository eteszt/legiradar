import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type GeoFeature = {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

type FeatureCollection = {
  features?: GeoFeature[];
};

let weatherCache: { expiresAt: number; payload: unknown } | null = null;

function text(value: unknown) {
  return value == null ? null : String(value);
}

function flightLevel(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "SFC";
  return numeric <= 600 ? `FL${String(Math.round(numeric)).padStart(3, "0")}` : `FL${String(Math.round(numeric / 100)).padStart(3, "0")}`;
}

export async function GET() {
  if (weatherCache && weatherCache.expiresAt > Date.now()) {
    return NextResponse.json(weatherCache.payload);
  }

  try {
    const [internationalResponse, gairmetResponse] = await Promise.all([
      fetch("https://aviationweather.gov/api/data/isigmet?format=geojson", {
        headers: { Accept: "application/geo+json" },
      }),
      fetch("https://aviationweather.gov/api/data/gairmet?format=geojson", {
        headers: { Accept: "application/geo+json" },
      }),
    ]);
    if (!internationalResponse.ok || !gairmetResponse.ok) {
      throw new Error("A repülésmeteorológiai adatforrás nem elérhető.");
    }

    const [international, gairmet] = await Promise.all([
      internationalResponse.json() as Promise<FeatureCollection>,
      gairmetResponse.json() as Promise<FeatureCollection>,
    ]);

    const internationalFeatures = (international.features || [])
      .filter((item) => ["TURB", "MTW"].includes(String(item.properties?.hazard || "")))
      .map((item) => ({
        ...item,
        properties: {
          source: "SIGMET",
          hazard: text(item.properties?.hazard) === "MTW" ? "Hegyi hullám" : "Turbulencia",
          severity: text(item.properties?.qualifier) || "SEV",
          area: text(item.properties?.firName),
          base: flightLevel(item.properties?.base),
          top: flightLevel(item.properties?.top),
          validFrom: text(item.properties?.validTimeFrom),
          validTo: text(item.properties?.validTimeTo),
        },
      }));

    const gairmetFeatures = (gairmet.features || [])
      .filter((item) => String(item.properties?.hazard || "").startsWith("TURB"))
      .map((item) => ({
        ...item,
        properties: {
          source: "G-AIRMET",
          hazard: "Turbulencia",
          severity: text(item.properties?.severity) || "MOD",
          area: text(item.properties?.tag),
          base: flightLevel(item.properties?.base),
          top: flightLevel(item.properties?.top),
          validFrom: text(item.properties?.issueTime),
          validTo: text(item.properties?.validTime),
        },
      }));

    const payload = {
      type: "FeatureCollection",
      features: [...internationalFeatures, ...gairmetFeatures],
      updatedAt: new Date().toISOString(),
      source: "NOAA/NWS Aviation Weather Center",
    };
    weatherCache = { expiresAt: Date.now() + 10 * 60_000, payload };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=600" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "A turbulencia-adatok nem tölthetők be." },
      { status: 502 },
    );
  }
}
