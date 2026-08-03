import assert from "node:assert/strict";
import test from "node:test";
import { selectNearestHourlyWeather } from "../app/api/weather/airports/hourly.ts";

const payload = {
  hourly: {
    time: ["2026-08-03T12:00", "2026-08-03T13:00", "2026-08-03T14:00"],
    temperature_2m: [20, 21.2, 22],
    apparent_temperature: [19, 20.4, 21],
  },
};

test("nearest hourly temperature is selected and source remains explicit", () => {
  const selected = selectNearestHourlyWeather(payload, "2026-08-03T13:20:00Z");
  assert.deepEqual(selected, {
    validAt: "2026-08-03T13:00:00.000Z",
    temperatureC: 21.2,
    apparentTemperatureC: 20.4,
    source: "Open-Meteo órás előrejelzés",
  });
});

test("missing and distant hourly values are rejected rather than converted to zero", () => {
  assert.equal(selectNearestHourlyWeather({ hourly: { time: ["2026-08-03T13:00"], temperature_2m: [null] } }, "2026-08-03T13:00:00Z"), null);
  assert.equal(selectNearestHourlyWeather(payload, "2026-08-04T13:00:00Z"), null);
  assert.equal(selectNearestHourlyWeather(payload, "not-a-date"), null);
});
