import { afterEach, describe, expect, it, vi } from "vitest";
import { connectCommandTarget, registerCommands } from "./commands";
import { declareRealm } from "./realm-fixture";

describe("input.type 공개 계약", () => {
  let disconnect = () => {};
  afterEach(() => disconnect());

  it("DOM 값을 쓰지 않고 포커스 확인 뒤 엔진 텍스트 입력을 호출한다", async () => {
    const handlers = new Map<string, (params: Record<string, unknown>) => Promise<object> | object>();
    const evalPage = vi.fn(async (_label: string, js: string) => {
      expect(js).toContain(".focus(");
      expect(js).not.toContain(".value =");
      return JSON.stringify({ focused: true });
    });
    const typeText = vi.fn(async () => undefined);
    const subscriptions: { dispose(): void }[] = [];
    disconnect = connectCommandTarget("v-ime", "b-w-v-ime", "about:blank");

    const app = declareRealm("window", {
      commands: {
        register: (name: string, spec: { handler: (p: Record<string, unknown>) => Promise<object> | object }) => {
          handlers.set(name, spec.handler);
          return { dispose() {} };
        },
        execute: vi.fn(),
      },
      events: { on: () => ({ dispose() {} }) },
      webview: { eval: evalPage, typeText },
    });
    registerCommands({ app, subscriptions } as never);

    const outcome = await handlers.get("input.type")!({
      viewId: "v-ime",
      selector: "#ime",
      text: "한글 입력",
    });
    expect(outcome).toEqual({ ok: true, typed: "한글 입력", viewId: "v-ime" });
    expect(typeText).toHaveBeenCalledWith("b-w-v-ime", "한글 입력");
  });
});

describe("input.scroll 공개 계약", () => {
  let disconnect = () => {};
  afterEach(() => disconnect());

  it("페이지를 직접 바꾸지 않고 측정한 좌표로 엔진 휠 입력을 보낸다", async () => {
    const handlers = new Map<string, (params: Record<string, unknown>) => Promise<object> | object>();
    const evalPage = vi.fn(async (_label: string, js: string) => {
      expect(js).toContain("getBoundingClientRect");
      expect(js).not.toContain("scrollBy");
      return JSON.stringify({ found: true, point: { x: 31, y: 47 } });
    });
    const wheel = vi.fn(async () => undefined);
    disconnect = connectCommandTarget("v-scroll", "b-w-v-scroll", "about:blank");

    const app = declareRealm("window", {
      commands: {
        register: (name: string, spec: { handler: (p: Record<string, unknown>) => Promise<object> | object }) => {
          handlers.set(name, spec.handler);
          return { dispose() {} };
        },
        execute: vi.fn(),
      },
      events: { on: () => ({ dispose() {} }) },
      webview: { eval: evalPage, wheel },
    });
    registerCommands({ app, subscriptions: [] } as never);

    expect(handlers.has("input.scroll")).toBe(true);
    const outcome = await handlers.get("input.scroll")!({
      viewId: "v-scroll",
      selector: "#feed",
      dx: 0,
      dy: 240,
    });
    expect(outcome).toEqual({ ok: true, scrolled: { dx: 0, dy: 240 }, viewId: "v-scroll" });
    expect(wheel).toHaveBeenCalledWith("b-w-v-scroll", 31, 47, 0, 240);
  });
});
