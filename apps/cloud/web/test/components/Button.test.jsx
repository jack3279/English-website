import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "../../src/components/Button.jsx";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText("Click me")).toBeInTheDocument();
  });
  it("applies variant class", () => {
    render(<Button variant="danger">X</Button>);
    expect(screen.getByText("X").className).toContain("bg-danger-600");
  });
});
