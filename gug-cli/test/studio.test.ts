import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-studio-"));
const { sanitizeSvg } = await import("../src/server/studio.ts");

test("SVG sanitizer strips anything active or external", () => {
  const dirty = `Sure! Here you go:
<svg viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(1)</script><script src="x.js"/>
  <foreignObject><iframe src="https://evil.example"></iframe></foreignObject>
  <style>@import url(https://evil.example/a.css); rect{fill:url(https://evil.example/p.svg)} .a{fill:url(#ok)}</style>
  <a href="javascript:alert(1)"><rect width="5" height="5" onclick='steal()' /></a>
  <use xlink:href="#shape"/><use href="https://evil.example/s.svg#x"/>
  <image href="data:image/png;base64,AAAA"/><image href="http://evil.example/t.png"/>
  <!-- <script>hidden</script> -->
</svg> hope you like it`;
  const s = sanitizeSvg(dirty);
  assert.ok(s.startsWith("<svg") && s.endsWith("</svg>"), "prose around the SVG is dropped");
  for (const bad of ["<script", "onload", "onclick", "foreignObject", "iframe", "javascript:", "evil.example", "@import"]) assert.ok(!s.includes(bad), `removed ${bad}`);
  assert.ok(s.includes('xlink:href="#shape"'), "in-document references stay");
  assert.ok(s.includes("data:image/png;base64,AAAA"), "embedded images stay");
  assert.ok(s.includes("url(#ok)"), "local gradients stay");
  assert.ok(s.includes('xmlns="http://www.w3.org/2000/svg"'), "namespace added so it renders as an image");
});

test("a reply without an SVG is a clear error", () => {
  assert.throws(() => sanitizeSvg("I can't draw that."), /didn't return an SVG/);
});
