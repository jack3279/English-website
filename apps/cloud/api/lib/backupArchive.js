const { TABLES, identityOf, keyOf, EXPORT_LIMIT } = require('./backup.js');
const secureStore = require('./secureStore.js');
const { HttpError } = require('./errors.js');
const PAGE = 500;
const BACKUP_ENCRYPTION_NAME = 'backup-archive';

function isEncryptedEnvelope(value) {
  return value && typeof value === 'object' && value.format === 'encrypted-backup'
    && value.encryption === 'AES-GCM' && typeof value.iv === 'string' && typeof value.data === 'string';
}
async function packArchive(archive) {
  if (!secureStore.keyReady()) throw new HttpError(503, 'BACKUP_ENCRYPTION_UNAVAILABLE', '备份加密密钥不可用，拒绝生成明文备份');
  const { sha256: _ignoredSha, ...payload } = { ...archive, encrypted: true };
  const stored = { ...payload, sha256: await secureStore.hash(JSON.stringify(payload)) };
  const sealed = JSON.parse(await secureStore.sealText(JSON.stringify(stored), BACKUP_ENCRYPTION_NAME));
  return { format: 'encrypted-backup', encryption: 'AES-GCM', ...sealed };
}
async function openArchive(value) {
  if (!isEncryptedEnvelope(value)) return { archive: { ...value, encrypted: false }, encrypted: false };
  try {
    return { archive: JSON.parse(await secureStore.openText(value, BACKUP_ENCRYPTION_NAME)), encrypted: true };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'BACKUP_DECRYPT_FAILED', '备份解密失败，拒绝恢复');
  }
}
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_OBJECTS = 400;
// Locks and login sessions must expire, rather than being resurrected by recovery.
function durableKey(key) {
  return key.startsWith('private/') && !key.startsWith('private/workflow-locks/');
}
async function exportTable(admin, table, budget) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    if (budget.left-- <= 0) throw new Error('导出查询预算不足，需分批备份');
    let query = admin.from(table).select('*', { count: 'exact' });
    for (const column of identityOf(table)) query = query.order(column);
    const { data, error, count } = await query.range(from, from + PAGE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (rows.length > EXPORT_LIMIT) throw new Error('单表超过备份上限，需分批备份');
    if (page.length < PAGE) {
      if (count != null && count !== rows.length) throw new Error('导出行数与数据库数量不符，请重试');
      const keys = new Set(rows.map(r => keyOf(r, identityOf(table))));
      if (keys.size !== rows.length) throw new Error('分页过程中数据变化，请重试');
      return rows;
    }
  }
}
async function exportPrivate(bucket) {
  const objects = [];
  let cursor, size = 0;
  if (!bucket.list || !bucket.get) throw new Error('私有存储无法列出或读取');
  do {
    const page = await bucket.list({ prefix: 'private/', limit: 500, ...(cursor ? { cursor } : {}) });
    for (const item of page.objects || []) {
      if (!durableKey(item.key)) continue;
      if (objects.length >= MAX_OBJECTS) throw new Error('私有对象超过备份上限');
      const object = await bucket.get(item.key);
      if (!object) throw new Error('私有对象在导出期间发生变化，请重试');
      const bytes = object.arrayBuffer ? Buffer.from(await object.arrayBuffer()) : Buffer.from(await object.text());
      size += bytes.length;
      if (size > MAX_BYTES) throw new Error('私有存储超过备份容量上限');
      if (item.etag && object.etag !== item.etag) throw new Error('私有对象在导出期间发生变化，请重试');
      objects.push({ key: item.key, data: bytes.toString('base64'), sha256: await secureStore.hash(bytes.toString('base64')), httpMetadata: object.httpMetadata || {} });
    }
    if (page.truncated && !page.cursor) throw new Error('私有存储分页中断');
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return objects;
}
async function create(admin, bucket) {
  const archive = { version: 3, exported_at: new Date().toISOString(), tables: {}, manifest: {}, private_objects: [], coverage: {
    auth: '登录密码、令牌、MFA和登录会话不备份；用户元数据用于账号重建核对',
    secrets: '部署密钥和加密主密钥不写入备份，灾难恢复需使用原加密密钥',
    files: '教材和付款截图若为外部链接，备份保存链接，不复制外部文件',
    consistency: '分表读取期间应暂停录入；该备份不是数据库事务时间点快照',
  } };
  const budget = { left: 38 };
  for (const table of TABLES) {
    try {
      const rows = await exportTable(admin, table, budget);
      archive.tables[table] = rows;
      archive.manifest[table] = { count: rows.length, ok: true, truncated: false, sha256: await secureStore.hash(JSON.stringify(rows)) };
    } catch (e) {
      archive.tables[table] = [];
      archive.manifest[table] = { count: 0, ok: false, error: String(e.message || e).slice(0, 200) };
    }
  }
  try {
    archive.private_objects = await exportPrivate(bucket);
    archive.private_manifest = { ok: true, count: archive.private_objects.length };
  } catch (e) { archive.private_manifest = { ok: false, count: 0, error: String(e.message || e).slice(0, 200) }; }
  try {
    const users = [];
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 500 });
      if (error) throw error;
      for (const user of data.users) users.push({ id: user.id, email: user.email, phone: user.phone, app_metadata: user.app_metadata, user_metadata: user.user_metadata, created_at: user.created_at });
      if (data.users.length < 500) break;
      if (page === 10) throw new Error('账号数量超出备份上限');
    }
    archive.auth_metadata = users;
    archive.auth_manifest = { ok: true, count: users.length };
  } catch (e) { archive.auth_manifest = { ok: false, count: 0, error: String(e.message || e).slice(0, 200) }; }
  archive.complete = TABLES.every(t => archive.manifest[t].ok) && archive.private_manifest.ok && archive.auth_manifest.ok;
  archive.finished_at = new Date().toISOString();
  archive.sha256 = await secureStore.hash(JSON.stringify(archive));
  if (Buffer.byteLength(JSON.stringify(archive)) > MAX_BYTES) throw new HttpError(413, 'BACKUP_TOO_LARGE', '备份超出容量上限，需分批备份');
  return archive;
}
async function validate(archive) {
  if (archive.version !== 3) return { verified: false, legacy: true, encrypted: false };
  const { sha256, ...withEncryptionMarker } = archive;
  const { encrypted: _encryptedMarker, ...legacyPayload } = withEncryptionMarker;
  const payload = archive.encrypted === true ? withEncryptionMarker : legacyPayload;
  if (sha256 !== await secureStore.hash(JSON.stringify(payload))) throw new HttpError(400, 'BACKUP_CORRUPT', '备份校验失败，拒绝恢复');
  for (const table of TABLES) {
    const meta = archive.manifest?.[table], rows = archive.tables?.[table];
    if (meta?.ok && (!Array.isArray(rows) || rows.length !== meta.count || await secureStore.hash(JSON.stringify(rows)) !== meta.sha256)) throw new HttpError(400, 'BACKUP_CORRUPT', '数据表校验失败，拒绝恢复');
  }
  const seen = new Set();
  for (const object of archive.private_objects || []) {
    if (!durableKey(object.key) || seen.has(object.key) || await secureStore.hash(object.data) !== object.sha256) throw new HttpError(400, 'BACKUP_CORRUPT', '私有数据校验失败，拒绝恢复');
    seen.add(object.key);
  }
  return { verified: true, complete: archive.complete === true, encrypted: archive.encrypted === true };
}
// Restore into an isolated namespace and read every byte back; never touch live objects.
async function drill(bucket, archive) {
  const integrity = await validate(archive);
  if (!integrity.verified || !integrity.complete) throw new HttpError(400, 'BACKUP_INCOMPLETE', '此备份不完整，不能通过恢复演练');
  const prefix = 'recovery-drill/' + require('node:crypto').randomUUID() + '/';
  const written = [];
  let verified = 0;
  try {
    for (const object of archive.private_objects) {
      const key = prefix + object.key;
      written.push(key);
      await bucket.put(key, Buffer.from(object.data, 'base64'), { httpMetadata: object.httpMetadata });
      const copy = await bucket.get(key);
      if (!copy) throw new Error('恢复副本未读到');
      const bytes = copy.arrayBuffer ? Buffer.from(await copy.arrayBuffer()) : Buffer.from(await copy.text());
      if (await secureStore.hash(bytes.toString('base64')) !== object.sha256) throw new Error('恢复副本校验失败');
      verified++;
    }
    return { ok: true, privateObjects: verified, tables: TABLES.length, rows: Object.values(archive.tables).reduce((s, rows) => s + rows.length, 0), note: '私有对象已在隔离命名空间恢复并逐个读回；数据库恢复需另执行隔离数据库演练。' };
  } finally {
    if (written.length) await bucket.delete(written);
  }
}
async function restorePrivate(bucket, archive, dryRun = true) {
  const valid = await validate(archive);
  if (!valid.verified || !valid.complete) throw new HttpError(400, 'BACKUP_INCOMPLETE', '只能恢复完整且校验通过的私有数据');
  const missing = [];
  for (const object of archive.private_objects) if (!(await bucket.get(object.key))) missing.push(object);
  let inserted = 0;
  if (!dryRun) for (const object of missing) {
    const result = await bucket.put(object.key, Buffer.from(object.data, 'base64'), { onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: object.httpMetadata });
    if (result) inserted++;
  }
  return { dryRun, missing: missing.length, inserted, existing: archive.private_objects.length - missing.length };
}
module.exports = { create, validate, packArchive, openArchive, isEncryptedEnvelope, drill, restorePrivate, exportTable, durableKey };
