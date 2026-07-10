import { describe, expect, it } from "vitest";
import { loadStatus } from "./view-status";

// 뷰 status 축 채택(C2) — 이 콘텐츠 뷰가 코어 browser-loading 신호를 코어 status 축(setStatus)으로
// 보고한다. 코어 status 축 계약(view-status-close-guard)의 blocking 어휘는 { dirty, busy, running }
// 뿐이고 그 code 만 닫기 가드를 발동한다. 그 밖의 code(ready 등)는 표시 전용.
const STATUS_BLOCKING = ["dirty", "busy", "running"] as const;
const isBlocking = (code: string) =>
  (STATUS_BLOCKING as readonly string[]).includes(code);

describe("loadStatus — 브라우저 로드 상태 → status 축 매핑", () => {
  it("로딩 중(loading=true)은 busy 로 보고한다 — 활성 로드는 닫기 가드 대상", () => {
    const s = loadStatus(true);
    expect(s.code).toBe("busy");
    expect(s.messageKey).toBe("statusLoading");
    expect(isBlocking(s.code)).toBe(true);
  });

  it("로드 완료(loading=false)는 ready 로 보고한다 — 표시 전용, 닫기를 막지 않는다", () => {
    const s = loadStatus(false);
    expect(s.code).toBe("ready");
    expect(s.messageKey).toBe("statusReady");
    expect(isBlocking(s.code)).toBe(false);
  });

  it("없는 상태를 지어내지 않는다 — 코어 신호가 없는 error 는 어느 입력에서도 보고 안 함", () => {
    // browser-loading 은 성공 완료(Finished)만 emit — 로드 실패 신호가 없다. 억지 error 금지.
    expect(loadStatus(true).code).not.toBe("error");
    expect(loadStatus(false).code).not.toBe("error");
  });
});
