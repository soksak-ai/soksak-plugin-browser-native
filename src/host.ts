// 코어 플러그인 API 중 browser 플러그인이 쓰는 표면만 선언.
// soksak-plugin-spec v1 의 SoksakPluginApi 와 동형 — 별도 repo, 코어 소스 비의존.
// 미선언 권한 표면은 런타임에 undefined.
import type { DeclaredRealm } from "./realm";

export interface Disposable {
  dispose(): void;
}

// 코어 viewRegistry.PluginViewContext 와 동형.
// viewId = sessions view.id(콘텐츠 배치 인스턴스 안정 키). 사이드바 배치 = null.
export interface PluginViewContext {
  projectId: string;
  root: string | null;
  paneId: string | null;
  viewId: string | null;
  // 복원 seam(B3) — 복원 마운트면 관찰됐던 런타임(setRestoreState 로 기록한 state 포함). 새 뷰는 null.
  restore?: { cwd: string | null; state: unknown } | null;
  setBadge: (badge: number | "dot" | null) => void;
  setStatus: (status: { code: string; message?: string } | null) => void;
  setTitle: (title: string) => void;
  // 탭 아이콘(콘텐츠 사실 — 파비콘 URL). 빈 값 = 해제(매니페스트 아이콘 폴백).
  setIcon?: (icon: string) => void;
  // 플러그인 관찰 상태 보고(B3) — 뷰 레코드 영속(뷰와 수명 동기). kv 에 viewId 키 영속 금지.
  setRestoreState?: (state: unknown) => void;
}

export interface PluginViewProvider {
  /** DOM과 독립인 뷰 인스턴스 명령/상태 수명을 등록한다. */
  connect?(ctx: PluginViewContext): void | (() => void);
  mount(container: HTMLElement, ctx: PluginViewContext): void;
  unmount?(container: HTMLElement): void;
  /** 줌 인텐트(코어 PLUGIN-CONTRACT §Zoom, 선택) — 브라우저는 페이지 줌으로 응답. */
  zoom?(
    container: HTMLElement,
    ctx: PluginViewContext,
    action: "in" | "out" | "reset",
  ): void;
}

export interface ParamSpec {
  type: string;
  description?: string;
  required?: boolean;
}

export interface CommandHint {
  cmd: string;
  why: string;
}

export interface PluginCommandSpec {
  description: string;
  triggers?: Record<string, string>;
  params?: Record<string, ParamSpec>;
  returns?: string;
  message?: (data: any) => string;
  /** Up to 3 suggested next commands, worded suggestively ("...할 수 있습니다"). */
  hint?: (data: any, ctx: PluginContext) => CommandHint[];
  handler: (params: Record<string, unknown>) => Promise<object> | object;
}

export interface CommandOutcome {
  ok: boolean;
  [k: string]: unknown;
}

