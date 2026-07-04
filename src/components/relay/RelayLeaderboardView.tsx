'use client';

import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatSecondsToHMS } from '@/lib/utils';
import { getRoleLabel } from '@/lib/utils/relayTimingUtils';
import type { EventParticipant } from '@/lib/types';

interface RelayTeamResult {
  teamBib: string;
  teamName: string;
  rank: number;
  swimTime?: number;
  bikeTime?: number;
  runTime?: number;
  totalTime: number;
  status: 'Finished' | 'DNF' | 'DNS' | 'In Progress';
  participants: {
    role: 'swim' | 'bike' | 'run';
    name: string;
    bib: string;
    legTime?: number;
  }[];
}

interface RelayLeaderboardViewProps {
  teams: RelayTeamResult[];
  showParticipantDetails?: boolean;
}

export function RelayLeaderboardView({
  teams,
  showParticipantDetails = true,
}: RelayLeaderboardViewProps) {
  if (!teams || teams.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No relay teams found
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-12 text-center font-bold">Rank</TableHead>
              <TableHead className="font-bold">Team</TableHead>
              <TableHead className="text-center font-bold">Swim</TableHead>
              <TableHead className="text-center font-bold">Bike</TableHead>
              <TableHead className="text-center font-bold">Run</TableHead>
              <TableHead className="text-right font-bold">Total Time</TableHead>
              <TableHead className="text-center font-bold">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.map((team) => (
              <React.Fragment key={team.teamBib}>
                <TableRow className="hover:bg-muted/50 transition-colors">
                  <TableCell className="text-center font-bold text-lg w-12">
                    {team.rank}
                  </TableCell>
                  <TableCell className="font-semibold">
                    <div className="flex flex-col gap-1">
                      <span>{team.teamName}</span>
                      <span className="text-xs text-muted-foreground">Bib: {team.teamBib}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {team.swimTime !== undefined ? (
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold">
                          {formatSecondsToHMS(team.swimTime)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {team.participants.find((p) => p.role === 'swim')?.name}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {team.bikeTime !== undefined ? (
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold">
                          {formatSecondsToHMS(team.bikeTime)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {team.participants.find((p) => p.role === 'bike')?.name}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {team.runTime !== undefined ? (
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold">
                          {formatSecondsToHMS(team.runTime)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {team.participants.find((p) => p.role === 'run')?.name}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-bold text-base">
                    {team.status === 'Finished' ? (
                      formatSecondsToHMS(team.totalTime)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={
                        team.status === 'Finished'
                          ? 'default'
                          : team.status === 'DNF'
                            ? 'destructive'
                            : 'secondary'
                      }
                      className="text-xs"
                    >
                      {team.status}
                    </Badge>
                  </TableCell>
                </TableRow>

                {/* Participant Details Row (Optional) */}
                {showParticipantDetails && (
                  <TableRow className="bg-muted/20 hover:bg-muted/30">
                    <TableCell colSpan={7}>
                      <div className="py-3 grid grid-cols-3 gap-4 text-sm">
                        {team.participants.map((participant) => (
                          <div
                            key={participant.role}
                            className="flex flex-col gap-1 p-2 bg-card rounded border"
                          >
                            <div className="font-semibold">
                              {getRoleLabel(participant.role)}
                            </div>
                            <div className="text-xs">{participant.name}</div>
                            <div className="text-xs text-muted-foreground">
                              Bib: {participant.bib}
                            </div>
                            {participant.legTime !== undefined && (
                              <div className="text-xs mt-1 pt-1 border-t">
                                {formatSecondsToHMS(participant.legTime)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
