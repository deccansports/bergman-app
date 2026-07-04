'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { sendAiSensyMessage } from '@/lib/auth/aisensyService';
import { sendRawHtmlEmail } from '@/lib/auth/brevoService';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV, putKV } from '../cloudflare/kv';
import type { RaceResult, RankedAthlete } from '../types';
import { normalizeStatus } from '@/lib/utils';
import { _internal_fetchAllRaceDataFromKV } from './publicResultActions';

export interface BelPageContent {
  season: string;
  title: string;
  officialCopy: string[];
  recognitionTiers: Array<{ tier: string; rule: string }>;
  currentDataFit: string[];
  systemUpgrades: {
    athleteBadges: string[];
    raceDayBenefits: string[];
    websiteUpgrade: string[];
    uiStructure: string[];
    clubRankingFormula: string;
    minStartsRule: string;
    brandPositioning: string;
  };
}

export interface BelSeasonMeta {
  season: number;
  totalRankedAthletes: number;
  eligibleAthletes: number;
  provisionalAthletes: number;
  goldAthletes: number;
  silverAthletes: number;
  bronzeAthletes: number;
  noTierAthletes: number;
  lastSyncedAt: string;
  source: 'results-kv';
}

export interface BelRankedAthlete extends RankedAthlete {
  belTier: 'Gold' | 'Silver' | 'Bronze' | 'Provisional' | 'No Tier';
  belQualified: boolean;
}

type BelCampaignTier = 'all' | 'gold' | 'silver' | 'bronze' | 'provisional' | 'qualified';

const FALLBACK_BEL_2025: BelPageContent = {
  season: '2025',
  title: 'Bergman Elite League (BEL) – 2025 Season',
  officialCopy: [
    'The Bergman Elite League (BEL) celebrates the top-performing endurance athletes across Bergman events each season.',
    'Athletes earn ranking points based on their performances throughout the calendar year. Each athlete’s best race results are considered, and total points determine their standing within their age group and globally.',
    'At the end of the season, athletes are ranked and recognized within their respective categories.',
  ],
  recognitionTiers: [
    { tier: 'Elite Gold', rule: 'Top 3 athletes in each age group' },
    { tier: 'Elite Silver', rule: 'Next 5 athletes in each age group' },
    { tier: 'Elite Bronze', rule: 'Next 10 athletes in each age group' },
  ],
  currentDataFit: ['Total Points', 'Starts', 'Category Rank', 'Overall Rank'],
  systemUpgrades: {
    athleteBadges: ['GOLD badge', 'SILVER badge', 'BRONZE badge'],
    raceDayBenefits: ['Early registration access', 'Priority bike racking', 'Special swim cap'],
    websiteUpgrade: ['Search athlete', 'Filter by gender', 'Filter by age group', 'Filter by club', 'Highlight Top 3 with premium UI'],
    uiStructure: ['Top Male', 'Top Female', 'Age-group tables'],
    clubRankingFormula: 'clubPoints = sum(all athlete points in club)',
    minStartsRule: 'minimumStarts = 2; provisional requires at least 1 finished race and minimum 499 points, otherwise No Tier.',
    brandPositioning:
      'Bergman Elite League recognizes consistent performers across India’s most competitive endurance events.',
  },
};

export async function getBelSeasonContentAction(
  season = 2025
): Promise<{ success: boolean; source: 'kv' | 'fallback'; content: BelPageContent; message: string }> {
  const actionName = 'getBelSeasonContentAction';
  const key = `content:bel:${season}`;

  const fromKv = await getKV<BelPageContent>(key, actionName);
  if (fromKv) {
    return {
      success: true,
      source: 'kv',
      content: fromKv,
      message: `Loaded BEL ${season} content from KV.`,
    };
  }

  return {
    success: true,
    source: 'fallback',
    content: FALLBACK_BEL_2025,
    message: `KV empty for BEL ${season}, using fallback content.`,
  };
}

