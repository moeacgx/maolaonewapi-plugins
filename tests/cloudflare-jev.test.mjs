import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture } from "./cloudflare-jev-cases.mjs";

const bytes = await readFile(
  new URL("../published/cloudflare-jev/0.2.3/plugin.js", import.meta.url),
);
const plugin = await import(
  "data:text/javascript;base64," + bytes.toString("base64")
);
test("宿主能够按声明接收完整 token 用量事实", () => {
  const usage = { input_tokens: 486, output_tokens: 70 };
  const facts = plugin.extractUsageOnComplete({}, {}, { usage });
  assert.deepEqual(facts, usage);
  for (const key of Object.keys(usage)) {
    assert.equal(plugin.meta.usageSchema[key]?.type, "number");
    assert.equal(plugin.meta.usageSchema[key]?.unit, "token");
  }
});
test("客户端统一入口仍由插件转换为 Cloudflare 私有请求", () => {
  assert.equal(plugin.meta.routes.length, 1);
  const route = plugin.meta.routes[0];
  assert.equal(route.method, "POST");
  assert.equal(route.path, "/v1/systemone");
  const intent = plugin.native[route.decode]({
    body: {
      kind: "json",
      value: {
        model: "typesafe/jev",
        state: null,
        questions: { ok: { type: "noul", instructions: null } },
      },
    },
  });
  const upstream = plugin.buildSubmitRequest({
    model: intent.model,
    requestBody: intent.requestBody,
    baseUrl:
      "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef",
    apiKey: "test-only",
  });
  assert.equal(
    upstream.url,
    "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run",
  );
  assert.deepEqual(upstream.body, {
    model: "typesafe/jev",
    input: {
      state: null,
      questions: { ok: { type: "noul", instructions: null } },
    },
  });
});
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
