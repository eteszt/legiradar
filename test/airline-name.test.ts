import assert from "node:assert/strict";
import test from "node:test";
import { withFallbackAirline } from "../app/api/flight/airline-name.ts";

const route = {
  origin: { iata: "FRA" },
  destination: { iata: "BKK" },
  airlineName: null,
};
const condorRoute = {
  ...route,
  airlineName: "Condor Flugdienst",
  airline: {
    name: "Condor Flugdienst",
    iata: "DE",
    icao: "CFG",
    radioCallsign: "CONDOR",
    country: "Germany",
    countryIso: "DE",
  },
};

test("ADSBDB airline identity fills an otherwise anonymous live route", () => {
  assert.deepEqual(
    withFallbackAirline(route, condorRoute),
    { ...route, airlineName: "Condor Flugdienst", airline: condorRoute.airline },
  );
});

test("matching provider name can be enriched with ADSBDB airline identity", () => {
  const providerRoute = { ...route, airlineName: "condor flugdienst" };
  assert.deepEqual(
    withFallbackAirline(providerRoute, condorRoute),
    { ...providerRoute, airline: condorRoute.airline },
  );
});

test("different provider airline remains authoritative and is not mixed with ADSBDB metadata", () => {
  const providerRoute = { ...route, airlineName: "Current Provider Airline" };
  assert.equal(withFallbackAirline(providerRoute, condorRoute), providerRoute);
});

test("missing route or fallback remains unchanged", () => {
  assert.equal(withFallbackAirline(null, condorRoute), null);
  assert.equal(withFallbackAirline(route, null), route);
});
