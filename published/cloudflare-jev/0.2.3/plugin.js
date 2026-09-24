// Cloudflare Jev：仅使用 Cloudflare 账户端点，不接受客户端覆盖上游地址或凭据。
// 协议依据：https://developers.cloudflare.com/ai/models/typesafe/jev/
const MODEL = "typesafe/jev";
// 原生路由先按声明模型鉴权与选渠，别名必须保留到渠道映射阶段。
const MODELS = [MODEL, "Typesafe-jev"];
const MAX_INPUT_TOKENS = 32000;
const MAX_OUTPUT_TOKENS = 2147483647;

export const meta = {
  apiVersion: 1,
  key: "cloudflare-jev",
  name: "Cloudflare Jev",
  version: "0.2.3",
  icon: "text:CF",
  author: { name: "MaoLao", url: "https://github.com/moeacgx" },
  website: "https://developers.cloudflare.com/ai/models/typesafe/jev/",
  description: {
    en: "Jev decisions through Cloudflare; configure an account-scoped API URL and token",
    zh: "通过 Cloudflare 调用 Jev 决策模型，需配置包含账户 ID 的 API 地址和令牌",
  },
  auth: "api_key",
  models: MODELS,
  fetchMode: "per_task",
  routes: [
    {
      method: "POST",
      path: "/v1/systemone",
      type: "submit",
      decode: "decodeSystemOne",
      render: "renderSystemOne",
      retainResult: false,
    },
  ],
  usageSchema: {
    input_tokens: {
      type: "number",
      unit: "token",
      description: { en: "Input token unit price", zh: "输入 token 单价" },
    },
    output_tokens: {
      type: "number",
      unit: "token",
      description: { en: "Actual output tokens", zh: "实际输出 token 数量" },
    },
  },
  usageExamples: [
    { label: "Jev", facts: { input_tokens: 1000, output_tokens: 73 } },
  ],
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isEntry(value) {
  return (
    value === null || typeof value === "string" || typeof value === "object"
  );
}

function hasResponseFailure(body) {
  return (
    (hasOwn(body, "success") && body.success !== true) ||
    body.error != null ||
    (hasOwn(body, "errors") &&
      (!Array.isArray(body.errors) || body.errors.length !== 0))
  );
}

function validateRequest(body) {
  if (!isObject(body)) throw new Error("请求必须是 JSON 对象");
  if (!MODELS.includes(body.model))
    throw new Error("模型必须为 typesafe/jev 或 Typesafe-jev");
  if (
    Object.keys(body).some(
      (key) =>
        !["model", "state", "questions", "stream", "group"].includes(key),
    )
  )
    throw new Error("请求含未支持字段");
  if (body.stream !== undefined && body.stream !== false)
    throw new Error("Cloudflare Jev 不支持流式请求");
  if (!hasOwn(body, "state") || !isEntry(body.state))
    throw new Error("state 必须为文本、对象、数组或 null");
  if (!isObject(body.questions) || Object.keys(body.questions).length === 0)
    throw new Error("questions 必须是非空对象");
  for (const id of Object.keys(body.questions)) {
    if (!id) throw new Error("问题 ID 不能为空");
    const question = body.questions[id];
    if (
      !isObject(question) ||
      !["noul", "choice", "score"].includes(question.type)
    )
      throw new Error("不支持的问题题型");
    if (
      Object.keys(question).some(
        (key) => !["type", "instructions", "criteria"].includes(key),
      )
    )
      throw new Error("问题含未支持字段");
    if (!hasOwn(question, "instructions") || !isEntry(question.instructions))
      throw new Error("instructions 必须存在且为文本、对象、数组或 null");
    const criteria = question.criteria;
    if (question.type === "choice") {
      if (!isObject(criteria) || Object.keys(criteria).length === 0)
        throw new Error("choice criteria 必须是非空对象");
    } else if (question.type === "score") {
      if (!Array.isArray(criteria) || criteria.length < 2)
        throw new Error("score criteria 至少包含两档");
    } else if (
      criteria != null &&
      (!isObject(criteria) ||
        Object.keys(criteria).some((key) => key !== "true" && key !== "false"))
    ) {
      throw new Error("noul criteria 只能描述 true 和 false");
    }
    if (
      criteria != null &&
      Object.values(criteria).some((value) => !isEntry(value))
    )
      throw new Error("criteria 描述必须为文本、对象、数组或 null");
  }
  return { model: body.model, state: body.state, questions: body.questions };
}

function validateUsage(body) {
  const usage = body && body.usage;
  if (
    !isObject(usage) ||
    !Number.isInteger(usage.input_tokens) ||
    usage.input_tokens < 0 ||
    usage.input_tokens > MAX_INPUT_TOKENS ||
    !Number.isSafeInteger(usage.output_tokens) ||
    usage.output_tokens < 0 ||
    usage.output_tokens > MAX_OUTPUT_TOKENS
  ) {
    throw new Error("Cloudflare Jev 用量缺失或超出安全范围");
  }
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
  };
}

function probability(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new Error("答案概率或置信度无效");
  return value;
}

