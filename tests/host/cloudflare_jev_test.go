package router

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 只替换测试客户端的传输层，插件仍构造并校验真实 Cloudflare 地址。
type cloudflareJevTestTransport func(*http.Request) (*http.Response, error)

func (transport cloudflareJevTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestCloudflareJevFixture(t *testing.T) {
	sourcePath := os.Getenv("CLOUDFLARE_JEV_PLUGIN_SOURCE")
	fixturePath := os.Getenv("CLOUDFLARE_JEV_PLUGIN_FIXTURE")
	require.NotEmpty(t, sourcePath, "必须指定待验证插件源码")
	require.NotEmpty(t, fixturePath, "必须指定待回放的插件夹具")
	source, err := os.ReadFile(sourcePath)
	require.NoError(t, err)
	fixture, err := os.ReadFile(fixturePath)
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	report, err := jsplugin.ReplayFixture(ctx, string(source), fixture)
	require.NoError(t, err)
	assert.Positive(t, report.Total)
	assert.Equal(t, report.Total, report.Passed)
}

func TestCloudflareJevNativeIntegration(t *testing.T) {
	for _, fixedPrice := range []bool{false, true} {
		name := "用量表达式"
		if fixedPrice {
			name = "按次计费"
		}
		for _, clientModel := range []string{"typesafe/jev", "Typesafe-jev"} {
			t.Run(name+"/"+clientModel, func(t *testing.T) { testCloudflareJevNativeIntegration(t, fixedPrice, clientModel) })
		}
	}
}

func testCloudflareJevNativeIntegration(t *testing.T, fixedPrice bool, clientModel string) {
	t.Helper()
	sourcePath := os.Getenv("CLOUDFLARE_JEV_PLUGIN_SOURCE")
	require.NotEmpty(t, sourcePath, "必须指定待验证插件源码")
	source, err := os.ReadFile(sourcePath)
	require.NoError(t, err)
	loaded, err := jsplugin.CompilePlugin(string(source), jsplugin.Options{})
	require.NoError(t, err)
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())
	db := setupFeatureRouterAuthTest(t)
	model.InitDBColumns()
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.TaskPlugin{}, &model.Channel{}, &model.Token{}, &model.Log{}, &model.Group{}, &model.GroupAlias{}, &model.ChannelGroupBinding{}, &model.Ability{}, &model.UserSubscription{}, &model.SubscriptionPreConsumeRecord{}, &model.PromptAuditConfig{}, &model.PromptAuditEndpoint{}, &model.RequestArchiveConfig{}, &model.RequestArchiveTarget{}, &model.PromptAuditQueueState{}, &model.RequestArchiveQueueState{}))
	oldRegistry, oldLogDB := jsplugin.DefaultRegistry, model.LOG_DB
	oldCache, oldBatch, oldLog := common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled
	oldQuotaPerUnit := common.QuotaPerUnit
	jsplugin.DefaultRegistry = jsplugin.NewRegistry()
	model.LOG_DB = db
	common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled = false, false, false
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		jsplugin.DefaultRegistry = oldRegistry
		model.LOG_DB = oldLogDB
		common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled = oldCache, oldBatch, oldLog
		common.QuotaPerUnit = oldQuotaPerUnit
	})
	savedBilling := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		if strings.HasPrefix(key, "billing_setting.") {
			savedBilling[key] = value
		}
		return nil
	}))
	t.Cleanup(func() { require.NoError(t, config.GlobalConfig.LoadFromDB(savedBilling)) })
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode": fmt.Sprintf(`{%q:"tiered_expr"}`, clientModel),
		"billing_setting.billing_expr": fmt.Sprintf(`{%q:"u(\"input_tokens\") * 0.042 / 1000000"}`, clientModel),
	}))
	reservedQuota := int64(672)
	if fixedPrice {
		savedPrice := ratio_setting.ModelPrice2JSONString()
		t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrice)) })
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(fmt.Sprintf(`{%q:0.01}`, clientModel)))
		require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{"billing_setting.billing_mode": `{}`}))
		reservedQuota = 5000
	}
	plugin := model.TaskPlugin{Key: loaded.Meta.Key, Version: loaded.Meta.Version, APIVersion: loaded.Meta.APIVersion, Source: string(source), SourceHash: fmt.Sprintf("%x", sha256.Sum256(source)), SourceKind: "custom", Active: true, Enabled: true}
	require.NoError(t, db.Create(&plugin).Error)
	require.NoError(t, db.Create(&model.Option{Key: "TaskPluginEnabled", Value: "true"}).Error)
	group := model.Group{Code: "default", Name: "默认测试组", Status: model.GroupStatusActive, UserSelectable: true, Ratio: 1}
	require.NoError(t, db.Create(&group).Error)
	user := model.User{Id: 94401, Username: "cloudflare-jev-host-test", Quota: 1000000, Status: common.UserStatusEnabled, Group: group.Code, Setting: `{"billing_preference":"wallet_only"}`}
	require.NoError(t, db.Create(&user).Error)
	token := model.Token{Id: 94401, UserId: user.Id, Key: "cloudflarejevtesttoken", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 1000000, ModelLimitsEnabled: true, ModelLimits: clientModel}
	require.NoError(t, db.Create(&token).Error)

	const accountPath = "/client/v4/accounts/0123456789abcdef0123456789abcdef"
	const baseURL = "https://api.cloudflare.com" + accountPath
	requestBody := fmt.Sprintf(`{"model":%q,"state":null,"questions":{"urgent":{"type":"noul","instructions":null},"department":{"type":"choice","instructions":"应由哪个部门处理？","criteria":{"billing":null,"technical":"技术故障"}},"severity":{"type":"score","instructions":"严重程度","criteria":["低","高"]}}}`, clientModel)
	const answer = `{"model":"jev-1.13.0","answers":{"urgent":{"type":"noul","noul":0},"department":{"type":"choice","choice":"billing","confidence":1,"probabilities":{"billing":1,"technical":0}},"severity":{"type":"score","score":0.25,"confidence":0.5,"legend":{"0":"低","1":"高"},"probabilities":{"0":0.75,"1":0.25}}},"usage":{"input_tokens":1000,"output_tokens":73}}`
	completedRequest := fmt.Sprintf(`{"model":%q,"state":"重复扣款，请退款。","questions":{"urgent":{"type":"noul","instructions":"是否优先处理？"},"department":{"type":"choice","instructions":"选择部门","criteria":{"billing":"账单","technical":"技术","sales":"售前"}},"frustration":{"type":"score","instructions":"不满程度","criteria":["平静","不满","非常生气"]}}}`, clientModel)
	completedBytes, err := os.ReadFile(os.Getenv("CLOUDFLARE_JEV_COMPLETED_RESPONSE"))
	require.NoError(t, err)
	var completedEnvelope map[string]any
	require.NoError(t, common.Unmarshal(completedBytes, &completedEnvelope))
	completedState, ok := completedEnvelope["result"].(map[string]any)
	require.True(t, ok)
	completedAnswer, err := common.Marshal(completedState["result"])
	require.NoError(t, err)
	completedDirect, err := common.Marshal(completedState)
	require.NoError(t, err)
	var outgoingBody map[string]any
	require.NoError(t, common.Unmarshal([]byte(requestBody), &outgoingBody))
	expectedUpstream, err := common.Marshal(map[string]any{"model": "typesafe/jev", "input": map[string]any{"state": outgoingBody["state"], "questions": outgoingBody["questions"]}})
	require.NoError(t, err)
	var expectedRequest atomic.Value
	expectedRequest.Store(string(expectedUpstream))
	currentRequest := requestBody
	var calls atomic.Int32
	var responseBody atomic.Value
	responseBody.Store(answer)
	var balanceBeforeRequest atomic.Int64
	balanceBeforeRequest.Store(1000000)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, accountPath+"/ai/run", r.URL.Path)
		assert.Equal(t, "Bearer cloudflare-provider-secret", r.Header.Get("Authorization"))
		body, readErr := io.ReadAll(r.Body)
		if !assert.NoError(t, readErr) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		assert.JSONEq(t, expectedRequest.Load().(string), string(body))
		// 用量模式预扣 32000 token，按次模式使用固定价格；均在上游调用前完成。
		var chargedUser model.User
		var chargedToken model.Token
		if assert.NoError(t, db.First(&chargedUser, user.Id).Error) && assert.NoError(t, db.First(&chargedToken, token.Id).Error) {
			assert.EqualValues(t, balanceBeforeRequest.Load()-reservedQuota, chargedUser.Quota)
			assert.EqualValues(t, balanceBeforeRequest.Load()-reservedQuota, chargedToken.RemainQuota)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, responseBody.Load().(string))
	}))
	t.Cleanup(server.Close)
	serverURL, err := url.Parse(server.URL)
	require.NoError(t, err)
	if service.GetHttpClient() == nil {
		service.InitHttpClient()
	}
	client := service.GetHttpClient()
	previousTransport := client.Transport
	localTransport := http.DefaultTransport.(*http.Transport).Clone()
	localTransport.Proxy = nil
	t.Cleanup(func() {
		client.Transport = previousTransport
		localTransport.CloseIdleConnections()
	})
	client.Transport = cloudflareJevTestTransport(func(request *http.Request) (*http.Response, error) {
		if request.URL.Scheme != "https" || request.URL.Host != "api.cloudflare.com" || request.URL.Path != accountPath+"/ai/run" || request.URL.RawQuery != "" {
			return nil, fmt.Errorf("测试拒绝访问非预期地址")
		}
		forwarded := request.Clone(request.Context())
		forwarded.URL.Scheme = serverURL.Scheme
		forwarded.URL.Host = serverURL.Host
		forwarded.Host = serverURL.Host
		return localTransport.RoundTrip(forwarded)
	})
	// 相同模型的错误插件和 AtlasCloud 故意设置更高优先级，验证按插件身份隔离。
	mapping := fmt.Sprintf(`{%q:"typesafe/jev"}`, clientModel)
	for _, channel := range []model.Channel{
		{Id: 94401, Type: constant.ChannelTypeTaskPlugin, Name: "cloudflare-jev", Priority: common.GetPointer(int64(10)), Key: "cloudflare-provider-secret", BaseURL: common.GetPointer(baseURL), Models: "typesafe/jev", Group: group.Code, Status: common.ChannelStatusEnabled, Setting: common.GetPointer(`{"task_plugin_key":"cloudflare-jev"}`)},
		{Id: 94402, Type: constant.ChannelTypeTaskPlugin, Name: "typesafe-other", Priority: common.GetPointer(int64(200)), Key: "wrong-plugin-key", BaseURL: common.GetPointer(baseURL), Models: "typesafe/jev", Group: group.Code, Status: common.ChannelStatusEnabled, Setting: common.GetPointer(`{"task_plugin_key":"typesafe"}`)},
		{Id: 94403, Type: constant.ChannelTypeAtlasCloud, Name: "native-other", Priority: common.GetPointer(int64(300)), Key: "wrong-native-key", BaseURL: common.GetPointer(baseURL), Models: "typesafe/jev", Group: group.Code, Status: common.ChannelStatusEnabled},
	} {
		channel.Models = clientModel
		channel.ModelMapping = &mapping
		require.NoError(t, db.Create(&channel).Error)
		require.NoError(t, db.Create(&model.ChannelGroupBinding{ChannelId: channel.Id, GroupId: group.Id}).Error)
		require.NoError(t, db.Create(&model.Ability{ChannelId: channel.Id, Group: group.Code, GroupId: group.Id, Model: clientModel, Enabled: true, Priority: channel.Priority}).Error)
	}
	engine := gin.New()
	SetRelayRouter(engine)
	engine.NoRoute(SetPluginRouter(engine), func(c *gin.Context) { c.Status(http.StatusNotFound) })
	require.NoError(t, service.RefreshTaskPluginRoutes())
	send := func(method, path, key string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(currentRequest))
		request.Header.Set("Content-Type", "application/json")
		if key != "" {
			request.Header.Set("Authorization", "Bearer "+key)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		return recorder
	}
	const route = "/v1/systemone"
	t.Run("匿名请求不调用上游", func(t *testing.T) {
		response := send(http.MethodPost, route, "")
		assert.Equal(t, http.StatusUnauthorized, response.Code, response.Body.String())
		assert.EqualValues(t, 0, calls.Load())
	})
	t.Run("只注册统一POST入口且不接管聊天", func(t *testing.T) {
		beforeCalls := calls.Load()
		response := send(http.MethodPost, "/cloudflare/jev/v1/systemone", token.Key)
		assert.Equal(t, http.StatusNotFound, response.Code, response.Body.String())
		response = send(http.MethodGet, route, token.Key)
		assert.Equal(t, http.StatusMethodNotAllowed, response.Code, response.Body.String())
		response = send(http.MethodPost, "/v1/chat/completions", "")
		assert.Equal(t, http.StatusUnauthorized, response.Code, response.Body.String())
		assert.NotContains(t, response.Body.String(), "detail", "静态聊天入口不能使用插件错误格式")
		assert.Equal(t, beforeCalls, calls.Load())
	})
	t.Run("错误模型在发送上游前拒绝", func(t *testing.T) {
		beforeCalls := calls.Load()
		request := httptest.NewRequest(http.MethodPost, route, strings.NewReader(strings.Replace(requestBody, clientModel, "jev-1.13.0", 1)))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+token.Key)
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, request)
		assert.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
		assert.Equal(t, beforeCalls, calls.Load())
	})
	if clientModel == "Typesafe-jev" {
		t.Run("别名权限不能用规范名权限代替", func(t *testing.T) {
			beforeCalls := calls.Load()
			require.NoError(t, db.Model(&model.Token{}).Where("id = ?", token.Id).Update("model_limits", "typesafe/jev").Error)
			response := send(http.MethodPost, route, token.Key)
			assert.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
			assert.Equal(t, beforeCalls, calls.Load())
			require.NoError(t, db.Model(&model.Token{}).Where("id = ?", token.Id).Update("model_limits", clientModel).Error)
		})
		for _, invalidMapping := range []string{`{}`, `{"Typesafe-jev":"unsupported-model"}`} {
			t.Run("别名缺失或错误映射不调用上游/"+invalidMapping, func(t *testing.T) {
				beforeCalls := calls.Load()
				require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 94401).Update("model_mapping", invalidMapping).Error)
				response := send(http.MethodPost, route, token.Key)
				assert.GreaterOrEqual(t, response.Code, http.StatusBadRequest, response.Body.String())
				assert.Equal(t, beforeCalls, calls.Load())
				var actualUser model.User
				var actualToken model.Token
				require.Eventually(t, func() bool {
					return db.First(&actualUser, user.Id).Error == nil && db.First(&actualToken, token.Id).Error == nil &&
						actualUser.Quota == balanceBeforeRequest.Load() && int64(actualToken.RemainQuota) == balanceBeforeRequest.Load()
				}, 2*time.Second, 10*time.Millisecond)
				require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 94401).Update("model_mapping", mapping).Error)
			})
		}
	}
	var successfulTasks int64
	var totalCharged int
	for _, tc := range []struct {
		name, body, channelURL, request, expected string
		quota                                     int
	}{
		{"直接结果", answer, baseURL, requestBody, answer, 21},
		{"成功包裹及完整运行地址", `{"success":true,"result":` + answer + `,"errors":[],"messages":[]}`, baseURL + "/ai/run", requestBody, answer, 21},
		{"现场Completed双层包裹", string(completedBytes), baseURL, completedRequest, string(completedAnswer), 10},
		{"直接Completed包裹", string(completedDirect), baseURL, completedRequest, string(completedAnswer), 10},
	} {
		t.Run(tc.name, func(t *testing.T) {
			currentRequest = tc.request
			var input map[string]any
			require.NoError(t, common.Unmarshal([]byte(tc.request), &input))
			upstream, marshalErr := common.Marshal(map[string]any{"model": "typesafe/jev", "input": map[string]any{"state": input["state"], "questions": input["questions"]}})
			require.NoError(t, marshalErr)
			expectedRequest.Store(string(upstream))
			charge := tc.quota
			if fixedPrice {
				charge = 5000
			}
			responseBody.Store(tc.body)
			require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 94401).Update("base_url", tc.channelURL).Error)
			response := send(http.MethodPost, route, token.Key)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			assert.JSONEq(t, tc.expected, response.Body.String())
			assert.NotContains(t, response.Body.String(), "gatewayMetadata")
			expectedBalance := balanceBeforeRequest.Add(-int64(charge))
			totalCharged += charge
			successfulTasks++
			var actualUser model.User
			var actualToken model.Token
			require.NoError(t, db.First(&actualUser, user.Id).Error)
			require.NoError(t, db.First(&actualToken, token.Id).Error)
			assert.EqualValues(t, expectedBalance, actualUser.Quota)
			assert.EqualValues(t, expectedBalance, actualToken.RemainQuota)
			assert.Equal(t, totalCharged, actualToken.UsedQuota)
			var task model.Task
			require.NoError(t, db.Order("id DESC").First(&task).Error)
			assert.Equal(t, 94401, task.ChannelId)
			assert.Equal(t, charge, task.Quota)
			assert.Equal(t, clientModel, task.Properties.OriginModelName)
			assert.Equal(t, "typesafe/jev", task.Properties.UpstreamModelName)
			assert.EqualValues(t, model.TaskStatusSuccess, task.Status)
			assert.True(t, task.PrivateData.ResultDiscarded)
			assert.Empty(t, task.PrivateData.PluginData)
			assert.Empty(t, task.PrivateData.PluginState)
			assert.Empty(t, task.PrivateData.Key)
			assert.NotContains(t, string(task.Data), "answers")
			for _, suffix := range []string{"", "/artifacts"} {
				response := send(http.MethodGet, "/v1/task/plugins/cloudflare-jev/"+task.TaskID+suffix, token.Key)
				assert.Equal(t, http.StatusNotFound, response.Code, response.Body.String())
			}
		})
	}
	currentRequest = requestBody
	expectedRequest.Store(string(expectedUpstream))
	for _, tc := range []struct{ name, body string }{
		{"HTTP200失败包裹", `{"success":false,"result":` + answer + `,"errors":[{"message":"PRIVATE_CLOUDFLARE_ERROR"}]}`},
		{"缺失输入用量", strings.Replace(answer, `"input_tokens":1000,`, "", 1)},
		{"负输入用量", strings.Replace(answer, `"input_tokens":1000`, `"input_tokens":-1`, 1)},
		{"超出输入预算", strings.Replace(answer, `"input_tokens":1000`, `"input_tokens":32001`, 1)},
		{"Completed缺失用量", `{"success":true,"result":{"state":"Completed","result":` + strings.Replace(answer, `"input_tokens":1000,`, "", 1) + `}}`},
		{"未完成不能接受答案", `{"success":true,"result":{"state":"Running","result":` + answer + `}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			responseBody.Store(tc.body)
			beforeCalls := calls.Load()
			response := send(http.MethodPost, route, token.Key)
			assert.Equal(t, http.StatusBadGateway, response.Code, response.Body.String())
			assert.NotContains(t, response.Body.String(), "PRIVATE_CLOUDFLARE_ERROR")
			assert.Equal(t, beforeCalls+1, calls.Load(), "失败不得重试上游")
			var actualUser model.User
			var actualToken model.Token
			// 等待宿主异步退款提交，使用账务结果判定完成。
			require.Eventually(t, func() bool {
				return db.First(&actualUser, user.Id).Error == nil && db.First(&actualToken, token.Id).Error == nil &&
					actualUser.Quota == balanceBeforeRequest.Load() && int64(actualToken.RemainQuota) == balanceBeforeRequest.Load() && actualToken.UsedQuota == totalCharged
			}, 2*time.Second, 10*time.Millisecond)
			var count int64
			require.NoError(t, db.Model(&model.Task{}).Count(&count).Error)
			assert.EqualValues(t, successfulTasks, count, "失败不能创建成功任务")
		})
	}
	t.Run("切回旧版本与重新激活只保留当前入口", func(t *testing.T) {
		beforeCalls := calls.Load()
		previousSource, readErr := os.ReadFile(os.Getenv("CLOUDFLARE_JEV_PREVIOUS_SOURCE"))
		require.NoError(t, readErr)
		previous, compileErr := jsplugin.CompilePlugin(string(previousSource), jsplugin.Options{})
		require.NoError(t, compileErr)
		archived := model.TaskPlugin{Key: previous.Meta.Key, Version: previous.Meta.Version, APIVersion: previous.Meta.APIVersion, Source: string(previousSource), SourceHash: fmt.Sprintf("%x", sha256.Sum256(previousSource)), SourceKind: "custom"}
		require.NoError(t, db.Create(&archived).Error)
		require.NoError(t, model.ActivateTaskPlugin(archived.Key, archived.Version))
		require.NoError(t, service.RefreshTaskPluginRoutes())
		assert.Equal(t, http.StatusNotFound, send(http.MethodPost, route, "").Code)
		assert.Equal(t, http.StatusUnauthorized, send(http.MethodPost, "/cloudflare/jev/v1/systemone", "").Code)
		require.NoError(t, model.ActivateTaskPlugin(plugin.Key, plugin.Version))
		require.NoError(t, service.RefreshTaskPluginRoutes())
		assert.Equal(t, http.StatusUnauthorized, send(http.MethodPost, route, "").Code)
		assert.Equal(t, http.StatusNotFound, send(http.MethodPost, "/cloudflare/jev/v1/systemone", "").Code)
		assert.Equal(t, beforeCalls, calls.Load())
	})
	t.Run("禁用后撤销原生入口", func(t *testing.T) {
		beforeCalls := calls.Load()
		require.NoError(t, model.SetTaskPluginEnabled(plugin.Key, false))
		require.NoError(t, service.RefreshTaskPluginRoutes())
		response := send(http.MethodPost, route, token.Key)
		assert.Equal(t, http.StatusNotFound, response.Code, response.Body.String())
		assert.Equal(t, beforeCalls, calls.Load())
	})
}
