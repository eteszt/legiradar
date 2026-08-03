import assert from "node:assert/strict";
import test from "node:test";
import {
  isExactLiveCandidate,
  mapScheduleItem,
  mapSchedulePageRows,
  mapTargetedAirborneDetail,
  scheduleQueriesFromSearch,
  selectNext24hOccurrence,
  type Fr24ScheduleOccurrence,
} from "../app/api/flight/fr24.ts";

const now = Date.parse("2026-08-03T12:00:00Z");

function occurrence(overrides: Partial<Fr24ScheduleOccurrence> = {}): Fr24ScheduleOccurrence {
  return {
    flight: "DL183",
    callsign: null,
    status: "scheduled",
    departureAt: "2026-08-03T18:00:00Z",
    estimatedDepartureAt: null,
    actualDepartureAt: null,
    arrivalAt: "2026-08-04T01:00:00Z",
    estimatedArrivalAt: null,
    actualArrivalAt: null,
    origin: null,
    destination: null,
    registration: null,
    aircraftType: null,
    hex: null,
    ...overrides,
  };
}

test("exact targeted live candidate rejects prefix and schedule rows", () => {
  const wanted = ["DL183", "DAL183"];
  assert.equal(isExactLiveCandidate({ type: "live", id: "x", detail: { flight: "DL183" } }, wanted), true);
  assert.equal(isExactLiveCandidate({ type: "live", id: "x", detail: { flight: "DL1830" } }, wanted), false);
  assert.equal(isExactLiveCandidate({ type: "schedule", id: "x", detail: { flight: "DL183" } }, wanted), false);
});

test("targeted detail requires fresh, airborne, positioned telemetry", () => {
  const candidate = { detail: { flight: "DL183", callsign: "DAL183" } };
  const base = {
    status: { live: true },
    identification: { number: { default: "DL183" }, callsign: "DAL183" },
    trail: [{ lat: 50, lng: 10, alt: 35000, spd: 470, hd: 90, ts: now / 1000 }],
  };
  assert.equal(mapTargetedAirborneDetail(base, candidate, now)?.callsign, "DAL183");
  assert.equal(mapTargetedAirborneDetail({ ...base, trail: [
    { ...base.trail[0], ts: now / 1000 - 10 * 60, lat: 1 },
    { ...base.trail[0], ts: now / 1000 - 60, lat: 2 },
  ] }, candidate, now)?.lat, 2);
  assert.equal(mapTargetedAirborneDetail({ ...base, trail: [{ ...base.trail[0], ts: now / 1000 - 30 * 60 }] }, candidate, now)?.callsign, "DAL183");
  assert.equal(mapTargetedAirborneDetail({ ...base, trail: [{ ...base.trail[0], ts: now / 1000 - 46 * 60 }] }, candidate, now), null);
  assert.equal(mapTargetedAirborneDetail({ ...base, trail: [{ ...base.trail[0], ts: now / 1000 + 3 * 60 }] }, candidate, now), null);
  assert.equal(mapTargetedAirborneDetail({ ...base, trail: [{ ...base.trail[0], lat: 91 }] }, candidate, now), null);
  assert.equal(mapTargetedAirborneDetail({ ...base, identification: { number: { default: "DL999" }, callsign: "DAL999" } }, candidate, now), null);
  assert.equal(mapTargetedAirborneDetail({ ...base, trail: [{ ...base.trail[0], alt: 100 }] }, candidate, now), null);
  assert.equal(mapTargetedAirborneDetail({ ...base, status: { live: false } }, candidate, now), null);
});

test("schedule mapping retains cancellation from every FR24 status field", () => {
  const mapped = mapScheduleItem({
    identification: { number: { default: "DL183" } },
    time: { scheduled: { departure: now / 1000 + 3600 } },
    status: { generic: { status: { text: "scheduled", type: "departure" } }, text: "Canceled" },
  });
  assert.match(mapped?.status || "", /Canceled/);
  assert.equal(selectNext24hOccurrence(mapped ? [mapped] : [], ["DL183"], now), null);
});

test("schedule ordering uses scheduled departure, not estimated departure", () => {
  const selected = selectNext24hOccurrence([
    occurrence({ departureAt: "2026-08-03T14:00:00Z", estimatedDepartureAt: "2026-08-03T18:00:00Z" }),
    occurrence({ departureAt: "2026-08-03T15:00:00Z", estimatedDepartureAt: "2026-08-03T13:00:00Z" }),
  ], ["DL183"], now);
  assert.equal(selected?.departureAt, "2026-08-03T14:00:00Z");
});

test("schedule selector returns earliest exact non-cancelled occurrence inside 24 hours", () => {
  const selected = selectNext24hOccurrence([
    occurrence({ departureAt: "2026-08-04T13:00:01Z" }),
    occurrence({ departureAt: "2026-08-03T15:00:00Z", status: "cancelled" }),
    occurrence({ flight: "DL1830", departureAt: "2026-08-03T14:00:00Z" }),
    occurrence({ departureAt: "2026-08-03T20:00:00Z" }),
    occurrence({ departureAt: "2026-08-03T17:00:00Z" }),
  ], ["DL183", "DAL183"], now);
  assert.equal(selected?.departureAt, "2026-08-03T17:00:00Z");
});

test("24-hour boundary is inclusive and older occurrences are excluded", () => {
  const selected = selectNext24hOccurrence([
    occurrence({ departureAt: "2026-08-03T11:59:59Z" }),
    occurrence({ departureAt: "2026-08-04T12:00:00Z" }),
  ], ["DL183"], now);
  assert.equal(selected?.departureAt, "2026-08-04T12:00:00Z");
});

test("FR24 search index resolves commercial and ICAO forms to one schedule query", () => {
  const searchPayload = {
    results: [
      { id: "AAL", type: "operator", detail: { iata: "AA" } },
      {
        id: "AA1028",
        type: "schedule",
        detail: { flight: "AA1028", callsign: "AAL1028", operator: "AAL" },
      },
      {
        id: "AA10280",
        type: "schedule",
        detail: { flight: "AA10280", callsign: "AAL10280", operator: "AAL" },
      },
    ],
  };
  assert.deepEqual(scheduleQueriesFromSearch(searchPayload, ["AA1028", "AAL1028"]), ["AA1028"]);
  assert.deepEqual(scheduleQueriesFromSearch(searchPayload, ["AAL1028"]), ["AA1028"]);
});

test("FR24 public flight page maps exact dated schedule rows", () => {
  const html = `
    <table id="tbl-datatable"><tbody>
      <tr class=" data-row" data-timestamp="1785782040">
        <a href="/data/airports/aua">(AUA)</a>
        <a href="/data/airports/mia">(MIA)</a>
        <td data-timestamp="1785793080">21:38</td>
        <span>Estimated</span>
      </tr>
      <tr class="other" data-timestamp="1785780000">
        <a href="/data/airports/dfw">(DFW)</a>
        <a href="/data/airports/lax">(LAX)</a>
      </tr>
    </tbody></table>`;
  const rows = mapSchedulePageRows(html, "AA1028");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].flight, "AA1028");
  assert.equal(rows[0].departureAt, "2026-08-03T18:34:00.000Z");
  assert.equal(rows[0].arrivalAt, "2026-08-03T21:38:00.000Z");
  assert.equal(rows[0].origin?.iata, "AUA");
  assert.equal(rows[0].destination?.iata, "MIA");
  assert.match(rows[0].status, /estimated/i);
});
