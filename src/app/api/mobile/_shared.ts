import { NextRequest, NextResponse } from 'next/server';
import { format, isBefore, parseISO, startOfDay } from 'date-fns';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { EventCalendarEntry, User } from '@/lib/types';
import { serializeValue } from '@/lib/utils';

export type MobileAuthContext = {
  uid: string;
  user: User;
  isAdmin: boolean;
};

export function mobileJson(
  success: boolean,
  data?: Record<string, any>,
  error?: string,
  status = 200,
) {
  return NextResponse.json(
    success
      ? { success: true, data: data || {} }
      : { success: false, error: error || 'Request failed' },
    { status },
  );
}

export function parseMobileYear(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get('year');
  const parsed = raw ? parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : new Date().getFullYear();
}

export async function requireMobileAuth(request: NextRequest): Promise<{ ok: true; auth: MobileAuthContext } | { ok: false; response: NextResponse }> {
  try {
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const cookieToken = request.cookies.get('firebase-token')?.value
      || request.cookies.get('auth-token')?.value
      || request.cookies.get('__session')?.value
      || request.cookies.get('token')?.value
      || null;
    const queryToken = request.nextUrl.searchParams.get('token') || request.nextUrl.searchParams.get('auth') || null;

    const headerToken = authHeader?.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : authHeader?.trim() || null;

    const token = headerToken || cookieToken || queryToken;
    if (!token) {
      return { ok: false, response: mobileJson(false, undefined, 'Unauthorized', 401) };
    }

    const decoded = await getAuthInstance().verifyIdToken(token);
    const db = getFirestoreInstance();
    const userSnap = await db.collection('users').doc(decoded.uid).get();

    if (!userSnap.exists) {
      return { ok: false, response: mobileJson(false, undefined, 'User profile not found', 404) };
    }

    const user = serializeValue({ uid: decoded.uid, ...userSnap.data() }) as User;

    return {
      ok: true,
      auth: {
        uid: decoded.uid,
        user,
        isAdmin: Boolean((user as any)?.isAdmin),
      },
    };
  } catch (error: any) {
    return { ok: false, response: mobileJson(false, undefined, error?.message || 'Unauthorized', 401) };
  }
}

export async function getMobileUpcomingEvents(): Promise<EventCalendarEntry[]> {
  const result = await getCalendarEventsAction();
  if (!result.success || !Array.isArray(result.events)) {
    return [];
  }

  const today = startOfDay(new Date());
  return result.events
    .filter((event) => {
      if ((event as any)?.isHidden) return false;
      if (!event.eventDate) return true;
      return !isBefore(parseISO(event.eventDate), today);
    })
    .sort((a, b) => {
      const dateA = a.eventDate ? new Date(a.eventDate).getTime() : Infinity;
      const dateB = b.eventDate ? new Date(b.eventDate).getTime() : Infinity;
      return dateA - dateB;
    });
}

export async function getMobileLiveEvents() {
  const db = getFirestoreInstance();

  let eventsSnapshot = await db.collection('events').get();
  if (eventsSnapshot.empty) {
    eventsSnapshot = await db.collection('eventCalendar').get();
  }

  const today = startOfDay(new Date());

  return eventsSnapshot.docs
    .map((doc) => {
      const data = doc.data();
      const eventDateValue = String(data.eventDate || data.date || '').trim();
      const eventDate = data.eventDate ? parseISO(data.eventDate) : null;
      const hidden = Boolean(data.isHidden || data.hidden);
      const liveDataSource = typeof data?.liveDataSource === 'string' ? data.liveDataSource : null;
      const liveTrackingEnabled =
        data?.liveTrackingHub?.trackingConfig?.enabled ??
        data?.showLiveTrackingOnHomepage ??
        (liveDataSource ? liveDataSource !== 'none' : null) ??
        true;

      let status: 'upcoming' | 'live' | 'completed' = 'completed';
      let isUpcoming = false;

      if (eventDate) {
        if (isBefore(eventDate, today)) {
          status = 'completed';
        } else {
          const todayStr = format(today, 'yyyy-MM-dd');
          const eventStartStr = data.eventDate || '';
          status = eventStartStr === todayStr ? 'live' : 'upcoming';
          isUpcoming = true;
        }
      }

      return {
        id: doc.id,
        name: String(data.eventName || data.name || 'Unnamed Event').trim() || 'Unnamed Event',
        date: eventDateValue || null,
        customSlug: data.customSlug || null,
        isUpcoming,
        status,
        hidden,
        liveTrackingEnabled,
        sortDate: eventDate?.getTime() || 0,
      };
    })
    .filter((event) => !event.hidden && event.liveTrackingEnabled)
    .sort((a, b) => {
      if (a.isUpcoming !== b.isUpcoming) return b.isUpcoming ? 1 : -1;
      if (a.isUpcoming && b.isUpcoming) return a.sortDate - b.sortDate;
      return b.sortDate - a.sortDate;
    })
    .map(({ sortDate, hidden, liveTrackingEnabled, ...rest }) => rest);
}
