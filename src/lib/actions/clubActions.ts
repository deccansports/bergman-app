
// src/lib/actions/clubActions.ts
'use server';

import { getAuthInstance, getFirestoreInstance } from '../firebaseAdmin';
import { FieldValue, type Firestore, FieldPath, type QueryDocumentSnapshot, type DocumentData } from 'firebase-admin/firestore';
import type { Club, User, ClubRankingEntry, ClubAthleteContribution, ClubMemberPerformanceForAdmin, ClubDashboardData, ClubDashboardUpcomingRegistration, RaceResult, EventCalendarEntry, EventParticipant } from '@/lib/types';
import { serializeValue, normalizeStatus, serializeParticipantData, isTriathlonEvent, normalizeToE164 } from '@/lib/utils';
import { revalidatePath } from 'next/cache';
import { format, parseISO, isBefore, startOfDay, isEqual } from 'date-fns';
import {
  ClubSocialLinksUpdateSchema,
  type ClubSocialLinksUpdateActionInput,
  ClubUpdateSchema,
  type ClubUpdateFormInput,
} from '../schemas';
import { sendClubRegistrationConfirmationEmail, sendAthleteClubRemovalEmail, sendClubAffiliationNoticeToOwnerEmail, sendRawHtmlEmail, sendWelcomeEmail } from '../auth/brevoService';
import { _internal_fetchAllRaceDataFromFirestore } from './publicResultActions';
import { getKV, putKV, deleteKV } from '../cloudflare/kv';
import { runDataSyncAction, _mirrorParticipantToKV } from './dataSyncActions';
import { NO_CLUB_SELECTED_VALUE } from '../constants';

const MAX_MONTHLY_ENCOURAGEMENT_EMAILS = 2;

/**
 * CORE INTERNAL: Trigger KV mirror for a specific club
 */
export async function _syncClubToKV(clubId: string): Promise<void> {
    const actionName = '_syncClubToKV';
    try {
        const adminDb = getFirestoreInstance();
        const doc = await adminDb.collection('clubs').doc(clubId).get();
        if(doc.exists) {
            await putKV(`club:${clubId}`, serializeValue({ id: doc.id, ...doc.data() }), actionName);
        }
    } catch(e) { console.error(`[${actionName}] Failed:`, e); }
}

/**
 * CORE INTERNAL: Sync the club list to KV for public selectors
 */
export async function _syncClubsToKV(): Promise<void> {
    const actionName = '_syncClubsToKV';
    try {
        const adminDb = getFirestoreInstance();
        const snap = await adminDb.collection('clubs').orderBy('name', 'asc').get();
        const list = snap.docs.map(doc => ({ id: doc.id, name: doc.data().name }));
        await putKV('clubs:list', list, actionName);
    } catch(e) { console.error(`[${actionName}] Failed:`, e); }
}

/**
 * CORE LOGIC: COMPUTES CLUB RANKINGS.
 */