function getBelTier(categoryRank: number, racesFinished: number, totalPoints: number): BelRankedAthlete['belTier'] {
  if (racesFinished < 2) {
    return racesFinished >= 1 && totalPoints >= 499 ? 'Provisional' : 'No Tier';
  }
  if (categoryRank <= 3) return 'Gold';
  if (categoryRank <= 8) return 'Silver';
  if (categoryRank <= 18) return 'Bronze';
  return 'No Tier';
}

function filterBelRecipients(rankings: BelRankedAthlete[], targetTier: BelCampaignTier): BelRankedAthlete[] {
  switch (targetTier) {
    case 'gold':
      return rankings.filter((athlete) => athlete.belTier === 'Gold');
    case 'silver':
      return rankings.filter((athlete) => athlete.belTier === 'Silver');
    case 'bronze':
      return rankings.filter((athlete) => athlete.belTier === 'Bronze');
    case 'provisional':
      return rankings.filter((athlete) => athlete.belTier === 'Provisional');
    case 'qualified':
      return rankings.filter((athlete) => athlete.belQualified);
    case 'all':
    default:
      return rankings;
  }
}

function replaceBelPlaceholders(template: string, athlete: BelRankedAthlete, season: number): string {
  let output = template;
  const replacements: Record<string, string> = {
    '{{name}}': athlete.name || 'Athlete',
    '{{first_name}}': athlete.name?.split(' ')[0] || 'Athlete',
    '{{email}}': athlete.email || '',
    '{{mobile}}': athlete.mobile || '',
    '{{club_name}}': athlete.clubName || 'Independent',
    '{{country}}': athlete.country || '',
    '{{gender}}': athlete.gender || '',
    '{{age_category}}': athlete.ageCategory || 'Open',
    '{{tier}}': athlete.belTier,
    '{{total_points}}': String(athlete.totalPoints || 0),
    '{{starts}}': String(athlete.racesFinished || 0),
    '{{overall_rank}}': String(athlete.overallRank || ''),
    '{{category_rank}}': String(athlete.categoryRank || ''),
    '{{season}}': String(season),
  };

  for (const [key, value] of Object.entries(replacements)) {
    output = output.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), value);
  }

  return output;
}

export async function getBelSeasonLeaderboardAction(
  season = 2025
): Promise<{
  success: boolean;
  source: 'bel-kv' | 'synced' | 'empty';
  rankings: BelRankedAthlete[];
  meta: BelSeasonMeta | null;
  message: string;
}> {
  const actionName = 'getBelSeasonLeaderboardAction';
  let [rankings, meta] = await Promise.all([
    getKV<BelRankedAthlete[]>(`bel:season:${season}:rankings`, actionName),
    getKV<BelSeasonMeta>(`bel:season:${season}:meta`, actionName),
  ]);

  // If KV is empty, try to sync from Firestore
  if (!rankings || rankings.length === 0) {
    try {
      const syncResult = await syncBelSeasonFromResultsKVAction(season);
      console.log(`[${actionName}] Synced BEL season ${season} from Firestore:`, syncResult.message);
      
      [rankings, meta] = await Promise.all([
        getKV<BelRankedAthlete[]>(`bel:season:${season}:rankings`, actionName),
        getKV<BelSeasonMeta>(`bel:season:${season}:meta`, actionName),
      ]);
      
      if (!rankings || rankings.length === 0) {
        return {
          success: true,
          source: 'empty',
          rankings: [],
          meta: null,
          message: `BEL ${season} leaderboard is empty after sync attempt.`,
        };
      }
      
      return {
        success: true,
        source: 'synced',
        rankings,
        meta: meta || null,
        message: `BEL ${season} leaderboard synced from Firestore.`,
      };
    } catch (err: any) {
      console.warn(`[${actionName}] Failed to sync BEL season from Firestore:`, err?.message || err);
      return {
        success: true,
        source: 'empty',
        rankings: [],
        meta: null,
        message: `BEL ${season} leaderboard KV is empty and sync failed.`,
      };
    }
  }

  return {
    success: true,
    source: 'bel-kv',
    rankings,
    meta: meta || null,
    message: `BEL ${season} leaderboard loaded from KV.`,
  };
}

