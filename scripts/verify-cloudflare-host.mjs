// 在指定宿主的 Go 测试中叠加插件契约用例，不改写宿主工作区。
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fixture } from "../tests/cloudflare-jev-cases.mjs";

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
const temp = await mkdtemp(path.join(tmpdir(), "cloudflare-jev-check-"));
try {
  const casesPath = path.join(temp, "fixture.json");
  const overlayPath = path.join(temp, "overlay.json");
  await writeFile(casesPath, JSON.stringify(fixture));
  await writeFile(
    overlayPath,
    JSON.stringify({
      Replace: {
        [path.join(host, "router", "cloudflare_jev_external_test.go")]:
          path.join(root, "tests", "host", "cloudflare_jev_test.go"),
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
      "./router",
      "-run",
      "^TestCloudflareJev",
      "-count=1",
    ],
    {
      cwd: host,
      env: {
        ...process.env,
        CLOUDFLARE_JEV_PLUGIN_SOURCE: path.join(
          root,
          "published",
          "cloudflare-jev",
          "0.2.1",
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
