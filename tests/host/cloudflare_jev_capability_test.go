package jsplugin

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 该测试只用于旧宿主门禁，证明它明确拒绝需要新能力的插件。
func TestCloudflareJevRejectsUnsupportedPerformanceCapability(t *testing.T) {
	if os.Getenv("CLOUDFLARE_JEV_EXPECT_UNSUPPORTED_CAPABILITY") != "1" {
		t.Skip("仅旧宿主能力拒绝验证")
	}
	source, err := os.ReadFile(os.Getenv("CLOUDFLARE_JEV_PLUGIN_SOURCE"))
	require.NoError(t, err)
	_, err = CompilePlugin(string(source), Options{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported")
	assert.Contains(t, err.Error(), "task-performance-filter@1")
}