// app.webview — 호스트가 제공하는 임베디드 content-view 구동.
export interface WebviewApi {
  /** 선택 기능은 adapter 이름이 아니라 이 공개 축으로 판단한다. */
  capabilities: Readonly<{
    supportsDocumentStart: boolean;
    supportsInputInjection: boolean;
  }>;
  /** viewId → 전역 유일 label(창 네임스페이스). webviewLabels 단일 진실. */
  label: (viewId: string) => string;
  /** content-view 생성. 공개 슬롯이 있으면 호스트가 배치를 소유한다.
   *  좌표는 슬롯 없는 오프스크린 표면에만 명시한다. */
  open: (label: string, o: { url: string; x?: number; y?: number; w?: number; h?: number }) => Promise<void>;
  /** URL 이동. */
  navigate: (label: string, url: string) => Promise<void>;
  /** 뷰-단위 페이지 줌(0.25..4.0) — 유효 배율 = 창 줌 × 이 값. */
  zoom: (label: string, factor: number) => Promise<number>;
  /** URL 을 독립 OS 창(새 브라우저 윈도우)으로 연다. browserNewWindow="window" 모드용. */
  openWindow: (url: string) => Promise<void>;
  /** 세션 히스토리 이동(delta=-1 뒤/+1 앞). */
  history: (label: string, delta: number) => Promise<void>;
  /** 로딩 정지(WKWebView stopLoading) — 툴바 reload↔stop 토글용. */
  stop?: (label: string) => Promise<void>;
  /** 새로고침 — 현재 URL 로 다시 이동하는 것과 다르다(그건 이력을 한 칸 더 쌓는다). */
  reload: (label: string, ignoreCache?: boolean) => Promise<void>;
  /** OS 인스펙터(devtools) 토글 → 열림 여부. */
  devtools: (label: string) => Promise<boolean>;
  /** 페이지에서 JS 실행 후 결과 문자열 반환(AI/E2E DOM 제어). macOS 한정. */
  eval: (label: string, js: string) => Promise<string>;
  /** init script 주입(document-start/end, 매 내비게이션 재주입). macOS 한정(비-macOS no-op).
   *  반환 Disposable 은 추적용 — WKUserScript 개별 제거는 미지원(webview 수명까지 유지). */
  injectScript: (
    label: string,
    code: string,
    phase?: "document-start" | "document-end",
  ) => Disposable;
  /** 실제 엔진 입력 경로. supportsInputInjection=false면 호스트가 명시적으로 거절한다. */
  sendInput: (label: string, x: number, y: number) => Promise<void>;
  /** 실제 엔진 휠 입력. 좌표는 뷰 CSS px, 델타 부호는 DOM WheelEvent와 같다. */
  wheel: (label: string, x: number, y: number, dx: number, dy: number) => Promise<void>;
  captureFull: (label: string, path: string, width: number, height: number) => Promise<{ path: string; bytes: number }>;
  /** 현재 포커스된 편집 요소에 확정 텍스트를 엔진 입력 경로로 전달한다. */
  typeText: (label: string, text: string) => Promise<void>;
  /** webview 이벤트 구독: "nav"({url})·"title"({title})·"status"·"open-external"({url})·
   *  "loading"({loading,canBack,canForward} — 스피너/정지 토글·뒤로/앞으로 활성). 반환=해지. */
  on: (
    label: string,
    event: "nav" | "title" | "status" | "open-external" | "loading",
    cb: (payload: Record<string, unknown>) => void,
  ) => Disposable;
  /** 현재 살아있는 webview label 목록(prefix 필터). GC/정리용. */
  list: (prefix?: string) => Promise<string[]>;
  /** webview 종료 + 정리. */
  close: (label: string) => Promise<void>;
}

// app.data.kv — 즐겨찾기 저장에 쓰는 표면만.
export interface DataKvApi {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  keys: (prefix?: string) => Promise<string[]>;
  watch: (cb: (key: string | null) => void) => Disposable;
}

export interface DataApi {
  kv: DataKvApi;
}

export interface PluginApi {
  pluginId: string;
  /** 코어가 붙인 realm 신원 선언 — 이 표면이 무엇을 부를 수 있는지의 단일 진실. */
  realm?: DeclaredRealm;
  locale: () => string;
  commands?: {
    /** 창 realm 만 제공한다. 자식 renderer 는 execute 만 소비한다. */
    register?: (name: string, spec: PluginCommandSpec) => Disposable;
    execute: (name: string, params?: Record<string, unknown>) => Promise<CommandOutcome>;
  };
  events: {
    on: (event: string, fn: (payload: unknown) => void) => Disposable;
  };
  ui?: {
    registerView: (viewId: string, provider: PluginViewProvider) => Disposable;
  };
  webview?: WebviewApi;
  data?: DataApi;
  bus: {
    emit: (topic: string, payload: unknown) => void;
    on: (topic: string, fn: (payload: unknown) => void) => Disposable;
  };
  project: {
    current: () => { id: string; root: string | null } | null;
  };
  settings: {
    get: (key: string) => unknown;
    all: () => Record<string, unknown>;
    onChange: (cb: (all: Record<string, unknown>) => void) => Disposable;
  };
}

export interface PluginContext {
  app: PluginApi;
  manifest: unknown;
  dir: string;
  subscriptions: Disposable[];
}
