import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentRefs } from "./AttachmentStrip";

const mocks = vi.hoisted(() => ({
  useAttachment: vi.fn(),
}));

vi.mock("../api/hooks", () => ({
  useAttachment: mocks.useAttachment,
  useUploadAttachment: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

let intersectionCallback: IntersectionObserverCallback;

beforeEach(() => {
  mocks.useAttachment.mockReset();
  mocks.useAttachment.mockReturnValue({ isPending: true });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    },
  );
});

describe("AttachmentRefs", () => {
  it("does not resolve an attachment until its reference approaches the viewport", () => {
    render(
      <AttachmentRefs roomId="room_example" attachmentIds={["att_example"]} />,
    );

    expect(mocks.useAttachment).toHaveBeenLastCalledWith(
      "room_example",
      "att_example",
      false,
    );
    expect(screen.getByText(/附件引用/)).toBeInTheDocument();

    act(() => {
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(mocks.useAttachment).toHaveBeenLastCalledWith(
      "room_example",
      "att_example",
      true,
    );
  });
});