export async function syncBelSeasonFromResultsKVAction(
  season = 2025
): Promise<{
  success: boolean;
  message: string;
  rankings?: BelRankedAthlete[];
  meta?: BelSeasonMeta;
}> {
  const actionName = 'syncBelSeasonFromResultsKVAction';

  try {
    const raceResult = await _internal_fetchAllRaceDataFromKV();
    if (!raceResult.success) {
      return { success: false, message: raceResult.message };
    }

    const races = (raceResult.races || []).filter((race: RaceResult) => {
      const raceYear = Number(race.raceYear || (race.raceDate ? new Date(race.raceDate).getFullYear() : 0));
      return raceYear === season && !!race.athleteUid && normalizeStatus(race.status) === 'Finished';
    });

    const athletesMap = new Map<string, RankedAthlete>();

    for (const race of races) {
      const athleteId = race.athleteUid as string;
      const existing = athletesMap.get(athleteId);
      if (!existing) {
        athletesMap.set(athleteId, {
          athleteId,
          name: race.name,
          email: race.email || null,
          mobile: race.mobile || null,
          clubName: (race as any).clubNameAtRace || null,
          country: (race as any).countryAtRace || null,
          totalPoints: race.pointsAwarded || 0,
          racesFinished: 1,
          overallRank: 0,
          gender: String(race.gender || 'Unknown'),
          ageCategory: race.category || null,
          categoryRank: 0,
          totalInCategory: 0,
          photoURL: null,
          races: [race],
        });
        continue;
      }

      existing.totalPoints += race.pointsAwarded || 0;
      existing.racesFinished += 1;
      existing.races.push(race);
      if (!existing.clubName && (race as any).clubNameAtRace) existing.clubName = (race as any).clubNameAtRace;
      if (!existing.country && (race as any).countryAtRace) existing.country = (race as any).countryAtRace;
    }

    const rankedList = Array.from(athletesMap.values()).sort(
      (a, b) => (b.totalPoints || 0) - (a.totalPoints || 0) || a.name.localeCompare(b.name)
    );

    const belRankings: BelRankedAthlete[] = rankedList.map((athlete, index) => {
      const genderRanked = rankedList.filter((entry) => entry.gender === athlete.gender);
      const categoryRanked = genderRanked.filter((entry) => entry.ageCategory === athlete.ageCategory);
      const categoryRank = categoryRanked.findIndex((entry) => entry.athleteId === athlete.athleteId) + 1;
      const belTier = getBelTier(categoryRank, athlete.racesFinished || 0, athlete.totalPoints || 0);

      return {
        ...athlete,
        overallRank: index + 1,
        categoryRank,
        totalInCategory: categoryRanked.length,
        genderOverallRank: {
          rank: genderRanked.findIndex((entry) => entry.athleteId === athlete.athleteId) + 1,
          total: genderRanked.length,
        },
        belTier,
        belQualified: belTier !== 'Provisional' && belTier !== 'No Tier',
      };
    });

    const meta: BelSeasonMeta = {
      season,
      totalRankedAthletes: belRankings.length,
      eligibleAthletes: belRankings.filter((a) => a.racesFinished >= 2 && (a.totalPoints || 0) > 0).length,
      provisionalAthletes: belRankings.filter((a) => a.belTier === 'Provisional').length,
      goldAthletes: belRankings.filter((a) => a.belTier === 'Gold').length,
      silverAthletes: belRankings.filter((a) => a.belTier === 'Silver').length,
      bronzeAthletes: belRankings.filter((a) => a.belTier === 'Bronze').length,
      noTierAthletes: belRankings.filter((a) => a.belTier === 'No Tier').length,
      lastSyncedAt: new Date().toISOString(),
      source: 'results-kv',
    };

    await Promise.all([
      putKV(`bel:season:${season}:rankings`, belRankings, actionName),
      putKV(`bel:season:${season}:meta`, meta, actionName),
    ]);

    return {
      success: true,
      message: `BEL ${season} synced from results KV to BEL KV for ${belRankings.length} athletes.`,
      rankings: belRankings,
      meta,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || `Failed to sync BEL ${season}.`,
    };
  }
}

