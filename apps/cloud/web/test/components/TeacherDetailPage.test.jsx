import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TeacherDetailPage from "../../src/features/admin/TeacherDetailPage.jsx";
import { http } from "../../src/lib/http.js";

vi.mock("react-router-dom", async (original) => ({
  ...(await original()),
  useParams: () => ({ id: "teacher-row" }),
}));
vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
vi.mock("../../src/features/schedule/useSchedule.js", () => ({
  useSchedule: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("../../src/features/admin/TeachersPage.jsx", () => ({
  TeacherFormModal: () => <div>教师表单</div>,
}));
vi.mock("../../src/components/PageHeader.jsx", () => ({
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));
vi.mock("../../src/components/ui/toast.jsx", () => ({ useToast: () => ({ error: vi.fn() }) }));

let client;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});

test("教师档案缺少 profile_id 时不请求课酬报表或课表", async () => {
  http.mockImplementation((path) => {
    if (path === "/teachers") {
      return Promise.resolve({ data: [{ id: "teacher-row", full_name: "待建档教师" }] });
    }
    return Promise.resolve({ data: {} });
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TeacherDetailPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );

  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "待建档教师", level: 2 })).toBeInTheDocument(),
  );
  expect(http).toHaveBeenCalledTimes(1);
  expect(http).toHaveBeenCalledWith("/teachers");
});
