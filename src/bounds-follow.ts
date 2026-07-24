// 네이티브 webview 의 DOM 앵커 추종 정책(순수) — browser-view 의 rAF 루프·syncBounds 가 사용한다.
// 계약: 디바이더 드래그(gesture) 중에도 추종은 계속되고 bounds 커밋은 유예되지 않는다 —
// DOM 분할은 매 프레임 라이브 커밋이므로 네이티브가 같은 리듬으로 따라와야 실시간 리사이즈다.
// (과거 freeze-frame 은 드래그 동안 커밋을 전면 유예하고 정지 사진으로 덮었다 — 콘텐츠 박제와
//  잔상(옛 크기 스탠드인이 빈 슬롯 노출)의 근원. 그 유예를 되살리면 이 테스트가 깨진다.)

/** rAF 추종 루프 지속 판정 — 드래그(live·gesture) 중엔 항상 계속, 아니면 rect 안정 시 자가종료. */
export function followShouldContinue(i: {
  live: boolean;
  gesture: boolean;
  stableFrames: number;
  stopAfter: number;
}): boolean {
  return i.live || i.gesture || i.stableFrames < i.stopAfter;
}

/** bounds 커밋 판정 — same-rect 스킵(IPC 0), 창 라이브 리사이즈(live)만 스로틀, force 는 항상 전송.
 *  gesture 는 입력이지만 어떤 유예도 만들지 않는다(실시간 계약). */
export function boundsCommitDecision(i: {
  force: boolean;
  live: boolean;
  gesture: boolean;
  sameRect: boolean;
  msSinceLast: number;
  throttleMs: number;
}): "send" | "skip" | "pending" {
  if (i.sameRect) return "skip";
  if (!i.force && i.live && i.msSinceLast < i.throttleMs) return "pending";
  return "send";
}

/** 1프레임 선행 외삽(순수) — 모션 위상 중 송신 위치를 다음 표시 프레임의 예상 위치로 민다.
 * rAF 가 읽는 rect 는 "지금 화면 위치"고 setFrame 은 다음 리프레시에 그려지므로, 표시 시점엔
 * DOM 이 정확히 한 프레임 앞서 있다 — 격차 = 속도×1프레임(강조바는 마우스 속도라 지각 밖,
 * FLIP 주행은 프레임당 수십 px 라 벌어져 보인다). 연속 두 샘플의 델타를 한 번 더 밀어 상쇄한다.
 * 정지·직전샘플 부재·teleport(재배치 점프) 는 실측 그대로 — 외삽은 등속 구간에서만 이득이다. */
export function leadPosition(i: {
  prev: { x: number; y: number } | null;
  cur: { x: number; y: number };
  moving: boolean;
  teleportPx: number;
}): { x: number; y: number } {
  if (!i.moving || !i.prev) return i.cur;
  const dx = i.cur.x - i.prev.x;
  const dy = i.cur.y - i.prev.y;
  if (dx === 0 && dy === 0) return i.cur;
  if (Math.abs(dx) > i.teleportPx || Math.abs(dy) > i.teleportPx) return i.cur;
  return { x: i.cur.x + dx, y: i.cur.y + dy };
}
