import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DeleteStudentDialog from "../../src/features/students/DeleteStudentDialog.jsx";
import { http } from "../../src/lib/http.js";

vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
vi.mock("../../src/components/ui/toast.jsx", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const student = { id: "s1", full_name: "假学员" };
let client;

afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});

function renderDialog() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <DeleteStudentDialog student={student} onClose={onClose} onDeleted={onDeleted} />
    </QueryClientProvider>,
  );
  return { onClose, onDeleted };
}

test("打开时请求删除预览并展示将删除的关联数量", async () => {
  http.mockResolvedValueOnce({
    data: { lessons: 3, package_payments: 2, student_packages: 1, notifications: 0 },
  });
  renderDialog();
  expect(http).toHaveBeenCalledWith("/students/s1/delete-preview", { method: "POST" });
  expect(await screen.findByText(/将永久删除 6 条关联记录/)).toBeInTheDocument();
  expect(screen.getByText("课节").nextSibling.textContent).toBe("3");
  expect(screen.getByText("缴费记录").nextSibling.textContent).toBe("2");
  expect(screen.queryByText("站内通知")).not.toBeInTheDocument();
});

test("未输入密码或未勾选时，确认按钮禁用；齐了才带密码发 DELETE", async () => {
  http.mockResolvedValueOnce({ data: { lessons: 1 } });
  const { onDeleted } = renderDialog();
  await screen.findByText(/将永久删除/);

  const submit = screen.getByRole("button", { name: "确认永久删除" });
  expect(submit).toBeDisabled();

  fireEvent.change(screen.getByLabelText("当前管理员密码"), { target: { value: "secret" } });
  expect(submit).toBeDisabled();

  fireEvent.click(screen.getByText(/我确认永久删除/));
  await waitFor(() => expect(submit).toBeEnabled());

  http.mockResolvedValueOnce({ data: { deleted: true } });
  fireEvent.click(submit);
  await waitFor(() =>
    expect(http).toHaveBeenCalledWith("/students/s1", {
      method: "DELETE",
      body: { confirmed: true, current_password: "secret" },
    }),
  );
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
});

test("预览加载失败时不允许提交", async () => {
  http.mockRejectedValueOnce(new Error("删除功能尚未就绪"));
  renderDialog();
  expect(await screen.findByRole("alert")).toHaveTextContent("删除功能尚未就绪");
  expect(screen.getByRole("button", { name: "确认永久删除" })).toBeDisabled();
});
