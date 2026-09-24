// 在指定宿主的 Go 测试中叠加插件契约用例，不改写宿主工作区。
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fixture } from "../tests/cloudflare-jev-cases.mjs";
import { performanceFixture } from "../tests/cloudflare-jev-performance-cases.mjs";

if (process.argv.length !== 3)
  throw new Error(
    "用法：node scripts/verify-cloudflare-host.mjs <NewAPI宿主源码目录>",
  );
const host = path.resolve(process.argv[2]);
if (
  !(await readFile(path.join(host, "go.mod"), "utf8")).startsWith(
    "module github.com/QuantumNous/new-api",
  )
)
  throw new Error("目标不是 New API 宿主");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginVersion = process.env.CLOUDFLARE_JEV_PLUGIN_VERSION || "0.2.4";
if (!["0.2.3", "0.2.4"].includes(pluginVersion))
  throw new Error("宿主验收仅支持明确的 0.2.3 或 0.2.4 版本");
const cases =
  pluginVersion === "0.2.4"
    ? [...fixture.cases, ...performanceFixture.cases]
    : fixture.cases;
const expectUnsupported =
  process.env.CLOUDFLARE_JEV_EXPECT_UNSUPPORTED_CAPABILITY === "1";
const temp = await mkdtemp(path.join(tmpdir(), "cloudflare-jev-check-"));
try {
  const casesPath = path.join(temp, "fixture.json");
  const overlayPath = path.join(temp, "overlay.json");
  await writeFile(casesPath, JSON.stringify({ cases }));
  await writeFile(
    overlayPath,
    JSON.stringify({
      Replace: {
        [path.join(host, "router", "cloudflare_jev_external_test.go")]:
          path.join(root, "tests", "host", "cloudflare_jev_test.go"),
        [path.join(
          host,
          "pkg",
          "jsplugin",
          "cloudflare_jev_capability_test.go",
        )]: path.join(
          root,
          "tests",
          "host",
          "cloudflare_jev_capability_test.go",
        ),
      },
    }),
  );
  const result = spawnSync(
    "go",
    [
      "test",
      "-mod=readonly",
      "-overlay=" + overlayPath,
      "-timeout=60s",
      expectUnsupported ? "./pkg/jsplugin" : "./router",
      "-run",
      expectUnsupported
        ? "^TestCloudflareJevRejectsUnsupportedPerformanceCapability$"
        : "^TestCloudflareJev",
      "-count=1",
    ],
    {
      cwd: host,
      env: {
        ...process.env,
        CLOUDFLARE_JEV_EXPECT_PERFORMANCE_FILTER:
          pluginVersion === "0.2.4" ? "1" : "0",
        CLOUDFLARE_JEV_EXPECT_TOKEN_LOGS:
          pluginVersion === "0.2.4"
            ? "1"
            : process.env.CLOUDFLARE_JEV_EXPECT_TOKEN_LOGS || "0",
        CLOUDFLARE_JEV_PLUGIN_SOURCE: path.join(
          root,
          "published",
          "cloudflare-jev",
          pluginVersion,
          "plugin.js",
        ),
        CLOUDFLARE_JEV_PREVIOUS_SOURCE: path.join(
          root,
          "published",
          "cloudflare-jev",
          "0.1.0",
          "plugin.js",
        ),
        CLOUDFLARE_JEV_PLUGIN_FIXTURE: casesPath,
        CLOUDFLARE_JEV_COMPLETED_RESPONSE: path.join(
          root,
          "tests",
          "fixtures",
          "cloudflare-jev-completed.json",
        ),
      },
      stdio: "inherit",
      // 冷缓存编译允许十分钟；Go 测试本身由 -timeout=60s 限制。
      timeout: 600000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
