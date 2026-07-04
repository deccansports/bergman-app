import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV, putKV } from '@/lib/cloudflare/kv';
import { callFeibotAPI } from '@/lib/feibot-integration/api-client';
import { getFeibotRuntimeSecretsAsync } from '@/lib/feibot-integration/secure-credentials';
import { buildFeibotErrorReport } from '@/lib/feibot-integration/cloud-event-sync';
import { syncFeibotCloudEventInfo } from '@/lib/feibot-integration/cloud-event-sync';
import { buildResolvedTimingConfiguration } from '@/lib/timingConfiguration';
import { rebuildSplitIndexInKv } from '@/lib/splitIndex';
import { resolveFeibotEventUuid } from '@/lib/feibotEventUuid';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

async function loadPhase1ProviderConfig(eventId: string) {
  let accessKey = normalizeText(process.env.FEIBOT_ACCESS_KEY);
  let secretKey = normalizeText(process.env.FEIBOT_SECRET_KEY);
  try {
    if (!accessKey || !secretKey) {
      const runtime = await getFeibotRuntimeSecretsAsync();
      accessKey = normalizeText(runtime.accessKey);
      secretKey = normalizeText(runtime.secretKey);
    }
  } catch {
    // keep empty strings to allow cache-only fallback behavior
  }
  const resolved = await resolveFeibotEventUuid(eventId);

  const eventUuid = normalizeText(resolved.resolvedEventUuid || '');
  const apiBaseUrl = normalizeText(resolved.apiBaseUrl || process.env.FEIBOT_API_BASE_URL || 'https://apicn.feibot.com') || 'https://apicn.feibot.com';

  return {
    accessKey,
    secretKey,
    eventUuid,
    apiBaseUrl,
    resolved,
  };
}

