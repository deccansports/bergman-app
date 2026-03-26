// src/lib/actions/pageActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import type { HomepageSliderItem, Page, FooterConfig } from '@/lib/types';
import { serializeValue } from '@/lib/utils';
import { initialSliderItems, initialPages } from '@/lib/initial-cms-data';

const CMS_COLLECTION = 'cms_content';
const HOMEPAGE_DOC = 'homepage';
const PAGES_DOC = 'static_pages';
const FOOTER_DOC = 'footer';

// --- Page Actions ---

export async function getPagesAction(): Promise<{ success: boolean; pages: Page[] }> {
    try {
        const adminDb = getFirestoreInstance();
        const docSnap = await adminDb.collection(CMS_COLLECTION).doc(PAGES_DOC).get();
        if (!docSnap.exists) {
            // If the document doesn't exist, create it with the initial hardcoded data.
            await adminDb.collection(CMS_COLLECTION).doc(PAGES_DOC).set({ pages: initialPages });
            return { success: true, pages: serializeValue(initialPages) };
        }
        const data = docSnap.data();
        // Return pages in the order they are stored in the database
        const pages = data?.pages || [];
        return { success: true, pages: serializeValue(pages) };
    } catch (error: any) {
        console.error(`[getPagesAction] Error: ${error.message}`);
        return { success: false, pages: serializeValue(initialPages) }; // Fallback to initial data on error
    }
}

export async function savePagesAction(pages: Page[]): Promise<{ success: boolean; message: string }> {
    try {
        const adminDb = getFirestoreInstance();
        await adminDb.collection(CMS_COLLECTION).doc(PAGES_DOC).set({ pages });

        // Revalidate all paths that might be affected
        revalidatePath('/');
        revalidatePath('/races');
        pages.forEach(page => {
            if (page.slug && page.slug !== 'home') {
                revalidatePath(`/pages/${page.slug}`);
            }
        });
        revalidatePath('/admin/dashboard');
        
        return { success: true, message: 'Pages saved successfully.' };
    } catch (error: any) {
        console.error(`[savePagesAction] Error: ${error.message}`);
        return { success: false, message: `Failed to save pages: ${error.message}` };
    }
}


// --- Slider Actions ---

export async function getHomepageSliderItemsAction(): Promise<{ success: boolean; items?: HomepageSliderItem[] }> {
    try {
        const adminDb = getFirestoreInstance();
        const docSnap = await adminDb.collection(CMS_COLLECTION).doc(HOMEPAGE_DOC).get();
        if (!docSnap.exists) {
            await adminDb.collection(CMS_COLLECTION).doc(HOMEPAGE_DOC).set({
                sliderItems: initialSliderItems
            });
            return { success: true, items: serializeValue(initialSliderItems) }; 
        }
        const data = docSnap.data();
        return { success: true, items: serializeValue(data?.sliderItems || []) };
    } catch (error: any) {
        console.error(`[getHomepageSliderItemsAction] Error: ${error.message}`);
        return { success: false, items: [] };
    }
}

export async function saveHomepageSliderItemsAction(items: HomepageSliderItem[]): Promise<{ success: boolean; message: string }> {
    try {
        const adminDb = getFirestoreInstance();
        await adminDb.collection(CMS_COLLECTION).doc(HOMEPAGE_DOC).set({
            sliderItems: items
        }, { merge: true });

        revalidatePath('/'); // Revalidate the homepage to show changes
        revalidatePath('/admin/dashboard');
        return { success: true, message: 'Homepage slider items updated successfully.' };
    } catch (error: any) {
        console.error(`[saveHomepageSliderItemsAction] Error: ${error.message}`);
        return { success: false, message: `Failed to save slider items: ${error.message}` };
    }
}

// --- Footer Actions ---

export async function getFooterConfigAction(): Promise<{ success: boolean; config?: FooterConfig }> {
    try {
        const adminDb = getFirestoreInstance();
        const docSnap = await adminDb.collection(CMS_COLLECTION).doc(FOOTER_DOC).get();
        if (!docSnap.exists) {
            // Default config if it doesn't exist
            const defaultConfig: FooterConfig = {
                tagline: "Promoting sports and a healthy lifestyle through events.",
                htmlContent: "<p>Copyright © 2026 BERGMAN. All rights reserved.</p>",
                socials: {
                    instagram: "https://instagram.com/bergmantri",
                    facebook: "https://facebook.com/bergmantri",
                    x: "https://x.com/bergmantri",
                    youtube: "https://youtube.com/@bergmantri",
                    threads: null
                }
            };
            await adminDb.collection(CMS_COLLECTION).doc(FOOTER_DOC).set(defaultConfig);
            return { success: true, config: serializeValue(defaultConfig) };
        }
        return { success: true, config: serializeValue(docSnap.data()) as FooterConfig };
    } catch (error: any) {
        console.error(`[getFooterConfigAction] Error: ${error.message}`);
        return { success: false };
    }
}

export async function saveFooterConfigAction(config: FooterConfig): Promise<{ success: boolean; message: string }> {
    try {
        const adminDb = getFirestoreInstance();
        await adminDb.collection(CMS_COLLECTION).doc(FOOTER_DOC).set(config, { merge: true });
        revalidatePath('/'); // Revalidate all pages that might show the footer
        revalidatePath('/admin/dashboard');
        return { success: true, message: 'Footer configuration saved successfully.' };
    } catch (error: any) {
        console.error(`[saveFooterConfigAction] Error: ${error.message}`);
        return { success: false, message: `Failed to save footer configuration: ${error.message}` };
    }
}
