import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("tracked cards never promote opaque identities into BIB labels", async () => {
  const [watchlist, liveTrack] = await Promise.all([
    readFile(new URL("./hooks/useWatchlist.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../events/components/LiveTrackScreen.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(watchlist, /const bib = parsedBib;/);
  assert.doesNotMatch(watchlist, /const bib = parsedBib \|\| id;/);
  assert.doesNotMatch(
    watchlist,
    /bib: text\(athlete\.bib\) \|\| resolvedId/,
  );
  assert.doesNotMatch(
    liveTrack,
    /firstText\(item\.bib, item\.bibNumber, item\.number, item\.id\)/,
  );
});
