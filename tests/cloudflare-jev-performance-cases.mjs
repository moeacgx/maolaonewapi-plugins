const model = "Typesafe-jev";
const context = {
  pluginKey: "cloudflare-jev",
  pluginVersion: "0.2.4",
  model,
  upstreamModel: "typesafe/jev",
  method: "POST",
  requestPath: "/v1/systemone",
};
const failure = {
  stage: "http",
  httpStatus: 404,
  errorCode: "model_not_found",
};
const cases = [];
function add(name, ctx, expected, detail = failure) {
  cases.push({
    name,
    hook: "shouldRecordPerformanceFailure",
    args: [ctx, detail],
    expected,
  });
}
for (const requestPath of [
  "/v1/responses",
  "/v1/chat/completions",
  "/v1/systemone/extra",
  "/v1/task/plugins/cloudflare-jev/extra",
]) {
  add("错误客户端入口过滤：" + requestPath, { ...context, requestPath }, false);
}
add("错误方法过滤", { ...context, method: "GET" }, false);
for (const requestPath of [
  "/v1/systemone",
  "/v1/task/plugins/cloudflare-jev",
]) {
  for (const httpStatus of [400, 401, 403, 404, 429, 500, 502, 503]) {
    add(
      "合法路径保留真实HTTP失败：" + requestPath + "/" + httpStatus,
      { ...context, requestPath },
      true,
      { ...failure, httpStatus },
    );
  }
}
for (const stage of ["transport", "parse", "immediate"]) {
  add("合法路径保留真实阶段失败：" + stage, context, true, {
    ...failure,
    stage,
    httpStatus: 502,
  });
}
add("规范模型合法路径保留", { ...context, model: "typesafe/jev" }, true);
add(
  "规范模型错误路径过滤",
  { ...context, model: "typesafe/jev", requestPath: "/v1/responses" },
  false,
);
add(
  "未来或未知阶段默认保留",
  { ...context, requestPath: "/v1/responses" },
  true,
  { ...failure, stage: "unknown" },
);
add(
  "错误插件身份默认保留",
  { ...context, pluginKey: "other", requestPath: "/v1/responses" },
  true,
);
add(
  "未知模型默认保留",
  { ...context, model: "other", requestPath: "/v1/responses" },
  true,
);
add("缺失请求路径默认保留", { ...context, requestPath: undefined }, true);
add("缺失请求方法默认保留", { ...context, method: undefined }, true);
add("缺失上下文默认保留", null, true);
add("缺失失败上下文默认保留", context, true, null);
add(
  "路径必须为宿主绝对路径",
  { ...context, requestPath: "v1/systemone" },
  true,
);
add(
  "路径不能混入query",
  { ...context, requestPath: "/v1/systemone?key=ignored" },
  true,
);
export const performanceFixture = { cases };
