// src/app/api/admin/upload-event-asset/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance, getStorageInstance } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { runDataSyncAction } from '@/lib/actions/dataSyncActions';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_GPX_TYPES = ['application/gpx+xml', 'application/xml', 'text/xml', 'application/octet-stream', 'application/gpx'];
const ALLOWED_PDF_TYPES = ['application/pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

type AssetType = 
  | 'image' 
  | 'finishLedLogoUrl'
  | 'swimGpxUrl' | 'bikeGpxUrl' | 'runGpxUrl' | 'run1GpxUrl' | 'run2GpxUrl'
  | 'athleteGuideBookUrl';


export async function POST(request: NextRequest) {
  const actionName = '[API /admin/upload-event-asset]';

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const type = formData.get('type') as AssetType | null;
    const eventId = formData.get('eventId') as string | null;
    const ticketId = formData.get('ticketId') as string | null; // Can be null for event-level assets

    if (!file || !type || !eventId) {
      return NextResponse.json({ success: false, message: 'Missing file, type, or eventId.' }, { status: 400 });
    }
    
    // Validate file type and size
    const isGpxUpload = type.toLowerCase().includes('gpx');
    const isImageUpload = type === 'image' || type === 'finishLedLogoUrl';
    const isPdfUpload = type === 'athleteGuideBookUrl';

    let fileTypeIsValid = false;
    let expectedType = 'a supported file';

    if (isGpxUpload) {
        fileTypeIsValid = file.name.toLowerCase().endsWith('.gpx') || ALLOWED_GPX_TYPES.includes(file.type);
        expectedType = 'a GPX file';
    } else if (isImageUpload) {
        fileTypeIsValid = ALLOWED_IMAGE_TYPES.includes(file.type);
        expectedType = 'an Image file';
    } else if (isPdfUpload) {
        fileTypeIsValid = ALLOWED_PDF_TYPES.includes(file.type);
        expectedType = 'a PDF file';
    }


    if (!fileTypeIsValid) {
      return NextResponse.json({ success: false, message: `Invalid file type. Expected ${expectedType} but received ${file.type || 'unknown'}.` }, { status: 400 });
    }
    
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, message: 'File size exceeds 5MB limit.' }, { status: 400 });
    }

    const adminDb = getFirestoreInstance();
    const bucket = getStorageInstance().bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
    const fileExtension = file.name.split('.').pop() || 'dat';

    let filePath = '';
    let fieldToUpdate = '';
    let docRef: FirebaseFirestore.DocumentReference;

    if (isImageUpload) {
        filePath = type === 'finishLedLogoUrl'
          ? `event-branding/${eventId}/finish-led-logo-${Date.now()}.${fileExtension}`
          : `event-images/${eventId}/${type}-${Date.now()}.${fileExtension}`;
        fieldToUpdate = type === 'finishLedLogoUrl' ? 'finishLedLogoUrl' : 'photoUrl';
        docRef = adminDb.collection('events').doc(eventId);
    } else if (isPdfUpload) {
        filePath = `event-documents/${eventId}/guidebook-${Date.now()}.${fileExtension}`;
        fieldToUpdate = 'athleteGuideBookUrl';
        docRef = adminDb.collection('events').doc(eventId);
    } else if (isGpxUpload) {
        if (!ticketId) {
            return NextResponse.json({ success: false, message: 'Ticket ID is required for course assets.' }, { status: 400 });
        }
        filePath = `course-assets/${eventId}/${ticketId}/${type}-${Date.now()}.${fileExtension}`;
        fieldToUpdate = `courseMaps.${type}`;
        docRef = adminDb.collection('events').doc(eventId).collection('ticketDefinitions').doc(ticketId);
    } else {
        return NextResponse.json({ success: false, message: 'Unsupported asset type provided.' }, { status: 400 });
    }


    const buffer = Buffer.from(await file.arrayBuffer());
    await bucket.file(filePath).save(buffer, {
      metadata: { contentType: file.type },
      public: true,
    });
    
    const downloadURL = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    
    await docRef.set({ [fieldToUpdate]: downloadURL }, { merge: true });

    // --- SYNC TRIGGER ---
    // Update the public KV cache immediately so changes reflect on the homepage/races page
    await runDataSyncAction('calendar');

    revalidatePath('/admin/dashboard');
    if (isGpxUpload || isPdfUpload) {
        const eventDoc = await adminDb.collection('events').doc(eventId).get();
        const slug = eventDoc.data()?.customSlug;
        if(slug) {
            revalidatePath(`/races/${slug}`);
        }
    }

    return NextResponse.json({ success: true, message: 'Asset uploaded and saved successfully.', downloadURL, fieldToUpdate });
  } catch (error: any) {
    console.error(`[${actionName}] Error:`, error);
    return NextResponse.json({ success: false, message: `Server error: ${error.message}` }, { status: 500 });
  }
}
