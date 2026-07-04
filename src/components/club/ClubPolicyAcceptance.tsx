// src/components/club/ClubPolicyAcceptance.tsx
"use client";

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { FileText, CheckCircle2, ShieldCheck } from 'lucide-react';

interface ClubPolicyAcceptanceProps {
  accepted: boolean;
  onAcceptChange: (accepted: boolean) => void;
}

const POLICY_SECTIONS = [
  {
    number: '1',
    title: 'Purpose',
    content: `This policy defines the roles, responsibilities, and authority of Club Owners and Coaches within the Bergman Affiliate Club system, ensuring fair governance, transparency, and athlete development.`,
  },
  {
    number: '2',
    title: 'Eligibility to Create a Club',
    content: null,
    bullets: [
      'A Club Owner must be a verified individual or organization and provide valid contact details (email & mobile).',
      'A club will be considered active only when at least 3 affiliated athletes have earned points.',
      'Clubs not meeting this requirement will be marked as "Unranked".',
    ],
  },
  {
    number: '3',
    title: 'Club Ownership & Control',
    content: `The Club Owner/Coach has full authority to:`,
    bullets: [
      'Approve or reject athlete affiliation requests',
      'Manage athlete membership within the club',
      'Represent the club in Bergman rankings and competitions',
    ],
  },
  {
    number: '4',
    title: 'Athlete Management Rights',
    content: `Club Owners/Coaches may remove any affiliated athlete if the athlete is no longer part of the club or there is misconduct or policy violation.`,
    note: 'Points already earned by the athlete will remain with the club permanently. Removal does not affect past rankings.',
  },
  {
    number: '5',
    title: 'Athlete Data & Visibility',
    content: `Club Owners/Coaches will have access to athlete basic profile details (as permitted), registered events, and participation status (Registered / Completed / DNF / DNS). This access is provided strictly for coaching, performance tracking, and team planning.`,
  },
  {
    number: '6',
    title: 'Notifications & Communication',
    content: `Club Owners/Coaches will receive email notifications (and WhatsApp if enabled) when an athlete joins their club. Notifications include athlete name, registration confirmation, and relevant participation details.`,
  },
  {
    number: '7',
    title: 'Responsibilities of Club Owners',
    content: `Club Owners/Coaches must:`,
    bullets: [
      'Ensure genuine athlete memberships',
      'Maintain ethical practices and fair play',
      'Use athlete data responsibly and confidentially',
      'Avoid fake affiliations, unauthorized athlete additions, and misuse of athlete information',
    ],
  },
  {
    number: '8',
    title: 'Club Ranking Integrity',
    content: `Club rankings are based on points earned by affiliated athletes. Club Owners must not attempt to manipulate rankings or misrepresent athlete affiliations. Any violation may result in club disqualification or removal from the leaderboard.`,
  },
  {
    number: '9',
    title: 'Limitations of Authority',
    content: `Club Owners/Coaches cannot:`,
    bullets: [
      'Transfer points between clubs',
      'Claim points earned before athlete affiliation',
      'Override Bergman official results or rankings',
    ],
  },
  {
    number: '10',
    title: 'Compliance with Bergman Rules',
    content: `Club Owners/Coaches must comply with all Bergman event rules and the Affiliate Club Policy. Non-compliance may lead to suspension of the club or permanent removal from the Bergman system.`,
  },
  {
    number: '11',
    title: 'Rights of Bergman Organisers',
    content: `Bergman reserves the right to:`,
    bullets: [
      'Audit club data and athlete affiliations',
      'Suspend or remove clubs violating policies',
      'Modify rules without prior notice',
    ],
  },
  {
    number: '12',
    title: 'Acceptance of Policy',
    content: `By creating or managing a club, the Club Owner/Coach agrees to abide by this policy.`,
  },
];

export function ClubPolicyAcceptance({ accepted, onAcceptChange }: ClubPolicyAcceptanceProps) {
  const [isPolicyOpen, setIsPolicyOpen] = useState(false);

  return (
    <>
      {/* Compact acceptance block */}
      <div className="border rounded-xl bg-orange-50/60 border-orange-200 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
          <div className="space-y-1 flex-1">
            <p className="text-xs font-black uppercase tracking-widest text-orange-600">Bergman Club Owner / Coach Policy</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              By creating a club, you agree to Bergman&apos;s Club Owner &amp; Coach Policy — covering eligibility, athlete management, data usage, ranking integrity, and compliance.
            </p>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-xs font-bold text-orange-600 hover:text-orange-700 underline-offset-2"
              onClick={() => setIsPolicyOpen(true)}
            >
              Read Full Policy →
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-orange-200">
          <Checkbox
            id="club-policy-accept"
            checked={accepted}
            onCheckedChange={(checked) => onAcceptChange(checked === true)}
            className="border-orange-400 data-[state=checked]:bg-orange-600 data-[state=checked]:border-orange-600 flex-shrink-0"
          />
          <Label htmlFor="club-policy-accept" className="text-xs font-semibold cursor-pointer leading-relaxed">
            I have read and accept the{' '}
            <button
              type="button"
              onClick={() => setIsPolicyOpen(true)}
              className="text-orange-600 font-black hover:underline focus:outline-none"
            >
              Bergman Club Owner / Coach Policy
            </button>
          </Label>
        </div>
      </div>

      {/* Full policy dialog */}
      <Dialog open={isPolicyOpen} onOpenChange={setIsPolicyOpen}>
        <DialogContent className="max-w-2xl rounded-2xl p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b bg-gradient-to-r from-orange-50 to-amber-50">
            <DialogTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
              <FileText className="h-5 w-5 text-orange-600 flex-shrink-0" />
              Bergman Club Owner / Coach Policy
            </DialogTitle>
            <p className="text-xs text-muted-foreground font-medium mt-1">
              Please read and understand the following policy before creating your club.
            </p>
          </DialogHeader>

          <ScrollArea className="max-h-[62vh]">
            <div className="px-6 py-5 space-y-5">
              {POLICY_SECTIONS.map((section) => (
                <div key={section.number} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-black flex-shrink-0">
                      {section.number}
                    </span>
                    <h4 className="text-sm font-black uppercase tracking-wide text-foreground">
                      {section.title}
                    </h4>
                  </div>
                  {section.content && (
                    <p className="text-xs text-muted-foreground leading-relaxed pl-7">
                      {section.content}
                    </p>
                  )}
                  {section.bullets && (
                    <ul className="pl-7 space-y-1">
                      {section.bullets.map((bullet, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                          <span className="text-orange-500 mt-0.5 flex-shrink-0">•</span>
                          <span className="leading-relaxed">{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {section.note && (
                    <div className="pl-7">
                      <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
                        ⚠️ {section.note}
                      </p>
                    </div>
                  )}
                  {parseInt(section.number) < POLICY_SECTIONS.length && (
                    <div className="pl-7 border-b border-border/50" />
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter className="px-6 py-4 border-t bg-muted/20 flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsPolicyOpen(false)}
              className="rounded-xl text-xs font-bold uppercase tracking-widest"
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={() => {
                onAcceptChange(true);
                setIsPolicyOpen(false);
              }}
              className="bg-orange-600 hover:bg-orange-700 text-white font-black uppercase tracking-widest rounded-xl"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              I Accept This Policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
