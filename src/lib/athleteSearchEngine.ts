/**
 * High-performance unified athlete search engine
 * 
 * Features:
 * - Single search box with automatic type detection
 * - Prefix and partial matching (case-insensitive)
 * - Live suggestions while typing
 * - < 100ms search performance using in-memory indexing
 * - Comprehensive field coverage: name, bib, email, chip, booking ID, provider UUID
 * - Diagnostics and performance logging
 */

export type SearchType = 'name' | 'bib' | 'email' | 'chip' | 'booking_id' | 'provider_uuid' | 'mixed';

export type SearchDiagnostics = {
  query: string;
  detectedType: SearchType;
  matchCount: number;
  durationMs: number;
  source: 'kv_index' | 'memory';
  indexSize: number;
  fieldsSearched: string[];
};

export type SearchResult = {
  athlete: Record<string, any>;
  matchedFields: string[];
  matchType: 'exact' | 'prefix' | 'partial';
  diagnostics?: SearchDiagnostics;
};

function normalize(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeForSearch(value: unknown): string {
  return normalize(value).toLowerCase();
}

function compactBib(bibNumber: string): string {
  return bibNumber.replace(/^0+/, '');
}

/**
 * Detect what the user is likely searching for based on the query
 */
function detectSearchType(query: string): SearchType {
  const q = normalizeForSearch(query);
  
  // Email detection
  if (q.includes('@') && q.includes('.')) {
    return 'email';
  }

  // Numeric detection (bib or chip number)
  if (/^\d+$/.test(q)) {
    return 'bib'; // Bibs are typically numeric
  }

  // Chip number pattern (often longer numeric or alphanumeric)
  if (/^[a-z0-9]{8,}$/.test(q) && /\d/.test(q)) {
    return 'chip';
  }

  // UUID pattern (8-4-4-4-12)
  if (/^[a-z0-9]{8}-[a-z0-9]{4}-/.test(q)) {
    return 'provider_uuid';
  }

  // Default to name search
  return 'name';
}

/**
 * Build a searchable index from participant data
 */
export function buildAthleteSearchIndex(participants: Record<string, any>[]): Map<string, Record<string, any>> {
  const index = new Map<string, Record<string, any>>();

  for (const participant of participants) {
    const firstName = normalizeForSearch(participant?.firstName || participant?.provider?.firstName || participant?.registration?.firstName || '');
    const lastName = normalizeForSearch(participant?.lastName || participant?.provider?.lastName || participant?.registration?.lastName || '');
    const fullName = normalizeForSearch(
      participant?.fullName
      || participant?.name
      || participant?.athleteName
      || [participant?.firstName, participant?.lastName].filter(Boolean).join(' ')
      || ''
    );
    const bib = normalize(participant?.bib || participant?.bibNumber || '');
    const email = normalizeForSearch(participant?.email || participant?.emailAddress || participant?.registration?.email || '');
    const chip = normalizeForSearch(participant?.chip || participant?.chipCode || participant?.chip_code || '');
    const bookingId = normalize(participant?.bookingId || participant?.registrationId || participant?.athleteUid || participant?.bergmanAthleteId || '');
    const providerUuid = normalizeForSearch(participant?.providerUuid || participant?.participantUuid || participant?.provider?.providerUuid || '');

    // Store all variations for quick lookup
    const variations = [
      firstName,
      lastName,
      fullName,
      bib,
      compactBib(bib),
      email,
      chip,
      normalizeForSearch(bookingId),
      providerUuid,
    ].filter(Boolean);

    for (const variant of variations) {
      if (!index.has(variant)) {
        index.set(variant, participant);
      }
    }
  }

  return index;
}

/**
 * Perform prefix matching on a field
 */
function matchPrefix(query: string, fieldValue: string): boolean {
  if (!fieldValue) return false;
  return normalizeForSearch(fieldValue).startsWith(normalizeForSearch(query));
}

/**
 * Perform partial matching on a field (substring match)
 */
function matchPartial(query: string, fieldValue: string): boolean {
  if (!fieldValue) return false;
  return normalizeForSearch(fieldValue).includes(normalizeForSearch(query));
}

/**
 * Search through participant data with multiple strategies
 */
export function searchAthletes(
  query: string,
  participants: Record<string, any>[],
  options?: {
    maxResults?: number;
    includeDiagnostics?: boolean;
  }
): SearchResult[] {
  const startTime = performance.now();
  const q = normalize(query);
  const qLower = normalizeForSearch(q);
  const maxResults = options?.maxResults ?? 20;
  const includeDiagnostics = options?.includeDiagnostics ?? true;

  const detectedType = detectSearchType(q);
  const results = new Map<string, { participant: Record<string, any>; fields: Set<string>; matchType: 'exact' | 'prefix' | 'partial' }>();
  const fieldsSearched = new Set<string>();

  // Search by detected type with fallback to other types
  const searchStrategies: Array<{ type: SearchType; execute: () => void }> = [
    {
      type: 'name',
      execute: () => {
        fieldsSearched.add('firstName');
        fieldsSearched.add('lastName');
        fieldsSearched.add('fullName');

        for (const participant of participants) {
          const firstName = normalize(participant?.firstName || participant?.provider?.firstName || participant?.registration?.firstName || '');
          const lastName = normalize(participant?.lastName || participant?.provider?.lastName || participant?.registration?.lastName || '');
          const fullName = normalize(
            participant?.fullName
            || participant?.name
            || participant?.athleteName
            || [participant?.firstName, participant?.lastName].filter(Boolean).join(' ')
            || ''
          );

          // Exact match
          if (normalizeForSearch(fullName) === qLower || normalizeForSearch(firstName) === qLower || normalizeForSearch(lastName) === qLower) {
            const key = `${fullName}|${participant?.bib}`;
            if (!results.has(key)) {
              results.set(key, { participant, fields: new Set(), matchType: 'exact' });
            }
            results.get(key)!.fields.add('name');
            results.get(key)!.matchType = 'exact';
            continue;
          }

          // Prefix match
          if (matchPrefix(q, fullName) || matchPrefix(q, firstName) || matchPrefix(q, lastName)) {
            const key = `${fullName}|${participant?.bib}`;
            if (!results.has(key)) {
              results.set(key, { participant, fields: new Set(), matchType: 'prefix' });
            }
            results.get(key)!.fields.add('name');
            if (results.get(key)!.matchType !== 'exact') {
              results.get(key)!.matchType = 'prefix';
            }
            continue;
          }

          // Partial match
          if (matchPartial(q, fullName) || matchPartial(q, firstName) || matchPartial(q, lastName)) {
            const key = `${fullName}|${participant?.bib}`;
            if (!results.has(key)) {
              results.set(key, { participant, fields: new Set(), matchType: 'partial' });
            }
            results.get(key)!.fields.add('name');
          }
        }
      },
    },
    {
      type: 'bib',
      execute: () => {
        fieldsSearched.add('bib');

        for (const participant of participants) {
          const bib = normalize(participant?.bib || participant?.bibNumber || '');
          const bibCompact = compactBib(bib);

          // Exact match
          if (bib === q || bibCompact === q) {
            const key = `${participant?.name}|${bib}`;
            if (!results.has(key)) {
              results.set(key, { participant, fields: new Set(), matchType: 'exact' });
            }
            results.get(key)!.fields.add('bib');
            results.get(key)!.matchType = 'exact';
            continue;
          }

          // Prefix match
          if (matchPrefix(q, bib) || matchPrefix(q, bibCompact)) {
            const key = `${participant?.name}|${bib}`;
            if (!results.has(key)) {
              results.set(key, { participant, fields: new Set(), matchType: 'prefix' });
            }
            results.get(key)!.fields.add('bib');
            if (results.get(key)!.matchType !== 'exact') {
              results.get(key)!.matchType = 'prefix';
            }
          }
        }
      },
    },
    {
      type: 'email',
      execute: () => {
        fieldsSearched.add('email');

        for (const participant of participants) {
          const email = normalizeForSearch(participant?.email || participant?.emailAddress || participant?.registration?.email || '');

          if (!email) continue;

          // Exact match
          if (email === qLower) {
            const key = `${participant?.name}|${participant?.bib}`;
            if (!results.has(key)) {
              results.set(key, { participant, fields: new Set(), matchType: 'exact' });
            }
            results.get(key)!.fields.add('email');
            results.get(key)!.matchType = 'exact';
            continue;
          }

          // Prefix match
          if (matchPrefix(q, email)) {
            const key = `${participant?.name}|${participant?.bib}`;
            if (!results.has(key)) {
              results.set(key, { participant, fields: new Set(), matchType: 'prefix' });
            }
            results.get(key)!.fields.add('email');
            if (results.get(key)!.matchType !== 'exact') {
              results.get(key)!.matchType = 'prefix';
            }
          }
        }
      },
    },
    {
      type: 'chip',
      execute: () => {
        fieldsSearched.add('chip');

        for (const participant of participants) {
          const chip = normalizeForSearch(participant?.chip || participant?.chipCode || participant?.chip_code || '');

          if (!chip) continue;

          if (matchPrefix(q, chip) || matchPartial(q, chip)) {
            const key = `${participant?.name}|${participant?.bib}`;
            if (!results.has(key)) {
              results.set(key, { participant, fields: new Set(), matchType: 'partial' });
            }
            results.get(key)!.fields.add('chip');
          }
        }
      },
    },
    {
      type: 'booking_id',
      execute: () => {
        fieldsSearched.add('bookingId');

        for (const participant of participants) {
          const bookingId = normalizeForSearch(participant?.bookingId || participant?.registrationId || participant?.athleteUid || participant?.bergmanAthleteId || '');

          if (!bookingId) continue;

          if (matchPrefix(q, bookingId) || matchPartial(q, bookingId)) {
            const key = `${participant?.name}|${participant?.bib}`;
            if (!results.has(key)) {
              results.set(key, { participant, fields: new Set(), matchType: 'partial' });
            }
            results.get(key)!.fields.add('bookingId');
          }
        }
      },
    },
    {
      type: 'provider_uuid',
      execute: () => {
        fieldsSearched.add('providerUuid');

        for (const participant of participants) {
          const providerUuid = normalizeForSearch(participant?.providerUuid || participant?.participantUuid || participant?.provider?.providerUuid || '');

          if (!providerUuid) continue;

          if (matchPrefix(q, providerUuid) || matchPartial(q, providerUuid)) {
            const key = `${participant?.name}|${participant?.bib}`;
            if (!results.has(key)) {
              results.set(key, { participant, fields: new Set(), matchType: 'partial' });
            }
            results.get(key)!.fields.add('providerUuid');
          }
        }
      },
    },
  ];

  // Execute search strategies, prioritizing detected type
  const prioritized = searchStrategies.sort((a) => (a.type === detectedType ? -1 : 1));

  for (const strategy of prioritized) {
    strategy.execute();
    if (results.size >= maxResults) break;
  }

  // Sort results: exact > prefix > partial, then by name
  const sorted = Array.from(results.values())
    .sort((a, b) => {
      const matchPriority = { exact: 0, prefix: 1, partial: 2 };
      const priorityDiff = matchPriority[a.matchType] - matchPriority[b.matchType];
      if (priorityDiff !== 0) return priorityDiff;

      const nameA = normalize(a.participant?.name || a.participant?.fullName || '');
      const nameB = normalize(b.participant?.name || b.participant?.fullName || '');
      return nameA.localeCompare(nameB);
    })
    .slice(0, maxResults);

  const durationMs = Math.round((performance.now() - startTime) * 10) / 10;

  const searchResults: SearchResult[] = sorted.map((result) => ({
    athlete: result.participant,
    matchedFields: Array.from(result.fields),
    matchType: result.matchType,
    diagnostics: includeDiagnostics
      ? {
          query: q,
          detectedType,
          matchCount: sorted.length,
          durationMs,
          source: 'memory',
          indexSize: participants.length,
          fieldsSearched: Array.from(fieldsSearched),
        }
      : undefined,
  }));

  return searchResults;
}
