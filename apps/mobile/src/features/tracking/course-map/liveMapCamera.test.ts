import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node strip-types requires an explicit extension.
import * as camera from "./liveMapCamera.ts";

const {
  cameraCommandAllowed,
  constrainCameraCenter,
  courseReferencePoint,
  distanceFromReferenceKm,
  radiusBounds,
} = camera;

const bengaluru = { lat: 12.9716, lng: 77.5946 };

test("camera center moves freely in every direction inside 100 km", () => {
  for (const candidate of [
    { lat: 13.4, lng: 77.5946 },
    { lat: 12.5, lng: 77.5946 },
    { lat: 12.9716, lng: 78.1 },
    { lat: 12.9716, lng: 77.1 },
  ]) {
    const result = constrainCameraCenter(bengaluru, candidate);
    assert.equal(result.constrained, false);
    assert.deepEqual(result.center, candidate);
  }
});

test("camera can approach 100 km and is constrained only beyond it", () => {
  const near = constrainCameraCenter(bengaluru, { lat: 13.84, lng: 77.5946 });
  assert.equal(near.constrained, false);
  assert.ok(near.distanceKm > 95 && near.distanceKm < 100);

  const far = constrainCameraCenter(bengaluru, { lat: 15, lng: 77.5946 });
  assert.equal(far.constrained, true);
  assert.ok(
    Math.abs(distanceFromReferenceKm(bengaluru, far.center) - 100) < 0.05,
  );
});

test("user ownership blocks automatic fit and follow commands", () => {
  assert.equal(cameraCommandAllowed("USER_CONTROLLED", "follow"), false);
  assert.equal(cameraCommandAllowed("USER_CONTROLLED", "athlete_focus"), false);
  assert.equal(cameraCommandAllowed("USER_CONTROLLED", "course_fit"), false);
  assert.equal(cameraCommandAllowed("USER_CONTROLLED", "boundary"), true);
  assert.equal(cameraCommandAllowed("ATHLETE_FOCUS", "follow"), true);
});

test("course start is the immutable event reference and radius bounds exceed the course", () => {
  const reference = courseReferencePoint({
    mergedPath: [bengaluru, { lat: 12.98, lng: 77.6 }],
    bounds: { minLat: 12.9, maxLat: 13, minLng: 77.5, maxLng: 77.7 },
  });
  assert.deepEqual(reference, bengaluru);
  const bounds = radiusBounds(reference!);
  assert.ok(bounds.ne[1] > 13.8);
  assert.ok(bounds.sw[1] < 12.1);
});