export function buildSubmitRequest(ctx) {
  const request = validateRequest(ctx.requestBody);
  if ((ctx.upstreamModel || ctx.model) !== MODEL)
    throw new Error("上游模型必须为 typesafe/jev");
  if (ctx.upstream && ctx.upstream.kind !== "vendor")
    throw new Error("本插件仅支持直连 Cloudflare");
  // 不用宽松 URL 拼接，防止错误账户地址把渠道令牌发给其他主机。
  const match =
    typeof ctx.baseUrl === "string" &&
    /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/([a-fA-F0-9]{32})(?:\/ai\/run)?\/?$/.exec(
      ctx.baseUrl,
    );
  if (!match)
    throw new Error("Cloudflare 账户地址必须包含有效的 32 位 Account ID");
  if (typeof ctx.apiKey !== "string" || !ctx.apiKey || /\s/.test(ctx.apiKey))
    throw new Error("Cloudflare API 令牌无效");
  return {
    url:
      "https://api.cloudflare.com/client/v4/accounts/" + match[1] + "/ai/run",
    method: "POST",
    headers: {
      Authorization: "Bearer " + ctx.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: {
      model: MODEL,
      input: { state: request.state, questions: request.questions },
    },
  };
}

export function parseSubmitResponse(ctx, response) {
  if (response.statusCode < 200 || response.statusCode >= 300)
    throw new Error("Cloudflare HTTP " + response.statusCode);
  let body = response.body;
  if (!isObject(body)) throw new Error("Cloudflare 响应必须为对象");
  if (hasResponseFailure(body))
    throw new Error("Cloudflare 返回失败或无效结果");
  if (hasOwn(body, "success") && !hasOwn(body, "state")) {
    if (!isObject(body.result)) {
      throw new Error("Cloudflare 返回失败或无效结果");
    }
    body = body.result;
  }
  // 统一 AI 接口在完成时再包一层状态；只展开这一层，不递归接受任意结果。
  if (hasOwn(body, "state")) {
    if (
      body.state !== "Completed" ||
      hasResponseFailure(body) ||
      !isObject(body.result)
    ) {
      throw new Error("Cloudflare 任务未完成或结果无效");
    }
    body = body.result;
    if (hasOwn(body, "state"))
      throw new Error("Cloudflare 任务未完成或结果无效");
  }
  if (hasResponseFailure(body))
    throw new Error("Cloudflare 返回失败或无效结果");
  if (typeof body.model !== "string" || !body.model.trim())
    throw new Error("响应缺少模型");
  if (!isObject(body.answers)) throw new Error("响应缺少答案");
  const request = validateRequest(ctx.requestBody);
  const answers = [];
  for (const id of Object.keys(request.questions)) {
    const question = request.questions[id];
    const answer = hasOwn(body.answers, id) ? body.answers[id] : null;
    if (!isObject(answer) || answer.type !== question.type)
      throw new Error("响应缺少匹配的问题答案");
    if (answer.type === "noul") {
      answers.push([id, { type: "noul", noul: probability(answer.noul) }]);
      continue;
    }
    const keys =
      answer.type === "choice"
        ? Object.keys(question.criteria)
        : question.criteria.map((_, index) => String(index));
    if (
      !isObject(answer.probabilities) ||
      Object.keys(answer.probabilities).length !== keys.length ||
      keys.some((key) => !hasOwn(answer.probabilities, key))
    ) {
      throw new Error("答案概率分布与题目不匹配");
    }
    const probabilities = Object.fromEntries(
      keys.map((key) => [key, probability(answer.probabilities[key])]),
    );
    const confidence = probability(answer.confidence);
    if (answer.type === "choice") {
      if (
        typeof answer.choice !== "string" ||
        !hasOwn(question.criteria, answer.choice)
      )
        throw new Error("choice 结果不属于选项");
      answers.push([
        id,
        { type: "choice", choice: answer.choice, probabilities, confidence },
      ]);
    } else {
      if (
        typeof answer.score !== "number" ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > keys.length - 1
      )
        throw new Error("score 结果超出档位范围");
      if (
        !isObject(answer.legend) ||
        Object.keys(answer.legend).length !== keys.length ||
        keys.some(
          (key) => !hasOwn(answer.legend, key) || !isEntry(answer.legend[key]),
        )
      ) {
        throw new Error("score legend 与题目不匹配");
      }
      answers.push([
        id,
        {
          type: "score",
          score: answer.score,
          probabilities,
          confidence,
          legend: Object.fromEntries(
            keys.map((key) => [key, answer.legend[key]]),
          ),
        },
      ]);
    }
  }
  // 先验证用量再声明成功，使缺失/畸形计费事实通过宿主失败链退款。
  const usage = validateUsage(body);
  if (typeof ctx.publicTaskId !== "string" || !ctx.publicTaskId)
    throw new Error("缺少宿主公开任务 ID");
  return {
    taskId: ctx.publicTaskId,
    taskData: {
      model: body.model,
      answers: Object.fromEntries(answers),
      usage,
    },
    immediate: { status: "SUCCESS", progress: "100%" },
  };
}

export function extractUsage(ctx) {
  validateRequest(ctx.requestBody);
  if (ctx.usagePurpose === "billing_ratios") return null;
  return { input_tokens: MAX_INPUT_TOKENS };
}

export function extractUsageOnComplete(_ctx, _result, body) {
  return validateUsage(body);
}

export function buildQueryRequest() {
  throw new Error("Cloudflare Jev 仅支持同步请求");
}

export function parseTaskResult() {
  return { status: "UNKNOWN", reason: "Cloudflare Jev 仅支持同步请求" };
}

export const native = {
  decodeSystemOne: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json")
      throw new Error("仅支持 JSON 请求");
    const requestBody = validateRequest(ctx.body.value);
    return {
      kind: "submit",
      model: requestBody.model,
      action: "systemone",
      requestBody,
    };
  },
  renderSystemOne: function (_ctx, task) {
    return task.data;
  },
  error: function (_ctx, error) {
    return { detail: error.message };
  },
};
