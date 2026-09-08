import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./QueryProvider.tsx", import.meta.url), "utf8");

test("app rendering is never blocked by React Query disk hydration", () => {
  assert.doesNotMatch(source, /AsyncStorage|dehydrate\(|hydrate\(|cacheHydrated/);
  assert.match(source, /<QueryClientProvider client=\{queryClient\}>/);
});
