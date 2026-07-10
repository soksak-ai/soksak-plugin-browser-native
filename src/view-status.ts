// 브라우저 콘텐츠 뷰의 로드 상태 → 코어 status 축(PluginViewContext.setStatus) 매핑(순수).
// browser-view 가 코어 browser-loading 이벤트에서 이 함수로 매핑해 setStatus 로 보고한다.
//
// 코어 status 축 계약(view-status-close-guard):
//   - blocking 어휘 = { dirty, busy, running } — 이 code 만 닫기 가드를 발동한다(viewCloseReason).
//   - 그 밖의 code(ready 등)는 표시 전용 — 닫기를 막지 않는다.
//
// 이 뷰의 진짜 상태만 보고한다:
//   - 로딩 중(loading=true)   → busy   (활성 로드 — 닫기 가드 대상. 미디어 재생·다운로드 진행과 동형)
//   - 로드 완료(loading=false) → ready  (표시 전용 — 닫기를 막지 않는다)
//
// 로드 실패(error)는 보고하지 않는다: 코어 webview API 는 성공 완료(browser-loading loading=false)만
// emit 하고 로드 실패 신호가 없다. 없는 상태를 지어내지 않는다(억지 상태 금지). 실패 보고가 필요하면
// 코어가 로드 실패 신호를 내는 인터페이스 확장이 선행한다 — 이 플러그인 안에서 조작할 표면이 아니다.

export interface LoadStatus {
  code: "busy" | "ready";
  messageKey: "statusLoading" | "statusReady";
}

/** browser-loading 의 loading 플래그를 status 축 code+메시지 키로 매핑. i18n 해소는 호출측(t)이 한다. */
export function loadStatus(loading: boolean): LoadStatus {
  return loading
    ? { code: "busy", messageKey: "statusLoading" }
    : { code: "ready", messageKey: "statusReady" };
}
