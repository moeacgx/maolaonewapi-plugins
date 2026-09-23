# Cloudflare Jev 任务插件 0.1.0

通过 Cloudflare 统一 AI REST API 调用 `typesafe/jev`，与官方 TypeSafe 直连插件使用独立 key 和路径。
目标宿主为包含 NewAPI-Mao PR #266 的 `.335` 或后续兼容版本；仅需要安装插件，无需新增 Go 适配器。
开发及验证状态在本页同步记录，未完成真实 Cloudflare 账户调用时不宣称生产验收。

## 设计与接口

- 插件 key：`cloudflare-jev`，渠道类型：Task Plugins，绑定插件：Cloudflare Jev。
- 客户端端点：`POST /cloudflare/jev/v1/systemone`，网关令牌 Bearer 认证。
- 客户端模型：`typesafe/jev`。不把 TypeSafe 原生的 `jev-1.13.0` 当作可在 Cloudflare 指定的版本；
  响应里的具体模型版本原样保留。
- 请求 `model/state/questions` 转为 `{model:"typesafe/jev",input:{state,questions}}`。
- 上游端点：`https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run`，Cloudflare API Token Bearer 认证。
- 返回 `model/answers/usage`，支持 `noul`、`choice`、`score`，不提供聊天、流式或异步查询。
- 同时接受模型直接结果和 Workers AI 的 `{success:true,result,errors:[]}` 包裹，
  包裹中的失败标志和非空错误数组不能伪装成成功。HTTP 错误状态交给宿主处理，不自动重试。

## 渠道配置

1. 在「任务插件 → 插件市场」选择 MaoLao 插件源，安装 Cloudflare Jev，激活版本并打开总开关。
   PR 合并前可以通过「上传自定义」上传本目录 `plugin.js`；安装不会自动创建渠道。
2. 新建渠道：协议类型选 **Task Plugins**，任务插件选 **Cloudflare Jev (cloudflare-jev)**。
3. 名称自行填写；供应商只是管理分类，可选择 Cloudflare 或不选。
4. 密钥填写 Cloudflare API Token，需要目标账户的 **Account → Workers AI → Read** 权限。
   Account ID 是账户 ID，不是 Zone ID；不要填写 TypeSafe Key 或全局 API Key。
   `typesafe/jev` 是第三方模型，账户需要足够的 AI Gateway 预付额度；仅有 Workers AI 免费额度不代表能调用它。
5. API 地址必填：`https://api.cloudflare.com/client/v4/accounts/<32位Account ID>`。
   也接受尾部 `/ai/run` 和单个末尾斜杠，插件不会重复拼接路径。
   地址只允许官方 HTTPS 域名；本版不支持自定义反代域名或独立 AI Gateway URL。
6. 模型选择 `typesafe/jev`，设置允许访问的分组。多节点安装/激活后需让每节点刷新插件注册表或重启。
7. 设置该模型价格，可选择宿主原有按次计价，或 `tiered_expr` 用量表达式。
   用量字段是 `input_tokens`，按每百万输入 token 售价 P 配置：`u("input_tokens") * P / 1000000`。
   P 是说明占位值，保存时必须替换成实际数值；不自动沿用 TypeSafe 的美元价格，按 Cloudflare 账单和本站售价确认。

```sh
curl https://YOUR_GATEWAY/cloudflare/jev/v1/systemone \
  -H 'Authorization: Bearer YOUR_GATEWAY_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"model":"typesafe/jev","state":"重复扣款","questions":{"urgent":{"type":"noul","instructions":"是否需要优先处理？","criteria":{"true":"涉及资金损失"}}}}'
```

每道题的 `instructions` 必须存在，可以为 null；`state` 必须存在，也允许 null。
Choice 的 criteria 为非空选项对象；Score 的 criteria 至少两档。不把 TypeSafe 文档的 255/10 上限
误写成 Cloudflare schema 限制。未知输入字段会被拒绝，`stream:false` 可以省略，true 被拒绝。

