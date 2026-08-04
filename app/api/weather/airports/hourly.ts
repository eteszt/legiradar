export type HourlyWeatherPoint = {
  validAt: string;
  temperatureC: number;
  apparentTemperatureC: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
  source: "Open-Meteo órás előrejelzés";
};

type OpenMeteoPayload = {
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    apparent_temperature?: Array<number | null>;
    precipitation?: Array<number | null>;
    precipitation_probability?: Array<number | null>;
  };
};

export function selectNearestHourlyWeather(
  payload: OpenMeteoPayload,
  targetAt: string,
  maxDistanceMinutes = 90,
): HourlyWeatherPoint | null {
  const targetMs = Date.parse(targetAt);
  if (!Number.isFinite(targetMs)) return null;
  const times = payload.hourly?.time || [];
  const temperatures = payload.hourly?.temperature_2m || [];
  const apparent = payload.hourly?.apparent_temperature || [];
  let best: { index: number; distance: number; timeMs: number } | null = null;
  for (let index = 0; index < times.length; index += 1) {
    const rawTime = times[index];
    // timezone=UTC mellett az Open-Meteo offset nélküli órasztringet ad. A
    // JavaScript ezt külön jelölés nélkül a szerver/böngésző helyi idejének venné.
    const utcTime = /(?:Z|[+-]\d{2}:\d{2})$/.test(rawTime) ? rawTime : `${rawTime}Z`;
    const timeMs = Date.parse(utcTime);
    const temperature = temperatures[index];
    if (!Number.isFinite(timeMs) || typeof temperature !== "number" || !Number.isFinite(temperature)) continue;
    const distance = Math.abs(timeMs - targetMs);
    if (!best || distance < best.distance) best = { index, distance, timeMs };
  }
  if (!best || best.distance > maxDistanceMinutes * 60_000) return null;
  const apparentValue = apparent[best.index];
  const precipitationValue = payload.hourly?.precipitation?.[best.index];
  const precipitationProbabilityValue = payload.hourly?.precipitation_probability?.[best.index];
  return {
    validAt: new Date(best.timeMs).toISOString(),
    temperatureC: temperatures[best.index] as number,
    apparentTemperatureC: typeof apparentValue === "number" && Number.isFinite(apparentValue) ? apparentValue : null,
    precipitationMm: typeof precipitationValue === "number" && Number.isFinite(precipitationValue) ? precipitationValue : null,
    precipitationProbabilityPct: typeof precipitationProbabilityValue === "number" && Number.isFinite(precipitationProbabilityValue) ? precipitationProbabilityValue : null,
    source: "Open-Meteo órás előrejelzés",
  };
}

export async function fetchHourlyWeather(
  latitude: number,
  longitude: number,
  targetAt: string,
): Promise<HourlyWeatherPoint | null> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: "temperature_2m,apparent_temperature,precipitation,precipitation_probability",
    timezone: "UTC",
    forecast_days: "3",
    past_days: "1",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    headers: { "User-Agent": "legiradar/1.0 target-airport-temperature" },
    next: { revalidate: 900 },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Open-Meteo szolgáltatás: HTTP ${response.status}`);
  return selectNearestHourlyWeather(await response.json() as OpenMeteoPayload, targetAt);
}
