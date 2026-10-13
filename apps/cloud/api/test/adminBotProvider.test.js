const { test } = require("node:test");
const assert = require("node:assert/strict");
const provider = require("../lib/adminBotProvider.js");
test("微信启动通知使用官方路径和已绑定令牌", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).pathname, "/ilink/bot/msg/notifystart");
      assert.equal(options.headers.Authorization, "Bearer private-token");
      assert.equal(options.redirect, "manual");
      assert.ok(JSON.parse(options.body).base_info.channel_version);
      return Response.json({ ret: 0 });
    };
    await provider.start({ base: provider.BASE, token: "private-token" });
  } finally { globalThis.fetch = original; }
});

test("二维码请求兼容 Workers 的 redirect 模式", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(options.redirect, "manual");
      assert.equal(options.method, "POST");
      assert.equal(new URL(url).hostname, "ilinkai.weixin.qq.com");
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({ ret: 0, qrcode: "test-qr", qrcode_img_content: "test-image" });
    };
    assert.equal((await provider.qr()).qrcode, "test-qr");
  } finally {
    globalThis.fetch = original;
  }
});

test("不跟随模型接口重定向，避免转发 API 密钥", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(options.redirect, "manual");
      return new Response(null, { status: 302, headers: { Location: "https://other.example" } });
    };
    await assert.rejects(provider.deepseek("test-secret", []), (error) =>
      error.code === "BOT_PROVIDER_REJECTED" && error.message.includes("302"));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
