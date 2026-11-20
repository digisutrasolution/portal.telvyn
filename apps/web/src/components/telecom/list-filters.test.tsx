import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ListFilters } from "./list-filters";

describe("ListFilters", () => {
  it("renders a labelled search box and reports each change to the parent", () => {
    const onChange = vi.fn();
    render(<ListFilters search={{ value: "", onChange, label: "Search carriers" }} />);
    const box = screen.getByRole("searchbox", { name: "Search carriers" });
    fireEvent.change(box, { target: { value: "acme" } });
    expect(onChange).toHaveBeenCalledWith("acme");
  });

  it("renders a select with an All option and reports the chosen value", () => {
    const onChange = vi.fn();
    render(
      <ListFilters
        selects={[
          { name: "status", label: "Filter by status", value: "", options: [{ value: "ACTIVE", label: "Active" }], allLabel: "All statuses", onChange },
        ]}
      />,
    );
    expect(screen.getByRole("option", { name: "All statuses" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "ACTIVE" } });
    expect(onChange).toHaveBeenCalledWith("ACTIVE");
  });

  it("shows Clear only when a filter is active, and fires onClear", () => {
    const onClear = vi.fn();
    const { rerender } = render(<ListFilters onClear={onClear} canClear={false} />);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    rerender(<ListFilters onClear={onClear} canClear />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
