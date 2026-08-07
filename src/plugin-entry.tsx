// soksak browser 플러그인 엔트리 — loader 가 blob-URL 로 import 하는 단일 ESM(esbuild 번들).
// 콘텐츠 뷰 "content" 를 등록 → BrowserView 를 마운트.
import { createRoot, type Root } from "react-dom/client";
import { BrowserView } from "./browser-view";
import { injectStyles } from "./styles";
import { connectCommandTarget, registerCommands, takePendingUrl } from "./commands";
import type { PluginContext, PluginViewContext } from "./host";

const roots = new WeakMap<HTMLElement, Root>();

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
          // 이 뷰가 명령 대상이라는 사실이 사는 유일한 자리 — 코어가 선언한 인스턴스 수명 seam.
          // 프레임워크가 자식 renderer 에서 DOM 을 그려도 이 자리는 창 realm 에서 돈다.
          connect(vctx: PluginViewContext) {
            if (!vctx.viewId || !app.webview) {
              if (vctx.viewId)
                vctx.setStatus?.({ code: "error", message: "browser engine adapter missing (app.webview)" });
              return;
            }
            const viewId = vctx.viewId;
            const url = initialUrl(vctx);
            connectedInitialUrls.set(viewId, url);
            const disconnect = connectCommandTarget(viewId, app.webview.label(viewId), url);
            return () => {
              connectedInitialUrls.delete(viewId);
              disconnect();
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
            // 명령 대상 등록은 여기 없다 — connect 가 이미 했고, connect 는 mount 보다 먼저
            // 같은 턴에 돈다. 여기서 또 등록하면 같은 사실이 두 자리에 살고, 자식 renderer 에서
            // 그리는 프레임워크에서는 이 자리가 창의 등록부에 닿지도 못한다.
            if (vctx.viewId && !app.webview) {
              // 침묵 실패 금지 — 어댑터 부재는 status 축으로도 보고한다(화면 카드와 별개 채널).
              vctx.setStatus?.({ code: "error", message: "browser engine adapter missing (app.webview)" });
            }
            mountInto(
              container,
              <BrowserView app={app} ctx={vctx} initialUrl={url} />,
            );
          },
          unmount(container: HTMLElement) {
            // 등록을 connect 가 했으니 해제도 connect 의 반환이 한다 — 여기는 DOM 만 거둔다.
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
