import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("compact map athlete card keeps name readable and BIB visible", async () => {
  const source = await readFile(
    new URL("./LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("function CompactMapAthleteCard(");
  const end = source.indexOf("function MapSettingsToggle(", start);
  const card = source.slice(start, end);
  const identityHeader = card.slice(
    card.indexOf('<View style={{ flex: 1, gap: 3 }}>'),
    card.indexOf("BIB {bib}"),
  );

  assert.match(identityHeader, /fontSize: 16,[\s\S]*fontWeight: "700"/);
  assert.doesNotMatch(identityHeader, /adjustsFontSizeToFit/);
  assert.match(identityHeader, /ellipsizeMode="tail"/);
  assert.match(card, /BIB \{bib\}/);
  assert.match(card, /fontSize: 15,[\s\S]*fontWeight: "500"/);
  assert.ok(card.indexOf("BIB {bib}") < card.indexOf("{categoryLine}"));
});
