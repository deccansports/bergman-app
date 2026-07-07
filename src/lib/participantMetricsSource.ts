import type { Firestore } from 'firebase-admin/firestore';
import type { EventParticipant } from '@/lib/types';
import { getKV } from '@/lib/cloudflare/kv';
import { serializeParticipantData } from '@/lib/utils';
import { getRegistrationsCollectionRef } from '@/lib/eventDataPaths';

function getParticipantDedupKey(participant: any, fallbackIndex: number): string {
  const normalize = (value: any) => String(value || '').trim().toLowerCase();
  const registrationId = normalize(participant?.registrationId);
  if (registrationId) return `registration:${registrationId}`;

  const bookingId = normalize(participant?.bookingId);
  if (bookingId) return `booking:${bookingId}`;

  const participantId = normalize(participant?.participantId || participant?.id);
  if (participantId) return `participant:${participantId}`;

  const bibNumber = normalize(participant?.bibNumber);
  if (bibNumber) return `bib:${bibNumber}`;

  return `fallback:${fallbackIndex}`;
}

function dedupeParticipants<T extends Record<string, any>>(participants: T[]): T[] {
  const mergedByKey = new Map<string, T>();

  participants.forEach((participant, index) => {
    const key = getParticipantDedupKey(participant, index);
    const existing = mergedByKey.get(key);
    if (existing) {
      mergedByKey.set(key, {
        ...existing,
        ...participant,
      });
      return;
    }
    mergedByKey.set(key, participant);
  });

  return Array.from(mergedByKey.values());
}

function isTimingOnlyParticipantRecord(participant: any): boolean {
  const bookingId = String(participant?.bookingId || '').trim().toLowerCase();
  const registrationSource = String(participant?.registration?.source || '').trim().toLowerCase();
  const provider = String(participant?.provider || '').trim().toLowerCase();
  const hasTicketSignals = Boolean(
    participant?.ticketId ||
    participant?.ticketName ||
    participant?.ticketStatus ||
    participant?.amountPaidPaisa ||
    participant?.pricingBreakdown,
  );

  if (provider === 'feibot' && !hasTicketSignals) return true;
  return false;
}

function collapseRelayParticipantRecords(participants: EventParticipant[]): EventParticipant[] {
  const relayGroups = new Map<string, EventParticipant[]>();
  const standalone: EventParticipant[] = [];
  const roleOrder = { swim: 0, bike: 1, run: 2 } as const;

  for (const participant of participants) {
    const relayKey = participant.isRelay ? (participant.relayTeamId || participant.bookingId || participant.id) : null;
    if (!relayKey) {
      standalone.push(participant);
      continue;
    }

    const existing = relayGroups.get(relayKey) || [];
    existing.push(participant);
    relayGroups.set(relayKey, existing);
  }

  const collapsedRelayTeams = Array.from(relayGroups.values()).map((group) => {
    const preferred =
      group.find((participant) => Array.isArray(participant.relayParticipants) && participant.relayParticipants.length > 0) ||
      group.find((participant) => Number(participant.amountPaidPaisa || 0) > 0 || !!participant.invoiceId) ||
      group[0];

    const nestedParticipants = Array.isArray(preferred.relayParticipants) && preferred.relayParticipants.length > 0
      ? preferred.relayParticipants
      : group
          .filter((participant) => !!(participant.relayRole || participant.relayBib || participant.name))
          .map((participant) => ({
            role: ((participant.relayRole || 'run') as 'swim' | 'bike' | 'run'),
            name: participant.buyerName && participant.name === preferred.relayTeamName
              ? participant.buyerName
              : participant.name,
            email: participant.email || '',
            mobile: participant.mobile || undefined,
            dob: participant.dob || undefined,
            gender: (participant.gender as any) || undefined,
            bloodGroup: participant.bloodGroup || undefined,
            tshirtSize: participant.tshirtSize || undefined,
            emergencyContactNumber: participant.emergencyContactNumber || undefined,
            address: participant.address || undefined,
            city: participant.city || undefined,
            state: participant.state || undefined,
            country: participant.country || undefined,
            pincode: participant.pincode || undefined,
            idProofUrl: participant.idProofUrl || null,
            bib: participant.relayBib || participant.bibNumber || undefined,
            bibNumber: participant.relayBib || participant.bibNumber || undefined,
            athleteUid: participant.athleteUid || null,
          }))
          .sort((a, b) => (roleOrder[a.role] ?? 99) - (roleOrder[b.role] ?? 99));

    return {
      ...preferred,
      name: preferred.relayTeamName || preferred.name,
      email: preferred.buyerEmail || preferred.email,
      mobile: preferred.mobile || null,
      buyerName: preferred.buyerName || nestedParticipants[0]?.name || preferred.name,
      buyerEmail: preferred.buyerEmail || nestedParticipants[0]?.email || preferred.email,
      bibNumber: preferred.relayTeamBib || preferred.bibNumber,
      relayTeamName: preferred.relayTeamName || preferred.name,
      relayTeamBib: preferred.relayTeamBib || preferred.bibNumber,
      relayParticipants: nestedParticipants,
      relayParticipantCount: nestedParticipants.length,
    } as EventParticipant;
  });

  return [...standalone, ...collapsedRelayTeams];
}

function normalizeParticipantsForMetrics(rows: EventParticipant[]): EventParticipant[] {
  const withIds = rows.map((participant: any) => ({
    ...participant,
    id: participant?.id || participant?.bookingId || null,
  })) as EventParticipant[];

  const collapsed = collapseRelayParticipantRecords(withIds);
  const registrationOnly = collapsed.filter((participant: any) => !isTimingOnlyParticipantRecord(participant));
  return dedupeParticipants(registrationOnly as any[]) as EventParticipant[];
}

export async function loadRegistrationParticipantsForEventMetrics(params: {
  db: Firestore;
  eventId: string;
  actionName: string;
}): Promise<{ participants: EventParticipant[]; source: 'kv' | 'firestore' }> {
  const { db, eventId, actionName } = params;

  const cached = await getKV<EventParticipant[]>(`event:${eventId}:participants:index`, actionName);
  if (Array.isArray(cached) && cached.length > 0) {
    return {
      participants: normalizeParticipantsForMetrics(cached),
      source: 'kv',
    };
  }

  const snap = await getRegistrationsCollectionRef(db, eventId).get();
  const rows = snap.docs.map((doc) => {
    const participant = serializeParticipantData(doc) as EventParticipant;
    return {
      ...participant,
      id: (participant as any)?.id || doc.id,
    } as EventParticipant;
  });

  return {
    participants: normalizeParticipantsForMetrics(rows),
    source: 'firestore',
  };
}
