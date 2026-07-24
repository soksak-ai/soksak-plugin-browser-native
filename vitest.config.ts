import { defineConfig } from "vitest/config";
import paths from "./tsconfig.paths.json";

// 모듈 해석의 단일 진실 = build.mjs 가 생성하는 tsconfig.paths.json(발견 결과).
// esbuild·tsc 는 이미 이걸 쓰고, vitest 도 같은 해석을 써야 node_modules 에 잔존하는
// 낡은 킷 사본이 테스트에서 원본을 가리는 일이 없다(수기 topology 금지 — 생성물 재사용).
const alias = Object.fromEntries(
  Object.entries(paths.compilerOptions.paths as Record<string, string[]>)
    .filter(([key]) => !key.includes("*"))
    .map(([key, targets]) => [key, targets[0]]),
);

export default defineConfig({ resolve: { alias } });
