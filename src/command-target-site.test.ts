import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as commandsModule from "./commands";
import { connectCommandTarget, resolveEntry } from "./commands";

describe("명령 대상 등록 자리는 provider.connect 하나다", () => {
  it("connect 가 등록하고 그 반환이 해제한다", () => {
    expect(resolveEntry("v-connect")).toBeNull();
    const disconnect = connectCommandTarget("v-connect", "b-w-v-connect", "https://example.com/");
    expect(resolveEntry("v-connect")?.label).toBe("b-w-v-connect");
    disconnect();
    expect(resolveEntry("v-connect")).toBeNull();
  });

  it("등록·해제를 connect 밖으로 내주지 않는다", () => {
    // 자리가 하나여야 한다는 규칙은 세지 않고 요구한다 — 부를 함수가 없으면 딴 데서 못 부른다.
    const surface = Object.keys(commandsModule);
    expect(surface).toContain("connectCommandTarget");
    expect(surface).not.toContain("registerLabel");
    expect(surface).not.toContain("registerViewAtMount");
    expect(surface).not.toContain("unregisterLabel");
  });

  it("DOM 마운트와 뷰 컴포넌트는 명령 대상 수명을 소유하지 않는다", () => {
    const entry = readFileSync(new URL("./plugin-entry.tsx", import.meta.url), "utf8");
    expect(entry).toContain("connectCommandTarget");
    // mount 가 등록하지 않으니 "어느 컨테이너가 어느 뷰였나"를 적어 둘 이유도 사라진다.
    expect(entry).not.toContain("mountedViewOf");

    const view = readFileSync(new URL("./browser-view.tsx", import.meta.url), "utf8");
    expect(view).not.toContain("registerLabel");
    expect(view).not.toContain("unregisterLabel");
  });
});
