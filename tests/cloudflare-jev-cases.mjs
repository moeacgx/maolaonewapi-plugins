import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const account = "0123456789abcdef0123456789abcdef";
const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const questions = {
  urgent: {
    type: "noul",
    instructions: null,
    criteria: { true: "资金损失", false: null },
  },
  team: {
    type: "choice",
    instructions: "选择部门",
    criteria: { billing: null, technical: { label: "技术" } },
  },
  severity: {
    type: "score",
    instructions: ["分级"],
    criteria: [{ label: "低" }, { label: "高" }],
  },
};
const request = {
  model: "typesafe/jev",
  state: { text: "重复扣款", paid: false, count: 0 },
  questions,
};
const context = {
  model: "typesafe/jev",
  upstreamModel: "typesafe/jev",
  baseUrl,
  apiKey: "unit-test-token",
  publicTaskId: "task_test",
  requestBody: request,
};
const response = {
  model: "jev-1.13.0",
  answers: {
    urgent: { type: "noul", noul: 0 },
    team: {
      type: "choice",
      choice: "billing",
      confidence: 0,
      probabilities: { billing: 1, technical: 0 },
    },
    severity: {
      type: "score",
      score: 0.25,
      confidence: 0,
      probabilities: { 0: 0.75, 1: 0.25 },
      legend: { 0: { label: "低" }, 1: { label: "高" } },
    },
  },
  usage: { input_tokens: 1000, output_tokens: 73 },
};
const descriptor = {
  url: baseUrl + "/ai/run",
  method: "POST",
  headers: {
    Authorization: "Bearer unit-test-token",
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: { model: "typesafe/jev", input: { state: request.state, questions } },
};
const success = {
  taskId: "task_test",
  taskData: response,
  immediate: { status: "SUCCESS", progress: "100%" },
};
const cases = [];
const alias = "Typesafe-jev";
const aliasContext = {
  ...context,
  model: alias,
  requestBody: { ...request, model: alias },
};
good(
  "别名解码保留客户端模型用于权限与计费",
  "native",
  [
    {
      body: { kind: "json", value: aliasContext.requestBody },
    },
  ],
  {
    kind: "submit",
    model: alias,
    action: "systemone",
    requestBody: aliasContext.requestBody,
  },
  "decodeSystemOne",
);
good(
  "别名经渠道映射后向Cloudflare发送规范模型",
  "buildSubmitRequest",
  [aliasContext],
  descriptor,
);
good("别名预扣使用相同输入预算", "extractUsage", [aliasContext], {
  input_tokens: 32000,
});
good(
  "别名响应解析保持原答案与真实用量",
  "parseSubmitResponse",
  [aliasContext, { statusCode: 200, body: response }],
  success,
);
for (const upstreamModel of [alias, "other-model"]) {
  bad(
    "别名拒绝无效上游映射:" + upstreamModel,
    "buildSubmitRequest",
    [{ ...aliasContext, upstreamModel }],
    "上游模型",
  );
}
bad(
  "别名无渠道映射不能静默改成供应商模型",
  "buildSubmitRequest",
  [{ ...aliasContext, upstreamModel: undefined }],
  "上游模型",
);
bad(
  "仅大小写不同但未声明的别名仍被拒绝",
  "native",
  [
    {
      body: { kind: "json", value: { ...request, model: "typesafe-jev" } },
    },
  ],
  "模型",
  "decodeSystemOne",
);
// 保留现场响应的结构和数值；夹具不包含账户地址、请求 ID 或凭据。
const completedEnvelope = JSON.parse(
  readFileSync(
    new URL("./fixtures/cloudflare-jev-completed.json", import.meta.url),
    "utf8",
  ),
);
const completedContext = {
  ...context,
  requestBody: {
    model: "typesafe/jev",
    state: "订单重复扣款，请协助退款。",
    questions: {
      urgent: {
        type: "noul",
        instructions: "是否优先处理？",
        criteria: { true: "资金损失", false: "一般咨询" },
      },
      department: {
        type: "choice",
        instructions: "选择处理部门",
        criteria: { billing: "账单", technical: "技术", sales: "售前" },
      },
      frustration: {
        type: "score",
        instructions: "判断不满程度",
        criteria: ["平静", "不满", "非常生气"],
      },
    },
  },
};
function good(name, hook, args, expected, member) {
  cases.push({ name, hook, ...(member ? { member } : {}), args, expected });
}
function bad(name, hook, args, expectedError, member) {
  cases.push({
    name,
    hook,
    ...(member ? { member } : {}),
    args,
    expectedError,
  });
}
function requestError(name, change, message) {
  const body = structuredClone(request);
  change(body);
  bad(
    name,
    "native",
    [{ body: { kind: "json", value: body } }],
    message,
    "decodeSystemOne",
  );
}
function responseError(name, change, message) {
  const body = structuredClone(response);
  change(body);
  bad(
    name,
    "parseSubmitResponse",
    [context, { statusCode: 200, body }],
    message,
  );
}

for (const [name, body] of [
  ["现场Completed双层包裹", completedEnvelope],
  ["直接Completed状态包裹", completedEnvelope.result],
]) {
  good(
    name,
    "parseSubmitResponse",
    [completedContext, { statusCode: 200, body }],
    {
      taskId: "task_test",
      taskData: completedEnvelope.result.result,
      immediate: { status: "SUCCESS", progress: "100%" },
    },
  );
}
good(
  "现场Completed保留输入输出实际用量",
  "extractUsageOnComplete",
  [{}, {}, completedEnvelope.result.result],
  { input_tokens: 486, output_tokens: 70 },
);
good(
  "Completed包裹保留显式零值",
  "parseSubmitResponse",
  [
    context,
    {
      statusCode: 200,
      body: {
        success: true,
        errors: [],
        result: { state: "Completed", result: response },
      },
    },
  ],
  success,
);
for (const state of [
  "Queued",
  "Running",
  "Failed",
  "Cancelled",
  "completed",
  null,
]) {
  bad(
    "非完成状态不能伪装成功:" + state,
    "parseSubmitResponse",
    [context, { statusCode: 200, body: { state, result: response } }],
    "Cloudflare 任务未完成或结果无效",
  );
}
for (const result of [undefined, null, [], "PRIVATE"]) {
  bad(
    "Completed缺少有效结果",
    "parseSubmitResponse",
    [context, { statusCode: 200, body: { state: "Completed", result } }],
    "Cloudflare 任务未完成或结果无效",
  );
}
for (const extra of [
  { error: "PRIVATE" },
  { errors: [{ message: "PRIVATE" }] },
]) {
  bad(
    "Completed不能掩盖状态层错误",
    "parseSubmitResponse",
    [
      context,
      {
        statusCode: 200,
        body: {
          success: true,
          result: { state: "Completed", result: response, ...extra },
        },
      },
    ],
    "Cloudflare 任务未完成或结果无效",
  );
}
for (const outer of [
  { success: false, errors: [] },
  { success: true, errors: [{ message: "PRIVATE" }] },
]) {
  bad(
    "Completed不能绕过外层失败",
    "parseSubmitResponse",
    [
      context,
      {
        statusCode: 200,
        body: { ...outer, result: { state: "Completed", result: response } },
      },
    ],
    "Cloudflare 返回失败或无效结果",
  );
}
for (const extra of [
  { success: false },
  { error: "PRIVATE" },
  { errors: [{ message: "PRIVATE" }] },
]) {
  bad(
    "Completed不能掩盖模型层错误",
    "parseSubmitResponse",
    [
      context,
      {
        statusCode: 200,
        body: { state: "Completed", result: { ...response, ...extra } },
      },
    ],
    "Cloudflare 返回失败或无效结果",
  );
}
bad(
  "不递归展开多重Completed",
  "parseSubmitResponse",
  [
    context,
    {
      statusCode: 200,
      body: {
        state: "Completed",
        result: { state: "Completed", result: response },
      },
    },
  ],
  "Cloudflare 任务未完成或结果无效",
);
bad(
  "内层未完成不能借有效答案绕过状态检查",
  "parseSubmitResponse",
  [
    context,
    {
      statusCode: 200,
      body: { state: "Completed", result: { state: "Running", ...response } },
    },
  ],
  "Cloudflare 任务未完成或结果无效",
);
bad(
  "Completed仍要求用量",
  "parseSubmitResponse",
  [
    context,
    {
      statusCode: 200,
      body: { state: "Completed", result: { ...response, usage: null } },
    },
  ],
  "用量缺失",
);
bad(
  "Completed仍要求答案完整",
  "parseSubmitResponse",
  [
    context,
    {
      statusCode: 200,
      body: { state: "Completed", result: { ...response, answers: {} } },
    },
  ],
  "响应缺少匹配",
);

good("三题型和JSON嵌套零值转换", "buildSubmitRequest", [context], descriptor);
for (const suffix of ["/", "/ai/run", "/ai/run/"]) {
  good(
    `渠道地址规范化${suffix}`,
    "buildSubmitRequest",
    [{ ...context, baseUrl: baseUrl + suffix }],
    descriptor,
  );
}
good(
  "原生解码剥离非流式标志",
  "native",
  [{ body: { kind: "json", value: { ...request, stream: false } } }],
  {
    kind: "submit",
    model: "typesafe/jev",
    action: "systemone",
    requestBody: request,
  },
  "decodeSystemOne",
);
good(
  "空state保留",
  "buildSubmitRequest",
  [{ ...context, requestBody: { ...request, state: null } }],
  {
    ...descriptor,
    body: { model: "typesafe/jev", input: { state: null, questions } },
  },
);
good(
  "显式分组只留给网关",
  "buildSubmitRequest",
  [{ ...context, requestBody: { ...request, group: "default" } }],
  descriptor,
);
good(
  "直接模型结果",
  "parseSubmitResponse",
  [context, { statusCode: 200, body: response }],
  success,
);
good(
  "Cloudflare成功包裹",
  "parseSubmitResponse",
  [
    context,
    {
      statusCode: 200,
      body: { success: true, result: response, errors: [], messages: [] },
    },
  ],
  success,
);
good(
  "不向调用者泄露上游附加字段",
  "parseSubmitResponse",
  [
    context,
    {
      statusCode: 200,
      body: {
        ...response,
        secret: "PRIVATE",
        answers: {
          ...response.answers,
          extra: { secret: "PRIVATE" },
          urgent: { ...response.answers.urgent, prompt: "PRIVATE" },
        },
        usage: { ...response.usage, secret: "PRIVATE" },
      },
    },
  ],
  success,
);
good(
  "同步原生呈现",
  "native",
  [{}, { data: response }],
  response,
  "renderSystemOne",
);
good("保守预扣预算", "extractUsage", [{ ...context, usagePurpose: "facts" }], {
  input_tokens: 32000,
});
good(
  "用量不能误作倍率",
  "extractUsage",
  [{ ...context, usagePurpose: "billing_ratios" }],
  null,
);
good(
  "完成用量保留输入与输出供宿主记录",
  "extractUsageOnComplete",
  [{}, {}, response],
  {
    input_tokens: 1000,
    output_tokens: 73,
  },
);
for (const count of [0, 32000]) {
  const body = {
    ...response,
    usage: { input_tokens: count, output_tokens: 0 },
  };
  good(
    `有效输入边界${count}`,
    "parseSubmitResponse",
    [context, { statusCode: 200, body }],
    {
      ...success,
      taskData: body,
    },
  );
  good(`结算输入边界${count}`, "extractUsageOnComplete", [{}, {}, body], {
    input_tokens: count,
    output_tokens: 0,
  });
}
for (const url of [
  "",
  "https://api.cloudflare.com",
  baseUrl + "/v1",
  baseUrl + "?token=PRIVATE",
  baseUrl + "#x",
  baseUrl.replace("https:", "http:"),
  baseUrl.replace("api.cloudflare.com", "api.cloudflare.com.evil.test"),
  baseUrl.replace("api.cloudflare.com", "user@api.cloudflare.com"),
  baseUrl.replace(account, "not-an-account"),
]) {
  bad(
    `拒绝无效账户地址${cases.length}`,
    "buildSubmitRequest",
    [{ ...context, baseUrl: url }],
    "账户地址",
  );
}
for (const apiKey of ["", "  ", "bad\r\nHeader: injected"])
  bad("拒绝无效令牌", "buildSubmitRequest", [{ ...context, apiKey }], "令牌");
bad(
  "拒绝模型映射到原生版本号",
  "buildSubmitRequest",
  [{ ...context, upstreamModel: "jev-1.13.0" }],
  "模型",
);
bad(
  "拒绝嵌套新网关模式",
  "buildSubmitRequest",
  [{ ...context, upstream: { kind: "new_api" } }],
  "直连",
);
bad(
  "JSON格式门禁",
  "native",
  [{ body: { kind: "multipart", value: request } }],
  "JSON",
  "decodeSystemOne",
);
requestError(
  "不能省略state",
  (b) => {
    delete b.state;
  },
  "state",
);
requestError(
  "state不能为布尔值",
  (b) => {
    b.state = false;
  },
  "state",
);
requestError(
  "禁止流式",
  (b) => {
    b.stream = true;
  },
  "流式",
);
requestError(
  "禁止未声明顶层参数",
  (b) => {
    b.url = "https://evil.test";
  },
  "字段",
);
requestError(
  "禁止原生模型ID",
  (b) => {
    b.model = "jev-latest";
  },
  "模型",
);
requestError(
  "空问题对象",
  (b) => {
    b.questions = {};
  },
  "questions",
);
requestError(
  "问题ID不能为空",
  (b) => {
    b.questions[""] = b.questions.urgent;
  },
  "问题",
);
requestError(
  "instructions必须存在",
  (b) => {
    delete b.questions.urgent.instructions;
  },
  "instructions",
);
requestError(
  "instructions不能为数字",
  (b) => {
    b.questions.urgent.instructions = 1;
  },
  "instructions",
);
requestError(
  "未知题型",
  (b) => {
    b.questions.urgent.type = "chat";
  },
  "题型",
);
requestError(
  "题目未知参数",
  (b) => {
    b.questions.urgent.prompt = "x";
  },
  "字段",
);
requestError(
  "noul不能声明其他选项",
  (b) => {
    b.questions.urgent.criteria = { maybe: "x" };
  },
  "noul",
);
requestError(
  "choice空选项",
  (b) => {
    b.questions.team.criteria = {};
  },
  "choice",
);
requestError(
  "选项描述不能为数字",
  (b) => {
    b.questions.team.criteria.billing = 0;
  },
  "criteria",
);
requestError(
  "score至少两档",
  (b) => {
    b.questions.severity.criteria = ["唯一"];
  },
  "score",
);
const many = structuredClone(request);
many.questions.team.criteria = Object.fromEntries(
  Array.from({ length: 256 }, (_, i) => ["option" + i, null]),
);
many.questions.severity.criteria = Array.from({ length: 11 }, () => null);
good(
  "不引入Cloudflare未声明的选项档数上限",
  "native",
  [{ body: { kind: "json", value: many } }],
  {
    kind: "submit",
    model: "typesafe/jev",
    action: "systemone",
    requestBody: many,
  },
  "decodeSystemOne",
);
for (const statusCode of [401, 429, 500])
  bad(
    `HTTP${statusCode}拒绝原文`,
    "parseSubmitResponse",
    [context, { statusCode, body: { error: "PRIVATE" } }],
    "HTTP " + statusCode,
  );
for (const body of [
  { success: false, result: response, errors: [{ message: "PRIVATE" }] },
  { success: "true", result: response },
  { success: true, result: response, errors: ["PRIVATE"] },
  { success: true, errors: [], result: null },
]) {
  bad(
    "拒绝逻辑失败包裹",
    "parseSubmitResponse",
    [context, { statusCode: 200, body }],
    "Cloudflare",
  );
}
responseError(
  "模型缺失",
  (b) => {
    delete b.model;
  },
  "模型",
);
responseError(
  "缺少问题答案",
  (b) => {
    delete b.answers.urgent;
  },
  "答案",
);
responseError(
  "题型错配",
  (b) => {
    b.answers.urgent.type = "choice";
  },
  "答案",
);
responseError(
  "无效概率",
  (b) => {
    b.answers.urgent.noul = 1.01;
  },
  "概率",
);
responseError(
  "非法choice",
  (b) => {
    b.answers.team.choice = "other";
  },
  "choice",
);
responseError(
  "概率分布不完整",
  (b) => {
    delete b.answers.team.probabilities.technical;
  },
  "概率",
);
responseError(
  "置信度越界",
  (b) => {
    b.answers.team.confidence = -1;
  },
  "概率",
);
responseError(
  "分数越界",
  (b) => {
    b.answers.severity.score = 2;
  },
  "score",
);
responseError(
  "等级描述缺失",
  (b) => {
    delete b.answers.severity.legend["1"];
  },
  "legend",
);
for (const tokens of [-1, 0.5, 32001, 9007199254740992, "1000", null]) {
  responseError(
    `无效输入用量${tokens}`,
    (b) => {
      b.usage.input_tokens = tokens;
    },
    "用量",
  );
  bad(
    "无效结算用量",
    "extractUsageOnComplete",
    [{}, {}, { usage: { input_tokens: tokens, output_tokens: 0 } }],
    "用量",
  );
}
responseError(
  "无usage不能按免费成功",
  (b) => {
    delete b.usage;
  },
  "用量",
);
responseError(
  "无输出用量",
  (b) => {
    delete b.usage.output_tokens;
  },
  "用量",
);
const maxOutputBody = {
  ...response,
  usage: { input_tokens: 1000, output_tokens: 2147483647 },
};
good(
  "输出用量保留数据库整数上界",
  "parseSubmitResponse",
  [context, { statusCode: 200, body: maxOutputBody }],
  { ...success, taskData: maxOutputBody },
);
good(
  "完成用量保留数据库整数上界",
  "extractUsageOnComplete",
  [{}, {}, maxOutputBody],
  maxOutputBody.usage,
);
responseError(
  "输出用量超数据库整数上界",
  (b) => {
    b.usage.output_tokens = 2147483648;
  },
  "用量",
);
bad(
  "完成用量拒绝超数据库整数上界",
  "extractUsageOnComplete",
  [{}, {}, { usage: { input_tokens: 1000, output_tokens: 2147483648 } }],
  "用量",
);
responseError(
  "非法输出用量",
  (b) => {
    b.usage.output_tokens = -1;
  },
  "用量",
);
bad(
  "必须有公开任务ID",
  "parseSubmitResponse",
  [
    { ...context, publicTaskId: "" },
    { statusCode: 200, body: response },
  ],
  "任务",
);
bad("不伪造轮询接口", "buildQueryRequest", [], "同步");
good("无异步任务不伪造进度", "parseTaskResult", [], {
  status: "UNKNOWN",
  reason: "Cloudflare Jev 仅支持同步请求",
});
good(
  "错误只使用宿主脱敏内容",
  "native",
  [{}, { message: "safe", detail: "PRIVATE" }],
  { detail: "safe" },
  "error",
);

export const fixture = { cases };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(fixture, null, 2) + "\n");
