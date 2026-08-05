import assert from "node:assert/strict";
import test from "node:test";
import {
  isFlightLevelInHazardLayer,
  isRelevantFlightLevelTurbulence,
} from "../app/weather-relevance.ts";

function impact(hazard: string, altitudeRelevant: boolean, temporallyRelevant: boolean) {
  return {
    altitudeRelevant,
    temporallyRelevant,
    feature: { properties: { hazard } },
  };
}

test("flight level must be known and inside the advisory layer", () => {
  assert.equal(isFlightLevelInHazardLayer(null, 240, 390), false);
  assert.equal(isFlightLevelInHazardLayer(230, 240, 390), false);
  assert.equal(isFlightLevelInHazardLayer(400, 240, 390), false);
  assert.equal(isFlightLevelInHazardLayer(240, 240, 390), true);
  assert.equal(isFlightLevelInHazardLayer(370, 240, 390), true);
  assert.equal(isFlightLevelInHazardLayer(390, 240, 390), true);
});

test("only current flight-level turbulence receives detailed treatment", () => {
  assert.equal(isRelevantFlightLevelTurbulence(impact("Turbulencia", true, true)), true);
  assert.equal(isRelevantFlightLevelTurbulence(impact("Turbulencia", false, true)), false);
  assert.equal(isRelevantFlightLevelTurbulence(impact("Turbulencia", true, false)), false);
  assert.equal(isRelevantFlightLevelTurbulence(impact("Hegyi hullám", true, true)), false);
});
