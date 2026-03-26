// src/app/api/admin/upload-sponsor-logo/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getStorageInstance } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

export async function POST(request: NextRequest) {
  const actionName = '[API /admin/upload-sponsor-logo]';

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const eventId = formData.get('eventId') as string | null;

    if (!file || !eventId) {
      return NextResponse.json({ success: false, message: 'Missing file or eventId.' }, { status: 400 });
    }
    
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json({ success: false, message: `Invalid file type. Only image files are allowed.` }, { status: 400 });
    }
    
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, message: 'File size exceeds 2MB limit.' }, { status: 400 });
    }

    const bucket = getStorageInstance().bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
    const fileExtension = file.name.split('.').pop() || 'png';
    const filePath = `sponsors/${eventId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    await bucket.file(filePath).save(buffer, {
      metadata: { contentType: file.type },
      public: true,
    });
    
    const downloadURL = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    
    revalidatePath('/admin/dashboard');

    return NextResponse.json({ success: true, message: 'Sponsor logo uploaded successfully.', downloadURL });
  } catch (error: any) {
    console.error(`[${actionName}] Error:`, error);
    return NextResponse.json({ success: false, message: `Server error: ${error.message}` }, { status: 500 });
  }
}
