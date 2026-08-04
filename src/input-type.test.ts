import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCommands, registerViewAtMount, unregisterLabel } from "./commands";

describe("input.type 공개 계약", () => {
  afterEach(() => unregisterLabel("v-ime"));

  it("DOM 값을 쓰지 않고 포커스 확인 뒤 엔진 텍스트 입력을 호출한다", async () => {
    const handlers = new Map<string, (params: Record<string, unknown>) => Promise<object> | object>();
    const evalPage = vi.fn(async (_label: string, js: string) => {
      expect(js).toContain(".focus(");
      expect(js).not.toContain(".value =");
      return JSON.stringify({ focused: true });
    });
    const typeText = vi.fn(async () => undefined);
    const subscriptions: { dispose(): void }[] = [];
    registerViewAtMount("v-ime", "b-w-v-ime", "about:blank");

    registerCommands({
      app: {
        commands: {
          register: (name: string, spec: { handler: (p: Record<string, unknown>) => Promise<object> | object }) => {
            handlers.set(name, spec.handler);
            return { dispose() {} };
          },
          execute: vi.fn(),
        },
        events: { on: () => ({ dispose() {} }) },
        webview: { eval: evalPage, typeText },
      },
      subscriptions,
    } as never);

    const outcome = await handlers.get("input.type")!({
      viewId: "v-ime",
      selector: "#ime",
      text: "한글 입력",
    });
    expect(outcome).toEqual({ ok: true, typed: "한글 입력", viewId: "v-ime" });
    expect(typeText).toHaveBeenCalledWith("b-w-v-ime", "한글 입력");
  });
});
