import assert from "node:assert/strict";
import test from "node:test";
import {
  commercialFlightFromCallsign,
  exactCommercialFromFlightAwarePage,
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

test("French bee BF commercial numbers use the current FBU operator prefix", () => {
  assert.equal(operatorIcaoOverrides.BF, "FBU");
  assert.deepEqual(staticCallsignCandidates("BF704"), ["FBU704", "FBU0704", "BF704"]);
  assert.ok(!staticCallsignCandidates("BF704").some((candidate) => candidate.startsWith("RSR")));
  assert.equal(commercialFlightFromCallsign("FBU704"), "BF704");
  assert.equal(commercialFlightFromCallsign("FBU74E"), null);
  assert.notEqual(commercialFlightFromCallsign("FBU74E"), "BF74E");
  assert.equal(trustedCommercialAlias("704", "BF704"), null);
  const livePage = `<title>BF74E (FBU74E)</title><script>{"iataIdent":"BF704","ident":"FBU704"}</script>`;
  assert.equal(exactCommercialFromFlightAwarePage(livePage, "FBU74E"), "BF704");
  assert.equal(exactCommercialFromFlightAwarePage(livePage, "AAL1028"), null);
});

test("dynamic current operator resolution still takes precedence", () => {
  assert.equal(staticCallsignCandidates("FH8116", "ABC")[0], "ABC8116");
});
