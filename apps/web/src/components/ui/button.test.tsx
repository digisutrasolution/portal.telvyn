import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";

describe("Button", () => {
  it("renders an accessible button with type=button by default", () => {
    render(<Button>Assign DID</Button>);
    const btn = screen.getByRole("button", { name: "Assign DID" });
    expect(btn).toHaveAttribute("type", "button");
  });

  it("applies variant classes from the token system", () => {
    render(<Button variant="primary">Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).className).toContain("bg-accent");
  });

  it("disables interaction when disabled", () => {
    render(<Button disabled>Processing</Button>);
    expect(screen.getByRole("button", { name: "Processing" })).toBeDisabled();
  });
});
