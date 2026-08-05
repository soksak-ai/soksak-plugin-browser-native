// soksak browser 플러그인 엔트리 — loader 가 blob-URL 로 import 하는 단일 ESM(esbuild 번들).
// 콘텐츠 뷰 "content" 를 등록 → BrowserView 를 마운트.
import { createRoot, type Root } from "react-dom/client";
import { BrowserView } from "./browser-view";
import { injectStyles } from "./styles";
import { registerCommands, registerViewAtMount, takePendingUrl, unregisterLabel } from "./commands";
import type { PluginContext, PluginViewContext } from "./host";

const roots = new WeakMap<HTMLElement, Root>();
// unmount 는 컨텍스트를 받지 않으므로 어떤 컨테이너가 어떤 뷰였는지 mount 가 적어 둔다.
const mountedViewOf = new WeakMap<HTMLElement, string>();

function mountInto(container: HTMLElement, node: React.ReactElement): void {
  injectStyles();
  unmountContainer(container);
  container.style.position = "relative";
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.inset = "0";
  host.style.overflow = "hidden";
  container.appendChild(host);
  const root = createRoot(host);
  root.render(node);
  roots.set(container, root);
}

function unmountContainer(container: HTMLElement): void {
  const root = roots.get(container);
  if (root) {
    root.unmount();
    roots.delete(container);
  }
  container.replaceChildren();
}

export default {
  activate(ctx: PluginContext) {
    const app = ctx.app;
    injectStyles();
    // 뷰별 페이지 줌 배율(관찰 확대 — 메모리 수명).
    const pageZoom = new Map<string, number>();
    // connect가 먼저 소비한 시작 URL을 같은 인스턴스의 DOM mount가 재사용한다.
    const connectedInitialUrls = new Map<string, string>();
    const initialUrl = (vctx: PluginViewContext): string => {
      const pending = takePendingUrl();
      const rs = vctx.restore?.state as { url?: string } | null | undefined;
      return pending ??
        (typeof rs?.url === "string" && rs.url ? rs.url : null) ??
        (app.settings.get("homeUrl") as string | undefined) ??
        "about:blank";
    };

    if (app.ui?.registerView) {
      ctx.subscriptions.push(
        app.ui.registerView("content", {
          connect(vctx: PluginViewContext) {
            if (!vctx.viewId || !app.webview) {
              if (vctx.viewId)
                vctx.setStatus?.({ code: "error", message: "browser engine adapter missing (app.webview)" });
              return;
            }
            const viewId = vctx.viewId;
            const url = initialUrl(vctx);
            connectedInitialUrls.set(viewId, url);
            registerViewAtMount(viewId, app.webview.label(viewId), url);
            return () => {
              connectedInitialUrls.delete(viewId);
              unregisterLabel(viewId);
            };
          },
          mount(container: HTMLElement, vctx: PluginViewContext) {
            // 시작 URL 우선순위: 대기 URL(open 명령 / open-external 새 탭이 set) →
            // 복원 상태(B3 restore.state — 뷰 레코드 영속, 뷰와 수명 동기) → homeUrl 설정 → blank.
            // takePendingUrl 은 1회 소비(다음 mount 가 잘못 이어받지 않게).
            // 플러그인 kv(vurl:viewId) 복원은 폐기 — viewId 는 세션 넘어 재사용되어
            // 죽은 뷰의 잔재가 새 뷰에 유입된다(실측: 새 탭이 유령 URL 로 시작).
            const url = vctx.viewId
              ? connectedInitialUrls.get(vctx.viewId) ?? initialUrl(vctx)
              : initialUrl(vctx);
            // 명령 타겟 등록은 mount 의 동기 경로에서 — 코어의 mounted 신호(tab.open
            // mounted:true)는 mount 반환을 뜻하므로, 등록이 React 이펙트에만 있으면
            // mounted 직후 명령이 NO_VIEW 로 죽는 창이 생긴다(실측: 갓 부팅한 창).
            if (vctx.viewId && app.webview) {
              mountedViewOf.set(container, vctx.viewId);
              registerViewAtMount(vctx.viewId, app.webview.label(vctx.viewId), url);
            } else if (vctx.viewId) {
              // 침묵 실패 금지 — 어댑터 부재는 status 축으로도 보고한다(화면 카드와 별개 채널).
              vctx.setStatus?.({ code: "error", message: "browser engine adapter missing (app.webview)" });
            }
            mountInto(
              container,
              <BrowserView app={app} ctx={vctx} initialUrl={url} />,
            );
          },
          unmount(container: HTMLElement) {
            // 등록을 mount 가 했으니 해제도 여기서 한다(React cleanup 미실행 케이스 방어 — 멱등).
            const vid = mountedViewOf.get(container);
            if (vid) {
              mountedViewOf.delete(container);
              unregisterLabel(vid);
            }
            unmountContainer(container);
          },
          zoom(_container: HTMLElement, vctx: PluginViewContext, action: "in" | "out" | "reset") {
            // 페이지 줌(§Zoom — 브라우저 관례): 자기 child 라벨에 뷰 배율을 건다.
            // 유효 배율 합성(창 줌 ×)은 코어(webview_zoom_view)가 소유한다.
            const viewId = vctx.viewId;
            if (!viewId || !app.webview) return;
            const cur = pageZoom.get(viewId) ?? 1;
            const next =
              action === "reset"
                ? 1
                : Math.max(
                    0.25,
                    Math.min(4, Math.round((cur + (action === "in" ? 0.1 : -0.1)) * 100) / 100),
                  );
            pageZoom.set(viewId, next);
            void app.webview.zoom(app.webview.label(viewId), next).catch(() => {});
          },
        }),
      );
    }

    registerCommands(ctx);

    // 레거시 vurl 원장 제거 — B3 restore.state 로 이관 완료. 원장은 죽은 뷰의 잔재를
    // 남겨 재사용 viewId 와 충돌했으므로 흡수 없이 폐기한다.
    if (app.data) {
      void app.data.kv
        .keys("vurl:")
        .then((ks) => { for (const k of ks) void app.data!.kv.delete(k); })
        .catch(() => {});
    }
  },
  deactivate() {
    const s = document.getElementById("sk-browser-style");
    if (s) s.remove();
  },
};
