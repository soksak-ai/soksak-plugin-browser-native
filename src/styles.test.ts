import { describe, expect, it } from "vitest";
import { cspStyleNonce } from "./styles";

describe("browser stylesheet CSP contract", () => {
  it("정적 문서 style의 Tauri nonce를 동적 plugin style에 이어준다", () => {
    const doc = {
      querySelector: () => ({ nonce: "tauri-build-nonce" }),
    } as unknown as Document;

    expect(cspStyleNonce(doc)).toBe("tauri-build-nonce");
  });

  it("nonce가 없는 Electron DOM에서는 속성을 만들지 않는다", () => {
    const doc = { querySelector: () => null } as unknown as Document;
    expect(cspStyleNonce(doc)).toBeUndefined();
  });
});
