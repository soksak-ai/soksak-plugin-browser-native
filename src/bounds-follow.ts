// 네이티브 webview 의 DOM 앵커 추종 정책(순수) — browser-view 의 rAF 루프·syncBounds 가 사용한다.
// 계약: 디바이더 드래그(gesture) 중에도 추종은 계속되고 bounds 커밋은 유예되지 않는다 —
// DOM 분할은 매 프레임 라이브 커밋이므로 네이티브가 같은 리듬으로 따라와야 실시간 리사이즈다.
// (과거 freeze-frame 은 드래그 동안 커밋을 전면 유예하고 정지 사진으로 덮었다 — 콘텐츠 박제와
//  잔상(옛 크기 스탠드인이 빈 슬롯 노출)의 근원. 그 유예를 되살리면 이 테스트가 깨진다.)

/** rAF 추종 루프 지속 판정 — 드래그(live·gesture) 중엔 항상 계속, 아니면 rect 안정 시 자가종료.
 *  veiled(스탠드인 뒤)면 즉시 멈춘다: 보이지 않는 표면을 따라가는 것은 낭비이고, 그 쓰기가
 *  착지 스냅과 경쟁해 어긋남을 만든다(§4.6 — 위상 중 쓰기 주체는 없다). */
export function followShouldContinue(i: {
  live: boolean;
  gesture: boolean;
  veiled?: boolean;
  stableFrames: number;
  stopAfter: number;
}): boolean {
  if (i.veiled) return false;
  return i.live || i.gesture || i.stableFrames < i.stopAfter;
}

/** bounds 커밋 판정. 순서가 계약이다:
 *  ① force 는 무엇도 관통한다 — 종료 에지의 정확 스냅(§4.5-4)은 유일한 착지 쓰기이므로 절대
 *     스킵될 수 없다(same-rect 를 먼저 보던 종전 코드는 캐시가 조금이라도 어긋나면 착지를
 *     영구히 삼켰다).
 *  ② veiled = 스탠드인 뒤 — 따라가지 않는다(§4.6).
 *  ③ same-rect 는 무전송(§4.5-2).
 *  ④ 창 라이브 리사이즈만 스로틀. gesture 는 입력이지만 어떤 유예도 만들지 않는다(실시간 계약). */
export function boundsCommitDecision(i: {
  force: boolean;
  live: boolean;
  gesture: boolean;
  veiled?: boolean;
  sameRect: boolean;
  msSinceLast: number;
  throttleMs: number;
}): "send" | "skip" | "pending" {
  if (i.force) return "send";
  if (i.veiled) return "skip";
  if (i.sameRect) return "skip";
  if (i.live && i.msSinceLast < i.throttleMs) return "pending";
  return "send";
}

// 선행 외삽은 킷(soksak-kit-browser-common)의 단일 구현을 재수출한다 — 세 브라우저가
// 같은 코드를 소비한다(재발명 금지). 동결 판정·기계는 코어 슬롯 동결(§4.6)로 승격됐다.
export { leadPosition } from "soksak-kit-browser-common";
