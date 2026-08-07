// 이 번들이 사는 realm — 코어가 선언으로 답한다(코어 src/plugins/realm.ts, app.realm).
//
// 같은 플러그인 번들이 두 realm 에서 평가된다: 창 문서와, nativeSurface 뷰의 자식 renderer.
// 두 realm 의 app 표면은 같지 않다 — 창 단위 등록부(commands.register)는 창이 소유하고 자식은
// 실행만 소비한다. 그 차이를 typeof 로 더듬으면 같은 부재를 저마다 다르게 읽는다: 세 브라우저
// 플러그인이 그렇게 갈렸고 하나는 그 자리에서 죽었다(실측 2026-08-07 — 활성 실패
// "app.commands.register is not a function", 뒤따르는 registerView 가 아예 실행되지 않았다).
//
// 더듬기는 답이 아니다. realm 이 자기 신원과 능력을 선언으로 답한다.
// 선언하지 않은 호스트는 "창"이 아니라 "답하지 않았다" — 등록부 소유를 가정하지 않는다.

export type PluginRealmId = "window" | "view-renderer";

export interface DeclaredRealm {
  readonly id: PluginRealmId;
  readonly capabilities: readonly string[];
  supports(capability: string): boolean;
}

/** realm 선언을 읽을 수 있는 app 표면. */
export interface RealmAware {
  realm?: DeclaredRealm;
}

/** 이 app 이 선언한 realm. 선언이 없거나 신원이 계약 밖이면 null — 추정하지 않는다. */
export function declaredRealm(app: RealmAware): DeclaredRealm | null {
  const realm = app.realm;
  if (!realm) return null;
  return realm.id === "window" || realm.id === "view-renderer" ? realm : null;
}

/**
 * 부를 이름을 그대로 묻는다. 네임스페이스가 있다고 그 안이 다 있는 것은 아니다 —
 * 자식 realm 도 commands 는 들고 있고 register 만 없다.
 */
export function realmSupports(app: RealmAware, capability: string): boolean {
  return declaredRealm(app)?.supports(capability) ?? false;
}

/**
 * 이 realm 이 창 단위 등록부(command·뷰 등록·창 전체 원장)를 소유하는가.
 *
 * 소유는 신원의 사실이고 호출 가능은 능력의 사실이다 — 둘 다 선언이 답하고, 둘 다 있어야
 * 소유다. 능력만 보면 자식 realm 이 언젠가 register 를 얻는 날 창 전체 회수를 넘겨받고,
 * 신원만 보면 register 없는 창에서 다시 그 자리에서 죽는다.
 */
export function ownsWindowRegistry(app: RealmAware): boolean {
  const realm = declaredRealm(app);
  return realm !== null && realm.id === "window" && realm.supports("commands.register");
}
