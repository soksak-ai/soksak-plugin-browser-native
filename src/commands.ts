// browser.* 명령 — 내비게이션 + AI/E2E DOM 제어. 매니페스트 contributes.commands 와 1:1.
// CLI/MCP 자동 노출. DOM/eval/media 는 코어 catalog.ts browser.* 핸들러의 충실한 이식:
//   - 코어 evalInBrowser 래퍼(async IIFE + JSON.stringify)를 evalJson 으로 재현(app.webview.eval
//     은 raw 패스스루라 호출측이 직접 감싸야 한다 — browser_eval 은 문자열 반환을 요구).
//   - dom.* JS 스니펫·param 이름·반환 형태를 코어와 동일하게 유지(AI/E2E 행동 무변).
import type { PluginContext, WebviewApi } from "./host";

// 새 브라우저 탭을 열 때 mount 가 homeUrl 대신 소비할 "대기 URL".
// open 명령 / open-external(새 탭) 이 set, BrowserView mount 가 takePendingUrl 로 소비(1회).
// 모듈 레벨(같은 번들 단일 인스턴스)이라 view.open → mount 사이 교차-인스턴스로 안전히 전달된다.
let pendingOpenUrl: string | null = null;
export function setPendingUrl(url: string): void {
  pendingOpenUrl = url;
}
export function takePendingUrl(): string | null {
  const u = pendingOpenUrl;
  pendingOpenUrl = null;
  return u;
}

// 활성 뷰의 webview label 과 현재 URL 을 외부에서 주입받기 위한 레지스트리.
// 뷰가 마운트되면 label 을 등록하고, 언마운트되면 제거한다.
interface ViewEntry { label: string; getUrl: () => string }
const activeViews = new Map<string, ViewEntry>();

// 가장 최근에 마운트된 브라우저 뷰 id — 첫 브라우저(아직 view.activated 가 발화하기 전)의 폴백 타겟.
let lastMountedViewId: string | null = null;
// 현재 활성(포커스) 브라우저 뷰 id — 호스트 view.activated 이벤트로 추종한다. 등록된 브라우저 뷰가
// 활성이 된 경우에만 채워진다(다른 종류 뷰가 활성이면 마지막 브라우저 활성값을 유지 — 명령은 늘
// "마지막으로 본 브라우저"를 친다). 그 뷰가 닫히면 unregisterLabel 이 비운다.
let activeViewId: string | null = null;

export function registerLabel(viewId: string, label: string, getUrl: () => string): void {
  activeViews.set(viewId, { label, getUrl });
  lastMountedViewId = viewId;
  // 새로 마운트된 브라우저가 곧 활성이 될 가능성이 높다(view.open 직후 자기 자신이 활성).
  // view.activated 가 곧 확정하지만, 그 전에 즉시 명령이 와도 새 뷰를 친다.
  activeViewId = viewId;
}
export function unregisterLabel(viewId: string): void {
  activeViews.delete(viewId);
  if (activeViewId === viewId) activeViewId = null;
  if (lastMountedViewId === viewId) lastMountedViewId = null;
}

// 호스트 view.activated 이벤트가 알리는 활성 뷰 id 를 반영. 등록된 브라우저 뷰일 때만 갱신한다
// (활성이 터미널/파일 등 비-브라우저면 무시 — 명령 타겟은 마지막으로 본 브라우저를 유지).
export function noteActivated(viewId: string): void {
  if (activeViews.has(viewId)) activeViewId = viewId;
}

// 타겟 브라우저 해소: 명시 viewId(param) → 활성 뷰 → 마지막 마운트 → 첫 등록. 명시 viewId 가
// 미등록이면 null(잘못된 타겟을 조용히 다른 뷰로 돌리지 않는다 — 명시는 정확해야 한다).
function resolveEntry(explicitViewId?: string): ViewEntry | null {
  if (explicitViewId) return activeViews.get(explicitViewId) ?? null;
  if (activeViewId && activeViews.has(activeViewId)) {
    return activeViews.get(activeViewId)!;
  }
  if (lastMountedViewId && activeViews.has(lastMountedViewId)) {
    return activeViews.get(lastMountedViewId)!;
  }
  const iter = activeViews.values().next();
  return iter.done ? null : iter.value;
}

