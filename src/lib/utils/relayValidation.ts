// src/lib/utils/relayValidation.ts
// Helper functions for relay validation (not server actions)

import type { RelayTeamRegistrationFormInput } from '@/lib/types';

export function validateRelayTeamRegistration(data: RelayTeamRegistrationFormInput): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const relayConfiguration = data.relayConfiguration || { type: 'three_athletes' as const };
  const sharedLegs = relayConfiguration.type === 'two_athletes_one_double_leg' ? relayConfiguration.sharedLegs : undefined;

  const sharedRoles: Array<'swim' | 'bike' | 'run'> =
    sharedLegs === 'SB'
      ? ['swim', 'bike']
      : sharedLegs === 'SR'
      ? ['swim', 'run']
      : sharedLegs === 'BR'
      ? ['bike', 'run']
      : [];

  // Check team name
  if (!data.teamName || data.teamName.trim().length === 0) {
    errors.push('Team name is required');
  }

  // Check participants count
  if (!data.participants || data.participants.length !== 3) {
    errors.push('Exactly 3 participants required (Swim, Bike, Run)');
  } else {
    // Check each participant
    const emails = new Set<string>();
    const mobiles = new Set<string>();

    data.participants.forEach((p, index) => {
      const roleLabel = ['Swim', 'Bike', 'Run'][index];
      const normalizedEmail = (p.email || '').trim().toLowerCase();
      const normalizedMobile = (p.mobile || '').trim();

      if (!p.name || p.name.trim().length === 0) {
        errors.push(`${roleLabel} - Name is required`);
      }

      if (!p.email || p.email.trim().length === 0) {
        errors.push(`${roleLabel} - Email is required`);
      } else {
        const role = p.role;
        const allowDuplicateForSharedAthlete =
          relayConfiguration.type === 'two_athletes_one_double_leg' &&
          sharedRoles.includes(role) &&
          data.participants.some(
            (other) =>
              other !== p &&
              sharedRoles.includes(other.role) &&
              (other.email || '').trim().toLowerCase() === normalizedEmail
          );

        if (emails.has(normalizedEmail) && !allowDuplicateForSharedAthlete) {
          errors.push(`${roleLabel} - Email must be unique across team members`);
        } else {
          emails.add(normalizedEmail);
        }
      }

      if (normalizedMobile) {
        const role = p.role;
        const allowDuplicateMobileForSharedAthlete =
          relayConfiguration.type === 'two_athletes_one_double_leg' &&
          sharedRoles.includes(role) &&
          data.participants.some(
            (other) =>
              other !== p &&
              sharedRoles.includes(other.role) &&
              (other.mobile || '').trim() === normalizedMobile
          );

        if (mobiles.has(normalizedMobile) && !allowDuplicateMobileForSharedAthlete) {
          errors.push(`${roleLabel} - Mobile number must be unique across team members`);
        } else {
          mobiles.add(normalizedMobile);
        }
      }
    });

    if (relayConfiguration.type === 'two_athletes_one_double_leg') {
      if (!sharedLegs) {
        errors.push('Relay configuration is invalid: shared legs are required');
      } else {
        const [r1, r2] = sharedRoles;
        const first = data.participants.find((p) => p.role === r1);
        const second = data.participants.find((p) => p.role === r2);
        if (!first || !second) {
          errors.push('Relay configuration is invalid: shared leg participants missing');
        } else {
          const sameEmail = (first.email || '').trim().toLowerCase() === (second.email || '').trim().toLowerCase();
          if (!sameEmail) {
            errors.push(`Shared legs (${sharedLegs}) must belong to the same athlete (email must match)`);
          }
        }
      }
    }
  }

  // Check event and ticket IDs
  if (!data.eventId || data.eventId.trim().length === 0) {
    errors.push('Event ID is required');
  }

  if (!data.ticketId || data.ticketId.trim().length === 0) {
    errors.push('Ticket ID is required');
  }

  if (!data.agreedRules) {
    errors.push('Must agree to rules and regulations');
  }

  if (!data.agreedWaiver) {
    errors.push('Must agree to event waiver');
  }

  if (!data.agreedCutoff) {
    errors.push('Must accept cut-off timings');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
