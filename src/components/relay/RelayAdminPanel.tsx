'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { getRelayTeamsForEventAction, updateRelayTeamParticipantAction } from '@/lib/actions/relayRegistrationActions';
import type { RelayTeamRegistration, RelayTeamParticipant } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Edit2, Users, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getRoleLabel } from '@/lib/utils/relayTimingUtils';

interface RelayAdminPanelProps {
  eventId: string;
  eventName?: string;
}

export function RelayAdminPanel({ eventId, eventName }: RelayAdminPanelProps) {
  const { toast } = useToast();
  const [teams, setTeams] = useState<RelayTeamRegistration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingTeam, setEditingTeam] = useState<RelayTeamRegistration | null>(null);
  const [editingParticipantIndex, setEditingParticipantIndex] = useState<number | null>(null);
  const [editingParticipantData, setEditingParticipantData] = useState<Partial<RelayTeamParticipant> | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fetchTeams = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getRelayTeamsForEventAction(eventId);
      if (result.success && result.teams) {
        setTeams(result.teams);
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.message || 'Failed to fetch relay teams',
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to fetch relay teams',
      });
    } finally {
      setIsLoading(false);
    }
  }, [eventId, toast]);

  // Fetch teams
  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const handleEditParticipant = (team: RelayTeamRegistration, index: number) => {
    setEditingTeam(team);
    setEditingParticipantIndex(index);
    setEditingParticipantData({ ...team.participants[index] });
  };

  const handleSaveParticipant = async () => {
    if (!editingTeam || editingParticipantIndex === null || !editingParticipantData) {
      return;
    }

    setIsSaving(true);
    try {
      const role = editingTeam.participants[editingParticipantIndex].role;
      const result = await updateRelayTeamParticipantAction(
        editingTeam.id,
        role,
        editingParticipantData as RelayTeamParticipant
      );

      if (result.success) {
        toast({
          title: 'Success',
          description: 'Participant updated successfully',
        });

        // Update local state
        const updatedTeams = teams.map((t) => {
          if (t.id === editingTeam.id) {
            const updatedParticipants = [...t.participants];
            updatedParticipants[editingParticipantIndex] = {
              ...updatedParticipants[editingParticipantIndex],
              ...editingParticipantData,
            };
            return { ...t, participants: updatedParticipants as any };
          }
          return t;
        });
        setTeams(updatedTeams);

        setEditingTeam(null);
        setEditingParticipantIndex(null);
        setEditingParticipantData(null);
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.message,
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to save participant',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8 text-muted-foreground">
            No relay teams registered for this event
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> Relay Teams ({teams.length})
            </CardTitle>
            {eventName && (
              <p className="text-sm text-muted-foreground mt-1">{eventName}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchTeams}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Refresh'
            )}
          </Button>
        </CardHeader>

        <CardContent>
          <div className="space-y-6">
            {teams.map((team) => (
              <div
                key={team.id}
                className="border rounded-lg p-4 space-y-4 bg-card"
              >
                {/* Team Header */}
                <div className="flex items-start justify-between border-b pb-3">
                  <div>
                    <h3 className="font-bold text-lg">{team.teamName}</h3>
                    <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                      <span>Team Bib: <Badge variant="outline">{team.teamBib}</Badge></span>
                      <span>Status: <Badge variant={team.status === 'Completed' ? 'default' : 'secondary'}>{team.status}</Badge></span>
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-semibold">Created</div>
                    <div className="text-muted-foreground">
                      {team.createdAt
                        ? new Date(team.createdAt).toLocaleDateString()
                        : 'N/A'}
                    </div>
                  </div>
                </div>

                {/* Participants Table */}
                <div className="overflow-x-auto">
                  <Table className="text-sm">
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="font-bold">Role</TableHead>
                        <TableHead className="font-bold">Name</TableHead>
                        <TableHead className="font-bold">Email</TableHead>
                        <TableHead className="font-bold">Mobile</TableHead>
                        <TableHead className="font-bold">Bib</TableHead>
                        <TableHead className="text-center font-bold">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {team.participants.map((participant, idx) => (
                        <TableRow key={idx} className="hover:bg-muted/50">
                          <TableCell className="font-semibold">
                            {getRoleLabel(participant.role as 'swim' | 'bike' | 'run')}
                          </TableCell>
                          <TableCell>{participant.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {participant.email}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {participant.mobile || '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{participant.bib}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditParticipant(team, idx)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Created By */}
                <div className="text-xs text-muted-foreground border-t pt-3">
                  <span>Created by: {team.createdByName} ({team.createdByEmail})</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Edit Participant Dialog */}
      <Dialog
        open={!!editingTeam && editingParticipantIndex !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingTeam(null);
            setEditingParticipantIndex(null);
            setEditingParticipantData(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Participant</DialogTitle>
            <DialogDescription>
              Update participant details or replace with another athlete
            </DialogDescription>
          </DialogHeader>

          {editingTeam && editingParticipantIndex !== null && editingParticipantData && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-3">
                <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-blue-800">
                  Bib will remain: {editingTeam.participants[editingParticipantIndex].bib}
                </p>
              </div>

              <div>
                <Label htmlFor="edit-name" className="text-sm font-medium">
                  Name
                </Label>
                <Input
                  id="edit-name"
                  value={editingParticipantData.name || ''}
                  onChange={(e) =>
                    setEditingParticipantData({
                      ...editingParticipantData,
                      name: e.target.value,
                    })
                  }
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="edit-email" className="text-sm font-medium">
                  Email
                </Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editingParticipantData.email || ''}
                  onChange={(e) =>
                    setEditingParticipantData({
                      ...editingParticipantData,
                      email: e.target.value,
                    })
                  }
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="edit-mobile" className="text-sm font-medium">
                  Mobile
                </Label>
                <Input
                  id="edit-mobile"
                  type="tel"
                  value={editingParticipantData.mobile || ''}
                  onChange={(e) =>
                    setEditingParticipantData({
                      ...editingParticipantData,
                      mobile: e.target.value,
                    })
                  }
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="edit-dob" className="text-sm font-medium">
                  Date of Birth
                </Label>
                <Input
                  id="edit-dob"
                  type="date"
                  value={editingParticipantData.dob || ''}
                  onChange={(e) =>
                    setEditingParticipantData({
                      ...editingParticipantData,
                      dob: e.target.value,
                    })
                  }
                  className="mt-1"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditingTeam(null);
                setEditingParticipantIndex(null);
                setEditingParticipantData(null);
              }}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveParticipant}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
