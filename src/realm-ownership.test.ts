import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { registerCommands } from "./commands";
import { declareRealm } from "./realm-fixture";
import { declaredRealm, ownsWindowRegistry } from "./realm";

function subscription() {
  return { dispose: () => {} };
}

function childRealmApp() {
  // 코어 VIEW_RENDERER_CALL_PATHS 그대로 — commands 는 있고 register 는 없다.
  return declareRealm("view-renderer", {
    commands: { execute: vi.fn(async () => ({ ok: true })) },
    events: { on: vi.fn(() => subscription()) },
    bus: { emit: vi.fn(), on: vi.fn(() => subscription()) },
  });
}

describe("창 단위 소유는 realm 선언이 답한다", () => {
  it("자식 realm 은 commands 를 들고 있어도 등록부를 소유하지 않는다", () => {
    const child = childRealmApp();
    expect(child.commands).toBeDefined();
    expect(declaredRealm(child)?.id).toBe("view-renderer");
    expect(ownsWindowRegistry(child)).toBe(false);
  });

  it("창 realm 은 등록부를 소유한다", () => {
    const main = declareRealm("window", {
      commands: {
        register: vi.fn((_name: string, _spec: unknown) => subscription()),
        execute: vi.fn(async () => ({ ok: true })),
      },
    });
    expect(ownsWindowRegistry(main)).toBe(true);
  });

  it("선언하지 않은 호스트에게 등록부 소유를 가정하지 않는다", () => {
    expect(declaredRealm({})).toBeNull();
    expect(ownsWindowRegistry({})).toBe(false);
  });

  it("자식 realm 이 register 를 들고 있어도 등록부를 넘기지 않는다", () => {
    const child = declareRealm("view-renderer", {
      commands: {
        register: vi.fn((_name: string, _spec: unknown) => subscription()),
        execute: vi.fn(async () => ({ ok: true })),
      },
    });
    expect(ownsWindowRegistry(child)).toBe(false);
  });

  it("자식 realm 에서는 명령을 등록하지도, 이벤트를 구독하지도 않는다", () => {
    const app = childRealmApp();
    registerCommands({ app, subscriptions: [] } as never);
    expect(app.events.on).not.toHaveBeenCalled();
  });

  it("realm 판정에 표면 더듬기를 남기지 않는다", () => {
    const commands = readFileSync(new URL("./commands.ts", import.meta.url), "utf8");
    expect(commands).toContain("ownsWindowRegistry(app)");
    expect(commands).not.toContain("if (!app.commands) return;");
  });
});
