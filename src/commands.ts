// browser.* 명령 — 내비게이션. 매니페스트 contributes.commands 와 1:1. CLI/MCP 자동 노출.
import type { PluginContext } from "./host";

// 활성 뷰의 webview label 과 현재 URL 을 외부에서 주입받기 위한 레지스트리.
// 뷰가 마운트되면 label 을 등록하고, 언마운트되면 제거한다.
interface ViewEntry { label: string; getUrl: () => string }
const activeViews = new Map<string, ViewEntry>();

export function registerLabel(viewId: string, label: string, getUrl: () => string): void {
  activeViews.set(viewId, { label, getUrl });
}
export function unregisterLabel(viewId: string): void {
  activeViews.delete(viewId);
}

function firstEntry(): ViewEntry | null {
  const iter = activeViews.values().next();
  return iter.done ? null : iter.value;
}

export function registerCommands(ctx: PluginContext): void {
  const app = ctx.app;
  if (!app.commands) return;
  const sub = (d: { dispose(): void }) => ctx.subscriptions.push(d);

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
      },
      returns: "{ ok }",
      handler: async (p) => {
        const entry = firstEntry();
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
      returns: "{ ok }",
      handler: async () => {
        const entry = firstEntry();
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
      returns: "{ ok }",
      handler: async () => {
        const entry = firstEntry();
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
      returns: "{ ok }",
      handler: async () => {
        const entry = firstEntry();
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
}
