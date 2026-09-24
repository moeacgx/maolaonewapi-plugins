# 稳定源码

每个插件按 `<key>/<version>/plugin.js` 存放，配套验证记录见同目录 README.md。
当前最新 [Cloudflare Jev 0.2.4](cloudflare-jev/0.2.4/README.md)：面向 Cloudflare API 的独立任务插件，
已通过本地模拟上游测试，真实供应商验收仍待进行。
官方 TypeSafe 直连插件不在本仓库重复发布，请从官方插件源安装。
0.2.4 需要支持 `task-performance-filter@1` 的新宿主；.337 及更早发布版继续使用
[0.2.3](cloudflare-jev/0.2.3/README.md)，所有历史版本保持不可变。
