import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkspaceStudio } from "@/components/dashboard/workspace-studio";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkspaceStudio UI", () => {
  it("shows invalid URL error when private IP is submitted", () => {
    render(<WorkspaceStudio supabaseConfigured={false} />);

    fireEvent.change(screen.getByLabelText("Target website URL"), {
      target: { value: "http://127.0.0.1/secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Load Website Preview/i }));

    expect(screen.getByRole("alert").textContent).toMatch(/Invalid Website URL/i);
  });

  it("renders blocked website diagnostic banner for 422 BLOCKED_BY_CHALLENGE", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "BLOCKED_BY_CHALLENGE",
            message: "CAPTCHA gate detected on the target website.",
          },
        }),
        { status: 422 }
      )
    );

    render(<WorkspaceStudio supabaseConfigured={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Load Website Preview/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /Website Blocked Access/i
      );
    });
  });

  it("renders isolated preview, shows iframe-bypassed header badge, and selects DOM nodes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          previewId: "prev-1",
          finalUrl: "https://news.ycombinator.com/",
          pageTitle: "Hacker News",
          httpStatus: 200,
          resolvedIp: "209.216.230.207",
          frameBlockedByHeader: true,
          framePolicyHeader: "X-Frame-Options: DENY",
          viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
          documentDimensions: { width: 1280, height: 1200 },
          screenshotDataUrl: "data:image/png;base64,iVBORw0KGgo=",
          elements: [
            {
              id: "el-0",
              selector: "a.storylink",
              tag: "a",
              text: "Show HN: SidCrawal",
              boundingBox: { x: 100, y: 120, width: 320, height: 24 },
              metadata: {
                idAttr: null,
                classes: ["storylink"],
                role: null,
                ariaLabel: null,
                href: "https://example.com",
                domDepth: 5,
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    render(<WorkspaceStudio supabaseConfigured={false} />);
    fireEvent.change(screen.getByLabelText("Target website URL"), {
      target: { value: "https://news.ycombinator.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Load Website Preview/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Bypassed iframe restriction \(X-Frame-Options: DENY\)/i)
      ).toBeDefined();
    });

    // Switch to DOM Nodes tab and select element via keyboard/button
    fireEvent.click(screen.getByRole("tab", { name: /DOM Nodes \(1\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /Show HN: SidCrawal/i }));

    fireEvent.click(screen.getByRole("tab", { name: /^Selection$/i }));
    expect(
      (screen.getByLabelText("CSS selector") as HTMLInputElement).value
    ).toBe("a.storylink");
    expect(screen.getByText(/x:100, y:120, w:320, h:24/i)).toBeDefined();
  });
});
