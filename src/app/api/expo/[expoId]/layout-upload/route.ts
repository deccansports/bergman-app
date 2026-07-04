import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance, getStorageInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'application/pdf',
]);

function normalizeExt(fileName: string, mimeType: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpg';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'bin';
}

function safeName(input: string) {
  return String(input || 'layout')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 100) || 'layout';
}

export async function POST(req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, message: 'file is required' }, { status: 400 });
    }

    const mimeType = String(file.type || '').toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) {
      return NextResponse.json({ success: false, message: 'Only PNG, JPG, and PDF are supported' }, { status: 400 });
    }

    const db = getFirestoreInstance();
    const expoRef = db.collection('expo').doc(expoId);
    const expoSnap = await expoRef.get();
    if (!expoSnap.exists) {
      return NextResponse.json({ success: false, message: 'Expo not found' }, { status: 404 });
    }

    const expo = serializeValue(expoSnap.data() || {}) || {};
    const eventId = String(expo?.eventId || '').trim() || 'unknown-event';

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const ext = normalizeExt(file.name, mimeType);
    const baseName = safeName(file.name.replace(/\.[^.]+$/, '') || 'layout');
    const objectName = `${Date.now()}-${baseName}.${ext}`;
    const objectPath = `expoLayouts/${eventId}/${expoId}/${objectName}`;

    const storage = getStorageInstance();
    const bucket = storage.bucket();
    const storageFile = bucket.file(objectPath);
    await storageFile.save(buffer, {
      metadata: {
        contentType: mimeType,
      },
      resumable: false,
      public: true,
    });

    const fileUrl = `https://storage.googleapis.com/${bucket.name}/${objectPath}`;

    const layout = {
      fileName: file.name,
      fileUrl,
      fileType: ext,
      storagePath: objectPath,
      uploadedAt: new Date().toISOString(),
    };

    await expoRef.set(
      {
        layout,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await db.collection('expoLayouts').doc(`${expoId}:${Date.now()}`).set(
      {
        expoId,
        eventId,
        ...layout,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({ success: true, layout });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to upload layout' },
      { status: 500 },
    );
  }
}
