import assert from "node:assert/strict";
import test from "node:test";
import {
  commercialLiveIdentityQueries,
  isExactLiveCandidate,
  mapAirframeLiveIdentityCandidate,
  mapScheduleItem,
  mapScheduleMarkdownRows,
  mapSchedulePageRows,
  mapTargetedAirborneDetail,
  scheduleQueriesFromSearch,
  selectCurrentAirframeOccurrence,
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

test("exact airframe live identity binds a callsign-less ADS-B record safely", () => {
  const candidate = {
    id: "410690de",
    type: "live",
    detail: { reg: "ZS-FGC", flight: "FA253", callsign: "SFR253" },
  };
  assert.deepEqual(
    mapAirframeLiveIdentityCandidate(candidate, "ZS-FGC", ["FA253"]),
    { flight: "FA253", callsign: "SFR253", registration: "ZS-FGC" },
  );
  assert.equal(mapAirframeLiveIdentityCandidate(candidate, "ZS-OTHER", ["FA253"]), null);
  assert.equal(mapAirframeLiveIdentityCandidate(candidate, "ZS-FGC", ["FA999"]), null);
  assert.equal(mapAirframeLiveIdentityCandidate({ ...candidate, type: "schedule" }, "ZS-FGC", ["FA253"]), null);
});

test("commercial flight numbers enter exact current identity lookup before callsign inference", () => {
  assert.deepEqual(commercialLiveIdentityQueries(" bf-704 "), ["BF704"]);
  assert.deepEqual(commercialLiveIdentityQueries("U21078"), ["U21078"]);
  assert.deepEqual(commercialLiveIdentityQueries("FBU74E"), []);
  assert.deepEqual(commercialLiveIdentityQueries("39B10B"), []);
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

test("current dated occurrence exposes the assigned airframe for live identity reconciliation", () => {
  const selected = selectCurrentAirframeOccurrence([
    occurrence({
      flight: "FR2812",
      registration: "EI-IJP",
      departureAt: "2026-08-03T11:00:00Z",
      actualDepartureAt: "2026-08-03T11:20:00Z",
      arrivalAt: "2026-08-03T15:30:00Z",
      status: "Estimated 15:33",
    }),
    occurrence({
      flight: "FR2812",
      registration: "EI-OLD",
      departureAt: "2026-08-02T11:00:00Z",
      arrivalAt: "2026-08-02T15:30:00Z",
      status: "Landed",
    }),
  ], ["FR2812"], now);
  assert.equal(selected?.registration, "EI-IJP");
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

test("Jina Markdown schedule rows use airport-local time zones for AA1028 and AA128", () => {
  const markdown = `
| FLIGHTS HISTORY |  | DATE | FROM | TO | AIRCRAFT | FLIGHT TIME | STD | ATD | STA |  | STATUS |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N982NN 04 Aug 2026 |  | 04 Aug 2026 | Miami [(MIA)](https://www.flightradar24.com/data/airports/mia) | Oranjestad [(AUA)](https://www.flightradar24.com/data/airports/aua) | B738 [(N982NN)](https://www.flightradar24.com/data/aircraft/n982nn) | — | 10:25 AM | — | 1:34 PM |  | Estimated departure 10:25 AM |  |  |
`;
  const [aa1028] = mapScheduleMarkdownRows(markdown, "AA1028");
  assert.equal(aa1028.departureAt, "2026-08-04T14:25:00.000Z");
  assert.equal(aa1028.arrivalAt, "2026-08-04T17:34:00.000Z");
  assert.equal(aa1028.origin?.icao, "KMIA");
  assert.equal(aa1028.destination?.icao, "TNCA");
  assert.equal(aa1028.registration, "N982NN");

  const aa128Markdown = `
| N821AN 04 Aug 2026 |  | 04 Aug 2026 | Shanghai [(PVG)](https://www.flightradar24.com/data/airports/pvg) | Dallas [(DFW)](https://www.flightradar24.com/data/airports/dfw) | B789 [(N821AN)](https://www.flightradar24.com/data/aircraft/n821an) | — | 5:20 PM | — | 6:20 PM |  | Estimated departure 5:20 PM |  |  |
`;
  const rows = mapScheduleMarkdownRows(aa128Markdown, "AA128");
  assert.equal(rows[0].departureAt, "2026-08-04T09:20:00.000Z");
  assert.equal(rows[0].arrivalAt, "2026-08-04T23:20:00.000Z");
  assert.equal(
    selectNext24hOccurrence(rows, ["AA128", "AAL128"], Date.parse("2026-08-04T06:00:00Z"))?.flight,
    "AA128",
  );
});
