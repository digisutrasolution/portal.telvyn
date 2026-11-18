import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "./input";
import { Field } from "./field";

describe("Input + Field", () => {
  it("renders an input of the given type", () => {
    render(<Input type="email" aria-label="Email" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("associates the label with its control via a shared id", () => {
    render(
      <Field id="f-email" label="Email">
        <Input id="f-email" />
      </Field>,
    );
    expect(screen.getByLabelText("Email").id).toBe("f-email");
  });

  it("renders an error as role=alert", () => {
    render(
      <Field id="f-email" label="Email" error="Required">
        <Input id="f-email" />
      </Field>,
    );
    expect(screen.getByRole("alert").textContent).toBe("Required");
  });

  it("shows a hint only when there is no error", () => {
    const { rerender } = render(
      <Field id="f-email" label="Email" hint="Use your work email">
        <Input id="f-email" />
      </Field>,
    );
    expect(screen.getByText("Use your work email")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <Field id="f-email" label="Email" hint="Use your work email" error="Required">
        <Input id="f-email" />
      </Field>,
    );
    expect(screen.getByRole("alert").textContent).toBe("Required");
    expect(screen.queryByText("Use your work email")).toBeNull();
  });
});
