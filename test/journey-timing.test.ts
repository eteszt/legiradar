import assert from "node:assert/strict";
import test from "node:test";
import {
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
