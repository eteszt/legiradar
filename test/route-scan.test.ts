import assert from "node:assert/strict";
import test from "node:test";
import {
  operatorPrefixesForCommercialFlight,
  rankRouteAircraft,
  routeSamplePoints,
  routesMatch,
} from "../app/api/flight/route-scan.ts";

test("U2 commercial flights search every current easyJet operating prefix", () => {
  assert.deepEqual(
    operatorPrefixesForCommercialFlight("U21078", "EZY"),
    ["EZY", "EZS", "EJU"],
  );
});

test("route scan ranks the airborne EZS operational callsign before unrelated easyJet aircraft", () => {
  const origin = { lat: 41.500599, lon: 9.09778 };
  const destination = { lat: 47.59, lon: 7.529167 };
  const ranked = rankRouteAircraft([
    { hex: "4b1a1a", flight: "EZS792D ", lat: 44.07, lon: 7.02, alt_baro: 34025, gs: 412 },
    { hex: "440083", flight: "EJU173G ", lat: 43.94, lon: 6.48, alt_baro: 28000, gs: 379 },
    { hex: "dead01", flight: "AFR123 ", lat: 44.2, lon: 7.5, alt_baro: 33000, gs: 420 },
    { hex: "dead02", flight: "EZY000 ", lat: 44.2, lon: 7.5, alt_baro: "ground", gs: 0 },
  ], origin, destination, ["EZY", "EZS", "EJU"]);

  assert.equal(ranked[0]?.callsign, "EZS792D");
  assert.ok(!ranked.some((candidate) => candidate.callsign === "AFR123"));
  assert.ok(!ranked.some((candidate) => candidate.callsign === "EZY000"));
});

test("route scan samples the interior of the planned route", () => {
  assert.deepEqual(routeSamplePoints(
    { lat: 40, lon: 10 },
    { lat: 48, lon: 6 },
  ), [
    { lat: 42, lon: 9 },
    { lat: 44, lon: 8 },
    { lat: 46, lon: 7 },
  ]);
});

test("route match requires the same origin and destination", () => {
  const expected = {
    origin: { iata: "FSC", icao: "LFKF" },
    destination: { iata: "BSL", icao: "LFSB" },
  };
  assert.equal(routesMatch(expected, {
    origin: { iata: "FSC" },
    destination: { icao: "LFSB" },
  }), true);
  assert.equal(routesMatch(expected, {
    origin: { iata: "NCE" },
    destination: { iata: "BSL" },
  }), false);
});
