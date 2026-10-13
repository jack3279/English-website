import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BackupsPage from '../../src/features/admin/BackupsPage.jsx';
import { http } from '../../src/lib/http.js';
vi.mock('../../src/lib/http.js', () => ({ http: vi.fn() }));
vi.mock('../../src/components/PageHeader.jsx', () => ({ PageHeader: ({ title }) => <h1>{title}</h1> }));
vi.mock('../../src/components/ui/toast.jsx', () => ({ useToast: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
let client;
afterEach(() => { cleanup(); client?.clear(); vi.clearAllMocks(); });
function mount(complete = true, encrypted = true) {
  http.mockImplementation(async (path, opts) => {
    if (path === '/backups') return { data: { bound: true, items: [{ date: '2026-10-13', size: 3000 }] } };
    if (path.endsWith('/diff')) return { data: { tables: [{ table: 'students', backupRows: 2, dbRows: 1, missing: 1, verified: true }], totalMissing: 1 } };
    if (path.endsWith('/restore')) return { data: { dryRun: opts.body.dryRun, totalPlanned: 1, inserted: 1, results: [] } };
    if (path.endsWith('/private-restore')) return { data: { dryRun: opts.body.dryRun, missing: 1, existing: 2, inserted: opts.body.dryRun ? 0 : 1 } };
    return { data: { version: 'v3', complete, encrypted, tables: [{}], private: { ok: complete, count: 3 }, auth: { ok: true, count: 4 } } };
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BackupsPage /></QueryClientProvider>);
}
test('实际恢复需要管理员密码，预览不提交密码', async () => {
  mount();
  const restore = await screen.findByRole('button', { name: '确认恢复 1 行' }, { timeout: 5000 });
  expect(restore).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '预览这次会补回什么' }));
  await waitFor(() => expect(http.mock.calls.some(([p, o]) => p.endsWith('/restore') && o.body.dryRun)).toBe(true));
  const call = http.mock.calls.find(([p]) => p.endsWith('/restore'));
  expect(call[1].body.current_password).toBeUndefined();
  fireEvent.change(screen.getByLabelText(/当前管理员密码/), { target: { value: 'test-confirmation' } });
  expect(restore).toBeEnabled();
});
test('新加密备份明确显示整库已加密', async () => {
  mount(true, true);
  expect(await screen.findByText('整库已加密')).toBeInTheDocument();
  expect(screen.getByText(/下载到的是加密信封/)).toBeInTheDocument();
});

test('历史明文备份显示风险提示', async () => {
  mount(true, false);
  expect(await screen.findByText('历史明文备份')).toBeInTheDocument();
  expect(screen.getByText(/下载后是明文 JSON/)).toBeInTheDocument();
});

test('不完整备份禁用恢复演练及私有数据恢复', async () => {
  mount(false);
  expect(await screen.findByRole('button', { name: '验证私有数据恢复' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '预览私有数据恢复' })).toBeDisabled();
  expect(screen.getByText(/旧格式或导出不完整/)).toBeInTheDocument();
});
test('私有数据先预览且保持现有设置，不自动实际恢复', async () => {
  mount();
  const preview = await screen.findByRole('button', { name: '预览私有数据恢复' });
  await waitFor(() => expect(preview).toBeEnabled());
  fireEvent.click(preview);
  expect(await screen.findByText('缺失 1 个，现有 2 个保持不变')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认补回私有数据' })).toBeDisabled();
  expect(http.mock.calls.filter(([p]) => p.endsWith('/private-restore'))[0][1].body.dryRun).toBe(true);
});
