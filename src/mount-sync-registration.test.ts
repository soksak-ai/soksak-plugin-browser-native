import { describe, expect, it } from "vitest";
import { connectCommandTarget, resolveEntry } from "./commands";

// 인스턴스 connect 동기 등록 계약(C3 의 플러그인판).
//
// RED 근거(실측, 2026-07-26): tab.open 이 마운트를 기다려 mounted:true 로 답했는데도 그
// tabId 로 보낸 navigate 가 NO_VIEW 였다(갓 부팅한 창, browser-pixels 하니스). 코어의
// 명령 소유권을 DOM mount에 묶으면 별도 renderer를 쓰는 프레임워크에서 부모 명령 레지스트리가
// 비게 된다. connect는 DOM보다 먼저 제품 인스턴스를 등록하고, presentation ready 이후
// mounted:true가 되어 호출자의 즉시 명령이 실제 표면까지 도달한다.
describe("connect 동기 등록 — DOM renderer 위치와 무관하게 명령이 뷰를 찾는다", () => {
  it("connect 직후 명시 viewId 해소가 그 뷰를 찾는다", () => {
    const disconnect = connectCommandTarget("tab-sync01", "b-w-x-tab-sync01", "https://example.com/");
    const entry = resolveEntry("tab-sync01");
    expect(entry?.label).toBe("b-w-x-tab-sync01");
    expect(entry?.getUrl()).toBe("https://example.com/");
    disconnect();
  });

  it("해제 후에는 명시 해소가 null — 조용히 다른 뷰로 돌리지 않는다", () => {
    connectCommandTarget("tab-sync02", "b-w-x-tab-sync02", "about:blank")();
    expect(resolveEntry("tab-sync02")).toBeNull();
  });
});
