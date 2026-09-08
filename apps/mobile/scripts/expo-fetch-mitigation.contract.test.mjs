import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const mobileRoot = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(mobileRoot, '..', '..');

test('production builds opt out of Expo Fetch native RequestQueue', () => {
  const eas = JSON.parse(readFileSync(resolve(workspaceRoot, 'eas.json'), 'utf8'));
  const production = eas.build?.production;

  assert.equal(production?.environment, 'production');
  assert.equal(production?.env?.EXPO_PUBLIC_USE_RN_FETCH, '1');
});

test('the documented mobile environment retains the Expo Fetch mitigation', () => {
  const environmentExample = readFileSync(resolve(mobileRoot, '.env.example'), 'utf8');

  assert.match(environmentExample, /^EXPO_PUBLIC_USE_RN_FETCH=1$/m);
});

test('Metro forces the React Native fetch path even when an OTA command omits its EAS environment', () => {
  const metroConfig = readFileSync(resolve(mobileRoot, 'metro.config.js'), 'utf8');

  assert.match(
    metroConfig,
    /process\.env\.EXPO_PUBLIC_USE_RN_FETCH\s*=\s*['"]1['"]/,
  );
  const fetchSelectionIndex = metroConfig.search(
    /process\.env\.EXPO_PUBLIC_USE_RN_FETCH\s*=/,
  );
  const expoMetroLoadIndex = metroConfig.search(
    /require\(['"]expo\/metro-config['"]\)/,
  );
  assert.ok(
    fetchSelectionIndex >= 0 &&
      expoMetroLoadIndex >= 0 &&
      fetchSelectionIndex < expoMetroLoadIndex,
    'the fetch selection must be set before Expo Metro configuration is loaded',
  );
});

test('live tracking keeps its selected-athlete request cancellation cleanup', () => {
  const liveTrackingScreen = readFileSync(
    resolve(mobileRoot, 'src/features/events/components/LiveTrackScreen.tsx'),
    'utf8',
  );

  assert.match(liveTrackingScreen, /createSelectedAthleteRequestCoordinator/);
  assert.match(liveTrackingScreen, /signal\.addEventListener\("abort", abort, \{ once: true \}\)/);
  assert.match(liveTrackingScreen, /coordinatorSignal\.addEventListener\("abort", abort, \{ once: true \}\)/);
  assert.match(liveTrackingScreen, /signal\.removeEventListener\("abort", abort\)/);
  assert.match(liveTrackingScreen, /coordinatorSignal\.removeEventListener\("abort", abort\)/);
});
