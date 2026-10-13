import {MemoryRouter} from "react-router-dom";
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TeachersPage from "../../src/features/admin/TeachersPage.jsx";
vi.mock("../../src/lib/http.js", () => ({
  http: async () => ({
    data: [
      { id: "t1", full_name: "Alice", active: true, specialties: ["kids"], hourly_pay: 200 },
      { id: "t2", full_name: "Bob", active: false, specialties: ["business"], hourly_pay: 150 },
    ],
  }),
}));
vi.mock("../../src/components/PageHeader.jsx", () => ({
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));
vi.mock("../../src/components/ui/toast.jsx", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
let client;
afterEach(() => {
  cleanup();
  client?.clear();
});
test("教师列表可按专长搜索，并与在职筛选组合使用", async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><TeachersPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("Alice");
  fireEvent.change(screen.getByRole("textbox", { name: "搜索教师" }), {
    target: { value: "business" },
  });
  expect(screen.getByText("Bob")).toBeInTheDocument();
  expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^在职/ }));
  expect(screen.getByText("没有匹配的教师")).toBeInTheDocument();
  expect(screen.queryByText("Bob")).not.toBeInTheDocument();
});
