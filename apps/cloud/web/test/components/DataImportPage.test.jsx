import { test, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DataImportPage from "../../src/features/admin/DataImportPage.jsx";

// 解析/下载走真实 xlsx 太重, mock 掉; 文件解析正确性由 SheetJS 保证, 这里只测页面流程
const parseSheetToRows = vi.fn(async () => [
  { 姓名: "张三", 状态: "在读" },
  { 姓名: "李四", 状态: "在读" },
]);
vi.mock("../../src/lib/xlsx.js", () => ({
  parseSheetToRows: (...args) => parseSheetToRows(...args),
  downloadTemplate: vi.fn(async () => {}),
  exportRowsToXlsx: vi.fn(async () => {}),
}));

function makeRes(obj) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(obj),
  };
}

function renderPage() {
  // 页面用了 useMutation / useQuery，必须包 QueryClientProvider，
  // 否则报 "No QueryClient set, use QueryClientProvider to set one"。
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DataImportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function uploadFile(container) {
  const input = container.querySelector('input[type="file"]');
  const file = new File(["dummy"], "学员.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  fireEvent.change(input, { target: { files: [file] } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("选择文件后自动 dryrun 预览, 确认导入以 dryrun:false 提交", async () => {
  const fetchMock = vi.fn(async (url, options) => {
    if (String(url).includes("/admin/import-rows")) {
      const body = JSON.parse(options?.body || "{}");
      return makeRes({
        data: {
          entity: "students",
          dryrun: body.dryrun,
          created: 2,
          updated: 0,
          skipped: 0,
          errors: [],
        },
      });
    }
    return makeRes({ data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { container } = renderPage();

  uploadFile(container);

  await waitFor(() => expect(screen.getByText("将新增 2")).toBeInTheDocument());
  expect(screen.getByText("跳过 0")).toBeInTheDocument();

  fireEvent.click(screen.getByText("确认导入"));

  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some((c) => {
        if (!String(c[0]).includes("/admin/import-rows")) return false;
        const body = JSON.parse(c[1]?.body || "{}");
        return body.dryrun === false && Array.isArray(body.rows) && body.rows.length === 2;
      }),
    ).toBe(true),
  );
  await waitFor(() => expect(screen.getByText(/已导入：新增 2/)).toBeInTheDocument());
});

test("dryrun 返回错误行时展示问题列表", async () => {
  const fetchMock = vi.fn(async (url) => {
    if (String(url).includes("/admin/import-rows")) {
      return makeRes({
        data: {
          entity: "students",
          dryrun: true,
          created: 1,
          updated: 0,
          skipped: 0,
          errors: ["第 2 行缺少姓名"],
        },
      });
    }
    return makeRes({ data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { container } = renderPage();

  uploadFile(container);

  await waitFor(() => expect(screen.getByText(/1 行有问题/)).toBeInTheDocument());
  expect(screen.getByText(/第 2 行缺少姓名/)).toBeInTheDocument();
});

test("空文件给出提示且不发请求", async () => {
  parseSheetToRows.mockResolvedValueOnce([{ 姓名: "", 状态: "" }]);
  const fetchMock = vi.fn(async () => makeRes({ data: [] }));
  vi.stubGlobal("fetch", fetchMock);
  const { container } = renderPage();

  uploadFile(container);

  await waitFor(() => expect(screen.getByText("文件里没有可导入的数据行")).toBeInTheDocument());
  expect(
    fetchMock.mock.calls.filter((c) => String(c[0]).includes("/admin/import-rows")),
  ).toHaveLength(0);
});
