import { useState } from "react";
import { test, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Dialog } from "../../src/components/ui/dialog.jsx";
afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});
function Harness() {
  const [inner, setInner] = useState(false);
  return (
    <Dialog open title="课节详情">
      <button onClick={() => setInner(true)}>调整时间</button>
      {inner && (
        <Dialog open layer={1} title="确认调整" onClose={() => setInner(false)}>
          <input aria-label="时间" />
        </Dialog>
      )}
    </Dialog>
  );
}
test("Esc 仅关闭最上层确认窗口，详情保留且滚动锁仍有效", () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("调整时间"));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "确认调整" })).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "课节详情" })).toBeInTheDocument();
  expect(document.body.style.overflow).toBe("hidden");
});
