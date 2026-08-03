import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("브라우저 제품과 프레임워크 합성의 경계", () => {
  it("공개 플러그인 identity는 하나로 유지한다", () => {
    expect(JSON.parse(read("plugin.json")).id).toBe("soksak-plugin-browser-native");
  });

  it("뷰는 공개 슬롯만 선언하고 bounds·veil·추종 정책을 소유하지 않는다", () => {
    const source = read("src/browser-view.tsx");
    expect(source).toContain("data-content-view-body");
    expect(source).toContain('data-node="surface"');
    for (const forbidden of [
      "requestAnimationFrame",
      "ResizeObserver",
      ".bounds(",
      '"layout.reflow"',
      '"layout.resize-gesture"',
      '"window.live-resize"',
      '"view.veiled"',
      '"view.parked"',
      "bounds-follow",
    ]) {
      expect(source, `${forbidden} 는 프레임워크 어댑터의 책임이다`).not.toContain(forbidden);
    }
  });

  it("manifest도 과거 합성 hack DOM을 선언하지 않는다", () => {
    const manifest = read("plugin.json");
    for (const forbidden of ["freeze-frame", '"id": "freeze"', "stand-in", "veil"]) {
      expect(manifest, `${forbidden} 는 Tauri adapter 밖에 남을 수 없다`).not.toContain(forbidden);
    }
  });

  it("합성 상태 명령은 제품 플러그인에 재선언하지 않는다", () => {
    expect(read("src/commands.ts")).not.toContain("surface.stats");
    expect(read("plugin.json")).not.toContain('"surface.stats"');
  });

  it("제품 플러그인의 호스트 타입도 셸 합성 명령을 재선언하지 않는다", () => {
    const host = read("src/host.ts");
    for (const method of ["bounds", "visible", "alive", "captureRegion"]) {
      expect(host, method).not.toMatch(new RegExp(`^\\s*${method}\\??\\s*:`, "m"));
    }
  });
});
