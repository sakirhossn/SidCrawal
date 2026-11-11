import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InteractivePreview } from "@/components/landing/interactive-preview";
import { UrlQuickstart } from "@/components/landing/url-quickstart";

afterEach(() => {
  cleanup();
});

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

describe("InteractivePreview", () => {
  it("switches between sample targets and diff mode", () => {
    render(<InteractivePreview />);

    expect(screen.getByText(/Sample Preview • Phase 1 UI/i)).toBeDefined();
    expect(screen.getByText(/\$29 \/ month/i)).toBeDefined();

    fireEvent.click(screen.getByRole("tab", { name: "Service Status Banner" }));
    expect(screen.getByText(/All Systems Operational/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Diff Alert" }));
    expect(screen.getByText(/Degraded Performance/i)).toBeDefined();
  });
});

describe("UrlQuickstart", () => {
  it("blocks localhost SSRF targets before navigation", () => {
    pushMock.mockReset();
    render(<UrlQuickstart />);

    const input = screen.getByLabelText("Website URL to monitor");
    fireEvent.change(input, { target: { value: "http://127.0.0.1:8080/admin" } });
    fireEvent.click(screen.getByRole("button", { name: /Prepare Monitor/i }));

    expect(screen.getByRole("alert")).toBeDefined();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates to Add Monitor with normalized URL for valid public targets", () => {
    pushMock.mockReset();
    render(<UrlQuickstart />);

    const input = screen.getByLabelText("Website URL to monitor");
    fireEvent.change(input, { target: { value: "https://example.com/status#top" } });
    fireEvent.click(screen.getByRole("button", { name: /Prepare Monitor/i }));

    expect(pushMock).toHaveBeenCalledWith(
      "/dashboard/monitors/new?url=https%3A%2F%2Fexample.com%2Fstatus"
    );
  });
});
