import { describe, expect, it } from "vitest";
import { visibleFromComputedStyle } from "./view-visibility";

describe("브라우저 표면 초기 가시성", () => {
  it("조상 DOM에서 계산된 hidden은 숨김이다", () => {
    expect(visibleFromComputedStyle({ visibility: "hidden", display: "block" })).toBe(false);
  });

  it("보이는 DOM 자리는 보임이다", () => {
    expect(visibleFromComputedStyle({ visibility: "visible", display: "block" })).toBe(true);
  });

  it("display none도 숨김이다", () => {
    expect(visibleFromComputedStyle({ visibility: "visible", display: "none" })).toBe(false);
  });
});
