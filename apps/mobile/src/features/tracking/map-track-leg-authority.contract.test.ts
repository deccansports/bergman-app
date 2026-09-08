import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("track seed prefers canonical current leg before the last boundary segment", async () => {
  const source = await readFile(
    new URL("./mappers.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const activeLeg = text\([\s\S]*resolved\.currentLeg \?\?[\s\S]*res\.athlete\.currentLegName \?\?[\s\S]*last\.segment/,
  );
});

test("map interpolation uses the shared live clock and rebases on a new official anchor", async () => {
  const mapSource = await readFile(
    new URL(
      "./athlete-detail/components/cards/LiveMapCard.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const clockSource = await readFile(
    new URL("./engine/useRaceClock.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    mapSource,
    /const liveAnchorKey = `\$\{track\.seed\.anchorTimeSec\}:\$\{track\.seed\.nextKm\}`/,
  );
  assert.match(mapSource, /liveAnchorKey,/);
  assert.match(clockSource, /useSharedLiveNow\(liveEnabled\)/);
  assert.match(clockSource, /liveBaseline\.current\.key !== nextLiveKey/);
  assert.equal((clockSource.match(/setInterval\(/g) ?? []).length, 1);
  assert.match(clockSource, /\/\/ replay[\s\S]*setInterval\(/);
});