export async function sendBelEmailCampaignAction(
  season: number,
  input: {
    targetTier: BelCampaignTier;
    subject: string;
    htmlContent: string;
  }
): Promise<{ success: boolean; message: string; stats?: { targeted: number; sent: number; failed: number; skipped: number } }> {
  const actionName = 'sendBelEmailCampaignAction';

  try {
    if (!input.subject?.trim() || !input.htmlContent?.trim()) {
      return { success: false, message: 'Subject and HTML content are required.' };
    }

    const rankings = await getKV<BelRankedAthlete[]>(`bel:season:${season}:rankings`, actionName);
    if (!rankings?.length) {
      return { success: false, message: `BEL ${season} leaderboard is empty.` };
    }

    const recipients = filterBelRecipients(rankings, input.targetTier);
    const db = getFirestoreInstance();
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const athlete of recipients) {
      if (!athlete.email) {
        skipped += 1;
        continue;
      }

      const subject = replaceBelPlaceholders(input.subject, athlete, season);
      const htmlContent = replaceBelPlaceholders(input.htmlContent, athlete, season);
      const footer = `<hr><p style="font-size:12px;color:#666;text-align:center">Bergman Elite League ${season}</p>`;
      const success = await sendRawHtmlEmail(athlete.email, subject, `${htmlContent}${footer}`, null);

      await db.collection('campaignLogs').add({
        recipientEmail: athlete.email,
        recipientName: athlete.name,
        subject,
        campaignType: 'bel-email',
        campaignName: `BEL ${season} ${input.targetTier}`,
        sentAt: FieldValue.serverTimestamp(),
        status: success ? 'Success' : 'Failed',
        sentBy: 'Admin',
      });

      if (success) sent += 1;
      else failed += 1;
    }

    revalidatePath('/admin/dashboard');
    return {
      success: sent > 0,
      message: `BEL email campaign finished. Sent: ${sent}, Failed: ${failed}, Skipped: ${skipped}.`,
      stats: { targeted: recipients.length, sent, failed, skipped },
    };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to send BEL email campaign.' };
  }
}

export async function sendBelWhatsAppCampaignAction(
  season: number,
  input: {
    targetTier: BelCampaignTier;
    campaignName: string;
    templateParams: string[];
  }
): Promise<{ success: boolean; message: string; stats?: { targeted: number; sent: number; failed: number; skipped: number } }> {
  const actionName = 'sendBelWhatsAppCampaignAction';

  try {
    if (!input.campaignName?.trim()) {
      return { success: false, message: 'WhatsApp campaign name is required.' };
    }

    const rankings = await getKV<BelRankedAthlete[]>(`bel:season:${season}:rankings`, actionName);
    if (!rankings?.length) {
      return { success: false, message: `BEL ${season} leaderboard is empty.` };
    }

    const recipients = filterBelRecipients(rankings, input.targetTier);
    const db = getFirestoreInstance();
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const athlete of recipients) {
      if (!athlete.mobile) {
        skipped += 1;
        continue;
      }

      const finalParams = input.templateParams.map((value) => replaceBelPlaceholders(value, athlete, season));
      const result = await sendAiSensyMessage(
        athlete.mobile,
        input.campaignName,
        finalParams,
        `BEL ${season} WhatsApp Campaign`,
        actionName,
        athlete.name
      );

      await db.collection('whatsappLogs').add({
        recipientMobile: athlete.mobile,
        recipientName: athlete.name,
        templateName: input.campaignName,
        eventName: `BEL ${season}`,
        campaignType: 'bel-whatsapp',
        sentAt: FieldValue.serverTimestamp(),
        status: result.success ? 'Success' : 'Failed',
        sentBy: 'Admin',
      });

      if (result.success) sent += 1;
      else failed += 1;
    }

    revalidatePath('/admin/dashboard');
    return {
      success: sent > 0,
      message: `BEL WhatsApp campaign finished. Sent: ${sent}, Failed: ${failed}, Skipped: ${skipped}.`,
      stats: { targeted: recipients.length, sent, failed, skipped },
    };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to send BEL WhatsApp campaign.' };
  }
}
