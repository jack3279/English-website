const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');
const archive = require('../lib/backupArchive.js');
const { TABLES } = require('../lib/backup.js');
function bucket() {
  const data = new Map([['private/institution/settings-v1', Buffer.from('{"iv":"encrypted","data":"ciphertext"}')], ['private/payroll-pricing/v1', Buffer.from('pricing-cipher')], ['private/workflow-locks/student/1', Buffer.from('lock')]]);
  return { data, async list({ prefix }) { return { objects: [...data.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; }, async get(k) { const bytes = data.get(k); return bytes ? { text: async () => bytes.toString(), arrayBuffer: async () => bytes, } : null; }, async put(k, v, options) { if (options?.onlyIf && data.has(k)) return null; data.set(k, Buffer.from(v)); return { etag: '1' }; }, async delete(keys) { for (const k of keys) data.delete(k); } };
}
function db(rows = []) {
  return { from() { return { select() { return this; }, order() { return this; }, async range(a, b) { return { data: rows.slice(a, b+1), count: rows.length }; } }; }, auth: { admin: { async listUsers() { return { data: { users: [{ id: 'user', email: 'fake@example.invalid', encrypted_password: 'must-never-copy', app_metadata: { role: 'admin' } }] } }; } } } };
}
test('分页导出超过1000行，不受单次返回上限影响', async () => {
  const rows = Array.from({ length: 1201 }, (_, i) => ({ id: String(i) }));
  assert.equal((await archive.exportTable(db(rows), 'students', { left: 4 })).length, 1201);
});
test('返回行数少于数据库数量，明确拒绝不完整导出', async () => {
  const d = db(); d.from = () => ({ select() { return this; }, order() { return this; }, range: async () => ({ data: [{ id: '1' }], count: 1001 }) });
  await assert.rejects(archive.exportTable(d, 'students', { left: 4 }), /数量不符/);
});
test('新备份覆盖全部业务表及私有数据，排除锁与密码', async () => {
  const a = await archive.create(db(), bucket());
  assert.equal(a.complete, true);
  assert.equal(Object.keys(a.tables).length, TABLES.length);
  assert.equal(a.private_objects.length, 2);
  assert(!JSON.stringify(a).includes('must-never-copy'));
  assert.equal((await archive.validate(a)).verified, true);
});
test('每日备份使用 AES-GCM 信封加密，并能解密回完整归档', async () => {
  const a = await archive.create(db([{ id: 'secret-student' }]), bucket());
  const envelope = await archive.packArchive(a);
  assert.equal(envelope.format, 'encrypted-backup');
  assert.equal(envelope.encryption, 'AES-GCM');
  assert.equal(JSON.stringify(envelope).includes('secret-student'), false);
  const opened = await archive.openArchive(envelope);
  assert.equal(opened.encrypted, true);
  assert.equal(opened.archive.tables.students[0].id, 'secret-student');
  assert.equal((await archive.validate(opened.archive)).encrypted, true);
});

test('旧明文备份继续可读但标记为未加密', async () => {
  const legacy = await archive.create(db(), bucket());
  const opened = await archive.openArchive(legacy);
  assert.equal(opened.encrypted, false);
  assert.equal(opened.archive.encrypted, false);
  assert.equal((await archive.validate(opened.archive)).encrypted, false);
});

test('加密信封被篡改时拒绝解密', async () => {
  const envelope = await archive.packArchive(await archive.create(db(), bucket()));
  envelope.data = envelope.data.replace(/.$/, envelope.data.endsWith('=') ? 'A' : '=');
  await assert.rejects(archive.openArchive(envelope), /备份解密失败/);
});

test('任一内容被篡改，拒绝恢复', async () => {
  const a = await archive.create(db(), bucket()); a.tables.students.push({ id: 'unexpected' });
  await assert.rejects(archive.validate(a), /校验失败/);
});
test('恢复演练只写独立副本，读回校验后清理，不影响原数据', async () => {
  const b = bucket(), a = await archive.create(db(), b), before = [...b.data].map(([k,v]) => [k,v.toString()]);
  assert.equal((await archive.drill(b, a)).privateObjects, 2);
  assert.deepEqual([...b.data].map(([k,v]) => [k,v.toString()]), before);
});
test('私有对象只补缺失，现有较新设置不覆盖，重复恢复不多写', async () => {
  const source = bucket(), a = await archive.create(db(), source), target = bucket();
  target.data.delete('private/payroll-pricing/v1'); target.data.set('private/institution/settings-v1', Buffer.from('newer-setting'));
  assert.equal((await archive.restorePrivate(target, a)).missing, 1);
  assert(!target.data.has('private/payroll-pricing/v1'));
  assert.equal((await archive.restorePrivate(target, a, false)).inserted, 1);
  assert.equal((await archive.restorePrivate(target, a, false)).inserted, 0);
  assert.equal(target.data.get('private/institution/settings-v1').toString(), 'newer-setting');
});
test('预算耗尽或私有对象读取失败，不能标记完整，不能演练', async () => {
  const b = bucket(); b.get = async () => null;
  const a = await archive.create(db(), b);
  assert.equal(a.complete, false);
  await assert.rejects(archive.drill(b, a), /不完整/);
});
