# 官方 TypeSafe Jev 插件 1.0.0

`plugin.js` 原样取自 QuantumNous/new-api-plugins，保留作者、元数据和 Apache-2.0 许可证。
来源固定为提交 `b42cc99a6bd1998d0cc1581270bd46798ce00ad6` 下
`plugins/tasks/typesafe/1.0.0/plugin.js`，不另造 Jev 插件协议。
本版本纳入插件市场索引，合并到仓库 main 后可以从任务插件页面安装。
验收状态：已通过宿主模拟上游集成测试，未完成真实 TypeSafe 或生产验收。

## 接入

1. 使用支持 native JSON submit、同步结果返回及用量结算的 New API 宿主。
   MaoLao 原 `b2370db11` 仅有分阶段接入，不能直接使用；需包含本次宿主同步补丁。
2. Root 在「任务插件 → 插件市场」选择 `maolaonewapi-plugins`，刷新并安装 TypeSafe 1.0.0，
   激活版本并开启总开关；然后在渠道管理创建 Task Plugin 渠道并绑定 `typesafe`。
   也可使用「上传自定义」上传本目录 `plugin.js`。安装插件不会自动创建渠道。
3. 地址填写 `https://api.typesafe.ai`，密钥填写 TypeSafe Key；配置模型和分组。
4. 支持 `jev-1.13.0`、`jev-latest`、`jev-preview`。客户端使用网关令牌请求
   **`POST /typesafe/v1/systemone`**；插件向 TypeSafe 请求 **`POST /v1/systemone`**。
5. 定价由宿主管理。TypeSafe 文档当前为 $0.042/百万输入 token，输出免费。
   插件保守预留 65,536 输入 token，并以实际 `usage.input_tokens` 结算；余额要能覆盖预留。

```sh
curl https://YOUR_GATEWAY/typesafe/v1/systemone \
  -H 'Authorization: Bearer YOUR_GATEWAY_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"model":"jev-1.13.0","state":"用户发生重复扣款","questions":{"urgent":{"type":"noul","instructions":"是否需要优先处理","criteria":{"true":"资金损失"}}}}'
```

返回 `model/answers/usage`；三题型为 `noul`、`choice`、`score`，不支持流式。
本插件使用 TypeSafe 原生凭据，不能直接填写 Cloudflare Workers AI 地址或令牌。
官方文档对原生总上下文的限制为 64k，并要求 state 加最长单题不超过 32k；
Cloudflare 模型卡列出 32,000，不能当作两个接口完全相同的依据。

原样插件对于缺失/异常终态 input usage 会让宿主保留预扣量并记录警告；不会自动按零扣费。
未调用真实 TypeSafe，真实计费、失败退款和部署验收不可由离线通过替代。
部署前必须先升级宿主到包含原生同步能力的版本；API v1 标记不足以证明旧宿主兼容。
不要在尚未升级的生产宿主上启用。本次索引发布按用户明确要求准备，真实供应商验收仍待进行。

## 验证

- 固定源码 SHA-256：`80585e402c8e6709f976e6be1f0308a95d3b991370383ab984d21fe968d8e912`。
- 宿主基线 `b2370db118cfd36da58b1074ba62cecdd4c01c13` 加原生同步适配补丁。
- 真实 TokenAuth + SQLite + HTTP 模拟上游：三题型、渠道隔离、1000 输入 token 扣 21 quota、
  失败退款、结果不持久化、禁用门禁及持久化后结算故障边界通过。
- 索引由宿主 `cmd/task-plugin-index` 编译源码并生成，仓库校验器验证原始字节 hash。
- 尚未验证真实供应商、生产、多实例更新与订阅资金组合。

## 来源

- [固定插件源码](https://github.com/QuantumNous/new-api-plugins/blob/b42cc99a6bd1998d0cc1581270bd46798ce00ad6/plugins/tasks/typesafe/1.0.0/plugin.js)
- [TypeSafe 文档](https://docs.typesafe.ai/introduction)
- [TypeSafe API](https://docs.typesafe.ai/api)
- [Cloudflare Jev 文档](https://developers.cloudflare.com/ai/models/typesafe/jev/)