## 安全、计费与生命周期

用户、令牌、模型/分组授权、限流、资金预扣和退款由宿主管理。插件只负责协议转换和校验。
模型卡上下文为 32,000 token，插件保守预留 32,000 输入 token，成功后按实际输入用量结算。
插件没有供应商分词器，不声称预先精确验证总 token 数；由 Cloudflare 最终拒绝超限请求。

响应的 input_tokens 必须为 0～32,000 整数，这是插件计费安全预算，不是 Cloudflare 输出 schema 上限。
缺失、负数、小数或超过预算的输入用量在解析成功之前报错，交由宿主退还预扣，不按零费用成功。
output_tokens 必须为非负安全整数，保留在响应中，不纳入本版收费事实。
校验对应问题答案、概率和置信度范围，保留显式零值；Score legend 兼容结构化描述，
避免 TypeSafe 描述格式与 Cloudflare schema 字符串说明之间的差异造成丢失。

只将请求匹配的答案、模型和用量返回客户端；不回传上游附加字段、错误原文或请求回显。
`retainResult:false` 使宿主只保留任务账务记录，不保存成功答案或 API Key；成功结果无法再次查询。
上游已消费但响应畸形时，本插件可能拒绝结算并退款，这是明确的站点风险，不能冒称供应商不收费。
插件不会自动安装、启用或修改任何 Cloudflare 账户配置；卸载前停用并处理已有渠道绑定。

## 验证计划

先用确定性 fixture 验证端点拼接、三题型输入、两种响应形状、HTTP/逻辑错误、零值与畸形用量，
再通过实际宿主 JS 编译器回放同一组 fixture。使用 `.335` 宿主的真实 TokenAuth、SQLite、模拟 HTTP
上游验证同步结果、渠道隔离、收费、失败退款和无结果保存。单次 Go 测试超时 60 秒。
没有 Cloudflare 凭据，不调用真实付费推理接口。

### 已执行结果

- `node --test --test-timeout=60000 tests/cloudflare-jev.test.mjs scripts/validate-index.test.mjs`：85 项通过，其中插件合同 84 项。
- `node scripts/verify-cloudflare-host.mjs <宿主目录>`：同一批 84 项 fixture 经实际宿主 JS 引擎回放通过；
  8 个原生链路场景通过，覆盖认证、渠道隔离、两种响应、畸形用量/逻辑失败退款与禁用。
- 以测试单价 $0.042/百万输入 token、`QuotaPerUnit=500000` 为例，32,000 预留量扣 672 quota，
  实际 1000 输入 token 最终扣 21 quota；该单价仅为测试数据，不是对 Cloudflare 现价的承诺。
- 验证宿主为 `.335` 发布代码加文档提交 `b6476c6c8`，没有修改宿主生产源码；CI 固定到实际 `.335` 标签提交。
- `node scripts/validate-index.mjs --base .base-index.json`：1 个版本通过，原有 TypeSafe 退役记录保持不变。
- 概率按字段范围及键完整性校验，不增加 schema 未声明的概率总和/最大概率/加权均值近似判定。
- 未创建生产渠道、未安装启用插件、未使用真实 Cloudflare 令牌；真实计费、供应商错误形状和账户限额仍需实际接入验收。

测试通过不等于插件已发布；PR 合并到本仓库 `main` 后，刷新插件市场才会出现此条目。

## 官方依据（2026-09-24 核对）

- [Jev 模型卡与 curl 示例](https://developers.cloudflare.com/ai/models/typesafe/jev/)
- [输入 schema](https://developers.cloudflare.com/ai/models/typesafe/jev/schema-input.json)
- [输出 schema](https://developers.cloudflare.com/ai/models/typesafe/jev/schema-output.json)
- [统一 AI REST API 与认证](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
- [旧 Workers AI REST 响应包裹](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)

本插件由 MaoLao 维护，不代表 Cloudflare 或 TypeSafe 官方认证。
