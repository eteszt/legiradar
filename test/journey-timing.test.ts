import assert from "node:assert/strict";
import test from "node:test";
import {
  geographicArrivalFromActualDeparture,
  plausibleFlightDurationMinutes,
  reconciledArrivalTime,
} from "../app/api/flight/journey-timing.ts";

test("rejects a provider duration that is physically impossible for the route", () => {
  assert.equal(plausibleFlightDurationMinutes(120, 8_656), null);
  assert.equal(plausibleFlightDurationMinutes(630, 8_656), 630);
});

test("position conflict with impossible schedule falls back to distance-based arrival", () => {
  const now = Date.parse("2026-08-05T17:52:00Z");
  const arrival = reconciledArrivalTime(
    now,
    Date.parse("2026-08-05T11:00:00Z"),
    Date.parse("2026-08-05T13:00:00Z"),
    true,
    null,
    221,
  );
  assert.equal(arrival?.toISOString(), "2026-08-05T21:33:00.000Z");
});

test("consistent provider arrival remains authoritative", () => {
  const providerArrival = Date.parse("2026-08-05T22:15:00Z");
  const arrival = reconciledArrivalTime(
    Date.parse("2026-08-05T17:52:00Z"),
    Date.parse("2026-08-05T11:00:00Z"),
    providerArrival,
    false,
    675,
    221,
  );
  assert.equal(arrival?.getTime(), providerArrival);
});

test("geographic arrival from actual departure with known total distance", () => {
  // 800 km at 800 km/h = 60 min flight
  const actualDeparture = Date.parse("2026-08-06T14:00:00Z");
  const arrival = geographicArrivalFromActualDeparture(actualDeparture, 800, 800);
  assert.equal(arrival?.toISOString(), "2026-08-06T15:00:00.000Z");
});

test("geographic arrival from actual departure with slower speed gives later arrival", () => {
  // 800 km at 400 km/h = 120 min flight
  const actualDeparture = Date.parse("2026-08-06T14:00:00Z");
  const arrival = geographicArrivalFromActualDeparture(actualDeparture, 800, 400);
  assert.equal(arrival?.toISOString(), "2026-08-06T16:00:00.000Z");
});

test("geographic arrival returns null for zero distance", () => {
  const actualDeparture = Date.parse("2026-08-06T14:00:00Z");
  assert.equal(geographicArrivalFromActualDeparture(actualDeparture, 0, 800), null);
});

test("geographic arrival returns null for invalid speed", () => {
  const actualDeparture = Date.parse("2026-08-06T14:00:00Z");
  assert.equal(geographicArrivalFromActualDeparture(actualDeparture, 800, 0), null);
});

test("geographic arrival from actual departure handles long-haul flight", () => {
  // Budapest–New York ~6800 km at 850 km/h ≈ 480 min = 8h
  const actualDeparture = Date.parse("2026-08-06T12:00:00Z");
  const arrival = geographicArrivalFromActualDeparture(actualDeparture, 6800, 850);
  assert.equal(arrival?.toISOString(), "2026-08-06T20:00:00.000Z");
});
