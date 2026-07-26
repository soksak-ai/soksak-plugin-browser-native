import { describe, expect, it } from "vitest";
import { registerViewAtMount, resolveEntry, unregisterLabel } from "./commands";

// mount 동기 등록 계약(C3 의 플러그인판).
//
// RED 근거(실측, 2026-07-26): tab.open 이 마운트를 기다려 mounted:true 로 답했는데도 그
// tabId 로 보낸 navigate 가 NO_VIEW 였다(갓 부팅한 창, browser-pixels 하니스). 코어의
// mounted 신호는 provider.mount 반환이고, 등록이 React 이펙트(페인트 후)에만 있으면
// mounted 직후 명령이 미등록 창에 떨어진다. 등록은 mount 의 동기 경로에서 해야 한다 —
// registerViewAtMount 가 그 경로다(chromium 엔진과 같은 계약).
describe("mount 동기 등록 — mounted:true 를 본 호출자의 즉시 명령이 뷰를 찾는다", () => {
  it("registerViewAtMount 직후 명시 viewId 해소가 그 뷰를 찾는다", () => {
    registerViewAtMount("tab-sync01", "b-w-x-tab-sync01", "https://example.com/");
    const entry = resolveEntry("tab-sync01");
    expect(entry?.label).toBe("b-w-x-tab-sync01");
    expect(entry?.getUrl()).toBe("https://example.com/");
    unregisterLabel("tab-sync01");
  });

  it("해제 후에는 명시 해소가 null — 조용히 다른 뷰로 돌리지 않는다", () => {
    registerViewAtMount("tab-sync02", "b-w-x-tab-sync02", "about:blank");
    unregisterLabel("tab-sync02");
    expect(resolveEntry("tab-sync02")).toBeNull();
  });
});
