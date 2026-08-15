import assert from "node:assert/strict";
import test from "node:test";
import { statusLabel } from "../app/status-label.ts";

test("provider estimated departure status is localized and does not leak raw English copy", () => {
  assert.equal(statusLabel("Estimated departure 1:20 PM"), "VÁRHATÓ INDULÁS");
  assert.equal(statusLabel("Estimated departure 6:45 AM"), "VÁRHATÓ INDULÁS");
});

test("known schedule states keep compact Hungarian labels", () => {
  assert.equal(statusLabel("scheduled"), "INDULÁSRA VÁR");
  assert.equal(statusLabel("active"), "AKTÍV");
  assert.equal(statusLabel("cancelled"), "TÖRÖLVE");
});
