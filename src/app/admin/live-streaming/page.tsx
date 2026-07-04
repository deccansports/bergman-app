import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import BroadcastCenterTab from '@/components/admin/BroadcastCenterTab';
import CommentaryControlRoomTab from '@/components/admin/CommentaryControlRoomTab';
import VideoLibraryTab from '@/components/admin/VideoLibraryTab';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { EventCalendarEntry } from '@/lib/types';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

async function loadEvents(): Promise<EventCalendarEntry[]> {
  const db = getFirestoreInstance();
  const [eventsSnap, legacySnap] = await Promise.all([
    db.collection('events').orderBy('eventDate', 'desc').limit(100).get().catch(() => null),
    db.collection('eventCalendar').orderBy('eventDate', 'desc').limit(100).get().catch(() => null),
  ]);

  const docs = [
    ...(eventsSnap?.docs || []),
    ...(legacySnap?.docs || []),
  ];

  const deduped = new Map<string, EventCalendarEntry>();
  for (const doc of docs) {
    if (deduped.has(doc.id)) continue;
    const data = serializeValue(doc.data() || {}) as Record<string, any>;
    deduped.set(doc.id, {
      id: doc.id,
      ...data,
      eventName: String(data?.eventName || data?.name || 'Untitled Event'),
      eventDate: data?.eventDate ? String(data.eventDate) : null,
    } as EventCalendarEntry);
  }

  return Array.from(deduped.values());
}

export default async function AdminLiveStreamingPage() {
  const events = await loadEvents();

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="rounded-2xl border border-border/60 bg-background/80 backdrop-blur p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight">Live Streaming</h1>
            <p className="text-sm text-muted-foreground">Enterprise live operations for Cloudflare Stream + Firebase + Feibot overlays.</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="secondary">Unlimited Events</Badge>
            <Badge variant="secondary">Unlimited Cameras</Badge>
            <Badge variant="secondary">Cloudflare Stream</Badge>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="cameras">Cameras</TabsTrigger>
          <TabsTrigger value="library">Video Library</TabsTrigger>
          <TabsTrigger value="commentary">Audio &amp; Commentary</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="recordings">Recordings</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card><CardHeader><CardTitle>Live Status</CardTitle><CardDescription>Platform health</CardDescription></CardHeader><CardContent><div className="text-2xl font-bold">Online</div></CardContent></Card>
            <Card><CardHeader><CardTitle>Events</CardTitle><CardDescription>Configured events</CardDescription></CardHeader><CardContent><div className="text-2xl font-bold">{events.length}</div></CardContent></Card>
            <Card><CardHeader><CardTitle>Cloudflare Status</CardTitle><CardDescription>Provider integration</CardDescription></CardHeader><CardContent><div className="text-2xl font-bold">Connected</div></CardContent></Card>
            <Card><CardHeader><CardTitle>Recording</CardTitle><CardDescription>Automatic mode</CardDescription></CardHeader><CardContent><div className="text-2xl font-bold">Enabled</div></CardContent></Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
              <CardDescription>Use Cameras tab for real-time camera operations, switching, health checks, and OBS credentials.</CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>

        <TabsContent value="cameras">
          <BroadcastCenterTab events={events} isLoadingEvents={false} />
        </TabsContent>

        <TabsContent value="library" className="space-y-4">
          <VideoLibraryTab />
        </TabsContent>

        <TabsContent value="commentary" className="space-y-4">
          <CommentaryControlRoomTab />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Viewer Analytics</CardTitle>
              <CardDescription>Current viewers, peak viewers, watch time, bandwidth, and recording analytics are exposed via event live API.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Use the endpoint /api/events/{'{eventId}'}/live to power realtime analytics panels and mobile widgets.
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recordings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recordings</CardTitle>
              <CardDescription>Cloudflare automatic recording is enabled per camera. Use camera controls and debug endpoints to inspect recording UIDs.</CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>Security model uses encrypted stream keys with admin-only reveal. API tokens stay server-side only.</CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
