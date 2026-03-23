// functions/src/utils.ts

export function hmsToSeconds(timeString?: string | null): number {
  if (!timeString || typeof timeString !== 'string') {
    return Infinity;
  }
  const trimmedTime = timeString.trim();
  if (!trimmedTime || trimmedTime.toUpperCase() === 'N/A' || trimmedTime === '-') {
    return Infinity;
  }
  const parts = trimmedTime.split(':').map(part => parseInt(part, 10));
  if (parts.some(isNaN)) {
    return Infinity;
  }
  let hours = 0, minutes = 0, seconds = 0;
  if (parts.length === 3) {
    [hours, minutes, seconds] = parts;
  } else if (parts.length === 2) {
    [minutes, seconds] = parts;
  } else if (parts.length === 1 && parts[0] >= 0) {
     [seconds] = parts;
  } else {
    return Infinity;
  }
  if (hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) {
    return Infinity;
  }
  return hours * 3600 + minutes * 60 + seconds;
}


export function formatSecondsToHMS(seconds: number | undefined | null): string {
    if (seconds === undefined || seconds === null || isNaN(seconds) || seconds === Infinity || seconds < 0) {
        return '--:--:--';
    }
    if (seconds === 0) {
        return '00:00:00';
    }
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const paddedHrs = hrs.toString().padStart(2, '0');
    const paddedMins = mins.toString().padStart(2, '0');
    const paddedSecs = secs.toString().padStart(2, '0');
    
    return `${paddedHrs}:${paddedMins}:${paddedSecs}`;
}

export function normalizeStatus(status?: string | null): string {
  if (!status) return 'Unknown';
  const s = status.trim().toUpperCase();
  if (s.includes('FINISH')) return 'Finished';
  if (s === 'DNF') return 'DNF';
  if (s === 'DNS') return 'DNS';
  if (s === 'DNQ') return 'DNQ';
  if (s === 'ON COURSE' || s === 'RACING' || s === 'ACTIVE') return 'On Course';
  if (s === 'NOT STARTED') return 'Not Started';
  return status; // Return original if no match
}

export const isTriathlonEvent = (raceCategory?: string | null): boolean => {
    if (typeof raceCategory !== 'string' || !raceCategory) return false;
    const upperCategory = raceCategory.trim().toUpperCase();
    return upperCategory.includes('TRIATHLON');
};

export const isDuathlonEvent = (raceCategory?: string | null): boolean => {
     if (typeof raceCategory !== 'string' || !raceCategory) return false;
     const upperCategory = raceCategory.trim().toUpperCase();
     return upperCategory.includes('DUATHLON');
};

const parseDistance = (txt?: string | null): number | null => {
  if (!txt) return null;
  const n = parseFloat(txt);
  return isNaN(n) ? null : n;
};

// Course constants for normalization logic
const COURSE_CONFIG = {
  bikeFinish: 90,
  runFinish: 21.1,
};

export function normalizeSplit(rawSplitSegmentName?: string): { leg: string, distance?: number } | null {
  if (!rawSplitSegmentName) return null;

  const segment = rawSplitSegmentName.trim().toUpperCase();

  if (/swim/i.test(segment)) return { leg: "SWIM", distance: 1.9 };
  if (segment === "T1") return { leg: "T1" };
  if (segment === "T2") return { leg: "T2" };
  if (/finish/i.test(segment)) return { leg: "FINISHED" };

  const km = parseDistance(segment);
  if (km === null) return null; // If it's not a known keyword and not a distance, it's unknown

  if (km <= COURSE_CONFIG.bikeFinish) return { leg: "BIKE", distance: km };
  
  // Anything after bike finish distance is considered a run split
  return { leg: "RUN", distance: km };
}
