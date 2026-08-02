export function visibleFromComputedStyle(style: {
  visibility: string;
  display: string;
}): boolean {
  return style.visibility !== "hidden" && style.display !== "none";
}

/** 조상 가시성까지 계산된 DOM 사실. 좌표는 가시성의 대리값이 아니다. */
export function visibleFromAnchor(anchor: HTMLElement): boolean {
  return visibleFromComputedStyle(getComputedStyle(anchor));
}
