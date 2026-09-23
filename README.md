# MaoLao 任务插件源

独立公开的任务插件仓库，供 MaoLaoNewAPI 的插件市场读取。采用 NewAPI 官方 `indexVersion: 1` 格式，
可与官方插件源同时使用；无需公开主程序仓库，也无需向浏览器提供 GitHub 凭据。

**索引地址：** `https://raw.githubusercontent.com/moeacgx/maolaonewapi-plugins/main/index.json`

当前索引不收录 TypeSafe。TypeSafe Jev 已由官方 `newapi` 插件源提供，避免在本仓库重复展示。
需要使用 Jev 时，请在任务插件源管理中选择官方源并刷新；宿主必须升级到包含原生同步路由和用量结算能力的版本。
`retired` 记录仅用于证明曾发布版本的不可变来源和哈希，不会被插件市场展示或安装。

## 使用方式

1. 在任务插件页面的插件源管理中添加上述地址；包含本功能的 MaoLaoNewAPI 版本会默认提供此源。
2. 临时测试时使用 Root 源码上传。稳定后按下文提交本仓库。
3. 从市场选择来源与版本，审阅源码和 SHA-256，再确认安装。
4. 安装后需明确激活版本、开启总开关并配置 Task Plugin=62 渠道，安装不会自动启用。

## 发布稳定插件

源码存放在 `published/<key>/<version>/plugin.js`，不得包含密钥、用户数据、私人服务器地址或主程序内部代码。
保留原作者、许可证和来源；与 QuantumNous/new-api 插件 API 兼容不代表官方认证。

1. 完成测试实例的真实提交、结果交付、失败退款、版本升级与历史任务回归。
2. 新增版本目录及验证记录 `README.md`，记录宿主版本、供应商契约、必要配置和已知限制。
3. 在本地 MaoLaoNewAPI 源码目录运行 `go run ./cmd/task-plugin-index -root <本仓库绝对路径>`。
   生成器会用宿主编译器验证元数据与 Hook，计算原始字节 SHA-256，生成索引。此步骤不调用真实供应商。
4. 若已有旧版本，生成器保留原 latest；维护者审查后将索引中 latest 改为新版本，再运行生成器。
5. 本仓库运行 `node scripts/validate-index.mjs`，提交 PR。CI 验证目录、大小、UTF-8、hash 和已发布版本不可改写。
6. 审查并合入 main 后，使用网关页面手动刷新、安装和激活。出现兼容问题时选择旧版本，不覆盖同版本内容。

若没有生成器，也可手工维护下列索引，宿主安装时仍会编译并复核 key/version/hash：

```json
{
  "indexVersion": 1,
  "name": "MaoLao Maintained",
  "plugins": [
    {
      "key": "example",
      "name": "示例",
      "latest": "1.0.0",
      "versions": [
        {
          "version": "1.0.0",
          "path": "published/example/1.0.0/plugin.js",
          "sha256": "填写源码文件真实 SHA-256（64 位十六进制）",
          "kind": "task",
          "minApiVersion": 1
        }
      ]
    }
  ]
}
```

每个 key/version 的源码、路径、hash 一经发布即不可修改或删除。修正必须升级版本。
SHA-256 是完整性校验，不是发布者签名；源码始终需要维护者审查。
市场不代理远程媒体，不提供 S3、匿名签名或自动升级。
