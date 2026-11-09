const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

for (const entrypoint of ["index.js", "index_no_ai.js"]) {
  test(`${entrypoint} registers the Discord clientReady event`, () => {
    const source = readFileSync(path.join(root, entrypoint), "utf8");

    assert.match(source, /client\.once\(["']clientReady["']\s*,\s*async\s*\(/);
    assert.doesNotMatch(source, /client\.once\(["']ready["']/);
  });
}
