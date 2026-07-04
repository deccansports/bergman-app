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
        let pages: Page[] = data?.pages || [];

        // Normalize legacy pages missing access mode.
        let didNormalize = false;
        pages = pages.map((page) => {
            if (
                page.requiresLogin === undefined ||
                page.showInFooter === undefined ||
                page.footerCategory === undefined
            ) {
                didNormalize = true;
                return {
                    ...page,
                    requiresLogin: !!page.requiresLogin,
                    showInFooter: !!page.showInFooter,
                    footerCategory: page.footerCategory ?? 'Explore',
                };
            }
            return page;
        });

        // Merge any missing system pages (e.g. Race Photos added later)
        const existingIds = new Set(pages.map((p: Page) => p.id));
        const missingSystemPages = initialPages.filter(p => !existingIds.has(p.id));
        if (missingSystemPages.length > 0) {
            pages = [...pages, ...missingSystemPages];
            await adminDb.collection(CMS_COLLECTION).doc(PAGES_DOC).set({ pages });
        } else if (didNormalize) {
            await adminDb.collection(CMS_COLLECTION).doc(PAGES_DOC).set({ pages });
        }

        return { success: true, pages: serializeValue(pages) };
    } catch (error: any) {
        console.error(`[getPagesAction] Error: ${error.message}`);
        return { success: false, pages: serializeValue(initialPages) }; // Fallback to initial data on error
    }
}

export async function savePagesAction(pages: Page[]): Promise<{ success: boolean; message: string }> {
    try {
        const adminDb = getFirestoreInstance();
        const normalizedPages = pages.map((page) => ({
            ...page,
            requiresLogin: !!page.requiresLogin,
            showInFooter: !!page.showInFooter,
            footerCategory: page.footerCategory ?? 'Explore',
        }));

        await adminDb.collection(CMS_COLLECTION).doc(PAGES_DOC).set({ pages: normalizedPages });

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

/**
 * MIGRATION: Fix page URLs for About Us and Training pages
 * These should show /about and /training instead of /content/about and /content/training
 */
export async function fixPageUrlsMigration(): Promise<{ success: boolean; message: string }> {
    try {
        const adminDb = getFirestoreInstance();
        const docSnap = await adminDb.collection(CMS_COLLECTION).doc(PAGES_DOC).get();
        
        if (!docSnap.exists) {
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

            return page;
        });

        // Save the updated pages
        await adminDb.collection(CMS_COLLECTION).doc(PAGES_DOC).set({ pages: updatedPages });

        revalidatePath('/');
        revalidatePath('/admin/dashboard');

        return { success: true, message: 'Page URLs fixed successfully' };
    } catch (error: any) {
        console.error(`[fixPageUrlsMigration] Error: ${error.message}`);
        return { success: false, message: `Migration failed: ${error.message}` };
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
