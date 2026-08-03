import { describe, expect, it, vi } from "vitest";
import { waitForSelector } from "./commands";
import type { WebviewApi } from "./host";

describe("dom.wait-for — navigation 경계를 넘는 사건 기반 대기", () => {
  it("옛 document의 평가가 소멸해도 loading=false 사건에서 새 document를 다시 관측한다", async () => {
    const loading = new Set<(payload: Record<string, unknown>) => void>();
    const evalFn = vi
      .fn<(...args: unknown[]) => Promise<string>>()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(JSON.stringify({ found: true }));
    const webview = {
      eval: evalFn,
      on: (_label: string, event: string, cb: (payload: Record<string, unknown>) => void) => {
        if (event === "loading") loading.add(cb);
        return { dispose: () => loading.delete(cb) };
      },
    } as unknown as WebviewApi;

    const pending = waitForSelector(webview, "browser-label", "h1", 1_000);
    await Promise.resolve();
    for (const cb of loading) cb({ loading: false });

    await expect(pending).resolves.toEqual({ found: true });
    expect(evalFn).toHaveBeenCalledTimes(2);
    expect(loading.size).toBe(0);
  });
});
