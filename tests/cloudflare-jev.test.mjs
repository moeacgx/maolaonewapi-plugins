import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture } from "./cloudflare-jev-cases.mjs";

const bytes = await readFile(
  new URL("../published/cloudflare-jev/0.1.0/plugin.js", import.meta.url),
);
const plugin = await import("data:text/javascript;base64," + bytes.toString("base64"));
for (const entry of fixture.cases) {
  test(entry.name, () => {
    const invoke = () =>
      (entry.member ? plugin[entry.hook][entry.member] : plugin[entry.hook])(
        ...structuredClone(entry.args),
      );
    if (entry.expectedError) {
      assert.throws(invoke, (error) => {
        assert.ok(error.message.includes(entry.expectedError), error.message);
        assert.ok(!error.message.includes("PRIVATE"), "错误不得包含供应商正文");
        return true;
      });
    } else {
      assert.deepEqual(JSON.parse(JSON.stringify(invoke())), entry.expected);
    }
  });
}
