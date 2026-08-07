// 테스트용 호스트 모형 — 코어가 app 에 붙이는 realm 선언을 같은 방식으로 만든다.
// 능력 목록은 손으로 적지 않는다: 실제 app 객체에서 파생해야 객체와 어긋날 수 없다
// (코어 src/plugins/realm.ts 와 같은 규칙).
import type { DeclaredRealm, PluginRealmId } from "./realm";

function capabilitiesOf(node: unknown, prefix = "", depth = 1): string[] {
  if (depth > 4 || typeof node !== "object" || node === null) return [];
  const found: string[] = [];
  for (const key of Object.keys(node as Record<string, unknown>)) {
    if (!prefix && key === "realm") continue;
    const value = (node as Record<string, unknown>)[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "function") found.push(path);
    else found.push(...capabilitiesOf(value, path, depth + 1));
  }
  return found;
}

/** 코어 declarePluginRealm 과 같은 계약으로 realm 을 선언한다. */
export function declareRealm<T extends object>(id: PluginRealmId, app: T): T & { realm: DeclaredRealm } {
  const capabilities = Object.freeze(capabilitiesOf(app).sort());
  const declared = new Set(capabilities);
  Object.defineProperty(app, "realm", {
    value: Object.freeze({ id, capabilities, supports: (c: string) => declared.has(c) }),
    enumerable: true,
    writable: false,
    configurable: false,
  });
  return app as T & { realm: DeclaredRealm };
}
