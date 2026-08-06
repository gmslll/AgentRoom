import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeliveryStatusBadge } from "./DeliveryStatusBadge";

describe("DeliveryStatusBadge", () => {
  it("renders checklist-compliant labels for every status", () => {
    const cases: Array<
      [Parameters<typeof DeliveryStatusBadge>[0]["status"], string]
    > = [
      ["queued", "等待终端"],
      ["received", "已送达终端"],
      ["running", "AI 处理中"],
      ["replied", "已回复"],
      ["failed", "执行失败"],
    ];
    for (const [status, label] of cases) {
      const { unmount } = render(<DeliveryStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("exposes the failure reason as a tooltip", () => {
    render(<DeliveryStatusBadge status="failed" error="timeout" />);
    expect(screen.getByText("执行失败")).toHaveAttribute("title", "timeout");
  });
});
