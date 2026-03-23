/**
 * Central API Client for Bergman Platform
 * All reads go through Cloudflare Worker
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://api.bergmantri.com";

export async function apiFetch(
  path: string,
  options: RequestInit = {}
) {

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}`);
  }

  return res.json();
}


/* --------------------------------------------------
Rankings
-------------------------------------------------- */

export async function getRankings(
  eventId: string,
  raceCategory: string,
  gender?: string,
  category?: string
) {

  let url = `/api/rankings?eventId=${eventId}&raceCategory=${raceCategory}`;

  if (gender)
    url += `&gender=${gender}`;

  if (category)
    url += `&category=${category}`;

  return apiFetch(url);

}


/* --------------------------------------------------
Race History
-------------------------------------------------- */

export async function getRaceHistory(
  eventId: string,
  raceCategory: string
) {

  return apiFetch(
    `/api/races/history?eventId=${eventId}&raceCategory=${raceCategory}`
  );

}


/* --------------------------------------------------
Participants
-------------------------------------------------- */

export async function getParticipants(eventId: string) {

  return apiFetch(
    `/api/participants?eventId=${eventId}`
  );

}


/* --------------------------------------------------
Event Stats
-------------------------------------------------- */

export async function getEventStats(eventId: string) {

  return apiFetch(
    `/api/event/stats?eventId=${eventId}`
  );

}


/* --------------------------------------------------
Live Athlete Timing
-------------------------------------------------- */

export async function getLiveAthlete(
  eventId: string,
  athleteId: string
) {

  return apiFetch(
    `/api/live/athlete?eventId=${eventId}&athleteId=${athleteId}`
  );

}
