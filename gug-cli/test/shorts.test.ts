import assert from "node:assert/strict";
import { test } from "node:test";
import { toLines } from "../web/src/captions.ts";

test("scripts become short caption lines at sentence breaks", () => {
  const lines = toLines("Your desk, but cinematic. One bar of red light that turns any setup into a scene! Touch to dim.");
  assert.deepEqual(lines, ["Your desk, but cinematic.", "One bar of red light that", "turns any setup into a scene!", "Touch to dim."]);
  assert.ok(toLines("word ".repeat(400)).length <= 30);
});
