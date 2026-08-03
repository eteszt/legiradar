import assert from "node:assert/strict";
import test from "node:test";
import {
  commercialFlightFromCallsign,
  operatorIcaoOverrides,
  staticCallsignCandidates,
  trustedCommercialAlias,
} from "../app/api/flight/identifiers.ts";

test("Freebird Airlines commercial number resolves to current FHY callsign", () => {
  assert.equal(operatorIcaoOverrides.FH, "FHY");
  assert.deepEqual(staticCallsignCandidates("FH8116"), ["FHY8116", "FH8116"]);
  assert.ok(!staticCallsignCandidates("FH8116").includes("FHI8116"));
  assert.equal(commercialFlightFromCallsign("FHY8116"), "FH8116");
  assert.notEqual(commercialFlightFromCallsign("FHY8116"), "XD8116");
  assert.equal(trustedCommercialAlias("XD8116", "FH8116"), null);
  assert.equal(trustedCommercialAlias("FH8116", "FH8116"), "FH8116");
});

test("dynamic current operator resolution still takes precedence", () => {
  assert.equal(staticCallsignCandidates("FH8116", "ABC")[0], "ABC8116");
});
