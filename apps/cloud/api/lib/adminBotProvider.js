const { webcrypto } = require("node:crypto");
const { HttpError } = require("./errors.js");
const VERSION = "2.4.8";
const BASE = "https://ilinkai.weixin.qq.com";
const info = { channel_version: VERSION, bot_agent: "17sayAdmin/1.0" };
function validBase(value = BASE) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    !(u.hostname === "weixin.qq.com" || u.hostname.endsWith(".weixin.qq.com")) ||
    u.username ||
    u.password ||
    u.port
  )
    throw new HttpError(502, "WECHAT_HOST_INVALID", "微信返回了不支持的接口地址");
  return u.origin;
}
function headers(token) {
  const rng = globalThis.crypto || webcrypto;
  const n = rng.getRandomValues(new Uint32Array(1))[0];
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": Buffer.from(String(n)).toString("base64"),
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": "132104",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
async function json(url, options = {}, timeout = 20000) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      // Workers only supports follow/manual. Reject redirects below without
      // forwarding bot tokens or model credentials to another address.
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new HttpError(502, "BOT_NETWORK_UNKNOWN", "接口连接未能确认，请检查状态后再尝试");
  }
  if (!response.ok)
    throw new HttpError(
      502,
      "BOT_PROVIDER_REJECTED",
      `服务接口暂不可用（HTTP ${response.status}）`,
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new HttpError(502, "BOT_BAD_RESPONSE", "服务返回的内容无法识别");
  }
  if ((data.ret != null && data.ret !== 0) || (data.errcode != null && data.errcode !== 0))
    throw new HttpError(
      502,
      Number(data.ret || data.errcode) === -14 ? "WECHAT_SESSION_EXPIRED" : "WECHAT_REJECTED",
      "微信会话不可用，请发消息重新激活；仍失败时重新扫码",
    );
  return data;
}
async function qr() {
  const data = await json(`${BASE}/ilink/bot/get_bot_qrcode?bot_type=3`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ local_token_list: [] }),
  });
  if (!data.qrcode || !data.qrcode_img_content)
    throw new HttpError(502, "WECHAT_QR_INVALID", "暂时无法获取微信二维码");
  return data;
}
async function qrState(pair, code) {
  const query = new URLSearchParams({ qrcode: pair.qrcode });
  if (code) query.set("verify_code", code);
  return json(
    `${validBase(pair.base || BASE)}/ilink/bot/get_qrcode_status?${query}`,
    { headers: { "iLink-App-Id": "bot", "iLink-App-ClientVersion": "132104" } },
    20000,
  );
}
async function updates(bot, cursor = "") {
  return json(
    `${validBase(bot.base)}/ilink/bot/getupdates`,
    {
      method: "POST",
      headers: headers(bot.token),
      body: JSON.stringify({ get_updates_buf: cursor, base_info: info }),
    },
    40000,
  );
}
async function start(bot) {
  return json(`${validBase(bot.base)}/ilink/bot/msg/notifystart`, {
    method: "POST",
    headers: headers(bot.token),
    body: JSON.stringify({ base_info: info }),
  }, 10000);
}
async function send(bot, context, text, clientId) {
  if (!context) throw new HttpError(409, "WECHAT_CONTEXT_REQUIRED", "请先在微信给机器人发一条消息");
  return json(
    `${validBase(bot.base)}/ilink/bot/sendmessage`,
    {
      method: "POST",
      headers: headers(bot.token),
      body: JSON.stringify({
        msg: {
          from_user_id: "",
          to_user_id: bot.peer,
          client_id: clientId,
          message_type: 2,
          message_state: 2,
          context_token: context,
          item_list: [{ type: 1, text_item: { text: String(text).slice(0, 2500) } }],
        },
        base_info: info,
      }),
    },
    20000,
  );
}
async function deepseek(key, messages) {
  const raw = JSON.stringify(messages);
  if (Buffer.byteLength(raw, "utf8") > 24000)
    throw new HttpError(400, "BOT_INPUT_TOO_LONG", "对话内容过长，请清空历史后再试");
  const data = await json(
    "https://api.deepseek.com/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-flash",
        messages,
        thinking: { type: "disabled" },
        max_tokens: 600,
        stream: false,
      }),
    },
    30000,
  );
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim())
    throw new HttpError(502, "BOT_AI_EMPTY", "模型未生成可显示的回答");
  const p = data?.usage?.prompt_tokens,
    o = data?.usage?.completion_tokens;
  const cost =
    Number.isInteger(p) && Number.isInteger(o) && p >= 0 && o >= 0
      ? Math.min(60000, p * 2 + o * 8)
      : 60000;
  return { reply: reply.trim().slice(0, 2500), cost };
}
module.exports = { BASE, validBase, qr, qrState, updates, start, send, deepseek };