export async function _computeClubRankings({ year }: { year?: number } = {}) {
    const actionName = '_computeClubRankings';
    const displayYear = year || new Date().getFullYear();
    try {
        const { races } = await _internal_fetchAllRaceDataFromFirestore({ year: displayYear });
        const adminDb = getFirestoreInstance();
        const allClubsSnap = await adminDb.collection('clubs').get();
        const validClubsMap = new Map(allClubsSnap.docs.map(doc => [doc.id, doc.data()]));

        const clubMap = new Map<string, { 
            points: number, 
            races: number, 
            podiums: number,
            winners: number,
            latestRaceDate: string,
            athleteMap: Map<string, { points: number, count: number, name: string }> 
        }>();

        (races || []).forEach(r => {
            if (!isTriathlonEvent(r.raceCategory || r.eventCategory)) return;

            if (normalizeStatus(r.status) === "Finished" && (r.pointsAwarded || 0) > 0 && r.clubIdAtRace && r.clubIdAtRace !== NO_CLUB_SELECTED_VALUE) {
                const clubId = r.clubIdAtRace;
                if (!validClubsMap.has(clubId)) return;

                const cur = clubMap.get(clubId) || { 
                    points: 0, 
                    races: 0, 
                    podiums: 0, 
                    winners: 0, 
                    latestRaceDate: '', 
                    athleteMap: new Map() 
                };

                cur.points += r.pointsAwarded || 0;
                cur.races += 1;

                const cRank = parseInt(r.cRank || '0', 10);
                if (!isNaN(cRank) && cRank > 0) {
                    if (cRank <= 3) cur.podiums += 1;
                    if (cRank === 1) cur.winners += 1;
                }

                if (r.raceDate && (!cur.latestRaceDate || isBefore(parseISO(cur.latestRaceDate), parseISO(r.raceDate)))) {
                    cur.latestRaceDate = r.raceDate;
                }

                const athleteUid = r.athleteUid || r.emailLower; 
                const athData = cur.athleteMap.get(athleteUid) || { points: 0, count: 0, name: r.name || 'Athlete' };
                athData.points += r.pointsAwarded || 0;
                athData.count += 1;
                cur.athleteMap.set(athleteUid, athData);

                clubMap.set(clubId, cur);
            }
        });

        const entries: ClubRankingEntry[] = [];
        
        for (const doc of allClubsSnap.docs) {
            const clubId = doc.id;
            const clubData = doc.data();
            const stats = clubMap.get(clubId) || { points: 0, races: 0, podiums: 0, winners: 0, latestRaceDate: '', athleteMap: new Map() };
            
            const contributingAthletes: ClubAthleteContribution[] = Array.from(stats.athleteMap.entries()).map(([uid, data]) => ({
                athleteUid: uid,
                athleteName: data.name,
                pointsContributed: Math.round(data.points),
                racesFinished: data.count
            })).sort((a, b) => b.pointsContributed - a.pointsContributed);

            if (contributingAthletes.length > 0) {
                await putKV(`rankings:club:${clubId}:contributors:${displayYear}`, contributingAthletes, actionName);
            }

            entries.push({
                clubId: clubId, 
                clubName: clubData.name, 
                coachName: clubData.coach_name,
                totalPoints: Math.round(stats.points), 
                athleteCount: stats.athleteMap.size, 
                eventCount: stats.races,
                country: clubData.country || null, 
                city: clubData.city || null,
                state: clubData.state || null,
                logoUrl: clubData.logoUrl || null,
                email: clubData.email || null,
                instagramUrl: clubData.instagramUrl || null,
                facebookUrl: clubData.facebookUrl || null,
                contributingAthleteDetails: contributingAthletes
            });
        }

        const sortEntries = (a: any, b: any) => {
            if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
            return b.athleteCount - a.athleteCount;
        };

        const eligibleForRank = entries.filter(e => e.athleteCount >= 3).sort(sortEntries);
        const ineligible = entries.filter(e => e.athleteCount < 3).sort(sortEntries);
        
        const finalRankings = [
            ...eligibleForRank.map((e, i) => ({ ...e, overallRank: i + 1 })),
            ...ineligible.map(e => ({ ...e, overallRank: undefined })) 
        ];

        await putKV(`rankings:clubs:${displayYear}`, finalRankings, actionName);
        return { success: true, rankings: finalRankings };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getClubRankingData({ year }: { year?: number } = {}) {
    const displayYear = year || new Date().getFullYear();
    try {
        const rankings = await getKV<ClubRankingEntry[]>(`rankings:clubs:${displayYear}`, 'getClubRankingData');
        return { success: true, rankings: rankings || [], rankingYear: displayYear };
    } catch (e: any) {
        return { success: true, message: 'No data available.', rankings: [], rankingYear: displayYear };
    }
}

export async function getClubListAction(): Promise<{ success: boolean; clubs: { id: string; name: string }[] }> {
    const actionName = 'getClubListAction';
    try {
        const list = await getKV<{id: string, name: string}[]>('clubs:list', actionName);
        if (list) return { success: true, clubs: list };
        
        const adminDb = getFirestoreInstance();
        const snap = await adminDb.collection('clubs').orderBy('name', 'asc').get();
        const clubs = snap.docs.map(doc => ({ id: doc.id, name: doc.data().name }));
        return { success: true, clubs };
    } catch (e: any) { return { success: false, clubs: [] }; }
}

export async function getAllClubs(): Promise<{ success: boolean; message: string; clubs?: Club[] }> {
  try {
    const adminDb = getFirestoreInstance();
    const snap = await adminDb.collection('clubs').orderBy('name', 'asc').get();
    const clubs = snap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }) as Club);
    return { success: true, message: 'Clubs fetched.', clubs };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function deleteClubAction(clubId: string, ownerUid: string, message: string): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    const membersSnap = await adminDb.collection('users').where('clubId', '==', clubId).get();
    const batch = adminDb.batch();
    
    membersSnap.forEach(doc => {
      batch.update(doc.ref, {
        clubId: null,
        clubName: null,
        clubAffiliationDate: null,
        updatedAt: FieldValue.serverTimestamp()
      });
    });
    
    batch.delete(adminDb.collection('clubs').doc(clubId));
    batch.update(adminDb.collection('users').doc(ownerUid), {
      ownedClubId: null,
      ownedClubName: null,
      updatedAt: FieldValue.serverTimestamp()
    });
    
    await batch.commit();
    await _syncClubsToKV(); 

    const ownerSnap = await adminDb.collection('users').doc(ownerUid).get();
    const ownerEmail = ownerSnap.data()?.email;
    if (ownerEmail) {
        const subject = "Club Deactivated: Bergman Hub";
        const content = `<p>Hello,</p><p>Your club has been deactivated by the administrator.</p><p><strong>Reason:</strong> ${message}</p><p>Regards,<br/>The Bergman Team</p>`;
        await sendRawHtmlEmail(ownerEmail, subject, content);
    }

    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Club deleted and members de-affiliated.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function fetchClubMemberPerformanceForAdmin(clubId: string, year: string, _filter: 'active' | 'past'): Promise<{ success: boolean; message: string; membersWithPerformance?: any[]; clubPerformanceDetails?: any }> {
    try {
        const adminDb = getFirestoreInstance();
        const yearInt = parseInt(year);
        
        const membersSnap = await adminDb.collection('users').where('clubId', '==', clubId).get();
        const members = membersSnap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));

        const { races } = await _internal_fetchAllRaceDataFromFirestore({ year: yearInt });
        
        const membersWithPerformance = members.map(m => {
            const memberRaces = (races || []).filter(r => r.athleteUid === m.uid);
            const points = memberRaces.reduce((sum, r) => sum + (r.pointsAwarded || 0), 0);
            return {
                ...serializeValue(m),
                pointsEarnedForSelectedYear: points,
                racesFinishedInSelectedYear: memberRaces.length,
                clubRankForSelectedYear: 0
            };
        });

        const rankings = await getKV<any[]>(`rankings:clubs:${year}`, 'admin-view');
        const clubRank = rankings?.find(r => r.clubId === clubId);

        return { 
            success: true, 
            message: 'Fetched.', 
            membersWithPerformance,
            clubPerformanceDetails: clubRank || null
        };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function registerClubWithOwner(data: any): Promise<{ success: boolean; message: string }> {
    try {
        const adminAuth = getAuthInstance();
        const adminDb = getFirestoreInstance();
        
        const ownerMobile = normalizeToE164(data.ownerMobile);
        if (!ownerMobile) throw new Error("Owner mobile is required and must be valid.");

        const ownerRecord = await adminAuth.createUser({
            email: data.ownerLoginEmail,
            password: data.ownerPassword,
            displayName: data.ownerName,
            phoneNumber: ownerMobile
        }).catch((e: any) => {
            if (e.code === 'auth/email-already-exists' || e.code === 'auth/uid-already-exists') {
                throw new Error("account with This Email Already exist in the Bergman Athlete Hub please Sign in using email and password / Email Otp");
            }
            throw e;
        });

        const clubRef = adminDb.collection('clubs').doc();
        const clubData = {
            name: data.clubName,
            coach_name: data.ownerName,
            email: data.clubContactEmail,
            mobile: data.clubContactMobile,
            ownerUid: ownerRecord.uid,
            instagramUrl: data.instagramUrl || null,
            facebookUrl: data.facebookUrl || null,
            country: data.country || 'India',
            city: data.city || null,
            state: data.state || null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };
        await clubRef.set(clubData);

        await adminDb.collection('users').doc(ownerRecord.uid).set({
            uid: ownerRecord.uid,
            email: data.ownerLoginEmail,
            name: data.ownerName,
            mobile: ownerMobile,
            ownedClubId: clubRef.id,
            ownedClubName: data.clubName,
            clubId: clubRef.id,
            clubName: data.clubName,
            clubAffiliationDate: format(new Date(), 'yyyy-MM-dd'),
            emailVerified: true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        await _syncClubsToKV();
        await sendClubRegistrationConfirmationEmail(data.ownerLoginEmail, data.clubContactEmail, data.ownerName, data.clubName);

        return { success: true, message: "Club and owner account created successfully." };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function getRecentClubsAction(count: number): Promise<{ success: boolean; message: string; recentClubs?: Club[] }> {
    try {
        const adminDb = getFirestoreInstance();
        const snap = await adminDb.collection('clubs').orderBy('createdAt', 'desc').limit(count).get();
        const clubs = snap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }) as Club);
        return { success: true, message: 'Recent clubs fetched.', recentClubs: clubs };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function registerClubForExistingUser(userId: string, userName: string | null, data: any): Promise<{ success: boolean; message: string; club?: Club }> {
    try {
        const adminDb = getFirestoreInstance();
        const clubRef = adminDb.collection('clubs').doc();
        const now = new Date();
        const nowIso = now.toISOString();
        
        const clubData = {
            name: data.clubName,
            coach_name: data.coachName || userName || 'Coach',
            email: data.clubContactEmail,
            mobile: data.clubContactMobile,
            ownerUid: userId,
            country: data.country || 'India',
            city: data.city || null,
            state: data.state || null,
            instagramUrl: data.instagramUrl || null,
            facebookUrl: data.facebookUrl || null,
        };
        
        await clubRef.set({
            ...clubData,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        
        // Use set with merge true to handle both initial creation and updates
        await adminDb.collection('users').doc(userId).set({
            name: userName || data.coachName || 'Club Owner',
            nameLower: (userName || data.coachName || 'Club Owner').toLowerCase(),
            email: data.clubContactEmail.toLowerCase(),
            ownedClubId: clubRef.id,
            ownedClubName: data.clubName,
            clubId: clubRef.id,
            clubName: data.clubName,
            mobile: data.clubContactMobile,
            clubAffiliationDate: format(now, 'yyyy-MM-dd'),
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(), // Handled by merge
            emailVerified: true,
        }, { merge: true });

        await _syncClubsToKV();
        await sendClubRegistrationConfirmationEmail(data.clubContactEmail, data.clubContactEmail, userName || data.coachName || 'Owner', data.clubName);
        await sendWelcomeEmail(data.clubContactEmail, userName || data.coachName || 'Owner');
        
        revalidatePath('/club-dashboard'); 
        revalidatePath('/dashboard');
        
        return { 
            success: true, 
            message: 'Club registered.', 
            club: serializeValue({ 
                id: clubRef.id, 
                ...clubData, 
                createdAt: nowIso, 
                updatedAt: nowIso 
            }) as Club 
        };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getClubContributorsAction(clubId: string, year: number): Promise<{ success: boolean; message: string; contributors?: ClubAthleteContribution[] }> {
    const actionName = 'getClubContributorsAction';
    try {
        const contributors = await getKV<ClubAthleteContribution[]>(`rankings:club:${clubId}:contributors:${year}`, actionName);
        return { success: true, message: 'Fetched from KV.', contributors: contributors || [] };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function getClubDashboardDataAction(clubId: string, year: number): Promise<{ success: boolean; message: string; dashboard?: ClubDashboardData }> {
    const actionName = 'getClubDashboardDataAction';
    try {
        const club = await getKV<Club>(`club:${clubId}`, actionName);
        if (!club) throw new Error('Club not found.');

        const allRankingsResult = await getClubRankingData({ year });
        const clubRank = allRankingsResult.rankings?.find(r => r.clubId === clubId);
        
        const { races } = await _internal_fetchAllRaceDataFromFirestore({ year });
        const clubRaces = (races || []).filter(r => r.clubIdAtRace === clubId);

        const monthlyMap = new Map<string, number>();
        clubRaces.forEach(r => {
            if (!r.raceDate) return;
            const m = format(parseISO(r.raceDate), 'MMM');
            monthlyMap.set(m, (monthlyMap.get(m) || 0) + (r.pointsAwarded || 0));
        });
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        const adminDb = getFirestoreInstance();
        const membersSnap = await adminDb.collection('users').where('clubId', '==', clubId).get();
        const membersList = membersSnap.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => {
            const points = clubRaces.filter(r => r.athleteUid === doc.id).reduce((sum, r) => sum + (r.pointsAwarded || 0), 0);
            return {
                athleteUid: doc.id,
                athleteName: doc.data().name || 'Athlete',
                email: doc.data().email,
                photoURL: doc.data().photoURL || null,
                pointsContributed: Math.round(points),
                racesFinished: clubRaces.filter(r => r.athleteUid === doc.id).length
            };
        });

        const currentMonthKey = format(new Date(), 'yyyy-MM');
        const stats = club.encouragementEmailsSent || { month: currentMonthKey, count: 0 };
        const effectiveCount = stats.month === currentMonthKey ? stats.count : 0;

        const dashboard: ClubDashboardData = {
            club, totalPoints: clubRank?.totalPoints || 0, globalRank: clubRank?.overallRank,
            athleteCount: membersSnap.size, eventCount: clubRaces.length,
            podiums: { gold: 0, silver: 0, bronze: 0 }, upcomingRacesCount: 0,
            monthlyPerformance: months.map(m => ({ month: m, points: Math.round(monthlyMap.get(m) || 0) })),
            eventPerformance: [], topContributors: [], bestPerformer: null,
            upcomingRegistrations: [], members: membersList as any,
            emailStats: { sentThisMonth: effectiveCount, remaining: Math.max(0, MAX_MONTHLY_ENCOURAGEMENT_EMAILS - effectiveCount), totalLimit: MAX_MONTHLY_ENCOURAGEMENT_EMAILS }
        };

        return { success: true, message: 'Computed.', dashboard: serializeValue(dashboard) };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function _syncClubDataToKV(clubId: string, year: number): Promise<void> {
    await getClubDashboardDataAction(clubId, year);
}

export async function updateClubSocialLinks(args: ClubSocialLinksUpdateActionInput) {
  try {
    const adminDb = getFirestoreInstance();
    await adminDb.collection('clubs').doc(args.clubId).update({ 
        instagramUrl: args.instagramUrl || null, 
        facebookUrl: args.facebookUrl || null, 
        country: args.country || null, 
        city: args.city || null, 
        state: args.state || null, 
        updatedAt: FieldValue.serverTimestamp() 
    });
    
    await _syncClubToKV(args.clubId);
    
    revalidatePath('/club-dashboard');
    return { success: true, message: "Updated" };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function updateClubDetailsAction(clubId: string, data: ClubUpdateFormInput) {
    try {
        const adminDb = getFirestoreInstance();
        await adminDb.collection('clubs').doc(clubId).update({ ...data, updatedAt: FieldValue.serverTimestamp() });
        
        await _syncClubToKV(clubId);
        
        revalidatePath('/admin/dashboard'); revalidatePath('/club-dashboard');
        return { success: true, message: 'Updated' };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function updateClubLogoUrl(clubId: string, logoUrl: string) {
    try {
        const adminDb = getFirestoreInstance();
        await adminDb.collection('clubs').doc(clubId).update({ logoUrl, updatedAt: FieldValue.serverTimestamp() });
        
        await _syncClubToKV(clubId);
        
        revalidatePath('/club-dashboard');
        return { success: true, message: "Updated" };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function syncClubDataForEventParticipantsAction(eventId: string): Promise<{ success: boolean; message: string }> {
    try {
        const adminDb = getFirestoreInstance();
        const participantsSnapshot = await adminDb.collection('events').doc(eventId).collection('participants').get();
        const batch = adminDb.batch();
        let count = 0;
        const affectedParticipants: EventParticipant[] = [];

        for (const doc of participantsSnapshot.docs) {
            const p = doc.data();
            if (p.athleteUid) {
                const user = await adminDb.collection('users').doc(p.athleteUid).get();
                if (user.exists) {
                    const userData = user.data();
                    const clubId = (userData?.clubId === NO_CLUB_SELECTED_VALUE || !userData?.clubId) ? null : userData.clubId;
                    const clubName = clubId ? (userData?.clubName || null) : null;
                    
                    batch.update(doc.ref, { clubId, clubName, updatedAt: FieldValue.serverTimestamp() });
                    
                    const updatedParticipantData = {
                        ...serializeParticipantData(doc),
                        clubId,
                        clubName
                    };
                    affectedParticipants.push(updatedParticipantData);
                    count++;
                }
            }
        }
        
        if (count > 0) {
            await batch.commit();
            await Promise.all(affectedParticipants.map(p => _mirrorParticipantToKV(p)));
        }

        revalidatePath('/admin/dashboard');
        return { success: true, message: `Synced ${count} participants.` };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getAthletesByClubId(clubId: string) {
    try {
        const adminDb = getFirestoreInstance();
        const snapshot = await adminDb.collection('users').where('clubId', '==', clubId).get();
        return { success: true, athletes: snapshot.docs.map(doc => serializeValue({ uid: doc.id, ...doc.data() })) };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function syncClubUpcomingIndexAction(clubId: string) {
    const actionName = 'syncClubUpcomingIndexAction';
    try {
        const adminDb = getFirestoreInstance();
        const membersSnap = await adminDb.collection('users').where('clubId', '==', clubId).get();
        const memberUids = membersSnap.docs.map(d => d.id);
        await putKV(`club:${clubId}:members:index`, memberUids, actionName);
        return { success: true, message: `Synced ${memberUids.length} members.` };
    } catch(e: any) { return { success: false, message: e.message }; }
}

export async function removeAthleteFromClubAction(
  ownerUid: string,
  clubId: string,
  athleteUid: string,
  reason: string
): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    const clubRef = adminDb.collection('clubs').doc(clubId);
    const clubSnap = await clubRef.get();
    if (!clubSnap.exists) throw new Error("Club not found.");
    const clubData = clubSnap.data() as Club;

    if (clubData.ownerUid !== ownerUid) {
        const userRef = adminDb.collection('users').doc(ownerUid);
        const userSnap = await userRef.get();
        if (!userSnap.data()?.isAdmin) {
            throw new Error("Unauthorized: You must be the club owner or an admin.");
        }
    }

    const athleteRef = adminDb.collection('users').doc(athleteUid);
    const athleteSnap = await athleteRef.get();
    if (!athleteSnap.exists) throw new Error("Athlete profile not found.");
    const athleteData = athleteSnap.data() as User;

    await athleteRef.update({
        clubId: null,
        clubName: null,
        clubAffiliationDate: null,
        updatedAt: FieldValue.serverTimestamp()
    });

    if (athleteData.email) {
        await sendAthleteClubRemovalEmail(
            athleteData.email,
            athleteData.name || 'Athlete',
            clubData.name,
            'Club Owner',
            new Date().toISOString(),
            reason
        );
    }

    return { success: true, message: "Athlete removed from roster." };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function sendEncouragementEmailAction(clubId: string): Promise<{ success: boolean; message: string }> {
    const actionName = 'sendEncouragementEmailAction';
    try {
        const adminDb = getFirestoreInstance();
        const clubRef = adminDb.collection('clubs').doc(clubId);
        const clubSnap = await clubRef.get();
        if (!clubSnap.exists) throw new Error("Club not found.");
        const clubData = clubSnap.data() as Club;

        const now = new Date();
        const currentMonthKey = format(now, 'yyyy-MM');
        const stats = clubData.encouragementEmailsSent || { month: currentMonthKey, count: 0 };
        const effectiveCount = stats.month === currentMonthKey ? stats.count : 0;
        
        if (effectiveCount >= MAX_MONTHLY_ENCOURAGEMENT_EMAILS) {
            return { success: false, message: `Limit reached. Max ${MAX_MONTHLY_ENCOURAGEMENT_EMAILS} campaigns per month.` };
        }

        const memberUids = await getKV<string[]>(`club:${clubId}:members:index`, actionName) || [];
        if (memberUids.length === 0) return { success: true, message: "No club members found." };

        const calendar = await getKV<EventCalendarEntry[]>('calendar:snapshot', actionName) || [];
        const today = startOfDay(new Date());
        const upcomingEvents = calendar.filter(e => e.eventDate && e.eventDate !== 'TBD' && !isBefore(parseISO(e.eventDate!), today)).sort((a, b) => parseISO(a.eventDate!).getTime() - parseISO(b.eventDate!).getTime());
        const nextEventName = upcomingEvents[0]?.eventName || "upcoming Bergman races";

        const targetAthletes: { name: string; email: string }[] = [];

        for (const uid of memberUids) {
            const userEvents = await getKV<any[]>(`user:${uid}:events:index`, actionName) || [];
            const userProfile = await getKV<User>(`users:${uid}`, actionName);
            if (!userProfile?.email || userProfile.clubId !== clubId) continue;

            const hasUpcoming = userEvents.some(e => {
                const eventDateStr = (e.eventDate && e.eventDate !== 'TBD') ? e.eventDate : null;
                const d = eventDateStr ? parseISO(eventDateStr) : null;
                return e.ticketStatus === "Active" && (!d || !isBefore(d, today));
            });

            if (!hasUpcoming) targetAthletes.push({ name: userProfile.name || 'Athlete', email: userProfile.email });
        }

        if (targetAthletes.length === 0) return { success: true, message: "All members already registered." };

        const subject = `Represent ${clubData.name} – Let’s Climb to the Top`;
        for (const athlete of targetAthletes) {
            await sendRawHtmlEmail(athlete.email, subject, `<p>Dear ${athlete.name}, your team needs you at ${nextEventName}!</p>`);
        }

        const newStats = { month: currentMonthKey, count: effectiveCount + 1 };
        await clubRef.update({ encouragementEmailsSent: newStats, updatedAt: FieldValue.serverTimestamp() });
        await _syncClubToKV(clubId);

        return { success: true, message: `Sent to ${targetAthletes.length} athletes.` };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getClubRegistrationsAction(clubId: string): Promise<{ success: boolean; message: string; registrations?: ClubDashboardUpcomingRegistration[] }> {
    const actionName = 'getClubRegistrationsAction';
    try {
        const adminDb = getFirestoreInstance();
        const participantsSnap = await adminDb.collectionGroup('participants')
            .where('clubId', '==', clubId)
            .where('ticketStatus', 'in', ['Active', 'Confirmed'])
            .get();

        const registrations = participantsSnap.docs.map(doc => {
            const p = doc.data();
            return {
                athleteName: p.name,
                eventName: p.eventName,
                eventDate: p.eventDate,
                ticketName: p.ticketName,
                athleteBibNumber: p.bibNumber,
                bookingId: p.bookingId,
                athleteUid: p.athleteUid
            };
        });

        return { success: true, message: 'Fetched.', registrations: serializeValue(registrations) };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}
