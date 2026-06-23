// 브라우저 콘텐츠 뷰 — 코어 native child webview(WKWebView) 를 플러그인에서 직접 구동.
// BrowserView.tsx(코어) 의 충실한 이식:
//   - app.webview.* API 로 invoke 교체
//   - ctx.viewId 로 label 파생
//   - app.data.kv 로 즐겨찾기 저장(key: bm:<url>)
//   - useSessions 구독 제거 → ResizeObserver + window resize 로 대체
//   - 아이콘: lucide-style inline SVG(코어 Icon 컴포넌트 비의존)

import { memo, useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { PluginApi, PluginViewContext } from "./host";
import { t } from "./i18n";
import { registerLabel, unregisterLabel, setPendingUrl, takePendingUrl } from "./commands";

// ── IME 조합 중 Enter 무시 (코어 imeKeys.ts 이식) ────────────────────────────
function isComposingEnter(
  e: React.KeyboardEvent,
): boolean {
  return e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229);
}

// ── rafThrottle (코어 rafThrottle.ts 이식) ────────────────────────────────────
interface RafThrottled {
  (): void;
  cancel(): void;
}

function rafThrottle(fn: () => void): RafThrottled {
  let rafId = 0;
  let pending = false;

  const invoke = () => {
    rafId = 0;
    if (!pending) return;
    pending = false;
    fn();
  };

  const throttled = () => {
    pending = true;
    if (!rafId) rafId = requestAnimationFrame(invoke);
  };
  throttled.cancel = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    pending = false;
  };
  return throttled;
}

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
function IconBack() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function IconForward() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function IconReload() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
function IconStarFilled() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
function IconStar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
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
  const webview = app.webview;

  // viewId → 전역 유일 label(창 네임스페이스) — webview 단일 진실에서만 파생.
  // ctx.viewId 없는 배치(사이드바)에서는 웹뷰를 열지 않는다.
  const label = ctx.viewId && webview ? webview.label(ctx.viewId) : null;

  const areaRef = useRef<HTMLDivElement>(null);
  const openedRef = useRef(false);
  const lastRectRef = useRef("");
  // 최신 visible 값 — open 완료 시점에 재적용(생성 경쟁 보정).
  // 콘텐츠 배치에서는 항상 visible=true. 탭 전환 숨김은 코어가 처리한다.
  const [localUrl, setLocalUrl] = useState(initialUrl);
  // reload 명령이 최신 URL 에 접근할 수 있도록 ref 동기화(클로저 스탈 방지).
  const localUrlRef = useRef(initialUrl);
  const [input, setInput] = useState(initialUrl);
  const [bmOpen, setBmOpen] = useState(false);
  const [dtOpen, setDtOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const inputFocusRef = useRef(false);

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
    if (!inputFocusRef.current) setInput(localUrl);
  }, [localUrl]);

  // bounds sync — rAF 스로틀(프레임당 1회 상한, 동일 rect skip).
  const syncBounds = useMemo(
    () =>
      rafThrottle(() => {
        const el = areaRef.current;
        if (!el || !openedRef.current || !webview || !label) return;
        const r = el.getBoundingClientRect();
        // 정수 스냅: rect 소수점 → 네이티브 반올림이 홀과 어긋남 방지(ceil/floor).
        const x = Math.ceil(r.left);
        const y = Math.ceil(r.top);
        const w = Math.max(1, Math.floor(r.right) - x);
        const h = Math.max(1, Math.floor(r.bottom) - y);
        const key = `${x},${y},${w},${h}`;
        if (key === lastRectRef.current) return;
        lastRectRef.current = key;
        void webview.bounds(label, x, y, w, h);
      }),
    [webview, label],
  );

  // 최초 1회 webview 생성 + 언마운트 정리.
  // 비동기 open 전에 언마운트 → closed 플래그로 늦은 생성 즉시 회수(고아 방지).
  useEffect(() => {
    if (!label || !webview) return;
    const el = areaRef.current;
    if (!el) return;
    let closed = false;
    const r = el.getBoundingClientRect();
    webview
      .open(label, {
        url: localUrl,
        x: r.left,
        y: r.top,
        w: Math.max(1, r.width),
        h: Math.max(1, r.height),
      })
      .then(() => {
        if (closed) {
          void webview.close(label).catch(() => {});
          return;
        }
        openedRef.current = true;
        // 생성 경쟁 보정: open 완료 후 현재 visible 재적용
        void webview.visible(label, true).catch(() => {});
        syncBounds();
      })
      .catch((e: unknown) => console.error("browser_open:", e));

    // 명령 레지스트리에 label 등록(navigator 명령 라우팅용).
    // getUrl 클로저는 컴포넌트 state 의 최신 localUrl 을 반환한다.
    registerLabel(ctx.viewId!, label, () => localUrlRef.current);

    return () => {
      closed = true;
      openedRef.current = false;
      unregisterLabel(ctx.viewId!);
      void webview.close(label).catch(() => {});
      syncBounds.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  // bounds 구동원. 네이티브 webview 는 DOM 슬롯(.bv-area)을 추종해야 하는데, DOM 에는 "위치 이동"
  // 이벤트가 없다(ResizeObserver 는 크기 변화만). 코어 BrowserView 는 sessions.subscribe(레이아웃 쓰기)
  // 로 위치 이동을 잡았지만 플러그인은 코어 스토어에 접근 못 한다 → 표준 기법인 rAF 위치 추종으로 대체.
  // syncBounds 는 정수 rect 동일이면 IPC 를 보내지 않으므로(같은-rect skip) 정지 상태의 비용은
  // getBoundingClientRect 1회/프레임뿐(폴링이 아니라 위치 추종 — 값이 바뀔 때만 네이티브로 전달).
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => syncBounds());
    ro.observe(el);
    const onWinResize = () => syncBounds();
    window.addEventListener("resize", onWinResize);
    let raf = 0;
    const track = () => {
      syncBounds();
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWinResize);
      cancelAnimationFrame(raf);
    };
  }, [syncBounds]);

  // webview nav 이벤트 → localUrl 동기화 + ctx.setTitle
  useEffect(() => {
    if (!label || !webview) return;
    const d1 = webview.on(label, "nav", (p) => {
      const url = p.url as string;
      setLocalUrl(url);
    });
    const d2 = webview.on(label, "title", (p) => {
      const title = p.title as string;
      if (title) ctx.setTitle(title);
    });
    return () => {
      d1.dispose();
      d2.dispose();
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
        .execute("view.open", { program: "browser" })
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

  if (!label || !webview) {
    return <div className="browser-view" />;
  }

  return (
    <div className="browser-view">
      <div className="bv-bar">
        <button
          type="button"
          className="bv-btn"
          title={t("back", lang)}
          data-node="back"
          onClick={() => void webview.history(label, -1)}
        >
          <IconBack />
        </button>
        <button
          type="button"
          className="bv-btn"
          title={t("forward", lang)}
          data-node="forward"
          onClick={() => void webview.history(label, 1)}
        >
          <IconForward />
        </button>
        <button
          type="button"
          className="bv-btn"
          title={t("reload", lang)}
          data-node="reload"
          onClick={() => void webview.navigate(label, localUrl)}
        >
          <IconReload />
        </button>
        <input
          className="bv-url"
          value={input}
          spellCheck={false}
          placeholder={t("urlPlaceholder", lang)}
          data-node="urlbar"
          onFocus={() => { inputFocusRef.current = true; }}
          onBlur={() => {
            inputFocusRef.current = false;
            setInput(localUrl);
          }}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (isComposingEnter(e)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              navigate(input);
              e.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          className={`bv-btn${isBookmarked ? " on" : ""}`}
          title={t("bookmark", lang)}
          onClick={() => void toggleBookmark()}
        >
          {isBookmarked ? <IconStarFilled /> : <IconStar />}
        </button>
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
      </div>
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
      {/* child webview 가 이 영역 위에 정렬된다(레이어 원칙: DOM 아래 네이티브). */}
      <div className="bv-area" ref={areaRef} />
    </div>
  );
}

export const BrowserView = memo(BrowserViewImpl);
