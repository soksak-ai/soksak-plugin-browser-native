// 툴바 행 계약(코어 PLUGIN-CONTRACT §Toolbar row) — 툴바는 선택 표면이지만, 존재하면
// 치수를 테마 토큰(--toolbar-h/--toolbar-pad-x)에서 소비한다. 자체 수치 재창조 금지.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GLOBAL_CSS as CSS } from "./styles.ts";

describe("toolbar row contract", () => {
  it("bv-bar consumes the theme toolbar tokens", () => {
    const bar = CSS.match(/\.bv-bar \{[^}]*\}/)?.[0] ?? "";
    assert.match(bar, /height:\s*var\(--toolbar-h/);
    assert.match(bar, /padding:\s*0 var\(--toolbar-pad-x/);
    assert.doesNotMatch(bar, /height:\s*\d/);
  });
});
