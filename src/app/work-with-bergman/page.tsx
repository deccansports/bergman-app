"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import NextImage from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import jsPDF from 'jspdf';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Trophy, CalendarDays, Users, ArrowRight, Flame } from 'lucide-react';
import type { OpenRole } from '@/lib/types/workWithBergman';
import type { EventCalendarEntry } from '@/lib/types/event';
import { useAuth } from '@/context/AuthContext';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import {
  checkRecruitmentEligibilityAction,
  getAllApplicationsAction,
  getAllAssignments,
  getOpenRoles,
  submitWorkWithBergmanApplicationAction,
} from '@/lib/actions/workBergmanActions';

type StatusTone = 'idle' | 'success' | 'error';

function formatDate(value: string | Date | undefined): string {
  if (!value) return 'TBD';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return 'TBD';
  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateRange(start?: string | Date, end?: string | Date): string {
  const startLabel = formatDate(start);
  const endLabel = formatDate(end);
  if (startLabel === 'TBD' && endLabel === 'TBD') return 'TBD';
  if (startLabel === endLabel) return startLabel;
  if (startLabel === 'TBD') return endLabel;
  if (endLabel === 'TBD') return startLabel;
  return `${startLabel} - ${endLabel}`;
}

function parseAsTime(value: string | Date | undefined): number {
  if (!value) return Number.NaN;
  const parsed = new Date(String(value)).getTime();
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

export default function WorkWithBergmanPublicPage() {
  const { currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isLocalDevelopment = process.env.NODE_ENV !== 'production';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [stateValue, setStateValue] = useState('');
  const [pincode, setPincode] = useState('');
  const [gender, setGender] = useState('');
  const [tshirtSize, setTshirtSize] = useState('');
  const [skills, setSkills] = useState('');
  const [notes, setNotes] = useState('');

  const [roles, setRoles] = useState<OpenRole[]>([]);
  const [calendarEventsById, setCalendarEventsById] = useState<Record<string, EventCalendarEntry>>({});
  const [hiddenEventIds, setHiddenEventIds] = useState<string[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [firstPreferenceRoleId, setFirstPreferenceRoleId] = useState('');
  const [selectedRoleDetails, setSelectedRoleDetails] = useState<OpenRole | null>(null);
  const [roleDescriptionAcknowledged, setRoleDescriptionAcknowledged] = useState(false);
  const [availablePriorDays, setAvailablePriorDays] = useState(false);
  const [canTravel, setCanTravel] = useState<'yes' | 'no' | ''>('');
  const [needAccommodation, setNeedAccommodation] = useState<'yes' | 'no' | ''>('');
  const [agreeAccommodationPolicy, setAgreeAccommodationPolicy] = useState(false);
  const [agreeTravelPolicy, setAgreeTravelPolicy] = useState(false);

  const [accountName, setAccountName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [upiId, setUpiId] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [saveBankForFuture, setSaveBankForFuture] = useState(true);
  const [hasSavedBankDetails, setHasSavedBankDetails] = useState(false);
  const [editingSavedBankDetails, setEditingSavedBankDetails] = useState(false);

  const [agreeReadRole, setAgreeReadRole] = useState(false);
  const [agreeWaiverAgreement, setAgreeWaiverAgreement] = useState(false);
  const [agreeHonorariumTerms, setAgreeHonorariumTerms] = useState(false);
  const [agreePolicyCompliance, setAgreePolicyCompliance] = useState(false);
  const [agreeVoluntaryAcceptance, setAgreeVoluntaryAcceptance] = useState(false);

  const [saving, setSaving] = useState(false);
  const [checkingEligibility, setCheckingEligibility] = useState(false);
  const [eligibilityChecked, setEligibilityChecked] = useState(false);
  const [isEligible, setIsEligible] = useState(false);
  const [status, setStatus] = useState<{ tone: StatusTone; message: string }>({
    tone: 'idle',
    message: '',
  });

  const selectedEventQuery = String(searchParams.get('eventId') || '').trim();

  const eventOptions = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; minStart?: string; maxEnd?: string }>();
    const now = Date.now();

    for (const role of roles) {
      const eventId = String(role.eventId || '').trim();
      if (!eventId) continue;

      const eventMeta = calendarEventsById[eventId];
      const eventMetaStart = String(eventMeta?.eventDate || '').trim();
      const eventMetaEnd = String(eventMeta?.endDate || '').trim() || eventMetaStart;

      const current = grouped.get(eventId) || {
        id: eventId,
        name: String(eventMeta?.eventName || role.eventName || 'Untitled Event').trim() || 'Untitled Event',
      };

      const roleStart = String(role.startDate || '').trim();
      const roleEnd = String(role.endDate || '').trim();
      const currentMinTime = parseAsTime(current.minStart);
      const currentMaxTime = parseAsTime(current.maxEnd);
      const candidateStart = eventMetaStart || roleStart;
      const candidateEnd = eventMetaEnd || roleEnd || candidateStart;
      const roleStartTime = parseAsTime(candidateStart);
      const roleEndTime = parseAsTime(candidateEnd);

      if (!Number.isNaN(roleStartTime) && (Number.isNaN(currentMinTime) || roleStartTime < currentMinTime)) {
        current.minStart = candidateStart;
      }
      if (!Number.isNaN(roleEndTime) && (Number.isNaN(currentMaxTime) || roleEndTime > currentMaxTime)) {
        current.maxEnd = candidateEnd;
      }

      grouped.set(eventId, current);
    }

    return Array.from(grouped.values())
      .filter((event) => {
        const eventStartTime = parseAsTime(event.minStart);
        const eventEndTime = parseAsTime(event.maxEnd);
        const referenceTime = !Number.isNaN(eventEndTime) ? eventEndTime : eventStartTime;
        if (Number.isNaN(referenceTime)) return false;
        return referenceTime >= now;
      })
      .sort((a, b) => parseAsTime(a.minStart) - parseAsTime(b.minStart));
  }, [roles, calendarEventsById]);

  const dropdownEventOptions = useMemo(() => {
    const hidden = new Set(hiddenEventIds.map((id) => String(id || '').trim()).filter(Boolean));
    const visible = eventOptions.filter((event) => !hidden.has(event.id));
    const selected = eventOptions.find((event) => event.id === selectedEventId);

    if (selected && !visible.some((event) => event.id === selected.id)) {
      return [selected, ...visible];
    }

    return visible;
  }, [eventOptions, hiddenEventIds, selectedEventId]);

  const eventOverview = useMemo(() => {
    const totalEvents = eventOptions.length;
    const totalOpenRoles = roles.length;

    let totalVacancies = 0;
    for (const role of roles) {
      const required = Number(role.numberRequired) || 0;
      const assigned = Number(role.numberAssigned) || 0;
      totalVacancies += Math.max(0, required - assigned);
    }

    const nextEvent = [...eventOptions]
      .sort((a, b) => parseAsTime(a.minStart) - parseAsTime(b.minStart))
      .find((event) => !Number.isNaN(parseAsTime(event.minStart))) || null;

    return {
      totalEvents,
      totalOpenRoles,
      totalVacancies,
      nextEvent,
    };
  }, [eventOptions, roles]);

  const selectedEvent = useMemo(
    () => eventOptions.find((item) => item.id === selectedEventId) || null,
    [eventOptions, selectedEventId]
  );

  const selectedEventDateLabel = useMemo(() => {
    if (!selectedEvent) return 'TBD';
    const scheduleLabel = ((selectedEvent as any)?.disciplineSchedule || [])
      .map((day: any) => {
        const dayDate = String(day.date || '').trim();
        if (!dayDate) return '';

        const disciplines = (day.disciplines || [])
          .map((discipline: any) => String(discipline || '').trim())
          .filter(Boolean);

        const formattedDay = formatDate(dayDate);
        return disciplines.length > 0
          ? `${formattedDay} (${disciplines.join(', ')})`
          : formattedDay;
      })
      .filter(Boolean);

    if (scheduleLabel.length > 0) {
      return scheduleLabel.join(' · ');
    }

    if (selectedEvent.minStart && selectedEvent.maxEnd) {
      const from = formatDate(selectedEvent.minStart);
      const to = formatDate(selectedEvent.maxEnd);
      return from === to ? from : `${from} - ${to}`;
    }
    return formatDate(selectedEvent.minStart || selectedEvent.maxEnd);
  }, [selectedEvent]);

  const getRoleChipClass = (roleName: string, index: number) => {
    const normalized = String(roleName || '').toLowerCase();
    const base = 'border shadow-sm backdrop-blur-sm bg-white/90 text-slate-900 dark:bg-slate-950/80 dark:text-slate-100';
    if (normalized.includes('chief')) return `${base} border-rose-300/80 dark:border-rose-700/80`;
    if (normalized.includes('referee')) return index % 2 === 0
      ? `${base} border-cyan-300/80 dark:border-cyan-700/80`
      : `${base} border-blue-300/80 dark:border-blue-700/80`;
    if (normalized.includes('marshal')) return `${base} border-emerald-300/80 dark:border-emerald-700/80`;
    if (normalized.includes('volunteer')) return `${base} border-violet-300/80 dark:border-violet-700/80`;
    return index % 2 === 0
      ? `${base} border-amber-300/80 dark:border-amber-700/80`
      : `${base} border-slate-300/80 dark:border-slate-700/80`;
  };

  const rolesForSelectedEvent = useMemo(() => {
    return roles
      .filter((role) => role.eventId === selectedEventId)
      .map((role) => ({
        ...role,
        remaining: Math.max(0, (Number(role.numberRequired) || 0) - (Number(role.numberAssigned) || 0)),
      }))
      .filter((role) => role.remaining > 0)
      .sort((a, b) => a.roleName.localeCompare(b.roleName));
  }, [roles, selectedEventId]);

  const availableRolesForPreferences = useMemo(
    () => rolesForSelectedEvent.filter((role) => role.remaining > 0),
    [rolesForSelectedEvent]
  );

  const selectedRoleForPreference = useMemo(
    () => availableRolesForPreferences.find((role) => role.id === firstPreferenceRoleId) || null,
    [availableRolesForPreferences, firstPreferenceRoleId]
  );

  const shouldAskBankDetails = !hasSavedBankDetails || editingSavedBankDetails;

  const getRoleSummary = (value: string) => {
    const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) return 'No description provided.';
    if (cleaned.length <= 120) return cleaned;
    return `${cleaned.slice(0, 117).trimEnd()}…`;
  };

  const sanitizeFileName = (value: string) => String(value || 'role')
    .trim()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'role';

  const downloadRolePdf = async (role: OpenRole) => {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 16;
    const contentWidth = pageWidth - margin * 2;
    const navy = [9, 18, 36] as const;
    const gold = [245, 158, 11] as const;
    const slate = [100, 116, 139] as const;
    const border = [226, 232, 240] as const;
    const light = [248, 250, 252] as const;
    const compactHeaderHeight = 22;
    const firstHeaderHeight = 48;
    const sectionGap = 6;
    let y = firstHeaderHeight + 12;
    let isFirstPage = true;

    type PdfSection = {
      title: string;
      lines: string[];
    };

    const sectionTitles = new Map<string, string>([
      ['role summary', 'Role Summary'],
      ['reporting structure', 'Reporting Structure'],
      ['key responsibilities', 'Key Responsibilities'],
      ['authority', 'Authority'],
      ['communication responsibilities', 'Communication Responsibilities'],
      ['final authority', 'Final Authority'],
      ['role details', 'Role Details'],
    ]);

    const loadLogoData = async (src: string): Promise<{ dataUrl: string; width: number; height: number } | null> => {
      try {
        const response = await fetch(src);
        if (!response.ok) return null;
        const blob = await response.blob();

        return await new Promise((resolve) => {
          const img = new window.Image();
          const objectUrl = URL.createObjectURL(blob);
          img.onload = () => {
            const reader = new FileReader();
            reader.onloadend = () => {
              URL.revokeObjectURL(objectUrl);
              resolve(
                typeof reader.result === 'string'
                  ? { dataUrl: reader.result, width: img.naturalWidth || 1, height: img.naturalHeight || 1 }
                  : null
              );
            };
            reader.onerror = () => {
              URL.revokeObjectURL(objectUrl);
              resolve(null);
            };
            reader.readAsDataURL(blob);
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(null);
          };
          img.src = objectUrl;
        });
      } catch {
        return null;
      }
    };

    const logo = await loadLogoData('/Bmlogowhite.png');

    const getLogoSize = (targetWidth: number) => {
      if (!logo) return null;
      const width = targetWidth;
      const height = Math.max(1, (logo.height / logo.width) * width);
      return { width, height };
    };

    const startNewPage = () => {
      if (!isFirstPage) doc.addPage();
      isFirstPage = false;
      drawHeader(false);
      y = compactHeaderHeight + 12;
    };

    const drawHeader = (firstPage: boolean) => {
      const headerHeight = firstPage ? firstHeaderHeight : compactHeaderHeight;
      doc.setFillColor(...navy);
      doc.rect(0, 0, pageWidth, headerHeight, 'F');
      doc.setDrawColor(...gold);
      doc.setLineWidth(0.8);
      doc.line(margin, headerHeight, pageWidth - margin, headerHeight);

      if (logo) {
        if (firstPage) {
          const size = getLogoSize(82);
          if (size) {
            doc.addImage(logo.dataUrl, 'PNG', (pageWidth - size.width) / 2, 6, size.width, size.height);
          }
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(16);
          doc.text('BERGMAN OZAR PUNE 2026', pageWidth / 2, 36, { align: 'center' });
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.text('Official Race-Official Appointment Document', pageWidth / 2, 42, { align: 'center' });
        } else {
          const size = getLogoSize(30);
          if (size) {
            doc.addImage(logo.dataUrl, 'PNG', (pageWidth - size.width) / 2, 4, size.width, size.height);
          }
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.text('BERGMAN OZAR PUNE 2026', pageWidth / 2, 18, { align: 'center' });
        }
      }

      doc.setTextColor(0, 0, 0);
    };

    const ensureSpace = (neededHeight: number) => {
      if (y + neededHeight <= pageHeight - margin) return;
      startNewPage();
    };

    const wrapLines = (text: string, fontSize: number, width = contentWidth) => {
      doc.setFontSize(fontSize);
      return doc.splitTextToSize(String(text || '').trim() || '—', width) as string[];
    };

    const lineHeightFor = (fontSize: number) => Math.max(4.5, fontSize * 0.38);

    const estimateLinesHeight = (lines: string[], fontSize: number) => lines.length * lineHeightFor(fontSize);

    const drawCard = (height: number, accent: readonly [number, number, number] = gold) => {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...border);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y, contentWidth, height, 4, 4, 'FD');
      doc.setFillColor(...accent);
      doc.roundedRect(margin, y, contentWidth, 4, 4, 4, 'F');
    };

    const drawCardTitle = (title: string) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...navy);
      doc.text(title, margin + 6, y + 11);
      doc.setTextColor(0, 0, 0);
    };

    const formatRange = (start?: string | Date, end?: string | Date) => {
      const startLabel = formatDate(start);
      const endLabel = formatDate(end);
      return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
    };

    const parseRoleSections = (description: string): PdfSection[] => {
      const sections: PdfSection[] = [];
      const rawLines = String(description || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      let current: PdfSection = { title: 'Role Summary', lines: [] };

      const pushCurrent = () => {
        if (current.lines.length > 0 || current.title === 'Role Summary') {
          sections.push(current);
        }
      };

      for (const rawLine of rawLines) {
        const normalized = rawLine.replace(/\s+/g, ' ').trim();
        const headingKey = normalized.toLowerCase().replace(/[:\s]+$/g, '');
        const mapped = sectionTitles.get(headingKey);

        if (mapped) {
          pushCurrent();
          current = { title: mapped, lines: [] };
          continue;
        }

        current.lines.push(normalized);
      }

      pushCurrent();

      return sections.length > 0 ? sections : [{ title: 'Role Summary', lines: [String(description || 'No description provided.')] }];
    };

    const renderEventInfoCard = () => {
      const eventName = role.eventName || selectedEvent?.name || 'Selected Event';
      const eventDates = formatRange(role.startDate, role.endDate);
      const reportingDate = formatDate(role.reportingDate || role.startDate);
      const honorarium = `₹${Number(role.paymentAmount || 0).toLocaleString('en-IN')}`;
      const vacancies = String(Math.max(0, Number(role.numberRequired || 0) - Number(role.numberAssigned || 0)));
      const roleTitle = role.roleName || 'Role Description';

      const cardHeight = 42;
      ensureSpace(cardHeight);
      drawCard(cardHeight, gold);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(...navy);
      const roleLines = wrapLines(roleTitle, 18, contentWidth - 16);
      doc.text(roleLines, margin + 8, y + 16);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      doc.setTextColor(...slate);
      const infoTop = y + 24;
      const infoCols = [
        { label: 'Event Dates', value: eventDates },
        { label: 'Reporting Date', value: reportingDate },
        { label: 'Honorarium', value: honorarium },
        { label: 'Vacancies', value: vacancies },
      ];

      const colW = (contentWidth - 18) / 2;
      infoCols.forEach((item, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = margin + 8 + col * (colW + 6);
        const yPos = infoTop + row * 7;
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...navy);
        doc.text(`${item.label}:`, x, yPos);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...slate);
        doc.text(item.value, x + 24, yPos);
      });

      doc.setTextColor(0, 0, 0);
      y += cardHeight + sectionGap;
    };

    const renderGenericSection = (title: string, lines: string[]) => {
      const cleanedLines = lines.map((line) => line.trim()).filter(Boolean);
      const titleHeight = 9;
      const bodyWidth = contentWidth - 16;

      let estimated = titleHeight + 8;
      cleanedLines.forEach((line) => {
        const wrapped = wrapLines(line, 10.2, bodyWidth);
        estimated += Math.max(5, estimateLinesHeight(wrapped, 10.2) + 1);
      });
      estimated += 4;

      ensureSpace(estimated);
      drawCard(estimated, navy);
      drawCardTitle(title);

      let cursorY = y + 18;
      cleanedLines.forEach((line) => {
        const isNumbered = /^\d+\./.test(line);
        const isBullet = /^[•*-]/.test(line);
        const paragraph = line.replace(/^[•*-]\s*/, '');
        const wrapped = wrapLines(paragraph, 10.2, bodyWidth - (isBullet || isNumbered ? 4 : 0));

        if (isNumbered) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10.2);
          doc.setTextColor(...navy);
          const first = wrapped.shift() || paragraph;
          doc.text(first, margin + 8, cursorY);
          cursorY += lineHeightFor(10.2);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...slate);
          wrapped.forEach((part) => {
            doc.text(part, margin + 12, cursorY);
            cursorY += lineHeightFor(10.2);
          });
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10.2);
          doc.setTextColor(...slate);
          if (isBullet) {
            doc.text('•', margin + 8, cursorY);
            wrapped.forEach((part, idx) => {
              doc.text(part, margin + 12, cursorY + idx * lineHeightFor(10.2));
            });
            cursorY += Math.max(1, wrapped.length) * lineHeightFor(10.2);
          } else {
            wrapped.forEach((part) => {
              doc.text(part, margin + 8, cursorY);
              cursorY += lineHeightFor(10.2);
            });
          }
        }

        cursorY += 1;
      });

      y += estimated + sectionGap;
    };

    const renderReportingStructure = (title: string, lines: string[]) => {
      const nodes = lines
        .flatMap((line) => line.split(/[↓↑→↔\-|>]+/g))
        .map((line) => line.replace(/[!"“”]/g, '').replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 1 && /[A-Za-z]/.test(line));

      const uniqueNodes = nodes.filter((node, index) => nodes.indexOf(node) === index);
      const nodeHeight = 10;
      const arrowHeight = 4;
      const estimated = 18 + uniqueNodes.length * nodeHeight + Math.max(0, uniqueNodes.length - 1) * arrowHeight + 8;

      ensureSpace(estimated);
      drawCard(estimated, gold);
      drawCardTitle(title);

      let cursorY = y + 18;
      uniqueNodes.forEach((node, index) => {
        const boxWidth = contentWidth - 46;
        const boxX = margin + 23;
        doc.setFillColor(...light);
        doc.setDrawColor(...border);
        doc.roundedRect(boxX, cursorY, boxWidth, 10, 2, 2, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...navy);
        const lines = wrapLines(node, 10, boxWidth - 8);
        doc.text(lines, pageWidth / 2, cursorY + 6.8, { align: 'center', baseline: 'middle' });
        cursorY += 12;
        if (index < uniqueNodes.length - 1) {
          doc.setTextColor(...gold);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(13);
          doc.text('↓', pageWidth / 2, cursorY, { align: 'center' });
          cursorY += 4;
        }
      });

      y += estimated + sectionGap;
    };

    const renderRoleDetails = () => {
      const honorarium = `₹${Number(role.paymentAmount || 0).toLocaleString('en-IN')}`;
      const reportingDate = formatDate(role.reportingDate || role.startDate);
      const eventDates = formatRange(role.startDate, role.endDate);
      const vacancies = String(Math.max(0, Number(role.numberRequired || 0) - Number(role.numberAssigned || 0)));

      const estimated = 38;
      ensureSpace(estimated);
      drawCard(estimated, navy);
      drawCardTitle('Role Details');

      const items = [
        ['Honorarium', honorarium],
        ['Reporting Date', reportingDate],
        ['Event Dates', eventDates],
        ['Vacancies', vacancies],
      ];

      const boxW = (contentWidth - 26) / 2;
      const boxH = 10;
      const startY = y + 18;
      items.forEach((item, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = margin + 8 + col * (boxW + 10);
        const yPos = startY + row * 13;

        doc.setFillColor(...light);
        doc.setDrawColor(...border);
        doc.roundedRect(x, yPos, boxW, boxH, 2, 2, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...navy);
        doc.text(`${item[0]}:`, x + 3, yPos + 6.4);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...slate);
        doc.text(item[1], x + 26, yPos + 6.4);
      });

      y += estimated + sectionGap;
    };

    drawHeader(true);
    renderEventInfoCard();

    const sections = parseRoleSections(role.roleDescription || '');
    const ordered = [
      'Role Summary',
      'Reporting Structure',
      'Key Responsibilities',
      'Authority',
      'Communication Responsibilities',
      'Final Authority',
    ];

    const sectionMap = new Map(sections.map((section) => [section.title, section.lines]));

    for (const title of ordered) {
      const lines = sectionMap.get(title);
      if (!lines || lines.length === 0) continue;
      if (title === 'Reporting Structure') {
        renderReportingStructure(title, lines);
      } else {
        renderGenericSection(title, lines);
      }
    }

    renderRoleDetails();

    doc.save(`${sanitizeFileName(role.roleName)}_Role_Description.pdf`);
  };

  const getRoleResponsibilities = (value: string) => {
    const raw = String(value || '').trim();
    if (!raw) return [] as string[];

    const lines = raw
      .split(/\n+/)
      .flatMap((line) => line.split(/(?:•|·|;|\|)/g))
      .map((item) => item.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean);

    if (lines.length >= 2) return lines.slice(0, 6);

    return raw
      .split(/\.\s+/)
      .map((item) => item.trim().replace(/\.$/, ''))
      .filter(Boolean)
      .slice(0, 6);
  };

  const openRoleDetails = (role: OpenRole) => {
    setSelectedRoleDetails(role);
    setRoleDescriptionAcknowledged(false);
  };

  const closeRoleDetails = () => {
    setSelectedRoleDetails(null);
    setRoleDescriptionAcknowledged(false);
  };

  const selectRoleForPreference = (role: OpenRole) => {
    setFirstPreferenceRoleId(role.id);
    setRoleDescriptionAcknowledged(false);
  };

  const resetFormAfterSubmit = () => {
    setFirstPreferenceRoleId('');
    setSelectedRoleDetails(null);
    setRoleDescriptionAcknowledged(false);
    setAvailablePriorDays(false);
    setCanTravel('');
    setNeedAccommodation('');
    setAgreeAccommodationPolicy(false);
    setAgreeTravelPolicy(false);
    setSkills('');
    setNotes('');
    setAgreeReadRole(false);
    setAgreeWaiverAgreement(false);
    setAgreeHonorariumTerms(false);
    setAgreePolicyCompliance(false);
    setAgreeVoluntaryAcceptance(false);

    if (!hasSavedBankDetails) {
      setAccountName('');
      setBankName('');
      setAccountNumber('');
      setIfscCode('');
      setUpiId('');
      setPanNumber('');
      setSaveBankForFuture(true);
    }
  };

  const loadOpenRoles = useCallback(async () => {
    setLoadingRoles(true);
    try {
      const activeEmail = String(currentUser?.email || email || '').trim().toLowerCase();
      const [openRoles, calendarResult, applications, assignments] = await Promise.all([
        getOpenRoles(),
        getCalendarEventsAction(),
        activeEmail ? getAllApplicationsAction() : Promise.resolve([]),
        activeEmail ? getAllAssignments() : Promise.resolve([]),
      ]);

      setRoles(openRoles.filter((role) => role.isActive));

      if (activeEmail) {
        const eventIds = new Set<string>();

        for (const application of applications) {
          const appEmail = String(application.email || '').trim().toLowerCase();
          const eventId = String(application.selectedEvent?.eventId || application.eventPreferences?.[0] || '').trim();
          if (!eventId || appEmail !== activeEmail) continue;
          const status = String(application.status || '').trim();
          if (status !== 'Rejected') eventIds.add(eventId);
        }

        for (const assignment of assignments) {
          const assignmentEmail = String(assignment.workerEmail || '').trim().toLowerCase();
          const eventId = String(assignment.eventId || '').trim();
          if (!eventId || assignmentEmail !== activeEmail) continue;
          const status = String(assignment.status || '').trim();
          if (status !== 'Cancelled' && status !== 'Declined') eventIds.add(eventId);
        }

        setHiddenEventIds(Array.from(eventIds));
      } else {
        setHiddenEventIds([]);
      }

      const byId: Record<string, EventCalendarEntry> = {};
      if (calendarResult.success && Array.isArray(calendarResult.events)) {
        for (const event of calendarResult.events) {
          if (!event?.id) continue;
          byId[String(event.id)] = event;
        }
      }
      setCalendarEventsById(byId);
    } finally {
      setLoadingRoles(false);
    }
  }, [currentUser?.email, email]);

  const syncEventInUrl = (eventId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (eventId) params.set('eventId', eventId);
    else params.delete('eventId');

    const query = params.toString();
    const nextUrl = query ? `/work-with-bergman?${query}` : '/work-with-bergman';
    router.replace(nextUrl);
  };

  const handleEventSelection = (eventId: string) => {
    setSelectedEventId(eventId);
    setFirstPreferenceRoleId('');
  };

  const runEligibilityCheck = useCallback(async (emailToCheck: string, eventIdToCheck = selectedEventId) => {
    if (!emailToCheck.trim()) return;
    setStatus({ tone: 'idle', message: '' });
    setCheckingEligibility(true);
    const result = await checkRecruitmentEligibilityAction(emailToCheck, eventIdToCheck);
    setCheckingEligibility(false);

    setEligibilityChecked(true);
    setIsEligible(result.eligible);
    setStatus({ tone: result.eligible ? 'success' : 'error', message: result.message });

    if (result.workerProfile) {
      const wp: any = result.workerProfile;
      if (wp.fullName) setFullName((prev) => prev || wp.fullName);
      if (wp.whatsappNumber) setPhone((prev) => prev || wp.whatsappNumber);
      if (wp.city) setCity((prev) => prev || wp.city);
      if (wp.address) setAddress((prev) => prev || wp.address);
      if (wp.pincode) setPincode((prev) => prev || wp.pincode);
      if (wp.state) setStateValue((prev) => prev || wp.state);
      if (wp.gender) setGender((prev) => prev || wp.gender);
      if (wp.tshirtSize) setTshirtSize((prev) => prev || wp.tshirtSize);

      setHasSavedBankDetails(!!wp.hasSavedBankDetails);
      setEditingSavedBankDetails(false);

      if (wp.hasSavedBankDetails && wp.bankDetails) {
        setAccountName(String(wp.bankDetails.accountName || ''));
        setBankName(String(wp.bankDetails.bankName || ''));
        setAccountNumber(String(wp.bankDetails.accountNumber || ''));
        setIfscCode(String(wp.bankDetails.ifscCode || ''));
        setUpiId(String(wp.bankDetails.upiId || ''));
        setPanNumber(String(wp.bankDetails.panNumber || ''));
      }
    }
  }, [selectedEventId]);

  useEffect(() => {
    if (!currentUser) return;

    const userEmail = String(currentUser.email || '').trim().toLowerCase();
    const userName = String(currentUser.name || '').trim();
    const userPhone = String(currentUser.mobile || '').trim();
    const userAlternatePhone = String((currentUser as any).alternateMobile || (currentUser as any).alternatePhone || (currentUser as any).altMobile || '').trim();
    const userCity = String(currentUser.city || '').trim();
    const userState = String(currentUser.state || '').trim();
    const userGender = String(currentUser.gender || '').trim();
    const userTshirt = String(currentUser.tshirtSize || '').trim();
    const userAddress = String((currentUser as any).address || '').trim();
    const userPincode = String((currentUser as any).pincode || (currentUser as any).postalCode || '').trim();

    setEmail(userEmail);
    setFullName((prev) => prev || userName);
    setPhone((prev) => prev || userPhone);
    setAlternatePhone((prev) => prev || userAlternatePhone);
    setCity((prev) => prev || userCity);
    setStateValue((prev) => prev || userState);
    setGender((prev) => prev || userGender);
    setTshirtSize((prev) => prev || userTshirt);
    setAddress((prev) => prev || userAddress);
    setPincode((prev) => prev || userPincode);
  }, [currentUser]);

  useEffect(() => {
    if (!email.trim() || !selectedEventId) return;
    runEligibilityCheck(email, selectedEventId);
  }, [email, selectedEventId, runEligibilityCheck]);

  useEffect(() => {
    loadOpenRoles();
  }, [loadOpenRoles]);

  useEffect(() => {
    if (!dropdownEventOptions.length) {
      setSelectedEventId('');
      return;
    }

    if (!selectedEventQuery) return;

    const isQueryEventValid = dropdownEventOptions.some((event) => event.id === selectedEventQuery);
    setSelectedEventId(isQueryEventValid ? selectedEventQuery : '');
  }, [dropdownEventOptions, selectedEventQuery]);

  useEffect(() => {
    if (selectedEventId && hiddenEventIds.includes(selectedEventId)) {
      setStatus({
        tone: 'error',
        message: 'You already have an application or assignment for this event. Contact the team if you need help updating it.',
      });
    }
  }, [hiddenEventIds, selectedEventId]);

  const handleSelectEvent = (eventId: string) => {
    if (!eventId) return;
    handleEventSelection(eventId);
  };

  useEffect(() => {
    if (!selectedEventId) return;
    requestAnimationFrame(() => {
      document.getElementById('application-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [selectedEventId]);

  useEffect(() => {
    setRoleDescriptionAcknowledged(false);
  }, [firstPreferenceRoleId]);

  useEffect(() => {
    if (!email.trim()) return;
    runEligibilityCheck(email, selectedEventId);
  }, [email, selectedEventId, runEligibilityCheck]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ tone: 'idle', message: '' });

    if (!eligibilityChecked || !isEligible) {
      setStatus({
        tone: 'error',
        message: 'You are not eligible to fill this form. Please contact our team via Contact Us and share your details.',
      });
      return;
    }

    if (!selectedEventId || !firstPreferenceRoleId) {
      setStatus({ tone: 'error', message: 'Please select an event and one role preference.' });
      return;
    }
    if (!availablePriorDays) {
      setStatus({ tone: 'error', message: 'Availability for 2-3 days prior to the event is mandatory.' });
      return;
    }
    if (canTravel !== 'yes') {
      setStatus({ tone: 'error', message: 'Travel support is required. Please select Yes to continue.' });
      return;
    }

    if (!needAccommodation) {
      setStatus({ tone: 'error', message: 'Please complete all travel and accommodation questions.' });
      return;
    }

    if (needAccommodation === 'yes' && !agreeAccommodationPolicy) {
      setStatus({ tone: 'error', message: 'Please accept the accommodation policy to continue.' });
      return;
    }

    if (!agreeTravelPolicy) {
      setStatus({ tone: 'error', message: 'Please accept the travel reimbursement policy to continue.' });
      return;
    }

    const allAgreementsAccepted =
      agreeReadRole &&
      agreeWaiverAgreement &&
      agreeHonorariumTerms &&
      agreePolicyCompliance &&
      agreeVoluntaryAcceptance;
    if (!allAgreementsAccepted) {
      setStatus({ tone: 'error', message: 'Please accept the Rules, Regulations & Waiver Agreement to continue.' });
      return;
    }

    if (shouldAskBankDetails) {
      const bankReady = !!(
        accountName.trim() &&
        bankName.trim() &&
        accountNumber.trim() &&
        ifscCode.trim() &&
        upiId.trim() &&
        panNumber.trim()
      );
      if (!bankReady) {
        setStatus({ tone: 'error', message: 'Please provide complete banking information.' });
        return;
      }
    }

    setSaving(true);
    const selectedEventMeta = eventOptions.find((event) => event.id === selectedEventId) || null;

    const result = await submitWorkWithBergmanApplicationAction({
      fullName,
      email,
      phone,
      alternatePhone,
      address,
      city,
      state: stateValue,
      pincode,
      skills,
      notes,
      declaration: allAgreementsAccepted,
      eventId: selectedEventId,
      eventName: selectedEventMeta?.name || 'Selected Event',
      eventDate: selectedEventDateLabel,
      firstPreferenceRoleId,
      eventAvailabilityOptions: availablePriorDays ? ['Available for 2-3 days prior to the event (Mandatory)'] : [],
      canTravel: canTravel === 'yes',
      needAccommodation: needAccommodation === 'yes',
      needLocalTransport: false,
      bankDetails: shouldAskBankDetails
        ? {
            accountName,
            bankName,
            accountNumber,
            ifscCode,
            upiId,
            panNumber,
          }
        : undefined,
      saveBankForFuture,
      updateSavedBankDetails: hasSavedBankDetails && editingSavedBankDetails,
      agreements: {
        freelance: agreeReadRole,
        duties: agreePolicyCompliance,
        reporting: agreeVoluntaryAcceptance,
        travelReimbursementPolicyAccepted: agreeTravelPolicy,
        accommodationPolicyAccepted: needAccommodation === 'yes' ? agreeAccommodationPolicy : true,
      },
    });
    setSaving(false);

    if (result.success) {
      setStatus({ tone: 'success', message: result.message });
      if (shouldAskBankDetails && saveBankForFuture) {
        setHasSavedBankDetails(true);
        setEditingSavedBankDetails(false);
      }
      resetFormAfterSubmit();
    } else {
      setStatus({ tone: 'error', message: result.message });
    }
  };

  if (authLoading) {
    return (
      <main className="container mx-auto max-w-4xl px-4 py-10" id="application-form">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading your profile…</CardContent>
        </Card>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Work With Bergman</CardTitle>
            <CardDescription>Please log in to apply for event staffing roles.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              You must be logged in to continue. If you do not have access, please use the{' '}
              <Link href="/contact-us" className="text-primary underline underline-offset-4">Contact Us</Link>{' '}
              page.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!selectedEventId) {
    return (
      <main className="container mx-auto max-w-6xl px-4 py-10 space-y-6" id="application-form">
        <Card className="border-none shadow-xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white overflow-hidden">
          <CardHeader className="relative">
            <div className="absolute -top-12 -right-10 h-36 w-36 rounded-full bg-cyan-400/20 blur-2xl" />
            <div className="absolute -bottom-14 -left-10 h-36 w-36 rounded-full bg-blue-500/20 blur-2xl" />
            <div className="relative mb-3 flex justify-center">
              <NextImage
                src="/Bmlogowhite.png"
                alt="Bergman"
                width={220}
                height={72}
                className="h-auto w-44 sm:w-52 md:w-56 drop-shadow-[0_0_14px_rgba(255,255,255,0.18)]"
                style={{ width: 'auto', height: 'auto' }}
                priority
              />
            </div>
            <div className="relative flex items-center gap-2 text-cyan-300 text-xs font-semibold tracking-wide uppercase">
              <Flame className="h-4 w-4" />
              Event Staffing Arena
            </div>
            <CardTitle className="relative text-2xl md:text-3xl">Work With Bergman · Available Events</CardTitle>
            <CardDescription className="relative text-slate-200">
              Pick your race weekend, choose your role preferences, and lock your application.
            </CardDescription>
          </CardHeader>
          <CardContent className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-white/15 bg-white/5 p-3">
              <div className="text-xs text-slate-300">Live Events</div>
              <div className="mt-1 text-2xl font-bold">{eventOverview.totalEvents}</div>
            </div>
            <div className="rounded-lg border border-white/15 bg-white/5 p-3">
              <div className="text-xs text-slate-300">Open Roles</div>
              <div className="mt-1 text-2xl font-bold">{eventOverview.totalOpenRoles}</div>
            </div>
            <div className="rounded-lg border border-white/15 bg-white/5 p-3">
              <div className="text-xs text-slate-300">Remaining Vacancies</div>
              <div className="mt-1 text-2xl font-bold">{eventOverview.totalVacancies}</div>
            </div>
            <div className="rounded-lg border border-white/15 bg-white/5 p-3">
              <div className="text-xs text-slate-300">Next Event</div>
              <div className="mt-1 text-sm font-semibold line-clamp-2">
                {eventOverview.nextEvent?.name || 'TBD'}
              </div>
              <div className="text-xs text-slate-300 mt-1">
                {eventOverview.nextEvent?.minStart ? formatDate(eventOverview.nextEvent.minStart) : 'TBD'}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Events with Open Roles</CardTitle>
            <CardDescription>
              Select an event to continue to the dynamic application form for that event date.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingRoles ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading events...</div>
            ) : eventOptions.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No available events found right now.</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {eventOptions.map((event) => {
                  const eventRoles = roles.filter((role) => role.eventId === event.id);
                  const totalRequired = eventRoles.reduce((sum, role) => sum + (Number(role.numberRequired) || 0), 0);
                  const totalAssigned = eventRoles.reduce((sum, role) => sum + (Number(role.numberAssigned) || 0), 0);
                  const remaining = Math.max(0, totalRequired - totalAssigned);
                  const fillPct = totalRequired > 0 ? Math.min(100, Math.round((totalAssigned / totalRequired) * 100)) : 0;
                  const topRoles = eventRoles
                    .slice()
                    .sort((a, b) => (Number(b.numberRequired) || 0) - (Number(a.numberRequired) || 0))
                    .slice(0, 3);

                  return (
                    <div key={event.id} className="rounded-xl border p-4 bg-gradient-to-br from-background to-muted/30 hover:shadow-md transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-base leading-tight">{event.name}</div>
                          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <CalendarDays className="h-3.5 w-3.5" />
                            Event Date: {event.minStart ? formatDate(event.minStart) : 'TBD'}{event.maxEnd && event.maxEnd !== event.minStart ? ` - ${formatDate(event.maxEnd)}` : ''}
                          </div>
                        </div>
                        <div className="rounded-full bg-primary/10 text-primary text-[10px] px-2 py-1 font-semibold">
                          {eventRoles.length} Roles
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-md border p-2">
                          <div className="text-muted-foreground flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Vacancies</div>
                          <div className="mt-1 font-semibold">{remaining}</div>
                        </div>
                        <div className="rounded-md border p-2">
                          <div className="text-muted-foreground flex items-center gap-1"><Trophy className="h-3.5 w-3.5" /> Filled</div>
                          <div className="mt-1 font-semibold">{fillPct}%</div>
                        </div>
                      </div>

                      <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600" style={{ width: `${fillPct}%` }} />
                      </div>

                      {topRoles.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {topRoles.map((role) => (
                            <span key={role.id} className={`rounded-full px-2 py-1 text-[11px] font-medium ${getRoleChipClass(role.roleName, topRoles.indexOf(role))}`}>
                              {role.roleName}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="text-xs text-muted-foreground mt-3">
                        Event Date: {event.minStart ? formatDate(event.minStart) : 'TBD'}{event.maxEnd && event.maxEnd !== event.minStart ? ` - ${formatDate(event.maxEnd)}` : ''}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Open Roles: {eventRoles.length} · Remaining Vacancies: {remaining}
                      </div>

                      <Button type="button" className="mt-3 w-full" onClick={() => handleSelectEvent(event.id)}>
                        Apply for this Event
                        <ArrowRight className="ml-1.5 h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {isLocalDevelopment ? (
          <Card className="border-dashed">
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">
                Local dev URL: <span className="font-medium">http://localhost:3000/work-with-bergman</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                HTTPS on localhost is not enabled in current dev setup, so https://localhost:3000 can show SSL protocol errors.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Event Staffing Application · Work With Bergman</CardTitle>
          <CardDescription>
            Submit role preferences for a selected event. This form uses your athlete profile as read-only identity details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-8" onSubmit={handleSubmit}>
            <section className="space-y-4 rounded-lg border p-4">
              <h3 className="font-semibold">Selected Event</h3>

              <div>
                <Label>Choose Event</Label>
                <select
                  className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={selectedEventId}
                  onChange={(e) => {
                    handleEventSelection(e.target.value);
                    setFirstPreferenceRoleId('');
                  }}
                  disabled={loadingRoles}
                >
                  {dropdownEventOptions.length === 0 ? (
                    <option value="">No events with open roles</option>
                  ) : (
                    dropdownEventOptions.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name} ({event.minStart ? formatDate(event.minStart) : 'TBD'})
                      </option>
                    ))
                  )}
                </select>
                {selectedEvent && hiddenEventIds.includes(selectedEvent.id) ? (
                  <p className="mt-2 text-xs text-amber-600">
                    This event is already linked to your account, so it is shown here but may be hidden from the general list.
                  </p>
                ) : null}
              </div>

              <div className="rounded-md bg-muted p-3 text-sm">
                This form is for: <span className="font-semibold">{selectedEvent?.name || 'Select an event'}</span>
                <span className="ml-2 text-muted-foreground">({selectedEventDateLabel})</span>
              </div>
            </section>

            <section className="space-y-4 rounded-lg border p-4">
              <h3 className="font-semibold">Personal Details (Auto Filled)</h3>
              <p className="text-xs text-muted-foreground">Read-only values pulled from your athlete profile.</p>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label>Name</Label>
                  <Input className="mt-2" value={fullName} readOnly />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input className="mt-2" value={email} readOnly />
                </div>
                <div>
                  <Label>Mobile</Label>
                  <Input className="mt-2" value={phone} readOnly />
                </div>
                <div>
                  <Label>Alternative Mobile Number</Label>
                  <Input
                    className="mt-2"
                    value={alternatePhone}
                    onChange={(e) => setAlternatePhone(e.target.value)}
                    placeholder="Enter an alternate mobile number"
                    type="tel"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Full Address</Label>
                  <Input
                    className="mt-2"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Enter your full delivery address"
                    required
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Please enter your full address. We will send your kit to this address.
                  </p>
                </div>
                <div>
                  <Label>City</Label>
                  <Input className="mt-2" value={city} readOnly />
                </div>
                <div>
                  <Label>Pincode</Label>
                  <Input className="mt-2" value={pincode} readOnly />
                </div>
                <div>
                  <Label>Gender</Label>
                  <Input className="mt-2" value={gender} readOnly />
                </div>
                <div>
                  <Label>T-Shirt Size</Label>
                  <Input className="mt-2" value={tshirtSize} readOnly />
                </div>
              </div>
            </section>

            <div>
              <Label>Email</Label>
              <div className="mt-2 flex gap-2">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  readOnly
                />
                <Button type="button" variant="outline" onClick={() => runEligibilityCheck(email, selectedEventId)} disabled={checkingEligibility || !email.trim()}>
                  {checkingEligibility ? 'Checking...' : 'Check Eligibility'}
                </Button>
              </div>
              {eligibilityChecked ? (
                <div className="mt-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${isEligible ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>
                    Eligible: {isEligible ? 'Yes' : 'No'}
                  </span>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground mt-1">
                Only approved candidates (or manually added by admin) can submit this recruitment form.
              </p>
            </div>

            <section className="space-y-4 rounded-lg border p-4">
              <h3 className="font-semibold uppercase tracking-wide text-sm">
                Available Roles for {selectedEvent?.name || 'Selected Event'}
              </h3>
              <p className="text-xs text-muted-foreground">
                Roles are allotted on a first come, first served basis. If no roles are open right now, we will inform you when new roles are available.
              </p>
              {rolesForSelectedEvent.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
                  No roles are available for this event right now. We will inform you when roles open.
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label>Available Roles You Would Like to Work In</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Please select one role you are interested in for this event.
                    </p>
                    <select
                      className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={firstPreferenceRoleId}
                      onChange={(e) => setFirstPreferenceRoleId(e.target.value)}
                      disabled={!isEligible}
                    >
                      <option value="">Select role</option>
                      {availableRolesForPreferences.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.roleName} - ₹{Number(role.paymentAmount || 0).toLocaleString('en-IN')}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedRoleForPreference ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                      <div className="font-semibold uppercase tracking-wide">Selected role</div>
                      <div className="mt-1 font-medium text-emerald-900">
                        {selectedRoleForPreference.roleName} · ₹{Number(selectedRoleForPreference.paymentAmount || 0).toLocaleString('en-IN')}
                      </div>
                      <div className="mt-1 text-xs text-emerald-700">
                        Reporting date: {formatDate(selectedRoleForPreference.reportingDate || selectedRoleForPreference.startDate)}
                      </div>
                      <div className="mt-1 text-xs text-emerald-700">
                        Event dates: {selectedEventDateLabel}
                      </div>
                      <div className="mt-2 text-xs text-emerald-700 leading-5">
                        {getRoleSummary(selectedRoleForPreference.roleDescription)}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => openRoleDetails(selectedRoleForPreference)}
                          disabled={!isEligible}
                        >
                          View Role Description
                        </Button>
                        <Button
                          type="button"
                          onClick={() => selectRoleForPreference(selectedRoleForPreference)}
                          disabled={!isEligible}
                        >
                          Accept Role
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            <section className="space-y-4 rounded-lg border p-4">
              <h3 className="font-semibold">Event Availability</h3>
              <p className="text-sm text-muted-foreground">
                Availability for <span className="font-semibold">2-3 days prior to the event</span> is mandatory.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={availablePriorDays}
                  onCheckedChange={(checked) => setAvailablePriorDays(!!checked)}
                  disabled={!isEligible}
                />
                I confirm I am available for 2-3 days prior to the event (mandatory).
              </label>
            </section>

            <section className="space-y-4 rounded-lg border p-4">
              <h3 className="font-semibold">Travel & Support</h3>

              <div>
                <Label>Are you willing to travel for this event if assigned a role?</Label>
                <div className="mt-2 flex gap-5 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="canTravel" value="yes" checked={canTravel === 'yes'} onChange={() => setCanTravel('yes')} disabled={!isEligible} />
                    Yes
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="canTravel" value="no" checked={canTravel === 'no'} onChange={() => setCanTravel('no')} disabled={!isEligible} />
                    No
                  </label>
                </div>
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <div className="font-medium text-sm">Accommodation Requirement</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Do you require accommodation during the event?
                </p>

                <div className="mt-2 flex gap-5 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="accommodationRequirement"
                      value="yes"
                      checked={needAccommodation === 'yes'}
                      onChange={() => setNeedAccommodation('yes')}
                      disabled={!isEligible}
                    />
                    Yes
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="accommodationRequirement"
                      value="no"
                      checked={needAccommodation === 'no'}
                      onChange={() => {
                        setNeedAccommodation('no');
                        setAgreeAccommodationPolicy(false);
                      }}
                      disabled={!isEligible}
                    />
                    No
                  </label>
                </div>

                <div className="mt-3">
                  <div className="font-medium text-sm">Accommodation Policy</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Accommodation, if provided, will be subject to availability and may be arranged on a shared basis with up to 2–3 participants per room.
                  </p>
                  <label className="mt-3 flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={agreeAccommodationPolicy}
                      onCheckedChange={(checked) => setAgreeAccommodationPolicy(!!checked)}
                      disabled={!isEligible || needAccommodation !== 'yes'}
                    />
                    <span>I understand and accept the accommodation policy.</span>
                  </label>
                </div>
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <div className="font-medium text-sm">Travel Reimbursement Policy</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Travel expenses will be reimbursed based on actual travel bills and receipts submitted after the event.
                  Reimbursement is subject to approval and capped at a maximum of ₹5,000 per event.
                </p>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={agreeTravelPolicy}
                    onCheckedChange={(checked) => setAgreeTravelPolicy(!!checked)}
                    disabled={!isEligible}
                  />
                  <span>I understand and accept the travel reimbursement policy.</span>
                </label>
              </div>
            </section>

            <section className="space-y-4 rounded-lg border p-4">
              <h3 className="font-semibold">Banking Information</h3>
              {hasSavedBankDetails && !editingSavedBankDetails ? (
                <div className="rounded-md border bg-muted p-3 text-sm">
                  <div>Bank details are already saved for future Bergman assignments.</div>
                  <Button type="button" variant="outline" className="mt-3" onClick={() => setEditingSavedBankDetails(true)} disabled={!isEligible}>
                    Edit Banking Information
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <Label>Account Holder Name</Label>
                      <Input className="mt-2" value={accountName} onChange={(e) => setAccountName(e.target.value)} disabled={!isEligible} />
                    </div>
                    <div>
                      <Label>Bank Name</Label>
                      <Input className="mt-2" value={bankName} onChange={(e) => setBankName(e.target.value)} disabled={!isEligible} />
                    </div>
                    <div>
                      <Label>Account Number</Label>
                      <Input className="mt-2" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} disabled={!isEligible} />
                    </div>
                    <div>
                      <Label>IFSC Code</Label>
                      <Input className="mt-2" value={ifscCode} onChange={(e) => setIfscCode(e.target.value.toUpperCase())} disabled={!isEligible} />
                    </div>
                    <div>
                      <Label>UPI ID</Label>
                      <Input className="mt-2" value={upiId} onChange={(e) => setUpiId(e.target.value)} disabled={!isEligible} />
                    </div>
                    <div>
                      <Label>PAN Number</Label>
                      <Input className="mt-2" value={panNumber} onChange={(e) => setPanNumber(e.target.value.toUpperCase())} disabled={!isEligible} />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={saveBankForFuture} onCheckedChange={(checked) => setSaveBankForFuture(!!checked)} disabled={!isEligible} />
                    Save for future Bergman assignments
                  </label>
                </>
              )}
            </section>

            <div>
              <Label>Skills (comma separated)</Label>
              <Textarea
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                className="mt-2"
                placeholder="First Aid, Event Operations, Route Management"
                disabled={!isEligible}
              />
            </div>

            <div>
              <Label>Why should we consider you?</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-2"
                placeholder="Share your background and event experience"
                disabled={!isEligible}
              />
            </div>

            <section className="space-y-4 rounded-lg border p-4 bg-slate-950 text-white">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Bergman Triathlon</div>
                <h3 className="mt-1 text-lg font-bold uppercase tracking-wide">Work With Bergman</h3>
                <p className="text-sm uppercase tracking-wide text-slate-300">Officials, Volunteers & Freelancers</p>
                <p className="mt-3 text-sm font-semibold text-amber-300">Rules, Regulations & Waiver Agreement</p>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-4 text-sm leading-7 text-slate-100 space-y-4">
                <p>
                  By accepting a role with Bergman Triathlon, Deccan Sports Club, or any affiliated event, I acknowledge and agree to the following terms and conditions:
                </p>

                <div>
                  <p className="font-semibold text-white">1. ROLE ACCEPTANCE</p>
                  <ul className="mt-2 space-y-1 pl-5 list-disc">
                    <li>I have read and understood the role description.</li>
                    <li>I possess the skills, qualifications, and experience required for the assigned role.</li>
                    <li>I agree to perform my duties professionally and responsibly.</li>
                    <li>I understand that role assignments may change based on event requirements.</li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-white">2. ATTENDANCE & REPORTING</p>
                  <ul className="mt-2 space-y-1 pl-5 list-disc">
                    <li>I will report at the designated time and location provided by the event organizers.</li>
                    <li>I will attend all mandatory briefings, training sessions, and meetings.</li>
                    <li>I will notify the event team immediately if I am unable to attend.</li>
                    <li>Repeated no-shows may affect future opportunities with Bergman.</li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-white">3. CODE OF CONDUCT</p>
                  <p className="mt-2 font-medium">I agree to:</p>
                  <ul className="mt-1 space-y-1 pl-5 list-disc">
                    <li>Treat athletes, volunteers, officials, sponsors, partners, spectators, and staff with respect.</li>
                    <li>Maintain professionalism at all times.</li>
                    <li>Follow instructions from the Race Director, Event Director, Chief Referee, and designated supervisors.</li>
                    <li>Represent Bergman Triathlon positively.</li>
                  </ul>
                  <p className="mt-2 font-medium">I will not:</p>
                  <ul className="mt-1 space-y-1 pl-5 list-disc">
                    <li>Harass, discriminate, intimidate, or abuse any individual.</li>
                    <li>Use offensive language or inappropriate behaviour.</li>
                    <li>Consume alcohol, narcotics, or prohibited substances while on duty.</li>
                    <li>Engage in actions that may damage the reputation of Bergman Triathlon.</li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-white">4. SAFETY REQUIREMENTS</p>
                  <ul className="mt-2 space-y-1 pl-5 list-disc">
                    <li>I will prioritize participant and public safety at all times.</li>
                    <li>I will immediately report hazards, incidents, injuries, or emergencies.</li>
                    <li>I will follow all safety protocols and emergency procedures.</li>
                    <li>I will not perform tasks that I am not trained or authorized to perform.</li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-white">5. CONFIDENTIALITY</p>
                  <ul className="mt-2 space-y-1 pl-5 list-disc">
                    <li>I may receive confidential information relating to athletes, sponsors, partners, operations, or event planning.</li>
                    <li>I will not share confidential information without authorization.</li>
                    <li>I will not distribute internal documents, contact information, or event data without permission.</li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-white">6. MEDIA & PHOTOGRAPHY CONSENT</p>
                  <ul className="mt-2 space-y-1 pl-5 list-disc">
                    <li>I grant Bergman Triathlon and Deccan Sports Club permission to photograph, film, record, and use my image, voice, likeness, and name for promotional, marketing, educational, and media purposes without additional compensation.</li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-white">7. COMPENSATION</p>
                  <ul className="mt-2 space-y-1 pl-5 list-disc">
                    <li>I understand that the stated honorarium is a fixed event-based amount and not a daily rate unless specifically stated otherwise.</li>
                    <li>Payment, if applicable, will be processed according to Bergman policies and may be subject to verification of attendance and completion of assigned duties.</li>
                    <li>Travel, accommodation, meals, or other expenses are not included unless explicitly approved by the organizers.</li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-white">8. EQUIPMENT & PROPERTY</p>
                  <ul className="mt-2 space-y-1 pl-5 list-disc">
                    <li>Any event equipment, uniforms, radios, credentials, or materials provided remain the property of Bergman Triathlon.</li>
                    <li>I agree to return all issued items upon request.</li>
                    <li>I may be responsible for damage caused through negligence or misuse.</li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-white">9. LIABILITY WAIVER</p>
                  <ul className="mt-2 space-y-1 pl-5 list-disc">
                    <li>I understand that participation in event operations may involve physical activity, travel, outdoor conditions, traffic exposure, water environments, and other inherent risks.</li>
                    <li>I voluntarily assume all risks associated with my participation.</li>
                    <li>I release and hold harmless Deccan Sports Club, Bergman Triathlon, event organizers, sponsors, partners, venues, government authorities, volunteers, contractors, and staff from any claims, injuries, losses, damages, liabilities, or expenses arising from my participation except where prohibited by law.</li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-white">10. TERMINATION OF ASSIGNMENT</p>
                  <p className="mt-2">Bergman Triathlon reserves the right to:</p>
                  <ul className="mt-1 space-y-1 pl-5 list-disc">
                    <li>Remove or reassign personnel at any time.</li>
                    <li>Terminate assignments due to misconduct, safety concerns, rule violations, non-performance, or operational requirements.</li>
                    <li>Withhold accreditation or future assignments where justified.</li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-white">12. REPORTING OFF DUTY &amp; DEPARTURE</p>
                  <p className="mt-2">I understand that I am required to remain available for my assigned duties until officially released by my designated Team Leader, Director, or Event Supervisor. I agree that:</p>
                  <ul className="mt-1 space-y-1 pl-5 list-disc">
                    <li>I will not leave my assigned location, venue, course, transition area, aid station, or event site without informing and obtaining approval from my Team Leader, Director, or designated supervisor.</li>
                    <li>I will report the completion of my assigned duties before leaving the event.</li>
                    <li>I may be required to assist with event closeout, equipment collection, venue restoration, or operational wrap-up activities related to my role.</li>
                    <li>My assignment shall be considered complete only after I have been formally released by my reporting supervisor.</li>
                    <li>Leaving the event without notification or approval may be treated as abandonment of duties and may affect future assignments, payments, reimbursements, certifications, references, or opportunities with Bergman Triathlon.</li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-white">13. AGREEMENT</p>
                  <p className="mt-2">By selecting “Accept Role” I confirm that:</p>
                  <ul className="mt-1 space-y-1 pl-5 list-disc">
                    <li>I have read and understood the role description.</li>
                    <li>I have read and agree to the Rules, Regulations &amp; Waiver Agreement.</li>
                    <li>I understand the event honorarium and compensation terms.</li>
                    <li>I agree to comply with all event policies and instructions.</li>
                    <li>I voluntarily accept this assignment and associated responsibilities.</li>
                  </ul>
                </div>
              </div>

              <div className="grid gap-3 rounded-lg border border-white/10 bg-white/5 p-4 text-sm">
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-300">Name</div>
                    <div className="mt-1 font-medium text-white">{fullName || 'Auto fill'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-300">Role</div>
                    <div className="mt-1 font-medium text-white">{selectedRoleForPreference?.roleName || 'Auto fill'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-300">Event</div>
                    <div className="mt-1 font-medium text-white">{selectedEvent?.name || 'Auto fill'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-300">Date</div>
                    <div className="mt-1 font-medium text-white">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                  </div>
                </div>

                <div className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
                  Digital Acceptance: Accepted via Work With Bergman Portal
                </div>

                <div className="space-y-2 pt-1 text-sm">
                  <label className="flex items-start gap-2">
                    <Checkbox checked={agreeReadRole} onCheckedChange={(checked) => setAgreeReadRole(!!checked)} disabled={!isEligible} />
                    <span>I have read and understood the role description.</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <Checkbox checked={agreeWaiverAgreement} onCheckedChange={(checked) => setAgreeWaiverAgreement(!!checked)} disabled={!isEligible} />
                    <span>I have read and agree to the Rules, Regulations &amp; Waiver Agreement.</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <Checkbox checked={agreeHonorariumTerms} onCheckedChange={(checked) => setAgreeHonorariumTerms(!!checked)} disabled={!isEligible} />
                    <span>I understand the event honorarium and compensation terms.</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <Checkbox checked={agreePolicyCompliance} onCheckedChange={(checked) => setAgreePolicyCompliance(!!checked)} disabled={!isEligible} />
                    <span>I agree to comply with all event policies and instructions.</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <Checkbox checked={agreeVoluntaryAcceptance} onCheckedChange={(checked) => setAgreeVoluntaryAcceptance(!!checked)} disabled={!isEligible} />
                    <span>I voluntarily accept this assignment and associated responsibilities.</span>
                  </label>
                </div>
              </div>
            </section>

            <Button type="submit" disabled={saving || !isEligible || !agreeReadRole || !agreeWaiverAgreement || !agreeHonorariumTerms || !agreePolicyCompliance || !agreeVoluntaryAcceptance}>
              {saving ? 'Submitting...' : 'Submit'}
            </Button>

            {!isEligible ? (
              <p className="text-xs text-muted-foreground">
                If you are not eligible, please contact our team from the{' '}
                <Link href="/contact-us" className="text-primary underline underline-offset-4">Contact Us</Link>{' '}
                page and share your details.
              </p>
            ) : null}

            {status.message ? (
              <div className={`rounded-md border px-3 py-2 text-sm ${status.tone === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {status.message}
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <footer className="mt-8 rounded-2xl border bg-gradient-to-br from-slate-950 to-slate-800 px-6 py-8 text-slate-100 shadow-lg">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Bergman Triathlon</div>
            <div className="text-lg font-semibold">Work With Bergman</div>
            <p className="max-w-2xl text-sm leading-6 text-slate-300">
              Officials, volunteers, and freelancers are matched to live event staffing needs. Roles are assigned based on eligibility, vacancy, and event requirements.
            </p>
          </div>

          <div className="flex flex-col gap-2 text-sm text-slate-300 md:text-right">
            <div>info@bergmantri.com</div>
            <Link href="/contact-us" className="font-medium text-cyan-300 underline underline-offset-4">
              Contact Us
            </Link>
          </div>
        </div>
      </footer>

      <Dialog open={!!selectedRoleDetails} onOpenChange={(open) => { if (!open) closeRoleDetails(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden p-0">
          {selectedRoleDetails ? (
            <div className="flex max-h-[90vh] flex-col">
              <div className="border-b px-5 py-4">
                <DialogHeader className="space-y-1 text-left">
                  <DialogTitle className="uppercase tracking-wide">{selectedRoleDetails.roleName}</DialogTitle>
                  <DialogDescription>
                    {selectedEvent?.name || selectedRoleDetails.eventName} · {selectedEventDateLabel}
                  </DialogDescription>
                </DialogHeader>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="space-y-5">
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role Summary</h4>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {selectedRoleDetails.roleDescription || 'No description provided.'}
                    </p>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key Responsibilities</h4>
                    <ul className="mt-2 space-y-2 text-sm leading-6 text-gray-700">
                      {getRoleResponsibilities(selectedRoleDetails.roleDescription).length > 0 ? (
                        getRoleResponsibilities(selectedRoleDetails.roleDescription).map((item, index) => (
                          <li key={`${item}-${index}`} className="flex items-start gap-2 rounded-md border bg-white px-3 py-2">
                            <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-primary" />
                            <span>{item}</span>
                          </li>
                        ))
                      ) : (
                        <li className="rounded-md border bg-white px-3 py-2">{selectedRoleDetails.roleDescription || 'No responsibilities listed.'}</li>
                      )}
                    </ul>
                  </div>

                  <div className="grid gap-3 rounded-lg border bg-background p-4 text-sm md:grid-cols-2">
                    <div>
                      <div className="text-muted-foreground">Honorarium</div>
                      <div className="font-semibold">₹{Number(selectedRoleDetails.paymentAmount || 0).toLocaleString('en-IN')}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Reporting to</div>
                      <div className="font-semibold">
                        {selectedRoleDetails.reportingManager || selectedRoleDetails.reportingManagerId || selectedRoleDetails.reportingInstructions || 'Not set'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Reporting Date</div>
                      <div className="font-semibold">{formatDate(selectedRoleDetails.reportingDate || selectedRoleDetails.startDate)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Event Dates</div>
                      <div className="font-semibold">{selectedEventDateLabel}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Vacancies</div>
                      <div className="font-semibold">{Math.max(0, Number(selectedRoleDetails.numberRequired || 0) - Number(selectedRoleDetails.numberAssigned || 0))}</div>
                    </div>
                  </div>

                  <label className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={roleDescriptionAcknowledged}
                      onCheckedChange={(checked) => setRoleDescriptionAcknowledged(!!checked)}
                    />
                    <span>I have read and understood this role.</span>
                  </label>
                </div>
              </div>

              <DialogFooter className="border-t px-5 py-4 gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={closeRoleDetails}>
                  Close
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void downloadRolePdf(selectedRoleDetails)}
                >
                  Download PDF
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    selectRoleForPreference(selectedRoleDetails);
                    closeRoleDetails();
                  }}
                  disabled={!roleDescriptionAcknowledged}
                >
                  Accept Role
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
