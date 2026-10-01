#!/usr/bin/env node
// Runs the built CLI; in a source checkout without a build, falls back to tsx.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const built = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
let mod;
if (existsSync(built)) {
  mod = await import(built);
} else {
  const { register } = await import("tsx/esm/api");
  register();
  mod = await import("../src/cli.ts");
}
const code = await mod.main();
if (typeof code === "number") process.exitCode = code;
