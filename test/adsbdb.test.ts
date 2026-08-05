import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdsbdbClient,
  parseAdsbdbCallsignPayload,
} from "../app/api/flight/adsbdb.ts";

const payload = {
  response: {
    flightroute: {
      callsign: "SIA479",
      callsign_icao: "SIA479",
      callsign_iata: "SQ479",
      airline: { name: "Singapore Airlines" },
      origin: { iata_code: "JNB", icao_code: "FAOR", latitude: -26.1392, longitude: 28.246 },
      destination: { iata_code: "SIN", icao_code: "WSSS", latitude: 1.35019, longitude: 103.994003 },
    },
  },
};

test("ADSBDB accepts either exact IATA flight number or ICAO callsign", () => {
  assert.deepEqual(
    parseAdsbdbCallsignPayload(payload, "sq-479"),
    {
      record: payload.response.flightroute,
      callsignIcao: "SIA479",
      callsignIata: "SQ479",
      matchedInput: "SQ479",
    },
  );
  assert.equal(parseAdsbdbCallsignPayload(payload, "SIA479")?.callsignIata, "SQ479");
});

test("ADSBDB rejects a response that does not contain the exact requested identity", () => {
  assert.equal(parseAdsbdbCallsignPayload(payload, "SIA478"), null);
  assert.equal(parseAdsbdbCallsignPayload({ response: { flightroute: {} } }, "SIA479"), null);
});

test("successful ADSBDB results are cached", async () => {
  let calls = 0;
  let now = 1_000;
  const client = createAdsbdbClient({
    now: () => now,
    successTtlMs: 5_000,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  assert.equal((await client("SQ479"))?.cacheHit, false);
  assert.equal((await client("SQ479"))?.cacheHit, true);
  assert.equal(calls, 1);
  now += 5_001;
  assert.equal((await client("SQ479"))?.cacheHit, false);
  assert.equal(calls, 2);
});

test("unknown ADSBDB identities receive a short negative cache", async () => {
  let calls = 0;
  const client = createAdsbdbClient({
    fetchImpl: async () => {
      calls += 1;
      return new Response('{"response":"unknown callsign"}', { status: 404 });
    },
  });
  assert.equal(await client("ZZZ999"), null);
  assert.equal(await client("ZZZ999"), null);
  assert.equal(calls, 1);
});

test("provider failures are not cached and remain available to fallback logic", async () => {
  let calls = 0;
  const client = createAdsbdbClient({
    fetchImpl: async () => {
      calls += 1;
      return new Response("rate limited", { status: 429 });
    },
  });
  await assert.rejects(() => client("SQ479"), /ADSBDB HTTP 429/);
  await assert.rejects(() => client("SQ479"), /ADSBDB HTTP 429/);
  assert.equal(calls, 2);
});