function normalizeForMatch(value: unknown) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/bergman|triathlon|swimathon|duathlon|relay|blr|bengaluru|mtrs|meters|metres/gi, ' ')
    .replace(/[-_]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompact(value: unknown) {
  return normalizeForMatch(value).replace(/\s+/g, '');
}

function similarity(a: string, b: string) {
  const aa = normalizeForMatch(a);
  const bb = normalizeForMatch(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 100;

  const as = new Set(aa.split(' ').filter(Boolean));
  const bs = new Set(bb.split(' ').filter(Boolean));
  const inter = [...as].filter((token) => bs.has(token)).length;
  const union = new Set([...as, ...bs]).size;
  const jaccard = union > 0 ? Math.round((inter / union) * 100) : 0;

  if (aa.includes(bb) || bb.includes(aa)) return Math.max(jaccard, 90);
  return jaccard;
}

function autoMatchTicket(ticketName: string, contests: any[]) {
  let best: any = null;
  let bestScore = 0;

  for (const contest of contests) {
    const score = similarity(ticketName, contest.contestName);
    if (score > bestScore) {
      bestScore = score;
      best = contest;
    }
  }

  return {
    contest: best,
    confidence: bestScore,
    status: bestScore >= 90 ? 'mapped' : bestScore >= 80 ? 'needs_review' : 'missing',
  };
}

function autoMatchTicketSubCategory(parentTicketName: string, subCategoryName: string | null, contests: any[]) {
  if (subCategoryName) {
    const direct = autoMatchTicket(subCategoryName, contests);
    const combined = autoMatchTicket(`${parentTicketName} ${subCategoryName}`, contests);
    return (direct.confidence || 0) >= (combined.confidence || 0) ? direct : combined;
  }
  return autoMatchTicket(parentTicketName, contests);
}

/**
 * Implement priority-based auto-mapping for tickets to contests.
 * Priority: (1) Saved UUID → (2) Contest Binding → (3) Provider UUID → (4) Exact Name → (5) Normalized Name → (6) Fuzzy >95% → (7) Manual Required
 * IMPORTANT: Skip tickets marked as ignored - do not overwrite
 */
function autoMapTicketByPriority(
  ticket: any,
  contests: any[],
  savedMappings: Record<string, any> | null,
  ticketBindings: Record<string, any> | null,
) {
  const mappingId = `${ticket.ticketId}:${ticket.subCategoryId}`;
  const savedEntry = (savedMappings?.ticketsById || {})[mappingId];

  // Check if ticket is explicitly ignored - NEVER AUTO-MAP ignored tickets
  if (savedEntry?.ignored === true) {
    return {
      contest: null,
      confidence: 0,
      mappingType: 'ignored' as const,
      reason: 'Ticket is ignored by admin',
    };
  }

  // Priority 1: Saved Contest UUID
  if (savedEntry?.contestUuid) {
    const contest = contests.find((c) => c.contestUuid === savedEntry.contestUuid);
    if (contest) {
      return {
        contest,
        confidence: 100,
        mappingType: 'manual' as const,
        reason: 'Previously saved mapping',
      };
    }
  }

  // Priority 2: Contest Binding (explicit ticket-to-contest mapping in config)
  if (ticketBindings?.[mappingId] || ticketBindings?.[ticket.ticketId]) {
    const bindingKey = ticketBindings?.[mappingId] ? mappingId : ticket.ticketId;
    const binding = ticketBindings[bindingKey];
    const contest = contests.find((c) => c.contestUuid === binding || c.contestName === binding);
    if (contest) {
      return {
        contest,
        confidence: 100,
        mappingType: 'auto' as const,
        reason: 'Contest binding',
      };
    }
  }

  // Priority 3: Provider Contest UUID (if present in imported data)
  if (ticket.providerContestUuid) {
    const contest = contests.find((c) => c.contestUuid === ticket.providerContestUuid);
    if (contest) {
      return {
        contest,
        confidence: 100,
        mappingType: 'auto' as const,
        reason: 'Provider contest UUID',
      };
    }
  }

  // Priority 4: Exact Name Match (case-insensitive)
  const exactMatch = contests.find(
    (c) => normalizeText(c.contestName).toLowerCase() === normalizeText(ticket.displayName).toLowerCase(),
  );
  if (exactMatch) {
    return {
      contest: exactMatch,
      confidence: 100,
      mappingType: 'auto' as const,
      reason: 'Exact name match',
    };
  }

  // Priority 5: Normalized Name Match
  const normalizedTicketName = normalizeForMatch(ticket.displayName);
  const normalizedNameMatch = contests.find((c) => normalizeForMatch(c.contestName) === normalizedTicketName);
  if (normalizedNameMatch) {
    return {
      contest: normalizedNameMatch,
      confidence: 95,
      mappingType: 'auto' as const,
      reason: 'Normalized name match',
    };
  }

  // Priority 6: Fuzzy Match >95%
  let bestFuzzyMatch: any = null;
  let bestFuzzyScore = 0;
  for (const contest of contests) {
    const score = similarity(ticket.displayName, contest.contestName);
    if (score > 95 && score > bestFuzzyScore) {
      bestFuzzyScore = score;
      bestFuzzyMatch = contest;
    }
  }
  if (bestFuzzyMatch && bestFuzzyScore > 95) {
    return {
      contest: bestFuzzyMatch,
      confidence: bestFuzzyScore,
      mappingType: 'auto' as const,
      reason: `Fuzzy match (${bestFuzzyScore}%)`,
    };
  }

  // Priority 7: Manual Mapping Required
  return {
    contest: null,
    confidence: 0,
    mappingType: 'manual' as const,
    reason: 'No automatic match found - manual mapping required',
  };
}


async function loadConfigFromKv(eventId: string) {
  return (
    (await getKV<Record<string, any>>(`event:${eventId}:config`, 'api-contest-mapping')) ||
    (await getKV<Record<string, any>>(`live:event:${eventId}:config`, 'api-contest-mapping')) ||
    {}
  );
}

async function loadMappingsFromKv(eventId: string) {
  return (
    (await getKV<Record<string, any>>(`event:${eventId}:ticketMappings`, 'api-contest-mapping')) ||
    (await getKV<Record<string, any>>(`live:event:${eventId}:ticketMappings`, 'api-contest-mapping')) ||
    null
  );
}

function resolveContestFromTicketMappings(ticketMappings: Record<string, any> | null, ticketIdRaw: unknown, subCategoryIdRaw: unknown) {
  if (!ticketMappings) return { contestUuid: null as string | null, contestName: null as string | null, mappingKey: null as string | null };
  const ticketId = normalizeText(ticketIdRaw);
  if (!ticketId) return { contestUuid: null as string | null, contestName: null as string | null, mappingKey: null as string | null };

  const subCategoryId = normalizeText(subCategoryIdRaw);
  const ticketToContest = (ticketMappings?.ticketToContest || {}) as Record<string, string>;
  const ticketsById = (ticketMappings?.ticketsById || {}) as Record<string, any>;

  const mappingKey = subCategoryId ? `${ticketId}:${subCategoryId}` : ticketId;
  const baseKey = `${ticketId}:base`;
  const contestUuid = normalizeText(
    ticketToContest[mappingKey] ||
    ticketToContest[ticketId] ||
    (!subCategoryId ? ticketToContest[baseKey] : ''),
  ) || null;

  const detail =
    ticketsById[mappingKey] ||
    ticketsById[ticketId] ||
    (!subCategoryId ? ticketsById[baseKey] : null) ||
    null;

  const contestName = normalizeText(detail?.contestName) || null;
  return { contestUuid, contestName, mappingKey };
}

function buildParticipantsKvIndex(participants: any[]) {
  const byBib: Record<string, any> = {};
  const byChip: Record<string, any> = {};
  const byUuid: Record<string, any> = {};
  const byEmail: Record<string, any> = {};
  const byMobile: Record<string, any> = {};

  for (const participant of participants) {
    const bib = normalizeText(participant?.bib || participant?.bibNumber || participant?.providerBib);
    const chip = normalizeText(participant?.chip || participant?.chipCode || participant?.providerChip);
    const uuid = normalizeText(participant?.participantUuid || participant?.participant_uuid || participant?.providerUuid || participant?.id);
    const email = normalizeText(participant?.email).toLowerCase();
    const mobile = normalizeText(participant?.mobile || participant?.phone).replace(/\D+/g, '');

    if (bib) byBib[bib] = participant;
    if (chip) byChip[chip] = participant;
    if (uuid) byUuid[uuid] = participant;
    if (email) byEmail[email] = participant;
    if (mobile) byMobile[mobile] = participant;
  }

  return {
    byBib,
    byChip,
    byUuid,
    byEmail,
    byMobile,
    participants,
    count: participants.length,
    generatedAt: new Date().toISOString(),
  };
}

function applyContestBackfillToParticipant(row: any, ticketMappings: Record<string, any> | null) {
  const ticketId = normalizeText(row?.ticketId || row?.ticket_id || row?.registration?.ticketId || row?.ticket?.id) || null;
  const subCategoryId = normalizeText(
    row?.subCategoryId ||
    row?.selectedSubCategoryId ||
    row?.sub_category_id ||
    row?.subCategory?.id ||
    row?.registration?.subCategoryId ||
    row?.registration?.selectedSubCategoryId,
  ) || null;

  const mapped = resolveContestFromTicketMappings(ticketMappings, ticketId, subCategoryId);
  const contestUuid = normalizeText(row?.contestUuid || row?.contest_uuid || mapped.contestUuid) || null;
  const contestName = normalizeText(row?.contestName || row?.contest_name || mapped.contestName) || null;

  return {
    ...(row || {}),
    ticketId,
    subCategoryId,
    contestUuid,
    contest_uuid: contestUuid,
    contestName,
    contest_name: contestName,
    providerContestUuid: normalizeText(row?.providerContestUuid || contestUuid) || null,
    providerContestName: normalizeText(row?.providerContestName || contestName) || null,
    mappingSource: mapped.mappingKey ? 'ticketMappings-backfill' : (normalizeText(row?.mappingSource) || 'provider'),
    liveTracking: {
      ...(row?.liveTracking || {}),
      contestUuid,
      contestName,
    },
  };
}

async function backfillContestUuids(eventId: string, ticketMappings: Record<string, any>) {
  let participantsUpdated = 0;
  let providerParticipantsUpdated = 0;
  let liveAthletesUpdated = 0;

  const participantIndex =
    (await getKV<Record<string, any>>(`live:event:${eventId}:participants`, 'api-contest-mapping')) ||
    null;

  if (participantIndex) {
    const sourceParticipants = Array.isArray(participantIndex?.participants)
      ? participantIndex.participants
      : Object.values((participantIndex?.byBib || {}) as Record<string, any>);
    const patched = sourceParticipants.map((row: any) => applyContestBackfillToParticipant(row, ticketMappings));
    participantsUpdated = patched.filter((row: any) => !!row?.contestUuid).length;
    const rebuilt = buildParticipantsKvIndex(patched);
    await putKV(`live:event:${eventId}:participants`, rebuilt, 'api-contest-mapping');
  }

  const providerParticipants =
    (await getKV<Record<string, any>>(`live:event:${eventId}:providerParticipants`, 'api-contest-mapping')) ||
    null;

  if (providerParticipants && Array.isArray(providerParticipants?.participants)) {
    const patched = providerParticipants.participants.map((row: any) => applyContestBackfillToParticipant(row, ticketMappings));
    providerParticipantsUpdated = patched.filter((row: any) => !!row?.contestUuid).length;
    const payload = {
      ...providerParticipants,
      participants: patched,
      backfilledAt: new Date().toISOString(),
    };
    await putKV(`live:event:${eventId}:providerParticipants`, payload, 'api-contest-mapping');
  }

  const liveAthletes =
    (await getKV<any[]>(`live:event:${eventId}:athletes`, 'api-contest-mapping')) ||
    null;

  if (Array.isArray(liveAthletes) && liveAthletes.length > 0) {
    const patched = liveAthletes.map((row: any) => applyContestBackfillToParticipant(row, ticketMappings));
    liveAthletesUpdated = patched.filter((row: any) => !!row?.contestUuid).length;
    await putKV(`live:event:${eventId}:athletes`, patched, 'api-contest-mapping');
  }

  return {
    participantsUpdated,
    providerParticipantsUpdated,
    liveAthletesUpdated,
  };
}

async function loadTicketDefinitions(eventId: string) {
  const db = getFirestoreInstance();
  const eventRef = db.collection('events').doc(eventId);

  // Load all sources in parallel
  const [eventSnap, ticketSnap, registrationsSnap] = await Promise.all([
    eventRef.get(),
    eventRef.collection('ticketDefinitions').get(),
    eventRef.collection('participants').get(),
  ]);

  const eventData = (eventSnap.data() || {}) as Record<string, any>;

  // Build registration count map from Bergman registrations ONLY
  const registrationCountByTicketId = new Map<string, number>();
  const registrationCountBySubCategoryKey = new Map<string, number>();
  const registrationCountBySubCategoryNameKey = new Map<string, number>();

  registrationsSnap.docs.forEach((doc) => {
    const reg = doc.data() as Record<string, any>;
    const ticketId = normalizeText(
      reg?.ticketId ||
      reg?.registrationTicketId ||
      reg?.ticket?.id ||
      reg?.registration?.ticketId ||
      '',
    );
    const subCategoryId = normalizeText(
      reg?.selectedSubCategoryId ||
      reg?.subCategoryId ||
      reg?.sub_category_id ||
      reg?.selectedSubCategory ||
      reg?.subCategory?.id ||
      reg?.registration?.selectedSubCategoryId ||
      reg?.registration?.subCategoryId ||
      '',
    );
    const subCategoryName = normalizeText(
      reg?.selectedSubCategoryName ||
      reg?.subCategoryName ||
      reg?.sub_category_name ||
      reg?.selectedSubCategoryLabel ||
      reg?.subCategory?.name ||
      reg?.registration?.selectedSubCategoryName ||
      reg?.registration?.subCategoryName ||
      '',
    );

    if (ticketId) {
      const count = registrationCountByTicketId.get(ticketId) || 0;
      registrationCountByTicketId.set(ticketId, count + 1);
    }

    if (ticketId && subCategoryId) {
      const key = `${normalizeCompact(ticketId)}:${normalizeCompact(subCategoryId)}`;
      const count = registrationCountBySubCategoryKey.get(key) || 0;
      registrationCountBySubCategoryKey.set(key, count + 1);
    }

    if (ticketId && subCategoryName) {
      const key = `${normalizeCompact(ticketId)}:${normalizeCompact(subCategoryName)}`;
      const count = registrationCountBySubCategoryNameKey.get(key) || 0;
      registrationCountBySubCategoryNameKey.set(key, count + 1);
    }
  });



  const buildSubCategoryCountMaps = (ticketId: string, subCategories: any[]) => {
    const byId: Record<string, number> = {};
    const byName: Record<string, number> = {};
    const ticketIdCompact = normalizeCompact(ticketId);
    for (const sub of subCategories) {
      const subId = normalizeText(sub?.id || sub?.subCategoryId || sub?.uuid || '');
      const subName = normalizeText(sub?.name || sub?.subCategoryName || sub?.label || '');
      const countById = subId
        ? registrationCountBySubCategoryKey.get(`${ticketIdCompact}:${normalizeCompact(subId)}`) || 0
        : 0;
      const countByName = subName
        ? registrationCountBySubCategoryNameKey.get(`${ticketIdCompact}:${normalizeCompact(subName)}`) || 0
        : 0;
      const count = countById || countByName || 0;

      if (subId) {
        byId[subId] = count;
        byId[normalizeCompact(subId)] = count;
      }
      if (subName) {
        byName[subName.toLowerCase()] = count;
        byName[normalizeCompact(subName)] = count;
      }
    }
    return { byId, byName };
  };

  const getMostUsedSubCategory = (ticketId: string, subCategories: any[]) => {
    if (!Array.isArray(subCategories) || subCategories.length === 0) return null;
    let selected: string | null = null;
    let highest = 0;
    const ticketIdCompact = normalizeCompact(ticketId);
    for (const sub of subCategories) {
      const subName = normalizeText(sub?.name || sub?.subCategoryName || sub?.label || '');
      const subId = normalizeText(sub?.id || sub?.subCategoryId || sub?.uuid || '');
      const countById = subId
        ? registrationCountBySubCategoryKey.get(`${ticketIdCompact}:${normalizeCompact(subId)}`) || 0
        : 0;
      const countByName = subName
        ? registrationCountBySubCategoryNameKey.get(`${ticketIdCompact}:${normalizeCompact(subName)}`) || 0
        : 0;
      const count = countById || countByName || 0;
      if (count > highest) {
        highest = count;
        selected = subName || null;
      }
    }
    return selected;
  };

  const normalizeSubCategoryEntry = (sub: any, fallbackName?: string | null) => {
    const id = normalizeText(sub?.id || sub?.subCategoryId || sub?.uuid || sub?.code || '');
    const name = normalizeText(sub?.name || sub?.subCategoryName || sub?.label || fallbackName || '');
    if (!id && !name) return null;
    return {
      id: id || name,
      name: name || id,
      pricePaisa: Number(sub?.pricePaisa ?? sub?.price ?? 0) || 0,
      applicableAgeGroups: Array.isArray(sub?.applicableAgeGroups)
        ? sub.applicableAgeGroups
        : Array.isArray(sub?.ageGroups)
          ? sub.ageGroups
          : [],
      cutoff: normalizeText(sub?.cutoff || sub?.cutoffTime || '') || null,
      tiers: Array.isArray(sub?.tiers) ? sub.tiers : [],
    };
  };

  const extractSubCategoriesFromTicketRecord = (data: Record<string, any>) => {
    const fromArray = Array.isArray(data?.subCategories)
      ? data.subCategories
      : data?.subCategories && typeof data.subCategories === 'object'
        ? Object.values(data.subCategories)
        : [];

    const scalarSub = normalizeSubCategoryEntry(
      {
        id: data?.subCategoryId || data?.subCategory || data?.sub_category_id,
        name: data?.subCategoryName || data?.sub_category_name || data?.subCategoryLabel,
        pricePaisa: data?.subCategoryPricePaisa,
        applicableAgeGroups: data?.subCategoryApplicableAgeGroups,
        cutoff: data?.subCategoryCutoff,
        tiers: data?.subCategoryTiers,
      },
      normalizeText(data?.subCategoryName || data?.sub_category_name || ''),
    );

    const rows = fromArray
      .map((sub) => normalizeSubCategoryEntry(sub, null))
      .filter(Boolean) as any[];

    if (scalarSub) rows.push(scalarSub);

    const dedup = new Map<string, any>();
    for (const row of rows) {
      const key = normalizeText(row?.id || row?.name).toLowerCase();
      if (!key) continue;
      dedup.set(key, row);
    }
    return Array.from(dedup.values());
  };

  const ticketsFromSubcollection = ticketSnap.docs.map((doc) => {
    const data = doc.data() as Record<string, any>;
    const canonicalTicketId = normalizeText(data?.ticketId || data?.parentTicketId || data?.groupTicketId || data?.ticketUuid || doc.id);
    const ticketName = normalizeText(data?.ticketName || data?.displayName || data?.name || doc.id);
    const subCategories = extractSubCategoriesFromTicketRecord(data);
    const subCounts = buildSubCategoryCountMaps(canonicalTicketId, subCategories);
    const ticketAthletes = registrationCountByTicketId.get(canonicalTicketId) || 0;
    return {
      ticketId: canonicalTicketId,
      ticketUuid: normalizeText(data?.ticketUuid || canonicalTicketId) || canonicalTicketId,
      ticketName,
      displayName: normalizeText(data?.displayName || ticketName) || ticketName,
      subCategory: normalizeText(data?.subCategory || data?.sub_category || '') || getMostUsedSubCategory(canonicalTicketId, subCategories),
      category: normalizeText(data?.ticketCategory || data?.category || data?.discipline || '') || null,
      type: normalizeText(data?.registrationType || data?.ticketType || data?.type || '') || null,
      distance: normalizeText(data?.distance || '') || null,
      relay: Boolean(data?.relay || data?.isRelay || false),
      status: normalizeText(data?.status || 'active') || 'active',
      price: Number(data?.price || 0) || 0,
      gender: normalizeText(data?.gender || '') || null,
      ageCategory: normalizeText(data?.ageCategory || '') || null,
      order: Number(data?.order || 9999),
      athletes: ticketAthletes,
      subCategories,
      subCategoryCountByName: subCounts.byName,
      subCategoryCountById: subCounts.byId,
    };
  });

  const disciplineSubCategories = Array.isArray(eventData?.disciplines)
    ? eventData.disciplines.flatMap((discipline: any) => Array.isArray(discipline?.subCategories) ? discipline.subCategories : [])
    : [];

  const eventLevelSubCategories = Array.isArray(eventData?.subCategories) ? eventData.subCategories : [];
  const fallbackSource = [...disciplineSubCategories, ...eventLevelSubCategories];

  const ticketsFromSubCategories = fallbackSource.map((row: any, index: number) => {
    const ticketId = normalizeText(row?.ticketId || row?.parentTicketId || row?.id || row?.uuid || row?.code || row?.name || `subcat-${index + 1}`);
    const ticketName = normalizeText(row?.ticketName || row?.displayName || row?.name || ticketId);
    const subCategories = extractSubCategoriesFromTicketRecord(row || {});
    const subCounts = buildSubCategoryCountMaps(ticketId, subCategories);
    const ticketAthletes = registrationCountByTicketId.get(ticketId) || 0;
    return {
      ticketId,
      ticketUuid: ticketId,
      ticketName,
      displayName: normalizeText(row?.displayName || ticketName) || ticketName,
      subCategory: normalizeText(row?.subCategory || row?.sub_category || row?.name || '') || null,
      category: normalizeText(row?.ticketCategory || row?.category || row?.discipline || row?.type || '') || null,
      type: normalizeText(row?.registrationType || row?.ticketType || row?.type || '') || null,
      distance: normalizeText(row?.distance || '') || null,
      relay: Boolean(row?.relay || row?.isRelay || false),
      status: normalizeText(row?.status || 'active') || 'active',
      price: Number(row?.price || 0) || 0,
      gender: normalizeText(row?.gender || '') || null,
      ageCategory: normalizeText(row?.ageCategory || '') || null,
      order: Number(row?.order || 9999),
      athletes: ticketAthletes,
      subCategories,
      subCategoryCountByName: subCounts.byName,
      subCategoryCountById: subCounts.byId,
    };
  });

  const byId = new Map<string, any>();
  const mergedSourceRows = [...ticketsFromSubCategories, ...ticketsFromSubcollection];
  for (const row of mergedSourceRows) {
    const id = normalizeText(row?.ticketId);
    if (!id) continue;
    const existing = byId.get(id) || {};
    const existingSubs = Array.isArray(existing?.subCategories) ? existing.subCategories : [];
    const rowSubs = Array.isArray(row?.subCategories) ? row.subCategories : [];
    const mergedSubsMap = new Map<string, any>();
    for (const sub of [...existingSubs, ...rowSubs]) {
      const key = normalizeText(sub?.id || sub?.subCategoryId || sub?.name || '').toLowerCase();
      if (!key) continue;
      mergedSubsMap.set(key, {
        ...(mergedSubsMap.get(key) || {}),
        ...sub,
      });
    }

    const mergedCountById: Record<string, number> = {
      ...((existing?.subCategoryCountById || {}) as Record<string, number>),
      ...((row?.subCategoryCountById || {}) as Record<string, number>),
    };
    const mergedCountByName: Record<string, number> = {
      ...((existing?.subCategoryCountByName || {}) as Record<string, number>),
      ...((row?.subCategoryCountByName || {}) as Record<string, number>),
    };

    byId.set(id, {
      ...existing,
      ...row,
      subCategory: row?.subCategory || byId.get(id)?.subCategory || null,
      athletes: Math.max(Number(existing?.athletes || 0), Number(row?.athletes || 0)),
      subCategories: Array.from(mergedSubsMap.values()),
      subCategoryCountById: mergedCountById,
      subCategoryCountByName: mergedCountByName,
    });
  }

  const tickets = Array.from(byId.values());
  tickets.sort((a, b) => (a.order - b.order) || a.ticketName.localeCompare(b.ticketName));
  return tickets;
}

function expandTicketRows(tickets: any[]) {
  const rows: any[] = [];
  for (const ticket of tickets) {
    const subCategories = Array.isArray(ticket?.subCategories) ? ticket.subCategories : [];
    if (subCategories.length === 0) {
      const ticketAthletes = Number(ticket.athletes || 0);
      const subCategoryId = 'base';
      const subCategoryName = null;
      const mappingId = `${ticket.ticketId}:${subCategoryId}`;
      rows.push({
        mappingId,
        parentTicketId: ticket.ticketId,
        parentTicketName: ticket.ticketName,
        subCategoryId,
        subCategoryName,
        displayName: ticket.ticketName,
        ticketId: ticket.ticketId,
        ticketName: ticket.ticketName,
        category: ticket.category,
        type: ticket.type,
        distance: ticket.distance,
        athletes: ticketAthletes,
        hasSubCategories: false,
      });
      continue;
    }

    for (const sub of subCategories) {
      const subCategoryId = normalizeText(sub?.id || sub?.subCategoryId || sub?.uuid || sub?.name || `sub-${Date.now()}`);
      const subCategoryName = normalizeText(sub?.name || sub?.subCategoryName || sub?.label || 'Sub Category');
      const countsById = (ticket?.subCategoryCountById || {}) as Record<string, number>;
      const countsByName = (ticket?.subCategoryCountByName || {}) as Record<string, number>;
      const subAthletes = Number(
        countsById[subCategoryId]
        || countsById[normalizeCompact(subCategoryId)]
        || countsByName[subCategoryName.toLowerCase()]
        || countsByName[normalizeCompact(subCategoryName)]
        || 0,
      );
      const mappingId = `${ticket.ticketId}:${subCategoryId}`;
      rows.push({
        mappingId,
        parentTicketId: ticket.ticketId,
        parentTicketName: ticket.ticketName,
        subCategoryId,
        subCategoryName,
        displayName: `${ticket.ticketName} · ${subCategoryName}`,
        ticketId: ticket.ticketId,
        ticketName: ticket.ticketName,
        category: ticket.category,
        type: ticket.type,
        distance: ticket.distance,
        athletes: subAthletes,
        hasSubCategories: true,
        price: Number(sub?.price || 0) || 0,
        cutoff: normalizeText(sub?.cutoff || sub?.cutoffTime || '') || null,
        ageGroups: Array.isArray(sub?.ageGroups) ? sub.ageGroups : [],
      });
    }
  }
  return rows;
}

function extractContestsFromConfig(config: Record<string, any>) {
  const source = Array.isArray(config?.contests)
    ? config.contests
    : Array.isArray(config?.timingRules?.contests)
      ? config.timingRules.contests
      : Array.isArray(config?.result?.timing_rules?.contests)
        ? config.result.timing_rules.contests
      : Array.isArray(config?.feibotConfig?.cloudTimingRules?.contests)
        ? config.feibotConfig.cloudTimingRules.contests
      : [];
  return source.map((row: any, idx: number) => ({
    contestUuid: normalizeText(row?.uuid || row?.contestUuid || row?.providerContestUuid || row?.id || `contest-${idx + 1}`),
    contestName: normalizeText(row?.name || row?.contestName || `Contest ${idx + 1}`),
    provider: normalizeText(row?.provider || 'feibot') || 'feibot',
    providerContestUuid: normalizeText(row?.providerContestUuid || row?.uuid || row?.contestUuid || row?.id) || null,
    abbreviation: normalizeText(row?.abbreviation || row?.abbr || '') || null,
    distance: normalizeText(row?.distance || '') || null,
    status: normalizeText(row?.status || 'active') || 'active',
    color: normalizeText(row?.color || '') || null,
  }));
}

function extractTimingRulesContests(payload: any) {
  if (!payload || typeof payload !== 'object') return [] as any[];
  if (Array.isArray(payload?.result?.timing_rules?.contests)) return payload.result.timing_rules.contests;
  if (Array.isArray(payload?.timing_rules?.contests)) return payload.timing_rules.contests;
  if (Array.isArray(payload?.timingRules?.contests)) return payload.timingRules.contests;
  if (Array.isArray(payload?.data?.timing_rules?.contests)) return payload.data.timing_rules.contests;
  if (Array.isArray(payload?.data?.timingRules?.contests)) return payload.data.timingRules.contests;
  if (Array.isArray(payload?.contests)) return payload.contests;
  if (Array.isArray(payload?.result?.contests)) return payload.result.contests;
  if (Array.isArray(payload?.data?.contests)) return payload.data.contests;
  return [] as any[];
}

function extractTimingRulesSource(payload: any) {
  if (!payload || typeof payload !== 'object') return null;
  return payload?.result?.timing_rules || payload?.timing_rules || payload?.timingRules || payload?.data?.timing_rules || payload?.data?.timingRules || null;
}

function normalizeEpochTimestamp(value: unknown) {
  const text = normalizeText(value);
  if (!text) return 0;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

async function syncContestsFromFeibotIfMissing(eventId: string, config: Record<string, any>) {
  return syncContestsFromFeibot(eventId, config, { force: false });
}

async function syncContestsFromFeibot(
  eventId: string,
  config: Record<string, any>,
  options: { force?: boolean } = {},
) {
  const forceSync = Boolean(options.force);
  const existing = extractContestsFromConfig(config);
  if (!forceSync && existing.length > 0) {
    return {
      contests: existing,
      config,
      sync: {
        provider: 'Feibot',
        authentication: 'SKIPPED',
        httpStatus: 200,
        requestUrl: null,
        contestApi: 'SKIPPED',
        contestReturned: existing.length,
        kvWrite: 'SKIPPED',
        kvRead: 'SKIPPED',
        reason: 'Contests already present in KV config',
        rawResponse: null,
        normalizedContests: existing,
        kvPayload: { contests: existing },
      },
    };
  }

  const providerConfig = await loadPhase1ProviderConfig(eventId);
  const accessKey = normalizeText(providerConfig.accessKey);
  const secretKey = normalizeText(providerConfig.secretKey);
  const eventUuid = normalizeText(providerConfig.eventUuid);
  const apiBaseUrl = normalizeText(providerConfig.apiBaseUrl) || 'https://apicn.feibot.com';

  const mapContestRows = (rows: any[]) => rows.map((row: any, idx: number) => ({
    contestUuid: normalizeText(row?.UUID || row?.uuid || row?.contestUuid || row?.providerContestUuid || row?.id || `contest-${idx + 1}`),
    contestName: normalizeText(row?.Name || row?.name || row?.contestName || row?.categoryName || `Contest ${idx + 1}`),
    provider: 'feibot',
    providerContestUuid: normalizeText(row?.providerContestUuid || row?.UUID || row?.uuid || row?.contestUuid || row?.id) || null,
    abbreviation: normalizeText(row?.Abbreviation || row?.abbreviation || row?.abbr || '') || null,
    distance: normalizeText(row?.Distance || row?.distance || '') || null,
    status: normalizeText(row?.Status || row?.status || 'active') || 'active',
    color: normalizeText(row?.Color || row?.color || '') || null,
  })).filter((contest: any) => !!contest.contestUuid);

  const fallbackCloudContests = Array.isArray(config?.feibotConfig?.cloudTimingRules?.contests) ? config.feibotConfig.cloudTimingRules.contests : [];
  const fallbackHubTimingContests = Array.isArray((config as any)?.liveTracking?.timingRules?.contests) ? (config as any).liveTracking.timingRules.contests : [];
  const fallbackCategoryContests = Array.isArray((config as any)?.categoryTimingConfiguration) ? (config as any).categoryTimingConfiguration : [];

  const verifyKvContests = async (expectedCount: number) => {
    const primary = await getKV<Record<string, any>>(`event:${eventId}:config`, 'api-contest-mapping');
    const secondary = await getKV<Record<string, any>>(`live:event:${eventId}:config`, 'api-contest-mapping');
    const primaryCount = extractContestsFromConfig(primary || {}).length;
    const secondaryCount = extractContestsFromConfig(secondary || {}).length;
    const verifiedCount = Math.max(primaryCount, secondaryCount);
    if (verifiedCount <= 0 || verifiedCount < expectedCount) {
      throw new Error(`Contest Sync Failed. Expected ${expectedCount} contests, stored ${verifiedCount}`);
    }
    return verifiedCount;
  };

  if (!accessKey || !secretKey || !eventUuid) {
    const fallbackContests = mapContestRows(
      fallbackCloudContests.length > 0
        ? fallbackCloudContests
        : fallbackHubTimingContests.length > 0
          ? fallbackHubTimingContests
          : fallbackCategoryContests,
    );
    if (fallbackContests.length === 0) {
      const cachedContests = extractContestsFromConfig(config);
      return {
        contests: cachedContests,
        config,
        sync: {
          provider: 'Feibot',
          authentication: 'FAILED',
          httpStatus: 400,
          requestUrl: `${apiBaseUrl.replace(/\/$/, '')}/eventConfigFile/timingRulesGet?event_uuid=${encodeURIComponent(eventUuid || 'missing')}`,
          contestApi: 'FAILED',
          contestReturned: 0,
          kvWrite: 'SKIPPED',
          kvRead: 'SKIPPED',
          reason: cachedContests.length > 0
            ? 'Missing Feibot credentials. Using cached contests from last successful sync.'
            : 'Missing Feibot credentials and no cached or fallback contests available',
          rawResponse: null,
          normalizedContests: cachedContests,
          kvPayload: null,
          cacheStatus: cachedContests.length > 0 ? {
            usingCache: true,
            cachedContestCount: cachedContests.length,
            lastSyncedAt: (config as any)?.lastContestSync?.syncedAt || null,
            message: 'Using cached contests due to missing Feibot credentials',
          } : null,
        },
      };
    }

    const nextConfig = {
      ...config,
      provider: 'feibot',
      contests: fallbackContests,
      lastContestSync: {
        syncedAt: new Date().toISOString(),
        fetched: fallbackContests.length,
        contests: fallbackContests,
        rawResponse: { source: 'fallback' },
      },
      providerVersion: normalizeText((config as any)?.providerVersion || 'v1') || 'v1',
      generatedAt: new Date().toISOString(),
      version: Number(config?.version || 0) + 1,
    };

    await putKV(`event:${eventId}:config`, nextConfig, 'api-contest-mapping');
    await putKV(`live:event:${eventId}:config`, nextConfig, 'api-contest-mapping');
    const verifiedCount = await verifyKvContests(fallbackContests.length);
    return {
      contests: fallbackContests,
      config: nextConfig,
      sync: {
        provider: 'Feibot',
        authentication: 'PASS',
        httpStatus: 200,
        requestUrl: `${apiBaseUrl.replace(/\/$/, '')}/eventConfigFile/timingRulesGet?event_uuid=${encodeURIComponent(eventUuid)}`,
        contestApi: 'PASS',
        contestReturned: fallbackContests.length,
        kvWrite: 'PASS',
        kvRead: verifiedCount > 0 ? 'PASS' : 'FAILED',
        reason: 'Loaded contests from fallback timing rules',
        rawResponse: { source: 'fallback' },
        normalizedContests: fallbackContests,
        kvPayload: { contests: fallbackContests },
      },
    };
  }

  const requestUrl = `${apiBaseUrl.replace(/\/$/, '')}/eventConfigFile/timingRulesGet?event_uuid=${encodeURIComponent(eventUuid)}`;
  const authRaw = Buffer.from(`${accessKey.trim()}:${secretKey.trim()}`).toString('base64');
  const authorizationPreview = `Basic ${authRaw.length > 8 ? `${authRaw.slice(0, 4)}...${authRaw.slice(-4)}` : '********'}`;
  console.log('[contest-sync][feibot][config]', {
    apiBaseUrl,
    eventUuid,
    accessKeyLength: accessKey.length,
    secretKeyLength: secretKey.length,
    authorizationPreview,
  });
  console.log('[contest-sync][feibot][request]', {
    url: requestUrl,
    method: 'GET',
    headers: {
      authorization: 'Basic ********',
      accept: 'application/json',
    },
    authorizationLength: authRaw.length,
  });

  const providerResult = await callFeibotAPI<any>(
    {
      accountId: 'contest-mapping-sync',
      accessKey,
      secretKey,
      apiBaseUrl,
    },
    '/eventConfigFile/timingRulesGet',
    {
      method: 'GET',
      query: {
        event_uuid: eventUuid,
      },
    },
  );

  const providerResponse = {
    ok: providerResult.ok,
    status: providerResult.status,
    url: requestUrl,
    text: providerResult.data ? JSON.stringify(providerResult.data) : '',
    data: providerResult.data,
    timestamp: providerResult.diagnostics?.timestamp,
    stringToSign: providerResult.diagnostics?.stringToSign,
    signatureLength: String(providerResult.diagnostics?.requestSignature || '').length,
  } as any;
  const responseSize = Buffer.byteLength(String(providerResponse?.text || ''), 'utf8');
  console.log('[contest-sync][feibot][response]', {
    status: Number(providerResponse?.status || 0),
    body: String(providerResponse?.text || '').slice(0, 2000),
    parsed: providerResponse?.data || null,
  });

  // MODE 1: AUTHENTICATION FAILURE (401/403) - Do NOT write to KV
  if (providerResponse?.status === 401 || providerResponse?.status === 403) {
    const httpStatus = Number(providerResponse?.status);
    const cachedContests = extractContestsFromConfig(config);

    return {
      contests: cachedContests,
      config,
      sync: {
        provider: 'Feibot',
        authentication: 'AUTHENTICATION_FAILED',
        httpStatus,
        requestUrl,
        contestApi: 'SKIPPED_AUTH_FAILURE',
        contestReturned: 0,
        responseSize,
        kvWrite: 'SKIPPED',
        kvRead: 'SKIPPED',
        reason: `HTTP ${httpStatus}: Authentication failed. Using cached contests from last successful sync.`,
        rawResponse: providerResponse?.data || providerResponse?.text || null,
        normalizedContests: cachedContests,
        kvPayload: null,
        cacheStatus: {
          usingCache: true,
          cachedContestCount: cachedContests.length,
          lastSyncedAt: (config as any)?.lastContestSync?.syncedAt || null,
          message: 'Using contests from last successful sync due to authentication failure',
        },
        errorReport: buildFeibotErrorReport({
          workerStatus: 500,
          feibotStatus: httpStatus,
          method: 'GET',
          path: '/eventConfigFile/timingRulesGet',
          eventUuid,
          cloudUuid: eventUuid,
          timestamp: providerResponse?.timestamp || null,
          sortedQuery: `event_uuid=${eventUuid}`,
          stringToSign: providerResponse?.stringToSign || null,
          responseBody: providerResponse?.data || providerResponse?.text || null,
        }),
      },
    };
  }

  // MODE 2: OTHER FAILURES - Try fallback, but don't write to KV on failure
  if (!providerResponse?.ok) {
    const httpStatus = Number(providerResponse?.status || 0);
    const fallbackRows =
      fallbackCloudContests.length > 0
        ? fallbackCloudContests
        : fallbackHubTimingContests.length > 0
          ? fallbackHubTimingContests
          : fallbackCategoryContests.length > 0
            ? fallbackCategoryContests
            : existing;
    const fallbackContests = mapContestRows(fallbackRows);

    if (fallbackContests.length > 0) {
      const nextConfig = {
        ...config,
        provider: 'feibot',
        contests: fallbackContests,
        lastContestSync: {
          syncedAt: new Date().toISOString(),
          fetched: fallbackContests.length,
          contests: fallbackContests,
          rawResponse: providerResponse?.data || providerResponse?.text || null,
          source: 'fallback_after_provider_failure',
        },
        providerVersion: normalizeText((config as any)?.providerVersion || 'v1') || 'v1',
        generatedAt: new Date().toISOString(),
        version: Number(config?.version || 0) + 1,
      };

      await putKV(`event:${eventId}:config`, nextConfig, 'api-contest-mapping');
      await putKV(`live:event:${eventId}:config`, nextConfig, 'api-contest-mapping');
      const verifiedCount = await verifyKvContests(fallbackContests.length);

      return {
        contests: fallbackContests,
        config: nextConfig,
        sync: {
          provider: 'Feibot',
          authentication: 'UNKNOWN_FAILURE',
          httpStatus,
          requestUrl,
          contestApi: 'FALLBACK',
          contestReturned: fallbackContests.length,
          responseSize,
          kvWrite: 'PASS',
          kvRead: verifiedCount > 0 ? 'PASS' : 'FAILED',
          reason: `timingRulesGet failed with HTTP ${httpStatus || 0}; loaded contests from fallback timing sources`,
          rawResponse: providerResponse?.data || providerResponse?.text || null,
          normalizedContests: fallbackContests,
          kvPayload: { contests: fallbackContests },
          compare: {
            apiBaseUrl: normalizeText(apiBaseUrl),
            eventUuid: normalizeText(eventUuid),
            accessKeyLength: Number(accessKey.length),
            secretKeyLength: Number(secretKey.length),
            authorizationLength: authRaw.length,
            requestPath: '/eventConfigFile/timingRulesGet',
            timestamp: providerResponse?.timestamp || null,
            stringToSign: providerResponse?.stringToSign || null,
            signatureLength: providerResponse?.signatureLength || null,
          },
          errorReport: buildFeibotErrorReport({
            workerStatus: 500,
            feibotStatus: httpStatus,
            method: 'GET',
            path: '/eventConfigFile/timingRulesGet',
            eventUuid,
            cloudUuid: eventUuid,
            timestamp: providerResponse?.timestamp || null,
            sortedQuery: `event_uuid=${eventUuid}`,
            stringToSign: providerResponse?.stringToSign || null,
            responseBody: providerResponse?.data || providerResponse?.text || null,
          }),
        },
      };
    }

    return {
      contests: existing,
      config,
      sync: {
        provider: 'Feibot',
        authentication: 'UNKNOWN_FAILURE',
        httpStatus,
        requestUrl,
        contestApi: 'FAILED',
        contestReturned: 0,
        responseSize,
        kvWrite: 'SKIPPED',
        kvRead: 'SKIPPED',
        reason: `timingRulesGet failed with HTTP ${httpStatus || 0}`,
        rawResponse: providerResponse?.data || providerResponse?.text || null,
        normalizedContests: [],
        kvPayload: null,
        compare: {
          apiBaseUrl: normalizeText(apiBaseUrl),
          eventUuid: normalizeText(eventUuid),
          accessKeyLength: Number(accessKey.length),
          secretKeyLength: Number(secretKey.length),
          authorizationLength: authRaw.length,
          requestPath: '/eventConfigFile/timingRulesGet',
          timestamp: providerResponse?.timestamp || null,
          stringToSign: providerResponse?.stringToSign || null,
          signatureLength: providerResponse?.signatureLength || null,
        },
        errorReport: buildFeibotErrorReport({
          workerStatus: 500,
          feibotStatus: httpStatus,
          method: 'GET',
          path: '/eventConfigFile/timingRulesGet',
          eventUuid,
          cloudUuid: eventUuid,
          timestamp: providerResponse?.timestamp || null,
          sortedQuery: `event_uuid=${eventUuid}`,
          stringToSign: providerResponse?.stringToSign || null,
          responseBody: providerResponse?.data || providerResponse?.text || null,
        }),
      },
    };
  }

  const payload = providerResponse?.data || {};
  const timingRulesSource = extractTimingRulesSource(payload);

  const rawContests = extractTimingRulesContests(payload);

  const contests = mapContestRows(rawContests);

  if (contests.length === 0) {
    if (forceSync) {
      return {
        contests: [],
        config,
        sync: {
          provider: 'Feibot',
          authentication: 'PASS',
          httpStatus: 200,
          requestUrl,
          contestApi: 'PASS',
          contestReturned: 0,
          responseSize,
          kvWrite: 'SKIPPED',
          kvRead: 'SKIPPED',
          reason: 'Provider response did not contain contests; refusing to reuse stale KV cache on forced sync',
          rawResponse: payload,
          normalizedContests: [],
          kvPayload: null,
        },
      };
    }

    return {
      contests: existing,
      config,
      sync: {
        provider: 'Feibot',
        authentication: 'PASS',
        httpStatus: 200,
        requestUrl,
        contestApi: 'PASS',
        contestReturned: 0,
        responseSize,
        kvWrite: 'SKIPPED',
        kvRead: 'SKIPPED',
        reason: 'Provider response did not contain contests at result.timing_rules.contests',
        rawResponse: payload,
        normalizedContests: [],
        kvPayload: null,
      },
    };
  }

  const resolvedTimingConfiguration = buildResolvedTimingConfiguration({
    eventId,
    cloud: {
      ...(payload || {}),
      timing_rules: timingRulesSource || undefined,
      timingRules: timingRulesSource || undefined,
    },
    importedAt: new Date().toISOString(),
    provider: 'feibot',
  }) as any;

  const timingUpdatedAt = normalizeEpochTimestamp(
    timingRulesSource?.meta?.updated_at ||
    timingRulesSource?.meta?.updatedAt ||
    payload?.meta?.updated_at ||
    payload?.meta?.updatedAt ||
    payload?.updated_at ||
    payload?.updatedAt,
  );
  resolvedTimingConfiguration.updatedAt = timingUpdatedAt;
  resolvedTimingConfiguration.meta = {
    ...(resolvedTimingConfiguration.meta || {}),
    updatedAt: timingUpdatedAt,
    sourceUpdatedAt: normalizeText(
      timingRulesSource?.meta?.updated_at ||
      timingRulesSource?.meta?.updatedAt ||
      payload?.meta?.updated_at ||
      payload?.meta?.updatedAt ||
      payload?.updated_at ||
      payload?.updatedAt ||
      '',
    ),
  };

  const resolvedCourse = resolvedTimingConfiguration.course || { legs: [], timingPoints: [], splits: [], contests: [] };
  const freshTimingRules = timingRulesSource ? {
    ...timingRulesSource,
  } : null;

  const nextConfig = {
    ...config,
    provider: 'feibot',
    contests,
    timingRules: freshTimingRules,
    timingConfiguration: resolvedTimingConfiguration,
    course: resolvedCourse,
    timingPoints: resolvedTimingConfiguration.timingPoints,
    splits: resolvedTimingConfiguration.splits,
    ageGroups: resolvedTimingConfiguration.ageGroups,
    legs: resolvedTimingConfiguration.legs,
    devices: resolvedTimingConfiguration.devices,
    lastContestSync: {
      syncedAt: new Date().toISOString(),
      fetched: contests.length,
      contests,
      rawResponse: payload,
      timingRules: freshTimingRules,
      timingConfiguration: resolvedTimingConfiguration,
    },
    providerVersion: normalizeText((payload as any)?.version || (config as any)?.providerVersion || 'v1') || 'v1',
    generatedAt: new Date().toISOString(),
    version: Number(config?.version || 0) + 1,
    feibotConfig: {
      ...(config?.feibotConfig || {}),
      cloudTimingRules: freshTimingRules,
      cloud: {
        ...(config?.feibotConfig?.cloud || {}),
        timingRules: freshTimingRules,
        timingConfiguration: resolvedTimingConfiguration,
      },
    },
  };

  await putKV(`event:${eventId}:config`, nextConfig, 'api-contest-mapping');
  await putKV(`live:event:${eventId}:config`, nextConfig, 'api-contest-mapping');
  console.log('[TimingConfiguration Write]', {
    writer: 'api-contest-mapping',
    source: 'Feibot',
    contestCount: resolvedTimingConfiguration.contests.length,
    splitCount: resolvedTimingConfiguration.splits.length,
    timingPointCount: resolvedTimingConfiguration.timingPoints.length,
    contestNames: resolvedTimingConfiguration.contests.map((contest: any) => contest?.contestName || contest?.name || contest?.Name).filter(Boolean),
    destination: `event:${eventId}:timingConfiguration`,
    note: 'delegated to canonical sync writer',
  });

  await putKV(`event:${eventId}:timingConfiguration`, {
    eventId,
    eventUuid: normalizeText(eventUuid),
    updatedAt: timingUpdatedAt,
    contests: resolvedTimingConfiguration.contests,
    splits: resolvedTimingConfiguration.splits,
    timingPoints: resolvedTimingConfiguration.timingPoints,
    legs: resolvedTimingConfiguration.legs,
    ageGroups: resolvedTimingConfiguration.ageGroups,
    devices: resolvedTimingConfiguration.devices,
    course: resolvedTimingConfiguration.course,
    timingConfiguration: resolvedTimingConfiguration,
    importedAt: new Date().toISOString(),
    source: 'feibot',
  }, 'api-contest-mapping');
  await putKV(`live:event:${eventId}:timingConfiguration`, {
    eventId,
    eventUuid: normalizeText(eventUuid),
    updatedAt: timingUpdatedAt,
    contests: resolvedTimingConfiguration.contests,
    splits: resolvedTimingConfiguration.splits,
    timingPoints: resolvedTimingConfiguration.timingPoints,
    legs: resolvedTimingConfiguration.legs,
    ageGroups: resolvedTimingConfiguration.ageGroups,
    devices: resolvedTimingConfiguration.devices,
    course: resolvedTimingConfiguration.course,
    timingConfiguration: resolvedTimingConfiguration,
    importedAt: new Date().toISOString(),
    source: 'feibot',
  }, 'api-contest-mapping');

  const verifiedCount = await verifyKvContests(contests.length);

  return {
    contests,
    config: nextConfig,
    sync: {
      provider: 'Feibot',
      authentication: 'PASS',
      httpStatus: 200,
      requestUrl,
      contestApi: 'PASS',
      contestReturned: contests.length,
      responseSize,
      kvWrite: 'PASS',
      kvRead: verifiedCount > 0 ? 'PASS' : 'FAILED',
      reason: 'Synced from provider timing rules',
      rawResponse: payload,
      normalizedContests: contests,
      kvPayload: { contests },
      compare: {
        apiBaseUrl: normalizeText(apiBaseUrl),
        eventUuid: normalizeText(eventUuid),
        accessKeyLength: Number(accessKey.length),
        secretKeyLength: Number(secretKey.length),
        authorizationLength: authRaw.length,
        requestPath: '/eventConfigFile/timingRulesGet',
        timestamp: providerResponse?.timestamp || null,
        stringToSign: providerResponse?.stringToSign || null,
        signatureLength: providerResponse?.signatureLength || null,
      },
    },
  };
}

function buildTicketLookupArtifacts(tickets: any[]) {
  const ticketLookupById: Record<string, any> = {};
  const ticketLookupByName: Record<string, any> = {};
  const ticketOrder: string[] = [];

  for (const ticket of tickets) {
    ticketLookupById[ticket.ticketId] = {
      id: ticket.ticketId,
      name: ticket.ticketName,
      displayName: ticket.displayName,
      subCategory: ticket.subCategory,
      category: ticket.category,
      type: ticket.type,
      distance: ticket.distance,
      relay: ticket.relay,
      status: ticket.status,
      gender: ticket.gender,
      ageCategory: ticket.ageCategory,
      order: ticket.order,
    };
    ticketLookupByName[normalizeCompact(ticket.ticketName)] = ticket.ticketId;
    ticketOrder.push(ticket.ticketId);
  }

  return { ticketLookupById, ticketLookupByName, ticketOrder };
}

async function upsertConfigTicketArtifacts(eventId: string, tickets: any[]) {
  const config = await loadConfigFromKv(eventId);
  const lookups = buildTicketLookupArtifacts(tickets);
  const merged = {
    ...config,
    ticketDefinitions: tickets.map((ticket) => ({
      id: ticket.ticketId,
      name: ticket.ticketName,
      displayName: ticket.displayName,
      category: ticket.category,
      type: ticket.type,
      distance: ticket.distance,
      relay: ticket.relay,
      status: ticket.status,
      price: ticket.price,
      gender: ticket.gender,
      ageCategory: ticket.ageCategory,
      order: ticket.order,
      athleteCount: Number(ticket.athletes || 0),
      hasSubCategories: Array.isArray(ticket.subCategories) && ticket.subCategories.length > 0,
      subCategories: (Array.isArray(ticket.subCategories) ? ticket.subCategories : []).map((sub: any) => {
        const subId = normalizeText(sub?.id || sub?.subCategoryId || sub?.uuid || '');
        const subName = normalizeText(sub?.name || sub?.subCategoryName || sub?.label || 'Sub Category');
        return {
          id: subId,
          name: subName,
          pricePaisa: Number(sub?.pricePaisa ?? sub?.price ?? 0) || 0,
          applicableAgeGroups: Array.isArray(sub?.applicableAgeGroups)
            ? sub.applicableAgeGroups
            : Array.isArray(sub?.ageGroups)
              ? sub.ageGroups
              : [],
          cutoff: normalizeText(sub?.cutoff || sub?.cutoffTime || '') || null,
          tiers: Array.isArray(sub?.tiers) ? sub.tiers : [],
          athleteCount: Number(
            (ticket?.subCategoryCountById && subId ? (ticket.subCategoryCountById[subId] || ticket.subCategoryCountById[normalizeCompact(subId)]) : 0)
              || (ticket?.subCategoryCountByName && subName ? (ticket.subCategoryCountByName[subName.toLowerCase()] || ticket.subCategoryCountByName[normalizeCompact(subName)]) : 0)
              || 0,
          ),
        };
      }),
    })),
    ticketLookupById: lookups.ticketLookupById,
    ticketLookupByName: lookups.ticketLookupByName,
    ticketOrder: lookups.ticketOrder,
    generatedAt: new Date().toISOString(),
    version: Number(config?.version || 0) + 1,
  };

  await putKV(`event:${eventId}:config`, merged, 'api-contest-mapping');
  await putKV(`live:event:${eventId}:config`, merged, 'api-contest-mapping');
  return merged;
}

function buildMappingsForUi(tickets: any[], contests: any[], savedMappings: Record<string, any> | null) {
  const rows = expandTicketRows(tickets);

  return rows.map((ticket) => {
    const result = autoMapTicketByPriority(ticket, contests, savedMappings, null);
    const contest = result.contest;
    const savedEntry = (savedMappings?.ticketsById || {})[ticket.mappingId];
    const isIgnored = savedEntry?.ignored === true;

    return {
      mappingId: ticket.mappingId,
      parentTicketId: ticket.parentTicketId,
      parentTicketName: ticket.parentTicketName,
      subCategoryId: ticket.subCategoryId,
      subCategoryName: ticket.subCategoryName,
      displayName: ticket.displayName,
      ticketId: ticket.ticketId,
      ticketName: ticket.ticketName,
      subCategory: ticket.subCategory,
      category: ticket.category,
      type: ticket.type,
      distance: ticket.distance,
      athletes: ticket.athletes || 0,
      contestUuid: contest?.contestUuid || null,
      contestName: contest?.contestName || null,
      contestColor: contest?.color || null,
      contestAbbreviation: contest?.abbreviation || null,
      provider: contest?.provider || 'feibot',
      providerContestUuid: contest?.providerContestUuid || contest?.contestUuid || null,
      providerContestName: contest?.contestName || null,
      confidence: result.confidence,
      status: isIgnored ? 'ignored' : contest ? 'mapped' : 'missing',
      mappingType: result.mappingType,
      reason: result.reason,
      ignored: isIgnored,
      liveTrackingEnabled: !isIgnored && !!contest,
      mode: isIgnored ? 'ignored' : result.mappingType === 'manual' ? 'manual' : result.mappingType === 'auto' ? 'auto' : 'missing',
      lastUpdated: null,
    };
  });
}

export async function GET(_req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = normalizeText(params.eventId);
    if (!eventId) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    const [tickets, config, saved] = await Promise.all([
      loadTicketDefinitions(eventId),
      loadConfigFromKv(eventId),
      loadMappingsFromKv(eventId),
    ]);

    const mergedConfig = await upsertConfigTicketArtifacts(eventId, tickets);
    const contests = extractContestsFromConfig(mergedConfig);
    const mappings = buildMappingsForUi(tickets, contests, saved);

    // Calculate metrics based on ALL leaf tickets
    const totalLeafTickets = mappings.length;
    const ignoredTickets = mappings.filter((row) => row.ignored === true).length;
    const requiredTickets = totalLeafTickets - ignoredTickets;
    const mappedTickets = mappings.filter((row) => !!row.contestUuid && row.ignored !== true).length;
    const missingTickets = requiredTickets - mappedTickets;
    const manualMappings = mappings.filter((row) => row.mappingType === 'manual' && !!row.contestUuid).length;
    const autoMappings = mappings.filter((row) => row.mappingType === 'auto' && !!row.contestUuid).length;
    const rejectedFuzzyMatches = mappings.filter((row) => !row.contestUuid && row.confidence > 0 && row.confidence < 96 && row.ignored !== true).length;
    const coverage = requiredTickets > 0 ? Math.round((mappedTickets / requiredTickets) * 100) : 0;
    const isComplete = mappedTickets === requiredTickets && missingTickets === 0;

    // Build debug data
    const duplicateUuids: Record<string, string[]> = {};
    const usedUuids = new Set<string>();
    const unusedContests: string[] = [];

    for (const mapping of mappings) {
      if (mapping.contestUuid) {
        if (usedUuids.has(mapping.contestUuid)) {
          if (!duplicateUuids[mapping.contestUuid]) duplicateUuids[mapping.contestUuid] = [];
          duplicateUuids[mapping.contestUuid].push(mapping.displayName);
        } else {
          usedUuids.add(mapping.contestUuid);
        }
      }
    }

    for (const contest of contests) {
      if (!usedUuids.has(contest.contestUuid)) {
        unusedContests.push(contest.contestName);
      }
    }

    const missingMappings = mappings.filter((row) => !row.contestUuid);
    const unusedTickets = missingMappings.map((row) => row.displayName);

    const cloudContests = Number((mergedConfig as any)?.lastContestSync?.fetched || contests.length || 0);
    const kvContests = contests.length;

    return NextResponse.json({
      success: true,
      eventId,
      tickets,
      databaseTickets: tickets,
      contests,
      mappings,
      mappingSummary: {
        leafTickets: totalLeafTickets,
        ignored: ignoredTickets,
        required: requiredTickets,
        mapped: mappedTickets,
        missing: missingTickets,
        manual: manualMappings,
        auto: autoMappings,
        coverage,
        complete: isComplete,
        requiredText: `${mappedTickets} Mapped, ${ignoredTickets} Ignored, ${manualMappings} Manual, ${autoMappings} Auto, ${missingTickets} Missing`,
      },
      diagnostics: {
        provider: 'Feibot',
        authentication: 'KV_ONLY',
        httpStatus: 200,
        requestUrl: null,
        contestApi: 'KV_ONLY',
        contestReturned: kvContests,
        kvWrite: 'PASS',
        kvRead: 'PASS',
        reason: 'Contest Mapping reads from KV. Use Sync Contests to fetch from Feibot.',
        kvConfigFound: Object.keys(mergedConfig || {}).length > 0,
        contestCount: contests.length,
        cloudContests,
        kvContests,
        ticketDefinitions: tickets.length,
        expandedRows: totalLeafTickets,
        lastSync: typeof (mergedConfig as any)?.lastContestSync === 'string'
          ? (mergedConfig as any).lastContestSync
          : (mergedConfig as any)?.lastContestSync?.syncedAt || (mergedConfig as any)?.generatedAt || null,
        kvKeys: [`event:${eventId}:config`, `event:${eventId}:ticketMappings`],
      },
      debugPanel: {
        totalLeafTickets,
        mappedTickets,
        missingTickets,
        manualMappings,
        autoMappings,
        rejectedFuzzyMatches,
        duplicateUuids: Object.keys(duplicateUuids).length > 0 ? duplicateUuids : null,
        unusedContests,
        unusedTickets,
        coverage,
        mappingsByType: {
          manual: manualMappings,
          auto: autoMappings,
          missing: missingTickets,
          fuzzyRejected: rejectedFuzzyMatches,
        },
        validationStatus: {
          allTicketsMapped: missingTickets === 0,
          fullCoverage: coverage === 100,
          noDuplicateUuids: Object.keys(duplicateUuids).length === 0,
          allContestsUsed: unusedContests.length === 0,
          readyForImport: isComplete && Object.keys(duplicateUuids).length === 0,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to load contest mapping context' },
      { status: 500 },
    );
  }
}

export async function POST(_req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = normalizeText(params.eventId);
    if (!eventId) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    const startedAt = Date.now();
    const config = await loadConfigFromKv(eventId);
    const synced = await syncContestsFromFeibot(eventId, config, { force: true });
    const contests = Array.isArray((synced as any)?.contests) ? (synced as any).contests : [];
    const cloudEventUuid = normalizeText(
      (synced as any)?.config?.feibotConfig?.cloud?.eventUuid ||
      (synced as any)?.config?.feibotConfig?.eventUuid ||
      config?.feibotConfig?.cloud?.eventUuid ||
      config?.feibotConfig?.eventUuid ||
      '',
    );
    const scoreEventUuid = normalizeText(
      (synced as any)?.config?.feibotConfig?.score?.eventUuid ||
      config?.feibotConfig?.score?.eventUuid ||
      '',
    );
    let snapshotSync: { success: boolean; message?: string } | null = null;
    if (cloudEventUuid) {
      try {
        const snapshot = await syncFeibotCloudEventInfo({
          eventId,
          eventUuid: cloudEventUuid,
          apiBaseUrl: normalizeText((synced as any)?.config?.feibotConfig?.cloud?.apiBaseUrl || (synced as any)?.config?.feibotConfig?.apiBaseUrl || config?.feibotConfig?.cloud?.apiBaseUrl || config?.feibotConfig?.apiBaseUrl || ''),
          scoreEventUuid: scoreEventUuid || undefined,
          triggeredBy: 'contest-mapping-sync-contests',
        });
        snapshotSync = snapshot.success
          ? { success: true, message: 'Timing points and splits synchronized from Feibot Cloud API' }
          : { success: false, message: snapshot.errorReport?.reason || 'Timing points/splits synchronization failed' };
      } catch (error) {
        snapshotSync = { success: false, message: error instanceof Error ? error.message : 'Timing points/splits synchronization failed' };
      }
    }
    try {
      const latestTimingConfiguration = await getKV<Record<string, any>>(`event:${eventId}:timingConfiguration`, 'api-contest-mapping');
      const timingPayload = latestTimingConfiguration?.timingConfiguration || latestTimingConfiguration;
      if (timingPayload) {
        await rebuildSplitIndexInKv({
          eventId,
          timingConfiguration: timingPayload as any,
          provider: String(latestTimingConfiguration?.provider || timingPayload?.provider || 'feibot'),
          generatedBy: 'contest-mapping-sync-contests',
          syncType: 'contest-mapping-sync',
          sourceVersion: String(latestTimingConfiguration?.version || timingPayload?.version || latestTimingConfiguration?.updatedAt || ''),
        });
      }
    } catch (error) {
      console.warn('[contest-mapping][split-index] rebuild skipped', error instanceof Error ? error.message : error);
    }
    const durationMs = Date.now() - startedAt;

    return NextResponse.json({
        success: (synced as any)?.sync?.kvWrite === 'PASS' && (synced as any)?.sync?.httpStatus === 200,
      eventId,
        message: (synced as any)?.sync?.authentication === 'AUTHENTICATION_FAILED'
          ? `Authentication failed (HTTP ${Number((synced as any)?.sync?.httpStatus || 403)}). Displaying ${contests.length} contests from cache.`
          : (synced as any)?.sync?.kvWrite === 'PASS' && (synced as any)?.sync?.httpStatus === 200
            ? `Successfully synced ${contests.length} contests from Feibot API`
            : `Contest sync failed: ${(synced as any)?.sync?.reason || 'HTTP ' + Number((synced as any)?.sync?.httpStatus || 0)}`,
      request: {
        endpoint: (synced as any)?.sync?.requestUrl || null,
        httpStatus: Number((synced as any)?.sync?.httpStatus || 0),
        durationMs,
        authentication: (synced as any)?.sync?.authentication || 'UNKNOWN',
        provider: 'Feibot',
      },
      rawResponse: (synced as any)?.sync?.rawResponse || null,
      normalizedContests: (synced as any)?.sync?.normalizedContests || contests,
      kvPayload: (synced as any)?.sync?.kvPayload || null,
      summary: {
          apiStatus: (synced as any)?.sync?.httpStatus === 200
            ? 'SUCCESS'
            : (['AUTHENTICATION_FAILED', 'FAILED'].includes((synced as any)?.sync?.authentication || '')
              ? `AUTH_FAILED_HTTP_${Number((synced as any)?.sync?.httpStatus || 403)}`
              : 'FAILED'),
          fetched: (synced as any)?.sync?.httpStatus === 200 ? Number((synced as any)?.sync?.contestReturned || 0) : 0,
          saved: (synced as any)?.sync?.kvWrite === 'PASS' ? contests.length : 0,
          loaded: contests.length,
          dataSource: (synced as any)?.sync?.kvWrite === 'PASS'
            ? 'FRESH_API'
            : (['AUTHENTICATION_FAILED', 'FAILED'].includes((synced as any)?.sync?.authentication || '') && contests.length > 0
              ? 'CACHED'
              : 'NONE'),
          kvUpdated: (synced as any)?.sync?.kvWrite === 'PASS',
          usingCache: ['AUTHENTICATION_FAILED', 'FAILED'].includes((synced as any)?.sync?.authentication || '') || ((synced as any)?.sync?.kvWrite !== 'PASS' && contests.length > 0),
          cacheStatus: (synced as any)?.sync?.cacheStatus || null,
        skipped: (synced as any)?.sync?.contestApi === 'SKIPPED' ? 1 : 0,
        errors: (synced as any)?.sync?.contestApi === 'FAILED' ? 1 : 0,
      },
      diagnostics: (synced as any)?.sync || {},
      snapshotSync,
      lastContestSync: (synced as any)?.config?.lastContestSync || null,
      }, {
        status:
          (synced as any)?.sync?.kvWrite === 'PASS' && (synced as any)?.sync?.httpStatus === 200
            ? 200
            : [401, 403].includes(Number((synced as any)?.sync?.httpStatus || 0))
              ? Number((synced as any)?.sync?.httpStatus || 403)
              : 502,
      });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to sync contests',
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = normalizeText(params.eventId);
    if (!eventId) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const incomingMappings = Array.isArray(body?.mappings) ? body.mappings : [];
    const updatedBy = normalizeText(body?.mappedBy || body?.updatedBy) || 'admin-ui';

    const [tickets, config, savedMappings] = await Promise.all([
      loadTicketDefinitions(eventId),
      loadConfigFromKv(eventId),
      getKV<Record<string, any>>(`event:${eventId}:ticketMappings`, 'api-contest-mapping').catch(() => null),
    ]);

    const contests = extractContestsFromConfig(config);
    const savedTicketsById = (savedMappings as any)?.ticketsById || {};
    if (contests.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'No contests found in KV. Run Sync Contests first.',
          code: 'CONTESTS_NOT_IN_KV',
        },
        { status: 409 },
      );
    }
    const contestsByUuid = new Map(contests.map((contest: any) => [contest.contestUuid, contest]));
    const incomingByTicket = new Map<string, any>();
    for (const row of incomingMappings) {
      const mappingId = normalizeText(row?.mappingId || (row?.ticketId && row?.subCategoryId ? `${row.ticketId}:${row.subCategoryId}` : ''));
      if (mappingId) incomingByTicket.set(mappingId, row);
    }

    const generatedAt = new Date().toISOString();
    const ticketsById: Record<string, any> = {};
    const ticketsByName: Record<string, string> = {};
    const ticketLookupById: Record<string, any> = {};
    const ticketLookupByName: Record<string, any> = {};
    const ticketToContest: Record<string, string> = {};
    const contestToTicket: Record<string, string> = {};
    const subCategoryMappings: Record<string, Record<string, { contestUUID: string; contestName: string | null }>> = {};
    const contestLookup: Record<string, any> = {};

    const ticketRows = expandTicketRows(tickets);
    for (const ticket of ticketRows) {
      const source = incomingByTicket.get(ticket.mappingId) || {};
      const hasIncoming = incomingByTicket.has(ticket.mappingId);
      const incomingIgnored = source?.ignored === true || normalizeText(source?.status).toLowerCase() === 'ignored' || normalizeText(source?.mode).toLowerCase() === 'ignored';
      const selectedContestUuid = normalizeText(source?.contestUuid);
      const selectedContest = selectedContestUuid ? contestsByUuid.get(selectedContestUuid) : null;
      const auto = (!selectedContest && !hasIncoming) ? autoMatchTicketSubCategory(ticket.parentTicketName || ticket.ticketName, ticket.subCategoryName, contests) : null;
      const contest = selectedContest || auto?.contest || null;
      const confidence = Number(source?.confidence || auto?.confidence || 0);

      const isIgnored = incomingIgnored || savedTicketsById[ticket.mappingId]?.ignored === true;
      const contestUuid = isIgnored ? null : (normalizeText(source?.contestUuid || contest?.contestUuid) || null);
      const contestName = isIgnored ? null : (normalizeText(source?.contestName || contest?.contestName) || null);
      const providerContestUuid = isIgnored ? null : (normalizeText(source?.providerContestUuid || contest?.providerContestUuid || contestUuid) || null);
      const providerContestName = isIgnored ? null : (normalizeText(source?.providerContestName || contest?.contestName || contestName) || null);
      const status = isIgnored ? 'ignored' : (contestUuid ? 'mapped' : 'missing');

      ticketsById[ticket.mappingId] = {
        mappingId: ticket.mappingId,
        parentTicketId: ticket.parentTicketId,
        parentTicketName: ticket.parentTicketName,
        subCategoryId: ticket.subCategoryId,
        subCategoryName: ticket.subCategoryName,
        displayName: ticket.displayName,
        ticketId: ticket.ticketId,
        ticketUuid: ticket.ticketId,
        ticketName: ticket.ticketName,
        subCategory: ticket.subCategory,
        contestUuid,
        contestName,
        contestColor: normalizeText(source?.contestColor || contest?.color) || null,
        contestAbbreviation: normalizeText(source?.contestAbbreviation || contest?.abbreviation) || null,
        provider: normalizeText(source?.provider || contest?.provider || 'feibot') || 'feibot',
        providerContestUuid,
        providerContestName,
        confidence,
        status,
        ignored: isIgnored,
        athletes: Number(ticket?.athletes || 0),
        lastUpdated: generatedAt,
        updatedBy,
      };

      ticketsByName[normalizeCompact(ticket.displayName || ticket.ticketName)] = ticket.mappingId;
      ticketLookupById[ticket.mappingId] = {
        mappingId: ticket.mappingId,
        ticketId: ticket.ticketId,
        ticketName: ticket.ticketName,
        parentTicketId: ticket.parentTicketId,
        parentTicketName: ticket.parentTicketName,
        subCategoryId: ticket.subCategoryId,
        subCategoryName: ticket.subCategoryName,
        displayName: ticket.displayName,
      };
      ticketLookupByName[normalizeCompact(ticket.displayName || ticket.ticketName)] = ticket.mappingId;
      if (contestUuid && !isIgnored) {
        ticketToContest[ticket.mappingId] = contestUuid;
        if (!contestToTicket[contestUuid]) contestToTicket[contestUuid] = ticket.mappingId;
        if (!subCategoryMappings[ticket.parentTicketId]) subCategoryMappings[ticket.parentTicketId] = {};
        subCategoryMappings[ticket.parentTicketId][ticket.subCategoryId] = {
          contestUUID: contestUuid,
          contestName,
        };
        contestLookup[contestUuid] = {
          contestUuid,
          contestName,
          ticketMappingId: ticket.mappingId,
          ticketId: ticket.ticketId,
          ticketName: ticket.ticketName,
          subCategoryId: ticket.subCategoryId,
          subCategoryName: ticket.subCategoryName,
        };
      }
    }

    const total = Object.keys(ticketsById).length;
    const ignored = Object.values(ticketsById).filter((row: any) => row?.ignored === true).length;
    const actionableTotal = Math.max(total - ignored, 0);
    const mapped = Object.values(ticketsById).filter((row: any) => row?.ignored !== true && !!row.contestUuid).length;
    const missing = Math.max(actionableTotal - mapped, 0);
    const coverage = actionableTotal > 0 ? Math.round((mapped / actionableTotal) * 100) : 100;
    const requiredRows = Object.values(ticketsById).filter((row: any) => row?.ignored !== true && Number((row as any)?.athletes || 0) > 0) as any[];
    const requiredTotal = requiredRows.length;
    const requiredMapped = requiredRows.filter((row: any) => !!row?.contestUuid).length;
    const requiredMissing = Math.max(requiredTotal - requiredMapped, 0);
    const requiredCoverage = requiredTotal > 0 ? Math.round((requiredMapped / requiredTotal) * 100) : 100;

    const payload = {
      generatedAt,
      version: generatedAt,
      provider: 'feibot',
      ticketsById,
      ticketsByName,
      ticketLookupById,
      ticketLookupByName,
      contestToTicket,
      ticketToContest,
      subCategoryMappings,
      contestLookup,
      coverage,
      mapped,
      missing,
      ignored,
      actionableTotal,
    };

    await putKV(`event:${eventId}:ticketMappings`, payload, 'api-contest-mapping');
    await putKV(`live:event:${eventId}:ticketMappings`, payload, 'api-contest-mapping');
    await upsertConfigTicketArtifacts(eventId, tickets);
    const backfill = await backfillContestUuids(eventId, payload);
    const cloudEventUuid = normalizeText(config?.feibotConfig?.cloud?.eventUuid || config?.feibotConfig?.eventUuid || '');
    const scoreEventUuid = normalizeText(config?.feibotConfig?.score?.eventUuid || '');
    let snapshotSync: { success: boolean; message?: string } | null = null;
    if (cloudEventUuid) {
      try {
        const snapshot = await syncFeibotCloudEventInfo({
          eventId,
          eventUuid: cloudEventUuid,
          apiBaseUrl: normalizeText(config?.feibotConfig?.cloud?.apiBaseUrl || config?.feibotConfig?.apiBaseUrl || ''),
          scoreEventUuid: scoreEventUuid || undefined,
          triggeredBy: 'contest-mapping-save-mappings',
        });
        snapshotSync = snapshot.success
          ? { success: true, message: 'Timing points and splits synchronized from Feibot Cloud API' }
          : { success: false, message: snapshot.errorReport?.reason || 'Timing points/splits synchronization failed' };
      } catch (error) {
        snapshotSync = { success: false, message: error instanceof Error ? error.message : 'Timing points/splits synchronization failed' };
      }
    }

    return NextResponse.json({
      success: true,
      eventId,
      message: `Saved ${mapped}/${total} mappings to KV`,
      mappingSummary: {
        total,
        ignored,
        actionableTotal,
        mapped,
        missing,
        coverage,
        complete: requiredTotal > 0 ? requiredMissing === 0 : true,
        requiredTotal,
        requiredMapped,
        requiredMissing,
        requiredCoverage,
      },
      backfill,
      snapshotSync,
      payload,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to save mappings' },
      { status: 500 },
    );
  }
}
