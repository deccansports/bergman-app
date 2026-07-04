'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import nextDynamic from 'next/dynamic';
import type { EventCalendarEntry } from '@/lib/types';
import { useRouter } from 'next/navigation';

const BroadcastCenterTab = nextDynamic(() => import('@/components/admin/BroadcastCenterTab'), {
  ssr: false,
  loading: () => <div className="rounded-2xl border p-6 text-sm text-muted-foreground">Loading broadcast tools...</div>,
});

export default function BroadcastPage() {
  const router = useRouter();
  const { firebaseUserFromAuth } = useAuth();
  const [events, setEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!firebaseUserFromAuth) {
      router.push('/login');
      return;
    }

    const loadEvents = async () => {
      try {
        const res = await fetch('/api/events?limit=50', {
          headers: {
            Authorization: `Bearer ${await firebaseUserFromAuth.getIdToken()}`,
          },
        });

        if (res.ok) {
          const data = await res.json();
          const eventList = Array.isArray(data) ? data : data.events || [];
          setEvents(
            eventList.map((e: any) => ({
              id: e.id || e._id,
              eventName: e.eventName || e.name || 'Untitled Event',
              eventDate: e.eventDate ? new Date(e.eventDate).toISOString() : null,
              ...e,
            })),
          );
        }
      } catch (error) {
        console.error('Failed to load events:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadEvents();
  }, [firebaseUserFromAuth, router]);

  if (!firebaseUserFromAuth) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg text-gray-600">Redirecting to login...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <BroadcastCenterTab events={events} isLoadingEvents={isLoading} />
    </div>
  );
}
