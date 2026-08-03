// 브라우저 제품 뷰. 플러그인은 브라우저 크롬·탐색·자동화와 공개 content-view 슬롯만 소유한다.
// 슬롯을 DOM 자식으로 채울지, 문서 밖 표면을 좌표로 합성할지는 선택된 호스트 어댑터의 책임이다.

import { memo, useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { createBrowserToolbar } from "soksak-kit-browser-common";
import type { BrowserToolbar } from "soksak-kit-browser-common";
import type { PluginApi, PluginViewContext } from "./host";
import { loadStatus } from "./view-status";
import { t } from "./i18n";
import {
  registerLabel,
  unregisterLabel,
  setPendingUrl,
  takePendingUrl,
} from "./commands";

// ── URL 정규화 (코어 BrowserView.tsx 와 동일) ────────────────────────────────
function normalizeUrl(input: string): string {
  const s = input.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s;
  if (!s.includes(" ") && s.includes(".")) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

// ── 즐겨찾기 타입 ────────────────────────────────────────────────────────────
interface Bookmark {
  url: string;
  title: string;
}

// ── Inline SVG 아이콘 (lucide-style, stroke=currentColor) ────────────────────
function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
function IconTerminal() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

// ── BrowserViewImpl ───────────────────────────────────────────────────────────
function BrowserViewImpl({
  app,
  ctx,
  initialUrl,
}: {
  app: PluginApi;
  ctx: PluginViewContext;
  initialUrl: string;
}) {
  const lang = app.locale();
  // status 메시지 해소용 — 로딩 이벤트 핸들러가 재구독 없이 최신 언어를 읽는다(언어 변경에 재구독 안 함).
  const langRef = useRef(lang);
  langRef.current = lang;
  const webview = app.webview;

  // viewId → 전역 유일 label(창 네임스페이스) — webview 단일 진실에서만 파생.
  // ctx.viewId 없는 배치(사이드바)에서는 웹뷰를 열지 않는다.
  const label = ctx.viewId && webview ? webview.label(ctx.viewId) : null;

  const areaRef = useRef<HTMLDivElement>(null);
  const [localUrl, setLocalUrl] = useState(initialUrl);
  // reload 명령이 최신 URL 에 접근할 수 있도록 ref 동기화(클로저 스탈 방지).
  const localUrlRef = useRef(initialUrl);
  const [bmOpen, setBmOpen] = useState(false);
  // 공용 툴바(soksak-kit-browser-common) — 세 브라우저 동일 DOM·노드·외형. 콜백은 ref 경유(재마운트 없음).
  const tbHostRef = useRef<HTMLDivElement | null>(null);
  const [tb, setTb] = useState<BrowserToolbar | null>(null);
  const tbCbRef = useRef({
    onNavigate: (_raw: string) => {},
    onBack: () => {}, onForward: () => {}, onReload: () => {}, onStop: () => {}, onHome: () => {},
    onBookmarkToggle: () => {},
  });
  useEffect(() => {
    const host = tbHostRef.current;
    if (!host) return;
    const t2 = createBrowserToolbar(host, {
      onNavigate: (raw) => tbCbRef.current.onNavigate(raw),
      onBack: () => tbCbRef.current.onBack(),
      onForward: () => tbCbRef.current.onForward(),
      onReload: () => tbCbRef.current.onReload(),
      onStop: () => tbCbRef.current.onStop(),
      onHome: () => tbCbRef.current.onHome(),
      onBookmarkToggle: () => tbCbRef.current.onBookmarkToggle(),
    });
    setTb(t2);
    return () => { setTb(null); t2.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [dtOpen, setDtOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  // 즐겨찾기 로드 + 구독
  useEffect(() => {
    if (!app.data) return;
    let cancelled = false;

    async function loadBookmarks() {
      const keys = await app.data!.kv.keys("bm:");
      if (cancelled) return;
      const items: Bookmark[] = [];
      for (const k of keys) {
        const v = await app.data!.kv.get(k);
        if (cancelled) return;
        if (v && typeof v === "object" && "url" in v && "title" in v) {
          items.push(v as Bookmark);
        }
      }
      if (!cancelled) setBookmarks(items);
    }

    void loadBookmarks();
    const d = app.data.kv.watch(() => {
      void loadBookmarks();
    });
    return () => {
      cancelled = true;
      d.dispose();
    };
  }, [app.data]);

  // URL 상태 변화(네비게이션/외부) → 입력칸 동기화(직접 입력 중엔 방해 안 함).
  useEffect(() => {
    localUrlRef.current = localUrl;
  }, [localUrl]);

  // 최초 1회 webview 생성 + 언마운트 정리.
  // 비동기 open 전에 언마운트 → closed 플래그로 늦은 생성 즉시 회수(고아 방지).
  useEffect(() => {
    // open 수명주기 관측면(el.dataset.bvOpen) — webview 콘솔이 안 보이는 환경에서 ui.hit 로
    // 어느 단계에서 죽었는지 판독한다(실사고: open 미호출 빈 홀의 원인 판별 불가).
    const stamp = (v: string) => {
      const el0 = areaRef.current;
      if (el0) el0.dataset.bvOpen = v;
    };
    if (!label || !webview) {
      stamp(`bail:no-${!label ? "label" : "webview"}`);
      return;
    }
    const el = areaRef.current;
    if (!el) {
      stamp("bail:no-el");
      return;
    }
    let closed = false;
    stamp("invoking");
    webview
      .open(label, { url: localUrl })
      .then(() => {
        if (closed) {
          stamp("closed-during-open");
          void webview.close(label).catch(() => {});
          return;
        }
        stamp("opened");
      })
      .catch((e: unknown) => {
        stamp(`error:${String(e).slice(0, 80)}`);
        console.error("browser_open:", e);
      });

    // 명령 레지스트리에 label 등록(navigator 명령 라우팅용).
    // getUrl 클로저는 컴포넌트 state 의 최신 localUrl 을 반환한다.
    registerLabel(ctx.viewId!, label, () => localUrlRef.current);

    return () => {
      closed = true;
      unregisterLabel(ctx.viewId!);
      void webview.close(label).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  // webview nav 이벤트 → localUrl 동기화 + ctx.setTitle
  useEffect(() => {
    if (!label || !webview) return;
    const d1 = webview.on(label, "nav", (p) => {
      const url = p.url as string;
      setLocalUrl(url);
      // title 폴백 — 탭 제목은 콘텐츠 사실이다: 페이지가 title 이벤트를 안 내는 경우
      // (about:blank·일부 data URL)에도 이전 페이지의 stale 제목이 남지 않게, nav 시점에
      // URL(host 우선)로 먼저 보고한다. 진짜 title 이벤트가 오면 그것이 덮는다.
      //
      // **같은 문서 안 이동에는 하지 않는다.** 그때는 지울 stale 제목이 없고, 엔진은 제목을
      // 다시 내지 않는다 — 그래서 폴백이 진짜 제목을 주소로 덮고 그대로 굳는다(실측
      // 2026-08-02: 탭이 "Google" 이 아니라 www.google.com 으로 남았다. 제목 사건은 도착했고
      // 그 뒤 nav 가 세 번 더 오면서 매번 덮었다).
      if (p.inPage) return;
      if (url) {
        let t = url;
        try { t = new URL(url).host || url; } catch { /* data:/about: 등 — URL 그대로 */ }
        ctx.setTitle(t);
      }
      // 복원용 URL 영속(B3 restore.state) — 뷰 레코드에 실려 뷰와 수명을 같이한다.
      // about:blank 는 저장하지 않는다(신선 뷰의 초기 nav 가 저장본을 덮는 것 방지).
      if (ctx.viewId && url && url !== "about:blank")
        ctx.setRestoreState?.({ url });
    });
    const d2 = webview.on(label, "title", (p) => {
      const title = p.title as string;
      if (title) ctx.setTitle(title);
    });
    // 파비콘 — WKWebView 엔 파비콘 이벤트가 없어 로드 완료 시 페이지에서 추출한다(eval).
    // link[rel~=icon] 우선, 없으면 origin/favicon.ico. 빈 결과도 보고(이전 아이콘 해제).
    const dIcon = webview.on(label, "loading", (p) => {
      if (p.loading) return; // 완료 시점에만
      // eval 계약: js 는 "함수 본문"이고 최상위 return 으로 문자열을 돌려준다(callAsyncJavaScript).
      void webview
        .eval(
          label,
          `const l = document.querySelector('link[rel~="icon" i], link[rel="shortcut icon" i]');
           if (l && l.href) return l.href;
           try { return location.protocol.startsWith("http") ? location.origin + "/favicon.ico" : ""; } catch (e) { return ""; }`,
        )
        .then((r) => {
          if (typeof r === "string" && r !== "null") ctx.setIcon?.(r);
        })
        .catch(() => {});
    });
    return () => {
      d1.dispose();
      d2.dispose();
      dIcon.dispose();
    };
  }, [label, webview, ctx]);

  // 뷰 status 축(C2) — 코어 browser-loading 신호를 코어 status 축(ctx.setStatus)으로 보고한다.
  // 로딩 중=busy(닫기 가드 대상), 로드 완료=ready(표시 전용). 매핑은 순수(view-status.ts) 소유.
  // 로드 실패(error)는 코어 webview API 에 신호가 없어 보고하지 않는다(억지 상태 금지 — view-status.ts).
  // 뷰 언마운트 시 status 를 회수(null) — 코어도 뷰 종속으로 회수하지만 명시적으로 해제한다.
  useEffect(() => {
    if (!label || !webview) return;
    // 초기 상태를 즉시 보고 — loading 이벤트에만 기대면 이벤트가 안 오는 경로
    // (about:blank 즉시 로드, 구독 전 완료)에서 mounted 인데 무보고로 남는다
    // (실측: view-status 하니스 unreported=[tab] — C2 는 mounted 뷰의 보고를 요구한다).
    {
      const s0 = loadStatus(false);
      ctx.setStatus({ code: s0.code, message: t(s0.messageKey, langRef.current) });
    }
    const d = webview.on(label, "loading", (p) => {
      const s = loadStatus(!!p.loading);
      ctx.setStatus({ code: s.code, message: t(s.messageKey, langRef.current) });
    });
    return () => {
      d.dispose();
      ctx.setStatus(null);
    };
  }, [label, webview, ctx]);

  // 새 링크를 browserNewWindow 설정대로 연다.
  //   "tab"(기본): 대기 URL 설정 후 새 브라우저 콘텐츠 뷰를 연다(mount 가 그 URL 소비).
  //   "window": 독립 OS 창. app.webview.openWindow(url) 이 코어 browser_open_window 으로
  //             새 OS 브라우저 창을 직접 띄운다(범용 webview 호스트 표면).
  const openExternal = useCallback(
    async (url: string): Promise<void> => {
      const mode =
        (app.settings.get("browserNewWindow") as string | undefined) ?? "tab";
      if (mode === "window" && webview?.openWindow) {
        await webview.openWindow(url).catch(() => {});
        return;
      }
      if (!app.commands) return;
      setPendingUrl(url);
      const out = await app.commands
        .execute("tab.open", { program: "browser" })
        .catch(() => null);
      if (!out || !out.ok) {
        // 실패 시 대기 URL 을 드레인(null 로)해 다음 mount 가 잘못 소비하지 않게 하고,
        // 현재 뷰에서 직접 이동(URL 소실 방지).
        takePendingUrl();
        if (label && webview) void webview.navigate(label, url).catch(() => {});
      }
    },
    [app.commands, app.settings, label, webview],
  );

  // 새 링크(target=_blank / window.open) → openExternal 라우팅. 코어 webview 가 마커
  // 네비게이션을 가로채 "open-external"({url})을 emit 한다(browser.rs NEW_WINDOW_NAV).
  // App.tsx 레거시 핸들러를 대체 — 이제 브라우저 플러그인이 소유한다.
  useEffect(() => {
    if (!label || !webview) return;
    const d = webview.on(label, "open-external", (p) => {
      const url = typeof p.url === "string" ? p.url : "";
      if (url) void openExternal(url);
    });
    return () => d.dispose();
  }, [label, webview, openExternal]);

  const navigate = useCallback((raw: string) => {
    const u = normalizeUrl(raw);
    setLocalUrl(u);
    if (label && webview) {
      void webview.navigate(label, u).catch(() => {});
    }
  }, [label, webview]);

  const isBookmarked = bookmarks.some((b) => b.url === localUrl);

  const toggleBookmark = useCallback(async () => {
    if (!app.data) return;
    const key = `bm:${localUrl}`;
    if (isBookmarked) {
      await app.data.kv.delete(key);
    } else {
      let title = localUrl;
      try {
        title = new URL(localUrl).host || localUrl;
      } catch { /* noop */ }
      await app.data.kv.set(key, { url: localUrl, title });
    }
  }, [app.data, localUrl, isBookmarked]);

  // 공용 툴바 ↔ React 상태 동기. native 는 코어 loading 이벤트가 아직 없어 nav-state 는 초기값 유지
  // (#15 코어 KVO 후 setNavState 배선이 드롭인). stop 은 코어 stop invoke 부재로 reload 와 동일 처리.
  tbCbRef.current = {
    onNavigate: (raw) => navigate(raw),
    onBack: () => { if (label && webview) void webview.history(label, -1); },
    onForward: () => { if (label && webview) void webview.history(label, 1); },
    onReload: () => { if (label && webview) void webview.navigate(label, localUrlRef.current); },
    onStop: () => { if (label && webview) void webview.stop?.(label); },
    onHome: () => navigate(String(app.settings.get("homeUrl") ?? "about:blank")),
    onBookmarkToggle: () => void toggleBookmark(),
  };
  // 코어 loading 이벤트(browser-loading: didStart/didFinish + canGoBack/canGoForward) → 툴바 상태.
  useEffect(() => {
    if (!tb || !label || !webview) return;
    const d = webview.on(label, "loading", (p) => {
      tb.setNavState({ loading: !!p.loading, canBack: !!p.canBack, canForward: !!p.canForward });
    });
    return () => d.dispose();
  }, [tb, label, webview]);
  useEffect(() => { tb?.setUrl(localUrl); }, [tb, localUrl]);
  useEffect(() => { tb?.setBookmarked(isBookmarked); }, [tb, isBookmarked]);

  if (!label || !webview) {
    // 침묵 실패 금지 — 어댑터/라벨 부재는 결함 사실이다. 빈 공간이 아니라 사유를 그리고
    // status 로 보고한다(§0-4). 예전의 빈 <div> 는 "주소창도 없는 검은 페인"으로만 보였다.
    return (
      <div className="browser-view">
        <div className="bv-engine-missing">
          {!webview
            ? "브라우저 엔진 어댑터가 없습니다 — app.webview 미제공(코어 webview capability 확인)"
            : "브라우저 뷰 라벨이 없습니다 — viewId 미전달"}
        </div>
      </div>
    );
  }

  return (
    <div className="browser-view">
      {/* 공용 툴바(soksak-kit-browser-common) 호스트 — 고유 버튼(devtools·북마크 메뉴)은 extraSlot 포털. */}
      <div ref={tbHostRef} style={{ flex: "0 0 auto" }} />
      {tb &&
        createPortal(
          <>
            <button
              type="button"
              className={`bv-btn${dtOpen ? " on" : ""}`}
              title={t("inspect", lang)}
              data-node="devtools"
              onClick={() => {
                void webview.devtools(label)
                  .then((open) => setDtOpen(open))
                  .catch(() => {});
              }}
            >
              <IconTerminal />
            </button>
            <button
              type="button"
              className={`bv-btn${bmOpen ? " on" : ""}`}
              title={t("bookmarks", lang)}
              onClick={() => setBmOpen((o) => !o)}
            >
              <IconMenu />
            </button>
          </>,
          tb.extraSlot,
        )}
      {bmOpen && (
        <div className="bv-bm-list">
          {bookmarks.length === 0 && (
            <div className="bv-bm-empty">{t("noBookmarks", lang)}</div>
          )}
          {bookmarks.map((b) => (
            <div
              key={b.url}
              className="bv-bm-item"
              title={b.url}
              onClick={() => {
                navigate(b.url);
                setBmOpen(false);
              }}
            >
              <span className="bv-bm-title">{b.title}</span>
              <span className="bv-bm-url">{b.url}</span>
            </div>
          ))}
        </div>
      )}
      {/* 이 콘텐츠 뷰의 본문. `data-content-view-body` 는 코어에게 "이 label 은 여기다"라고
          말한다 — 콘텐츠가 문서 안인 프레임워크에서는 코어가 표면을 이 자리의 자식으로 두고,
          그러면 자리가 움직일 때 표면도 같이 움직인다(좌표를 쓰는 쪽이 없다). 콘텐츠가 문서
          밖인 프레임워크에서는 같은 자리가 bounds 추종의 앵커다. 선언은 하나, 쓰는 쪽이 둘이다. */}
      <div className="bv-area" ref={areaRef} data-content-view-body={label || undefined} />
    </div>
  );
}

export const BrowserView = memo(BrowserViewImpl);
