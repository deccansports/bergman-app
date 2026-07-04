export type BroadcastCourseLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  coverageRadius: number;
  aliases?: string[];
};

const DEFAULT_LOCATIONS: BroadcastCourseLocation[] = [
  { id: 'finish-arch', name: 'Finish Arch', latitude: 12.9716, longitude: 77.5946, coverageRadius: 150, aliases: ['finish', 'finish line'] },
  { id: 'swim-start', name: 'Swim Start', latitude: 12.9712, longitude: 77.5941, coverageRadius: 150, aliases: ['swim start'] },
  { id: 'swim-exit', name: 'Swim Exit', latitude: 12.9711, longitude: 77.5943, coverageRadius: 150, aliases: ['swim exit'] },
  { id: 'transition', name: 'Transition', latitude: 12.9718, longitude: 77.5951, coverageRadius: 200, aliases: ['t1', 't2', 'transition 1', 'transition 2'] },
  { id: 'bike-turn-1', name: 'Bike Turn 1', latitude: 12.974, longitude: 77.6001, coverageRadius: 300, aliases: ['bike turn 1', 'bike turnaround 1'] },
  { id: 'bike-turn-2', name: 'Bike Turn 2', latitude: 12.9772, longitude: 77.6023, coverageRadius: 300, aliases: ['bike turn 2', 'bike turnaround 2'] },
  { id: 'run-aid-1', name: 'Run Aid Station 1', latitude: 12.9724, longitude: 77.5964, coverageRadius: 100, aliases: ['aid station 1'] },
  { id: 'run-aid-2', name: 'Run Aid Station 2', latitude: 12.9734, longitude: 77.5974, coverageRadius: 100, aliases: ['aid station 2'] },
  { id: 'run-turnaround', name: 'Run Turnaround', latitude: 12.9749, longitude: 77.5988, coverageRadius: 200, aliases: ['run turnaround'] },
  { id: 'awards-stage', name: 'Awards Stage', latitude: 12.9702, longitude: 77.5938, coverageRadius: 120, aliases: ['awards'] },
  { id: 'expo', name: 'Expo', latitude: 12.9697, longitude: 77.5929, coverageRadius: 120, aliases: ['expo'] },
];

export function getBroadcastCourseLocations(eventCourseLocations?: Array<Partial<BroadcastCourseLocation>> | null): BroadcastCourseLocation[] {
  const custom = Array.isArray(eventCourseLocations)
    ? eventCourseLocations
        .map((location, index) => ({
          id: String(location?.id || location?.name || `location-${index + 1}`).trim(),
          name: String(location?.name || `Location ${index + 1}`).trim(),
          latitude: Number(location?.latitude ?? 0) || 0,
          longitude: Number(location?.longitude ?? 0) || 0,
          coverageRadius: Number(location?.coverageRadius ?? 0) || 0,
          aliases: Array.isArray(location?.aliases) ? location.aliases.map((value) => String(value || '').trim()).filter(Boolean) : undefined,
        }))
        .filter((location) => location.name && Number.isFinite(location.latitude) && Number.isFinite(location.longitude))
    : [];

  return custom.length > 0 ? custom : DEFAULT_LOCATIONS;
}

export function findCourseLocation(query: string, locations: BroadcastCourseLocation[]) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return null;
  return locations.find((location) => {
    if (location.id.toLowerCase() === normalized) return true;
    if (location.name.toLowerCase() === normalized) return true;
    return Array.isArray(location.aliases) && location.aliases.some((alias) => alias.toLowerCase() === normalized || alias.toLowerCase().includes(normalized) || normalized.includes(alias.toLowerCase()));
  }) || null;
}

export function getDefaultCoverageRadiusForCameraType(cameraType: string) {
  const type = String(cameraType || '').trim().toLowerCase();
  if (type.includes('finish')) return 150;
  if (type.includes('swim')) return 150;
  if (type.includes('transition')) return 200;
  if (type.includes('bike')) return 300;
  if (type.includes('run')) return 200;
  if (type.includes('aid')) return 100;
  return 150;
}
