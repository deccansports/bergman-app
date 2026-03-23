
// src/lib/rewardsEngine.ts

export type RewardTier = 'Starter' | 'Bronze' | 'Silver' | 'Gold' | 'Legend';

export interface RewardConfig {
  tier: RewardTier;
  minPoints: number;
  maxPoints: number;
  discountPercent: number;
  label: string;
  color: string;
}

export const PERFORMANCE_REWARDS: RewardConfig[] = [
  {
    tier: 'Starter',
    minPoints: 0,
    maxPoints: 399,
    discountPercent: 0,
    label: 'Starter Tier',
    color: 'text-slate-500',
  },
  {
    tier: 'Bronze',
    minPoints: 400,
    maxPoints: 799,
    discountPercent: 5,
    label: 'Bronze Tier',
    color: 'text-amber-600',
  },
  {
    tier: 'Silver',
    minPoints: 800,
    maxPoints: 1399,
    discountPercent: 10,
    label: 'Silver Tier',
    color: 'text-slate-400',
  },
  {
    tier: 'Gold',
    minPoints: 1400,
    maxPoints: 1999,
    discountPercent: 15,
    label: 'Gold Tier',
    color: 'text-yellow-500',
  },
  {
    tier: 'Legend',
    minPoints: 2000,
    maxPoints: 100000,
    discountPercent: 20,
    label: 'Bergman Legend',
    color: 'text-primary',
  },
];

export function getRewardTierByPoints(points: number): RewardConfig {
  return (
    PERFORMANCE_REWARDS.find(
      (r) => points >= r.minPoints && points <= r.maxPoints
    ) || PERFORMANCE_REWARDS[0]
  );
}
