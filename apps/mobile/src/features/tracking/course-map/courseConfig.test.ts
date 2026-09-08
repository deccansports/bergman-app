import assert from "node:assert/strict";
import test from "node:test";

import {
  courseAssetMetadataVersion,
  courseGeometryOwner,
  extractCourseConfig,
  resolveBergman102MasterCourseSelection,
  resolveCourseGeometry,
  // @ts-expect-error Node's strip-types test runner requires the explicit .ts extension.
} from "./courseConfig.ts";

test("resolves BERGMAN 102 once as display geometry without changing athlete scope", () => {
  const config = {
    ticketDefinitions: [
      {
        id: "olympic-ticket",
        ticketName: "BERGMAN OLYMPIC TRIATHLON",
        courseMaps: {
          swimGpxUrl: "https://example.com/olympic-swim.gpx",
          bikeGpxUrl: "https://example.com/olympic-bike.gpx",
          runGpxUrl: "https://example.com/olympic-run.gpx",
        },
      },
      {
        id: "master-102-ticket",
        ticketName: "BERGMAN 102 TRIATHLON",
        courseMaps: {
          swimGpxUrl: "https://example.com/102-swim.gpx",
          bikeGpxUrl: "https://example.com/102-bike.gpx",
          runGpxUrl: "https://example.com/102-run.gpx",
        },
      },
      {
        id: "swimathon-ticket",
        ticketName: "BERGMAN SWIMATHON BLR",
        courseMaps: { swimGpxUrl: "https://example.com/swimathon.gpx" },
      },
    ],
  };

  const master = resolveBergman102MasterCourseSelection(config);
  assert.deepEqual(master, {
    ticketId: "master-102-ticket",
    contestId: undefined,
    contestName: "BERGMAN 102 TRIATHLON",
  });
  assert.deepEqual(
    extractCourseConfig(config, master).legs.map((leg) => leg.segment),
    ["swim", "bike", "run"],
  );
  assert.deepEqual(
    extractCourseConfig(config, {
      ticketId: "swimathon-ticket",
      contestName: "BERGMAN SWIMATHON BLR - 4 Km",
    }).legs.map((leg) => leg.segment),
    ["swim"],
  );
});

test("master map fetches only swim geometry for a Swimathon athlete", async () => {
  const urls: string[] = [];
  const config = {
    ticketDefinitions: [{
      id: "master-102-ticket",
      ticketName: "BERGMAN 102 TRIATHLON",
      courseMaps: {
        swimGpxUrl: "https://example.com/102-swim.gpx",
        bikeGpxUrl: "https://example.com/102-bike.gpx",
        runGpxUrl: "https://example.com/102-run.gpx",
      },
    }],
  };
  const selected = extractCourseConfig(config, {
    ticketId: "master-102-ticket",
    allowedSegments: ["swim"],
  });
  assert.deepEqual(selected.legs.map((leg) => leg.segment), ["swim"]);
  await resolveCourseGeometry(config, async (url) => {
    urls.push(url);
    return "<gpx><trk><trkseg><trkpt lat=\"1\" lon=\"1\"/><trkpt lat=\"2\" lon=\"2\"/></trkseg></trk></gpx>";
  }, { ticketId: "master-102-ticket", allowedSegments: ["swim"] });
  assert.equal(urls.some((url) => url.includes("bike")), false);
  assert.equal(urls.some((url) => url.includes("run")), false);
});

test("triathlon master geometry retains swim bike and run", () => {
  const config = {
    ticketDefinitions: [{
      id: "master-102-ticket",
      ticketName: "BERGMAN 102 TRIATHLON",
      courseMaps: {
        swimGpxUrl: "https://example.com/swim.gpx",
        bikeGpxUrl: "https://example.com/bike.gpx",
        runGpxUrl: "https://example.com/run.gpx",
      },
    }],
  };
  assert.deepEqual(
    extractCourseConfig(config, {
      ticketId: "master-102-ticket",
      allowedSegments: ["swim", "bike", "run"],
    }).legs.map((leg) => leg.segment),
    ["swim", "bike", "run"],
  );
});

test("waits for canonical ownership before allowing fallback GPX", () => {
  assert.equal(courseGeometryOwner(undefined, false), "pending");
  assert.equal(
    courseGeometryOwner(
      {
        available: true,
        canonicalCourseMissing: false,
        map: {
          contests: [
            {
              providerContestUuid: "contest-a",
              legs: [
                {
                  type: "run",
                  gpxUrls: ["https://example.com/canonical.gpx"],
                },
              ],
            },
          ],
        },
      },
      true,
    ),
    "canonical",
  );
  assert.equal(
    courseGeometryOwner(
      { available: false, canonicalCourseMissing: true, map: null },
      true,
    ),
    "fallback",
  );
});