// 명령 파라미터에서 명시 타겟 viewId 추출(viewId 우선, view 별칭 허용). 빈 문자열·비문자열은 무시.
function explicitTarget(p: Record<string, unknown>): string | undefined {
  const raw = p.viewId ?? p.view;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

// 명령 공통 타겟 파라미터 선언 — navigate/back/forward/reload/dom.*/eval 이 공유(명시 라우팅용).
const targetParam = {
  viewId: {
    type: "string" as const,
    description:
      "Target browser view id (e.g. v15). Omit to target the active browser view.",
    required: false,
  },
};

// JS 인자 직렬화(코어 sel — JSON.stringify 로 selector/text 를 안전한 JS 리터럴로).
const sel = (s: string) => JSON.stringify(s);

// 코어 evalInBrowser 의 충실한 이식. app.webview.eval(label, js) 은 browser_eval 패스스루로,
// js 는 "문자열을 반환"해야 한다(WKWebView callAsyncJavaScript 가 문자열 결과만 받음). 본문을
// async IIFE 로 감싸 await 를 허용하고 결과를 JSON.stringify 한 뒤, 받은 문자열을 JSON.parse 한다.
async function evalJson(
  webview: WebviewApi,
  label: string,
  body: string,
): Promise<unknown> {
  const wrapped = `const __r = await (async () => { ${body} })(); return JSON.stringify(__r === undefined ? null : __r);`;
  const raw = await webview.eval(label, wrapped);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// 비-macOS(eval 미지원)에서 graceful 에러 — 호출측이 ok:false 로 표면화.
const NON_MACOS_EVAL_ERR = "eval is macOS-only (WKWebView callAsyncJavaScript)";

export function registerCommands(ctx: PluginContext): void {
  const app = ctx.app;
  if (!app.commands) return;
  const sub = (d: { dispose(): void }) => ctx.subscriptions.push(d);

  // 활성 뷰 추종 — 호스트가 활성 뷰를 바꿀 때마다(탭 전환·클릭) 알린다. 이 뷰가 브라우저면 타겟 갱신.
  // 권한 불요 이벤트(EVENT_PERMISSIONS 미등록). 구독은 subscriptions 로 자동 수거(비활성화 시 해지).
  sub(
    app.events.on("view.activated", (payload) => {
      const viewId = (payload as { viewId?: unknown } | null)?.viewId;
      if (typeof viewId === "string") noteActivated(viewId);
    }),
  );

  sub(
    app.commands.register("ping", {
      description: "Browser plugin load/version check (E2E).",
      triggers: { ko: "브라우저 핑 적재확인 버전" },
      returns: "{ ok, version }",
      handler: () => ({ ok: true, version: "2.0.0" }),
    }),
  );

  sub(
    app.commands.register("navigate", {
      description: "Navigate the active browser view to a URL.",
      triggers: { ko: "브라우저 이동 URL 열기" },
      params: {
        url: { type: "string", description: "URL to navigate to", required: true },
        ...targetParam,
      },
      returns: "{ ok }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        await app.webview.navigate(entry.label, String(p.url ?? ""));
        return { ok: true };
      },
    }),
  );

  sub(
    app.commands.register("back", {
      description: "Go back in the active browser view history.",
      triggers: { ko: "브라우저 이전 뒤로" },
      params: { ...targetParam },
      returns: "{ ok }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        await app.webview.history(entry.label, -1);
        return { ok: true };
      },
    }),
  );

  sub(
    app.commands.register("forward", {
      description: "Go forward in the active browser view history.",
      triggers: { ko: "브라우저 다음 앞으로" },
      params: { ...targetParam },
      returns: "{ ok }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        await app.webview.history(entry.label, 1);
        return { ok: true };
      },
    }),
  );

  sub(
    app.commands.register("reload", {
      description: "Reload the active browser view.",
      triggers: { ko: "브라우저 새로고침 리로드" },
      params: { ...targetParam },
      returns: "{ ok }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        // 코어에 standalone reload invoke 없음 → 현재 URL 재전송으로 대체.
        const url = entry.getUrl();
        if (url && url !== "about:blank") {
          await app.webview.navigate(entry.label, url);
        }
        return { ok: true };
      },
    }),
  );

  // ── open: 새 브라우저 콘텐츠 뷰를 url 로 연다(대기 URL 메커니즘) ──────────────
  // url 을 pendingOpenUrl 에 set → view.open{program:browser} 호출 → 새 BrowserView mount 가
  // homeUrl 대신 takePendingUrl 로 그 url 을 소비. 코어 browser.open(where=panel)의 플러그인 등가.
  sub(
    app.commands.register("open", {
      description:
        "Open a new in-app browser content view (optionally at a URL). Plugin equivalent of the core browser panel.",
      triggers: { ko: "브라우저 뷰 열기 새 브라우저 탭 인앱 브라우저" },
      params: {
        url: {
          type: "string",
          description: "Start URL (omit = settings homeUrl)",
          required: false,
        },
      },
      returns: "{ ok, viewId?, groupId? }",
      handler: async (p) => {
        if (!app.commands) return { ok: false, error: "commands API 없음" };
        const url = typeof p.url === "string" && p.url.length > 0 ? p.url : undefined;
        if (url) setPendingUrl(url);
        const out = await app.commands.execute("view.open", { program: "browser" });
        if (!out.ok) {
          // 실패 시 대기 URL 회수(다음 mount 가 잘못 소비하지 않게).
          if (url) takePendingUrl();
          return { ok: false, error: String(out.error ?? "view.open 실패") };
        }
        return { ok: true, viewId: out.viewId, groupId: out.groupId };
      },
    }),
  );

  // ── devtools: OS 인스펙터 토글 ───────────────────────────────────────────────
  sub(
    app.commands.register("devtools", {
      description:
        "Toggle the browser Web Inspector (WKWebView has no CDP — opens the OS inspector in a separate window).",
      triggers: { ko: "개발자 도구 인스펙터 devtools 열기 닫기" },
      params: { ...targetParam },
      returns: "{ ok, open? }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        const open = await app.webview.devtools(entry.label);
        return { ok: true, open };
      },
    }),
  );

  // ── list: 살아있는 브라우저 webview label 목록(GC/정리·고아 탐지) ────────────
  sub(
    app.commands.register("list", {
      description:
        "List live native browser webview labels (b-*). Use to detect orphaned webviews.",
      triggers: { ko: "브라우저 webview 목록 라벨 고아 탐지" },
      params: {},
      returns: "{ ok, labels: string[] }",
      handler: async () => {
        if (!app.webview) return { ok: false, error: "webview API 없음" };
        const labels = await app.webview.list("b-");
        return { ok: true, labels };
      },
    }),
  );

  // ── eval: 페이지에서 임의 JS 실행(AI DOM 제어 통로). macOS 한정 ──────────────
  sub(
    app.commands.register("eval", {
      description:
        "Execute arbitrary JS in a browser page (async supported; return value serialized as JSON). macOS-only.",
      triggers: { ko: "JS 실행 자바스크립트 브라우저 실행 페이지 스크립트" },
      params: {
        js: {
          type: "string",
          description: "JS body to execute (e.g. return document.title)",
          required: true,
        },
        ...targetParam,
      },
      returns: "{ ok, result? }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        try {
          const result = await evalJson(app.webview, entry.label, String(p.js ?? ""));
          return { ok: true, result };
        } catch (e) {
          return { ok: false, error: evalErr(e) };
        }
      },
    }),
  );

  // ── dom.text: 페이지/선택자 가시 텍스트 ──────────────────────────────────────
  sub(
    app.commands.register("dom.text", {
      description: "Get the visible text of the page or a specific selector element.",
      triggers: { ko: "DOM 텍스트 읽기 페이지 텍스트 선택자 텍스트" },
      params: {
        selector: { type: "string", description: "CSS selector (omit = entire body)", required: false },
        maxLength: { type: "number", description: "Max character length", required: false },
        ...targetParam,
      },
      returns: "{ ok, text? }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        const max = typeof p.maxLength === "number" ? p.maxLength : 20000;
        const js = p.selector
          ? `const el = document.querySelector(${sel(String(p.selector))}); return el ? el.innerText.slice(0, ${max}) : null;`
          : `return document.body.innerText.slice(0, ${max});`;
        try {
          const text = await evalJson(app.webview, entry.label, js);
          return { ok: true, text };
        } catch (e) {
          return { ok: false, error: evalErr(e) };
        }
      },
    }),
  );

  // ── dom.html: 페이지/선택자 HTML ─────────────────────────────────────────────
  sub(
    app.commands.register("dom.html", {
      description: "Get the HTML of the page or a specific selector element.",
      triggers: { ko: "DOM HTML 읽기 페이지 HTML 선택자 마크업" },
      params: {
        selector: { type: "string", description: "CSS selector (omit = entire document)", required: false },
        maxLength: { type: "number", description: "Max character length", required: false },
        ...targetParam,
      },
      returns: "{ ok, html? }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        const max = typeof p.maxLength === "number" ? p.maxLength : 50000;
        const js = p.selector
          ? `const el = document.querySelector(${sel(String(p.selector))}); return el ? el.outerHTML.slice(0, ${max}) : null;`
          : `return document.documentElement.outerHTML.slice(0, ${max});`;
        try {
          const html = await evalJson(app.webview, entry.label, js);
          return { ok: true, html };
        } catch (e) {
          return { ok: false, error: evalErr(e) };
        }
      },
    }),
  );

  // ── dom.query: 선택자 매칭 요소 요약(구조 파악) ──────────────────────────────
  sub(
    app.commands.register("dom.query", {
      description:
        "Summarize matching elements (tag / text / attributes) for a CSS selector — use to understand page structure.",
      triggers: { ko: "DOM 요소 조회 선택자 매칭 구조 파악" },
      params: {
        selector: { type: "string", description: "CSS selector", required: true },
        limit: { type: "number", description: "Max element count", required: false },
        ...targetParam,
      },
      returns: "{ ok, count?, elements? }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        const limit = typeof p.limit === "number" ? p.limit : 20;
        const js = `
          const all = [...document.querySelectorAll(${sel(String(p.selector))})];
          return { count: all.length, elements: all.slice(0, ${limit}).map(e => ({
            tag: e.tagName.toLowerCase(),
            text: (e.innerText || "").trim().slice(0, 120) || undefined,
            id: e.id || undefined,
            class: (typeof e.className === "string" && e.className) || undefined,
            name: e.getAttribute("name") || undefined,
            href: e.getAttribute("href") || undefined,
            type: e.getAttribute("type") || undefined,
            value: e.value !== undefined ? String(e.value).slice(0, 120) : undefined,
          })) };`;
        try {
          const r = (await evalJson(app.webview, entry.label, js)) as object;
          return { ok: true, ...r };
        } catch (e) {
          return { ok: false, error: evalErr(e) };
        }
      },
    }),
  );

  // ── dom.click: 첫 매칭 요소 클릭 ─────────────────────────────────────────────
  sub(
    app.commands.register("dom.click", {
      description: "Click the first element matching a CSS selector.",
      triggers: { ko: "DOM 클릭 버튼 클릭 링크 클릭 페이지 클릭" },
      params: {
        selector: { type: "string", description: "CSS selector", required: true },
        ...targetParam,
      },
      returns: "{ ok, clicked? }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        const js = `const el = document.querySelector(${sel(String(p.selector))}); if (!el) return { clicked: false, reason: "selector 매칭 없음" }; el.click(); return { clicked: true };`;
        try {
          const r = (await evalJson(app.webview, entry.label, js)) as object;
          return { ok: true, ...r };
        } catch (e) {
          return { ok: false, error: evalErr(e) };
        }
      },
    }),
  );

  // ── dom.fill: input 값 채우기(input/change 발화 — React 호환) ─────────────────
  sub(
    app.commands.register("dom.fill", {
      description:
        "Fill an input element with a value (fires input/change events — React form compatible).",
      triggers: { ko: "DOM 입력 채우기 폼 입력 텍스트 입력 필드 채우기" },
      params: {
        selector: { type: "string", description: "CSS selector", required: true },
        text: { type: "string", description: "Value to enter", required: true },
        ...targetParam,
      },
      returns: "{ ok, filled? }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        const js = `
          const el = document.querySelector(${sel(String(p.selector))});
          if (!el) return { filled: false, reason: "selector 매칭 없음" };
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) setter.call(el, ${sel(String(p.text ?? ""))}); else el.value = ${sel(String(p.text ?? ""))};
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { filled: true };`;
        try {
          const r = (await evalJson(app.webview, entry.label, js)) as object;
          return { ok: true, ...r };
        } catch (e) {
          return { ok: false, error: evalErr(e) };
        }
      },
    }),
  );

  // ── dom.submit: 폼 제출 ──────────────────────────────────────────────────────
  sub(
    app.commands.register("dom.submit", {
      description: "Submit a form (selector can be the form element or any element inside it).",
      triggers: { ko: "폼 제출 submit 전송 양식 제출" },
      params: {
        selector: { type: "string", description: "CSS selector", required: true },
        ...targetParam,
      },
      returns: "{ ok, submitted? }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        const js = `
          const el = document.querySelector(${sel(String(p.selector))});
          if (!el) return { submitted: false, reason: "selector 매칭 없음" };
          const form = el instanceof HTMLFormElement ? el : el.closest("form");
          if (!form) return { submitted: false, reason: "form 없음" };
          form.requestSubmit ? form.requestSubmit() : form.submit();
          return { submitted: true };`;
        try {
          const r = (await evalJson(app.webview, entry.label, js)) as object;
          return { ok: true, ...r };
        } catch (e) {
          return { ok: false, error: evalErr(e) };
        }
      },
    }),
  );

  // ── dom.wait-for: 선택자 출현 대기(MutationObserver) ─────────────────────────
  sub(
    app.commands.register("dom.wait-for", {
      description: "Wait until a selector appears on the page (dynamic pages — uses MutationObserver).",
      triggers: { ko: "요소 대기 나타날 때까지 기다리기 동적 로딩 대기" },
      params: {
        selector: { type: "string", description: "CSS selector", required: true },
        timeoutMs: { type: "number", description: "Max wait time (ms)", required: false },
        ...targetParam,
      },
      returns: "{ ok, found? }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        const timeoutMs = typeof p.timeoutMs === "number" ? p.timeoutMs : 5000;
        const js = `
          const find = () => document.querySelector(${sel(String(p.selector))});
          if (find()) return { found: true };
          return await new Promise((resolve) => {
            const obs = new MutationObserver(() => {
              if (find()) { obs.disconnect(); clearTimeout(timer); resolve({ found: true }); }
            });
            const timer = setTimeout(() => { obs.disconnect(); resolve({ found: false }); }, ${timeoutMs});
            obs.observe(document.documentElement, { childList: true, subtree: true });
          });`;
        try {
          const r = (await evalJson(app.webview, entry.label, js)) as object;
          return { ok: true, ...r };
        } catch (e) {
          return { ok: false, error: evalErr(e) };
        }
      },
    }),
  );

  // ── media.sniff: 활성 페이지가 스스로 요청한 미디어 URL 수확 ──────────────────
  // 코어 init script(MEDIA_SNIFF)가 browser_open 시 항상 주입돼 window.__soksakMedia 에 패시브
  // 기록 → eval 로 읽기만 한다(코어 browser.media.sniff 충실 이식). 시간 상한 폴링(R10 무한폴링 금지).
  sub(
    app.commands.register("media.sniff", {
      description:
        "Harvest media URLs (m3u8/mpd/mp4/...) the active page requested — captured passively by the core init-script hook (window.__soksakMedia). Site-agnostic. macOS-only.",
      triggers: { ko: "미디어 스니프 추출 m3u8 스트림 페이지 캡처 가로채기 동영상" },
      params: {
        timeoutMs: { type: "number", description: "Max wait for a hit (ms)", required: false },
        autoplay: { type: "boolean", description: "Call video.play() to provoke the stream request", required: false },
        pattern: { type: "string", description: "Only return URLs matching this regex (e.g. m3u8)", required: false },
        ...targetParam,
      },
      returns: "{ ok, urls? }",
      handler: async (p) => {
        const entry = resolveEntry(explicitTarget(p));
        if (!entry || !app.webview) return { ok: false, error: "no active browser view" };
        const webview = app.webview;
        const label = entry.label;
        const timeoutMs = typeof p.timeoutMs === "number" ? p.timeoutMs : 8000;
        const autoplay = p.autoplay !== false;
        const re = p.pattern ? new RegExp(String(p.pattern), "i") : null;
        const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        const deadline = Date.now() + Math.max(500, timeoutMs);
        let triggered = false;
        try {
          for (;;) {
            const raw = await evalJson(
              webview,
              label,
              "return JSON.stringify(window.__soksakMedia || [])",
            );
            let hits: MediaHit[] = [];
            try {
              hits = typeof raw === "string" ? JSON.parse(raw) : (raw as MediaHit[]);
            } catch {
              hits = [];
            }
            const urls = re ? hits.filter((h) => re.test(h.url)) : hits;
            if (urls.length > 0) return { ok: true, urls };
            if (autoplay && !triggered) {
              triggered = true;
              await evalJson(
                webview,
                label,
                "try { var v = document.querySelector('video'); if (v) { v.muted = true; v.play && v.play().catch(function(){}); } } catch(e){} return null;",
              );
            }
            if (Date.now() >= deadline) return { ok: true, urls: [] };
            await delay(400);
          }
        } catch (e) {
          return { ok: false, error: evalErr(e) };
        }
      },
    }),
  );

  // ── media.extract: 보이지 않는(오프스크린) webview 로 미디어 URL 추출 ─────────
  // 코어 browser_media_extract 의 플러그인 이식: 화면 밖(-20000) child webview 를 열고(코어가
  // MEDIA_SNIFF 를 자동 주입) 로드시킨 뒤 window.__soksakMedia 를 폴링, 끝나면 닫는다. 사이트 무관.
  sub(
    app.commands.register("media.extract", {
      description:
        "Extract media URLs from a page WITHOUT showing it — opens an offscreen webview, lets it load (the core hook sniffs its own media requests), then closes it. Site-agnostic. macOS-only.",
      triggers: { ko: "미디어 추출 숨김 오프스크린 m3u8 스트림 페이지 가로채기 동영상" },
      params: {
        url: { type: "string", description: "Page URL to load offscreen and extract from", required: true },
        timeoutMs: { type: "number", description: "Max wait for a media hit (ms)", required: false },
      },
      returns: "{ ok, urls? }",
      handler: async (p) => {
        if (!app.webview) return { ok: false, error: "webview API 없음" };
        const url = typeof p.url === "string" ? p.url : "";
        if (!url) return { ok: false, error: "url 필요" };
        const webview = app.webview;
        const timeoutMs = Math.max(1000, typeof p.timeoutMs === "number" ? p.timeoutMs : 15000);
        // 전역 유일 라벨(b- prefix 아님 → 브라우저 뷰 GC 가 건드리지 않는다). 충돌 회피용 난수.
        const label = `media-extract-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        try {
          // 화면 밖(-20000): 보이지 않지만 합성기엔 살아있어 JS/미디어가 동작(스로틀 회피).
          await webview.open(label, { url, x: -20000, y: -20000, w: 1280, h: 720 });
          const deadline = Date.now() + timeoutMs;
          let triggered = false;
          let hits: MediaHit[] = [];
          for (;;) {
            const raw = await evalJson(
              webview,
              label,
              "return JSON.stringify(window.__soksakMedia || [])",
            );
            let arr: MediaHit[] = [];
            try {
              arr = typeof raw === "string" ? JSON.parse(raw) : (raw as MediaHit[]);
            } catch {
              arr = [];
            }
            if (arr.length > 0) {
              hits = arr;
              // m3u8 이 잡혔으면 즉시 종료(아니면 더 기다린다).
              if (arr.some((h) => typeof h.url === "string" && h.url.includes(".m3u8"))) break;
            }
            if (!triggered) {
              triggered = true;
              await evalJson(
                webview,
                label,
                "try{var v=document.querySelector('video'); if(v){v.muted=true; v.play&&v.play().catch(function(){});}}catch(e){} return null;",
              );
            }
            if (Date.now() >= deadline) break;
            await delay(400);
          }
          return { ok: true, urls: hits };
        } catch (e) {
          return { ok: false, error: evalErr(e) };
        } finally {
          await webview.close(label).catch(() => {});
        }
      },
    }),
  );
}

// 미디어 스니프 hit 형태(코어 window.__soksakMedia 항목).
interface MediaHit {
  url: string;
  via?: string;
  ref?: string;
}

// eval 에러 정규화 — 비-macOS(browser_eval 미지원)면 명확한 메시지로 치환.
function evalErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/macOS|not.*support|unsupported/i.test(msg)) return NON_MACOS_EVAL_ERR;
  return msg;
}
