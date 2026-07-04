/**
 * Migration: Fix page URLs for About Us and Training pages
 * These pages should use /about and /training instead of /content/about and /content/training
 */

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { Page } from '@/lib/types';

const CMS_COLLECTION = 'cms_content';
const PAGES_DOC = 'static_pages';

export async function fixPageUrls() {
  try {
    const adminDb = getFirestoreInstance();
    const docSnap = await adminDb.collection(CMS_COLLECTION).doc(PAGES_DOC).get();
    
    if (!docSnap.exists) {
      console.log('[fixPageUrls] Pages document does not exist');
      return { success: false, message: 'Pages document does not exist' };
    }

    const data = docSnap.data();
    const pages = data?.pages || [];

    // Fix the page URLs
    const updatedPages = pages.map((page: Page) => {
      // Fix About Us page
      if (page.title === 'About Us' || page.slug === 'about') {
        return { ...page, url: '/about' };
      }
      
      // Fix Training page
      if (page.title === 'Training' || page.slug === 'training') {
        return { ...page, url: '/training' };
      }

      // Ensure other pages with explicit URLs keep them
      // And pages without URLs get the default /content/{slug} pattern
      return page;
    });

    // Save the updated pages
    await adminDb.collection(CMS_COLLECTION).doc(PAGES_DOC).set({ pages: updatedPages });

    console.log('[fixPageUrls] Page URLs have been fixed');
    return { success: true, message: 'Page URLs fixed successfully' };
  } catch (error: any) {
    console.error('[fixPageUrls] Error:', error.message);
    return { success: false, message: `Migration failed: ${error.message}` };
  }
}
