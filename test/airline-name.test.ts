import assert from "node:assert/strict";
import test from "node:test";
import { withFallbackAirlineName } from "../app/api/flight/airline-name.ts";

const route = {
  origin: { iata: "FRA" },
  destination: { iata: "BKK" },
  airlineName: null,
};

test("ADSBDB airline name fills a live route that has no airline metadata", () => {
  assert.deepEqual(
    withFallbackAirlineName(route, "Condor Flugdienst"),
    { ...route, airlineName: "Condor Flugdienst" },
  );
});

test("existing airline metadata remains authoritative", () => {
  const providerRoute = { ...route, airlineName: "Current Provider Airline" };
  assert.equal(
    withFallbackAirlineName(providerRoute, "Condor Flugdienst"),
    providerRoute,
  );
});

test("missing route or blank fallback remains unchanged", () => {
  assert.equal(withFallbackAirlineName(null, "Condor Flugdienst"), null);
  assert.equal(withFallbackAirlineName(route, "  "), route);
});
