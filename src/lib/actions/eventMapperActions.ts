"use server";

import { getFirestoreInstance } from '@/lib/firebaseAdmin';

interface SaveEventMapperPdfInput {
  eventId: string;
  pdfUrl: string;
  pdfName: string;
  sportType: 'swim' | 'bike' | 'run';
  updatedBy?: string;
}

export async function saveEventMapperPdfForAthletesAction(input: SaveEventMapperPdfInput) {
  const { eventId, pdfUrl, pdfName, sportType, updatedBy } = input;

  if (!eventId || !pdfUrl || !pdfName) {
    throw new Error('eventId, pdfUrl and pdfName are required');
  }

  const db = getFirestoreInstance();
  const eventRef = db.collection('eventCalendar').doc(eventId);
  const snap = await eventRef.get();

  if (!snap.exists) {
    throw new Error('Event not found');
  }

  const eventData = snap.data() || {};
  const now = new Date().toISOString();
  const ticketDefinitions = Array.isArray(eventData.ticketDefinitions) ? eventData.ticketDefinitions : [];

  const updatedTicketDefinitions = ticketDefinitions.map((ticket: any) => ({
    ...ticket,
    courseMaps: {
      ...(ticket?.courseMaps || {}),
      generatedPdfUrl: pdfUrl,
      generatedPdfName: pdfName,
      generatedPdfUpdatedAt: now,
      generatedSportType: sportType,
    },
  }));

  await eventRef.update({
    ticketDefinitions: updatedTicketDefinitions,
    eventMapperPro: {
      pdfUrl,
      pdfName,
      sportType,
      updatedAt: now,
      updatedBy: updatedBy || 'admin',
    },
  });

  return {
    success: true,
    eventId,
    pdfUrl,
    pdfName,
    sportType,
    updatedAt: now,
  };
}
