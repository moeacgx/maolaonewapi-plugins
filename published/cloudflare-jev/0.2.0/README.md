# Cloudflare Jev 任务插件 0.2.0

## 变更目标与范围

将客户端入口统一为 `POST /v1/systemone`，上游供应商路径由插件内部转换。
插件 key 仍为 `cloudflare-jev`，模型仍为 `typesafe/jev`，渠道绑定与凭据不变。
Cloudflare 上游仍是 `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run`，
请求转换、三题型、响应过滤、用量计费及退款合同与 0.1.0 一致。

`.335` 宿主允许插件声明该路由，无需修改或升级主程序。0.1.0 已发布的源码和 hash 保持不变。
0.2.0 不再声明旧的 `/cloudflare/jev/v1/systemone`；安装后必须激活新版本才切换入口。
多节点必须确认注册表均已刷新。回滚时重新激活 0.1.0，客户端同时改回旧入口。

## 使用方式

在 MaoLao 插件源中安装并激活 Cloudflare Jev 0.2.0。已有渠道继续绑定 `cloudflare-jev`。
新渠道选择 Task Plugins，API 地址填写 `https://api.cloudflare.com/client/v4/accounts/<32位Account ID>`，
密钥填写 Cloudflare API Token，模型填写 `typesafe/jev`。客户端只填写本站地址和本站令牌：

```http
POST /v1/systemone
Authorization: Bearer YOUR_GATEWAY_TOKEN
Content-Type: application/json

{
  "model": "typesafe/jev",
  "state": "这是一条连接测试请求。",
  "questions": {
    "is_test": {
      "type": "noul",
      "instructions": "判断这是否为测试请求。",
      "criteria": { "true": "明确用于测试", "false": "其他用途" }
    }
  }
}
```

所有问题的 `instructions` 必须存在，可为 null；`state` 也必须存在，可为 null。
仅非流式调用，支持 `noul`、`choice`、`score`。不把上游账户路径暴露为客户端接口。

## 价格与错误定位

Task Plugins 的通用渠道测试不支持本接口，请使用上面的真实请求验证。
定价选择显式“按次计费”，或“表达式/阶梯计费”并填写
`u("input_tokens") * P / 1000000`，其中 P 必须替换为本站每百万输入 token 的美元售价。
普通 Token 倍率不能作为本插件的最终定价。预留 32,000 输入 token，成功后按实际用量结算。

客户端错误经过宿主脱敏，`Invalid request` 不足以区分价格和请求校验错误。
`fail_to_fetch_task` 加 HTTP 403 表示请求已发出且上游拒绝，不等于入口不匹配。
需要结合管理员日志的阶段或供应商直连的错误码排查；不要为诊断向客户端暴露密钥或供应商原始敏感内容。
本版本不改变现有错误脱敏合同，不承诺更换客户端路径能够修复供应商授权问题。

## 安全、兼容与验证

- 保留本站认证、模型/分组授权、渠道隔离、预扣结算、失败退款及 `retainResult:false`。
- 已发布 0.1.0 保留在市场历史版本；更新索引须保留退役 TypeSafe 的不可变记录。
- 官方 TypeSafe 插件的 `/typesafe/v1/systemone` 与本插件不冲突；宿主不支持多个插件同时占用
  `/v1/systemone`，此变更不表示已实现跨插件按模型分派。
- 在 `.335` 宿主完整静态 Relay 路由下验证新入口、认证、错误模型、旧路径撤销、版本切换、
  模拟 Cloudflare 请求转换、真实 TokenAuth/SQLite 计费及退款。单次 Go 测试超时 60 秒。
- 回放旧版相同的 84 个供应商协议 fixture，另加入口合同；不发真实付费推理请求。
- Node 协议和索引测试 86 项通过；宿主同一组 84 项 fixture、11 个完整路由链路场景通过。
- 新路径用例先在 0.1.0 上复现 404/旧路径仍可调用，再升级到 0.2.0 后全部通过。
- 宿主为 `.335` 发布代码加文档提交 `b6476c6c8`，CI 仍固定 `.335` 发布提交，不修改宿主源码。
- 供应商成功推理尚未验收。现场直连收到 HTTP 402、错误码 2021、余额不足提示，
  说明仍需处理 Cloudflare 账户计费条件；不将该响应视为模型成功或路由错误。

供应商协议与权限说明见 [0.1.0 文档](../0.1.0/README.md)，其中客户端旧路径仅适用于旧版本。
