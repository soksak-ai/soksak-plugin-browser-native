// soksak browser 플러그인 엔트리 — loader 가 blob-URL 로 import 하는 단일 ESM(esbuild 번들).
// 콘텐츠 뷰 "content" 를 등록 → BrowserView 를 마운트.
import { createRoot, type Root } from "react-dom/client";
import { BrowserView } from "./browser-view";
import { injectStyles } from "./styles";
import { registerCommands } from "./commands";
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

    if (app.ui?.registerView) {
      ctx.subscriptions.push(
        app.ui.registerView("content", {
          mount(container: HTMLElement, vctx: PluginViewContext) {
            // 기본 URL: 설정에서 homeUrl 읽기(없으면 blank)
            const homeUrl =
              (app.settings.get("homeUrl") as string | undefined) ?? "about:blank";
            mountInto(
              container,
              <BrowserView app={app} ctx={vctx} initialUrl={homeUrl} />,
            );
          },
          unmount(container: HTMLElement) {
            unmountContainer(container);
          },
        }),
      );
    }

    registerCommands(ctx);
  },
  deactivate() {
    const s = document.getElementById("sk-browser-style");
    if (s) s.remove();
  },
};
