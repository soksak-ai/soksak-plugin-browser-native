// 코어 플러그인 API 중 browser 플러그인이 쓰는 표면만 선언.
// soksak-plugin-spec v1 의 SoksakPluginApi 와 동형 — 별도 repo, 코어 소스 비의존.
// 미선언 권한 표면은 런타임에 undefined.

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
  setBadge: (badge: number | "dot" | null) => void;
  setStatus: (status: { code: string; message?: string } | null) => void;
  setTitle: (title: string) => void;
}

export interface PluginViewProvider {
  mount(container: HTMLElement, ctx: PluginViewContext): void;
  unmount?(container: HTMLElement): void;
}

export interface ParamSpec {
  type: string;
  description?: string;
  required?: boolean;
}

export interface PluginCommandSpec {
  description: string;
  triggers?: Record<string, string>;
  params?: Record<string, ParamSpec>;
  returns?: string;
  handler: (params: Record<string, unknown>) => Promise<object> | object;
}

export interface CommandOutcome {
  ok: boolean;
  [k: string]: unknown;
}

// app.webview — 코어 네이티브 child webview(WKWebView) 구동.
export interface WebviewApi {
  /** viewId → 전역 유일 label(창 네임스페이스). webviewLabels 단일 진실. */
  label: (viewId: string) => string;
  /** child webview 생성 + 슬롯 rect 에 임베드. 이미 있으면 no-op. */
  open: (label: string, o: { url: string; x: number; y: number; w: number; h: number }) => Promise<void>;
  /** 슬롯 rect 동기화(분할/리사이즈 — 프레임당 1회 권장). */
  bounds: (label: string, x: number, y: number, w: number, h: number) => Promise<void>;
  /** 표시/숨김(탭 전환·최대화의 숨김 슬롯). */
  visible: (label: string, visible: boolean) => Promise<void>;
  /** URL 이동. */
  navigate: (label: string, url: string) => Promise<void>;
  /** 세션 히스토리 이동(delta=-1 뒤/+1 앞). */
  history: (label: string, delta: number) => Promise<void>;
  /** OS 인스펙터(devtools) 토글 → 열림 여부. */
  devtools: (label: string) => Promise<boolean>;
  /** webview 이벤트 구독: "nav"({url})·"title"({title}). 반환=해지. */
  on: (
    label: string,
    event: "nav" | "title" | "status" | "open-external",
    cb: (payload: Record<string, unknown>) => void,
  ) => Disposable;
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
  locale: () => string;
  commands?: {
    register: (name: string, spec: PluginCommandSpec) => Disposable;
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
