import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner requires the explicit extension.
import * as layers from "./mapboxCourseLayers.ts";

const {
  athleteSourceSignature,
  buildAthleteGeoJson,
  buildDistanceGeoJson,
  COURSE_COLORS,
  majorDistanceInterval,
  paddedCourseBounds,
} = layers;

test("canonical discipline colors and overview marker intervals are exact", () => {
  assert.deepEqual(COURSE_COLORS, {
    swim: "#0EA5E9",
    bike: "#F5821F",
    run: "#DC2626",
    transition: "#64748B",
    other: "#334155",
  });
  assert.equal(majorDistanceInterval("SWIM"), 1);
  assert.equal(majorDistanceInterval("BIKE"), 10);
  assert.equal(majorDistanceInterval("RUN"), 5);
});

test("distance badges carry numbers only and classify major intervals", () => {
  const point = (id: string, segment: string, distanceKm: number) => ({
    id,
    sourceId: `gpx-distance-${id}`,
    source: "geometry" as const,
    kind: "timing" as const,
    segment,
    label: `${distanceKm} km`,
    distanceLabel: `${distanceKm} km`,
    distanceKm,
    position: { lat: 13, lng: 77 },
  });
  const shape = buildDistanceGeoJson([
    point("bike-10", "BIKE", 10),
    point("bike-11", "BIKE", 11),
    point("run-5", "RUN", 5),
  ]);
  assert.deepEqual(
    shape.features.map((feature) => [
      feature.properties.number,
      feature.properties.major,
    ]),
    [
      ["10", true],
      ["11", false],
      ["5", true],
    ],
  );
});

test("200 selected-athlete switches do not alter athlete source identity", () => {
  const athletes = [
    {
      id: "p-1",
      bib: "101",
      name: "One",
      position: { lat: 13, lng: 77 },
      selected: true,
    },
    {
      id: "p-2",
      bib: "4121",
      name: "Two",
      position: { lat: 13.01, lng: 77.01 },
      selected: false,
    },
  ];
  const initialSignature = athleteSourceSignature(athletes);
  const initialShape = buildAthleteGeoJson(athletes);
  for (let index = 0; index < 200; index += 1) {
    const switched = athletes.map((athlete, athleteIndex) => ({
      ...athlete,
      selected: athleteIndex === index % 2,
    }));
    assert.equal(athleteSourceSignature(switched), initialSignature);
    assert.deepEqual(buildAthleteGeoJson(switched), initialShape);
  }
});

test("padded course bounds constrain horizontal and vertical panning", () => {
  const bounds = paddedCourseBounds({
    name: "Test",
    hasGeometry: true,
    legs: [],
    mergedPath: [],
    markers: [],
    timingPoints: [],
    bounds: {
      minLat: 12.9,
      maxLat: 13.1,
      minLng: 76.9,
      maxLng: 77.1,
    },
  });
  assert.ok(bounds);
  assert.ok(bounds.ne[0] > 77.1 && bounds.sw[0] < 76.9);
  assert.ok(bounds.ne[1] > 13.1 && bounds.sw[1] < 12.9);
});
