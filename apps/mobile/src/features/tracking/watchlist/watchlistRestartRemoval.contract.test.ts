import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repository = await readFile(
  new URL(
    "../../../core/repositories/trackingSubscription.repository.ts",
    import.meta.url,
  ),
  "utf8",
);
const hook = await readFile(
  new URL("./hooks/useWatchlist.ts", import.meta.url),
  "utf8",
);
const store = await readFile(
  new URL("../../../core/store/watchlist.store.ts", import.meta.url),
  "utf8",
);
const authProvider = await readFile(
  new URL("../../../core/auth/AuthProvider.tsx", import.meta.url),
  "utf8",
);

test("DELETE includes canonical and BIB identity when the stored item ID is stale", () => {
  assert.match(repository, /method: "DELETE",\s*body: \{/s);
  assert.match(repository, /participantUuid: input\.participantUuid \|\| null/);
  assert.match(repository, /providerUuid: input\.providerUuid \|\| null/);
  assert.match(repository, /contestUuid: input\.contestUuid \|\| null/);
  assert.match(repository, /bib: input\.bib \|\| null/);
  assert.match(repository, /return rowsFromResponse\(payload\)/);
});

test("successful removal persists the server-confirmed remaining watchlist before returning", () => {
  const toggle = hook.slice(
    hook.indexOf("const toggle = useCallback"),
    hook.indexOf("return {", hook.indexOf("const toggle = useCallback")),
  );
  assert.match(
    toggle,
    /const remainingSubscriptions = await unsubscribeTrackedAthlete/,
  );
  assert.match(toggle, /await storeReplaceAthletes\(confirmedAthletes\)/);
  const authenticatedRemoval = toggle.slice(
    toggle.indexOf("const remainingSubscriptions"),
  );
  assert.ok(
    authenticatedRemoval.indexOf(
      "await storeReplaceAthletes(confirmedAthletes)",
    ) < authenticatedRemoval.indexOf("return true"),
  );
});

test("local untrack persistence is awaited so cold-start hydration cannot restore the removed row", () => {
  const toggle = store.slice(store.indexOf("toggle: async"));
  assert.match(toggle, /await persist\(next, get\(\)\.accountId\)/);
  assert.match(toggle, /return true/);
});

test("an authoritative backend snapshot wins if it arrives during local hydration", () => {
  const hydrate = store.slice(
    store.indexOf("hydrate: async"),
    store.indexOf("clearAccount: async"),
  );
  assert.match(hydrate, /if \(get\(\)\.hydrated\) return/);
  assert.match(authProvider, /replaceAthletes\(rows\)/);
});

test("identical authoritative snapshots do not rerender or rewrite storage", () => {
  assert.match(store, /function sameAthleteSnapshot\(/);
  assert.match(
    store,
    /if \(sameAthleteSnapshot\(get\(\)\.athletes, next\)\)[\s\S]*return;/,
  );
});

test("authenticated startup does not render device cache before the fresh backend watchlist", () => {
  assert.match(store, /prepareAccount: \(accountId: string\) => void/);
  assert.match(store, /prepareAccount: \(accountId\) => \{/);
  assert.match(authProvider, /prepareAccount\(userId\)/);
  assert.match(authProvider, /staleTime: 0/);
  assert.match(authProvider, /refetchOnMount: "always"/);
  assert.match(authProvider, /accountWatchlistQuery\.isFetching/);
  assert.match(
    authProvider,
    /accountWatchlistQuery\.isError[\s\S]*hydrate\(userId\)/,
  );
});

test("foreground recovery refreshes the authoritative account watchlist", () => {
  assert.match(authProvider, /accountWatchlistQuery\.refetch\(\)/);
  assert.match(authProvider, /foreground watchlist refresh/);
});

test("guest startup clears persisted tracking instead of restoring a prior session", () => {
  const guestBranch = authProvider.slice(
    authProvider.indexOf('if (status === "guest")'),
    authProvider.indexOf("const onAppStateChange"),
  );
  assert.match(guestBranch, /clearAccount\(null\)/);
  assert.match(guestBranch, /guest watchlist reset/);
  assert.doesNotMatch(guestBranch, /hydrate\(null\)/);

  const clearAccount = store.slice(
    store.indexOf("clearAccount: async"),
    store.indexOf("replaceAthletes: async"),
  );
  assert.ok(
    clearAccount.indexOf("set({ athletes: []") <
      clearAccount.indexOf("await AsyncStorage.removeItem"),
  );
});

test("untrack cancels an older account GET and rejects a successful no-op DELETE", () => {
  const toggle = hook.slice(
    hook.indexOf("const toggle = useCallback"),
    hook.indexOf("return {", hook.indexOf("const toggle = useCallback")),
  );
  assert.match(toggle, /await queryClient\.cancelQueries/);
  assert.match(toggle, /remainingSubscriptions\.some/);
  assert.match(toggle, /backend did not remove/);
});