test("athlete contest switches select only the new canonical geometry", () => {
  const canonical = {
    available: true,
    map: {
      contests: [
        {
          providerContestUuid: "contest-a",
          legs: [{ type: "run", gpxUrls: ["https://example.com/a.gpx"] }],
        },
        {
          providerContestUuid: "contest-b",
          legs: [{ type: "run", gpxUrls: ["https://example.com/b.gpx"] }],
        },
      ],
    },
  };

  assert.deepEqual(
    extractCourseConfig(canonical, { contestId: "contest-a" }).legs.map(
      (leg) => leg.gpxUrl,
    ),
    ["https://example.com/a.gpx"],
  );
  assert.deepEqual(
    extractCourseConfig(canonical, { contestId: "contest-b" }).legs.map(
      (leg) => leg.gpxUrl,
    ),
    ["https://example.com/b.gpx"],
  );
});

test("selects the Bergman course by category name when Feibot contest UUID is stale", () => {
  const config = {
    ticketDefinitions: [
      {
        id: "9sCrSokhHWsTp4fkDrQb",
        ticketName: "Bergman 102 Triathlon",
        courseMaps: { bikeGpxUrl: "https://example.com/102-bike.gpx" },
      },
      {
        id: "QVmkC9logIQ8VD3LVL3K",
        ticketName: "Bergman Olympic Triathlon",
        courseMaps: {
          swimGpxUrl: "https://example.com/olympic-swim.gpx",
          bikeGpxUrl: "https://example.com/olympic-bike.gpx",
          runGpxUrl: "https://example.com/olympic-run.gpx",
        },
      },
    ],
  };

  const selected = extractCourseConfig(config, {
    providerEventUuid: "6QTff6CR",
    contestId: "6mDRe5lS",
    contestName: "Bergman Olympic Triathlon",
    participantUuid: "race:6qtff6cr:6mdre5ls:2001",
  });

  assert.equal(selected.ticketId, "QVmkC9logIQ8VD3LVL3K");
  assert.deepEqual(
    selected.legs.map((leg) => leg.segment),
    ["swim", "bike", "run"],
  );
});

test("does not choose another contest when an explicit athlete scope has no match", () => {
  const selected = extractCourseConfig(
    {
      ticketDefinitions: [
        {
          id: "ticket-a",
          ticketName: "Race A",
          courseMaps: { runGpxUrl: "https://example.com/a.gpx" },
        },
        {
          id: "ticket-b",
          ticketName: "Race B",
          courseMaps: { runGpxUrl: "https://example.com/b.gpx" },
        },
      ],
    },
    {
      providerEventUuid: "6QTff6CR",
      contestId: "unknown-contest",
      contestName: "Unknown Race",
    },
  );

  assert.deepEqual(selected, { legs: [] });
});

test("uses the matching swim distance subcategory map before its parent fallback", () => {
  const selected = extractCourseConfig(
    {
      ticketDefinitions: [
        {
          id: "swimathon",
          ticketName: "Bergman Swimathon BLR",
          courseMaps: { swimGpxUrl: "https://example.com/parent.gpx" },
          subCategories: [
            {
              id: "swim-1k",
              name: "1 Km",
              courseMaps: { swimGpxUrl: "https://example.com/1k.gpx" },
            },
            {
              id: "swim-2k",
              name: "2 Km",
              courseMaps: { swimGpxUrl: "https://example.com/2k.gpx" },
            },
          ],
        },
      ],
    },
    {
      ticketId: "swimathon",
      contestName: "Bergman Swimathon BLR - 2 Km",
    },
  );

  assert.equal(selected.name, "2 Km");
  assert.deepEqual(selected.legs, [
    {
      segment: "swim",
      gpxUrl: "https://example.com/2k.gpx",
      distanceKm: undefined,
    },
  ]);
});

test("unwraps the provider-scoped canonical map envelope", () => {
  const selected = extractCourseConfig(
    {
      available: true,
      map: {
        courseVersion: 2,
        contests: [
          {
            providerContestUuid: "4FgqiHGd",
            displayName: "Bergman Swimathon Blr - 1 Km",
            legs: [
              {
                type: "swim",
                distanceKm: 1,
                gpxUrls: ["https://example.com/swim-1k.gpx"],
              },
            ],
          },
        ],
      },
    },
    { providerEventUuid: "1xajvfm0", contestId: "4fgqihgd" },
  );

  assert.equal(selected.ticketId, "4FgqiHGd");
  assert.deepEqual(selected.legs, [
    {
      segment: "swim",
      gpxUrl: "https://example.com/swim-1k.gpx",
      distanceKm: 1,
    },
  ]);
});

test("late category GPX metadata changes the fallback dependency and becomes selectable", () => {
  const initial = { id: "event", ticketDefinitions: [] };
  const hydrated = {
    id: "event",
    ticketDefinitions: [
      {
        id: "olympic",
        ticketName: "Olympic",
        courseMaps: {
          swimGpxUrl: "https://example.com/olympic-swim.gpx",
          bikeGpxUrl: "https://example.com/olympic-bike.gpx",
          runGpxUrl: "https://example.com/olympic-run.gpx",
        },
      },
    ],
  };

  assert.equal(courseAssetMetadataVersion(initial), "no-course-assets");
  assert.notEqual(
    courseAssetMetadataVersion(initial),
    courseAssetMetadataVersion(hydrated),
  );
  assert.deepEqual(
    extractCourseConfig(hydrated, {
      ticketId: "olympic",
      contestName: "Olympic",
    }).legs.map((leg) => leg.segment),
    ["swim", "bike", "run"],
  );
});
