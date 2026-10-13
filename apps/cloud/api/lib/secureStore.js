// 加密 KV 存储层 —— 财务审批幂等、机构设置等私密配置共用。
// 数据落在 R2(BACKUP_BUCKET), 以 AES-GCM 加密后存放, 靠 etag 做乐观并发。
//
// 历史上这个文件叫 pushplusStore.js(为微信提醒而写)。微信提醒已下线,
// 存储层被保留并提升为公共组件; 密钥变量名 PUSHPLUS_ENCRYPTION_KEY 沿用
// 旧名做兼容读取, 避免线上已配置的 secret 失效。
const { webcrypto } = require("node:crypto");
const { HttpError } = require("./errors.js");
const cryptoApi = globalThis.crypto || webcrypto;
const encoder = new TextEncoder();
let importedKey = null;
let importedFor = null;
function env() {
  return globalThis.__CLOUDFLARE_ENV || process.env;
}
function secret() {
  // 新名优先, 旧名兼容 —— 线上 secret 改名不会导致读取中断。
  return env().ENCRYPTION_KEY || env().PUSHPLUS_ENCRYPTION_KEY || "";
}
function ready() {
  return !!(env().BACKUP_BUCKET && Buffer.from(secret(), "base64").length === 32);
}
function keyReady() {
  try {
    return Buffer.from(secret(), "base64").length === 32;
  } catch {
    return false;
  }
}
function storage() {
  if (!ready())
    throw new HttpError(503, "STORAGE_UNAVAILABLE", "加密存储尚未准备好，请联系管理员");
  return env().BACKUP_BUCKET;
}
function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}
function from64(value) {
  return new Uint8Array(Buffer.from(value, "base64"));
}
async function key() {
  const source = secret();
  const bytes = from64(source);
  if (bytes.length !== 32)
    throw new HttpError(503, "STORAGE_UNAVAILABLE", "加密存储密钥不可用");
  if (source !== importedFor) {
    importedFor = source;
    importedKey = cryptoApi.subtle.importKey("raw", bytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }
  return importedKey;
}
async function sealText(text, name) {
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const cipher = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(name) },
    await key(),
    encoder.encode(text),
  );
  return JSON.stringify({ version: 1, iv: base64(iv), data: base64(new Uint8Array(cipher)) });
}
async function seal(value, name) {
  return sealText(JSON.stringify(value), name);
}
async function openText(sealed, name) {
  const encrypted = typeof sealed === "string" ? JSON.parse(sealed) : sealed;
  const plain = await cryptoApi.subtle.decrypt(
    { name: "AES-GCM", iv: from64(encrypted.iv), additionalData: encoder.encode(name) },
    await key(),
    from64(encrypted.data),
  );
  return new TextDecoder().decode(plain);
}
async function read(name, fallback) {
  const object = await storage().get(name);
  if (!object) return { value: structuredClone(fallback), etag: null };
  try {
    const encrypted = await object.json();
    return { value: JSON.parse(await openText(encrypted, name)), etag: object.etag };
  } catch {
    throw new HttpError(503, "STORAGE_UNAVAILABLE", "加密配置暂时无法读取");
  }
}
// 读-改-写并重试: 只有 put 的 etag 条件成立才算成功, 冲突就重来。
async function change(name, fallback, mutate) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { value, etag } = await read(name, fallback);
    const next = await mutate(value);
    if (next === null) return null;
    const result = await storage().put(name, await seal(next, name), {
      onlyIf: etag ? { etagMatches: etag } : new Headers({ "If-None-Match": "*" }),
      httpMetadata: { contentType: "application/json" },
    });
    if (result) return next;
  }
  throw new HttpError(409, "STORAGE_BUSY", "配置正在更新，请稍后重试");
}
async function hash(value) {
  return Buffer.from(await cryptoApi.subtle.digest("SHA-256", encoder.encode(value))).toString(
    "hex",
  );
}
function randomId() {
  return Buffer.from(cryptoApi.getRandomValues(new Uint8Array(32))).toString("hex");
}
module.exports = {
  change,
  env,
  ready,
  keyReady,
  read,
  seal,
  sealText,
  openText,
  hash,
  randomId,
};
