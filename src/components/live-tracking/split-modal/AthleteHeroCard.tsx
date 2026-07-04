import { formatSecondsToHMS } from '@/lib/utils';
import type { LiveAthlete } from '@/lib/types';
import type { SplitModalModel } from './types';
import { getCountryFlagEmoji, getInitialsFallback, getRankChip, resolveAthleteAgeGroup, resolveAthleteCountry } from './utils';
import { RankingChip } from './presentation';

export default function AthleteHeroCard({ athlete, model }: { athlete: LiveAthlete; model: SplitModalModel }) {
  const profile = model.participantProfile;
  const flagEmoji = getCountryFlagEmoji(profile.country || resolveAthleteCountry(athlete));
  const ageGroupText = profile.ageGroup === '—' ? 'Not assigned' : profile.ageGroup;
  const isNotStarted = model.isNotStarted;

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950/95 to-slate-900/80 p-4 shadow-xl shadow-black/10">
      <div className="flex w-full min-w-0 flex-col gap-3">
        <div className="flex w-full min-w-0 items-start gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-xl font-bold text-white shadow-md sm:h-16 sm:w-16 sm:text-2xl">
            {getInitialsFallback(athlete.name)}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="min-w-0">
                <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-white sm:text-2xl">
                  {flagEmoji ? <span className="shrink-0 text-2xl leading-none" aria-hidden="true">{flagEmoji}</span> : null}
                  <span className="truncate">{profile.name || athlete.name}</span>
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <RankingChip label="Bib" value={String(profile.bib || athlete.bib || '—')} />
                </div>
              </div>
            </div>

            <div className="grid min-w-0 grid-cols-1 gap-1 text-sm text-slate-300 sm:grid-cols-2">
              <div className="min-w-0 truncate">{profile.gender || '—'}</div>
              <div className="min-w-0 truncate">{profile.category || '—'}</div>
              <div className="min-w-0 truncate">{ageGroupText}</div>
              <div className="min-w-0 truncate">Start {profile.startTime ? new Date(profile.startTime * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</div>
              <div className="min-w-0 truncate">Contest Date {profile.contestDate || profile.contestEtd || '—'}</div>
              <div className="min-w-0 truncate">ETD {profile.contestEtd || profile.contestDate || '—'}</div>
            </div>

            {!isNotStarted ? (
              <div className="flex min-w-0 flex-wrap gap-2">
                <RankingChip label="Overall" value={getRankChip(model.rankSummary.overall)} />
                <RankingChip label="Gender" value={getRankChip(model.rankSummary.gender)} />
                <RankingChip label="AG" value={getRankChip(model.rankSummary.category)} />
                <RankingChip label="Chip" value={formatSecondsToHMS(model.totalRaceTimeSeconds || null)} />
                <RankingChip label="Gun" value={formatSecondsToHMS(model.totalRaceTimeSeconds || null)} />
              </div>
            ) : null}

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] ${isNotStarted ? 'border border-slate-600 bg-slate-800 text-slate-200' : 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-300'}`}>
                <span className={`h-2 w-2 rounded-full ${isNotStarted ? 'bg-slate-400' : 'animate-pulse bg-emerald-400'}`} />
                {isNotStarted ? 'NOT STARTED' : 'LIVE'}
              </span>
              <span className="text-xs text-slate-400">Updated {model.lastUpdatedSeconds} sec ago</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
