// src/lib/apiAuth.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { createHash } from 'crypto';

type ValidateApiKeyOptions = boolean | { required?: boolean };

function isRequiredOption(options?: ValidateApiKeyOptions): boolean {
  if (typeof options === 'boolean') return options;
  return options?.required !== false;
}

export async function withApiKey(
  req: NextRequest,
  handler: (request: NextRequest, params?: { params: any }) => Promise<NextResponse>
) {
  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');

  if (!apiKey) {
    return NextResponse.json({ success: false, message: 'Unauthorized: API key is missing.' }, { status: 401 });
  }

  try {
    const adminDb = getFirestoreInstance();
    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    
    const snapshot = await adminDb.collection('apiKeys')
      .where('keyHash', '==', keyHash)
      .limit(1)
      .get();
      
    if (snapshot.empty) {
      return NextResponse.json({ success: false, message: 'Unauthorized: Invalid API key.' }, { status: 403 });
    }

    const keyDoc = snapshot.docs[0];
    
    // Asynchronously update the last used time without waiting for it to complete
    keyDoc.ref.update({ lastUsed: new Date() }).catch(err => {
        console.error(`Failed to update lastUsed for key ${keyDoc.id}:`, err);
    });

    return handler(req);
  } catch (error: any) {
    console.error('[withApiKey] Middleware error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}

// A simplified version that can be used inside existing GET/POST functions
export async function validateApiKey(
  req: NextRequest,
  options?: ValidateApiKeyOptions
): Promise<{ success: boolean; message: string; status: number; anonymous?: boolean }> {
  const required = isRequiredOption(options);
  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) {
    if (!required) {
      return { success: true, message: 'Anonymous access.', status: 200, anonymous: true };
    }
    return { success: false, message: 'Unauthorized: API key is missing.', status: 401 };
  }
  try {
    const adminDb = getFirestoreInstance();
    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    const snapshot = await adminDb.collection('apiKeys').where('keyHash', '==', keyHash).limit(1).get();
    if (snapshot.empty) {
      return { success: false, message: 'Unauthorized: Invalid API key.', status: 403 };
    }
    const keyDoc = snapshot.docs[0];
    keyDoc.ref.update({ lastUsed: new Date() }).catch(err => console.error(`Failed to update lastUsed for key ${keyDoc.id}:`, err));
    return { success: true, message: 'Authenticated.', status: 200 };
  } catch (error: any) {
    return { success: false, message: 'Internal Server Error', status: 500 };
  }
}
