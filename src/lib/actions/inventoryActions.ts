// src/lib/actions/inventoryActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { EventInventory, InventoryItemType, AidStationConfig, CustomItem } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { toIsoStringSafe } from '@/lib/utils';
import { getParticipantsForEventAction } from './participantActions';

const INVENTORY_DOC_ID = 'mainInventory'; // Use a consistent ID for the single inventory document per event

export async function getInventoryForEventAction(
  eventId: string
): Promise<{ success: boolean; message: string; inventory?: EventInventory | null }> {
  const actionName = 'getInventoryForEventAction';
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }

  try {
    const adminDb = getFirestoreInstance();
    const inventoryRef = adminDb.collection('events').doc(eventId).collection('inventory').doc(INVENTORY_DOC_ID);
    const inventorySnap = await inventoryRef.get();

    if (!inventorySnap.exists) {
      return { success: true, message: 'No inventory record found for this event.', inventory: null };
    }

    const inventoryData = inventorySnap.data();
    if (!inventoryData) {
       return { success: true, message: 'Inventory record is empty.', inventory: null };
    }

    const serializedInventory: EventInventory = {
      id: inventorySnap.id,
      tshirts: inventoryData.tshirts,
      medals: inventoryData.medals,
      trophies: inventoryData.trophies,
      finisherJerseys: inventoryData.finisherJerseys,
      swimCaps: inventoryData.swimCaps,
      bags: inventoryData.bags,
      waterStationConfig: inventoryData.waterStationConfig, // NEW
      updatedAt: toIsoStringSafe(inventoryData.updatedAt) || undefined,
    };
    
    return { success: true, message: 'Inventory fetched.', inventory: serializedInventory };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function updateInventoryStockAction(
  eventId: string,
  itemType: InventoryItemType,
  key: string,
  change: number,
  fieldToUpdate: 'initial' | 'issued' = 'initial',
  updateMode: 'increment' | 'set' = 'increment',
  gender?: 'Male' | 'Female' | 'Other'
): Promise<{ success: boolean; message: string }> {
  const actionName = 'updateInventoryStockAction';
  if (!eventId || !itemType || (itemType !== 'Bag' && (!key || typeof key !== 'string'))) {
    return { success: false, message: 'Event ID, item type, and key are required.' };
  }

  try {
    const adminDb = getFirestoreInstance();
    const inventoryRef = adminDb.collection('events').doc(eventId).collection('inventory').doc(INVENTORY_DOC_ID);
    
    let baseFieldPath = '';
    let finalKey = key;
    
    if ((itemType === 'T-Shirt' || itemType === 'Finisher Jersey') && gender) {
        finalKey = `${key}_${gender}`;
    }

    switch (itemType) {
      case 'T-Shirt': baseFieldPath = `tshirts.${finalKey}`; break;
      case 'Finisher Jersey': baseFieldPath = `finisherJerseys.${finalKey}`; break;
      case 'Medal': baseFieldPath = `medals.${key}`; break;
      case 'Trophy': baseFieldPath = `trophies.${key}`; break;
      case 'Swim Cap': baseFieldPath = `swimCaps.${key}`; break;
      case 'Bag': baseFieldPath = `bags`; break; 
      case 'Food': return { success: true, message: "Food inventory not tracked."};
      case 'Breakfast': return { success: true, message: "Breakfast inventory not tracked."};
      case 'Lunch': return { success: true, message: "Lunch inventory not tracked."};
      default: return { success: false, message: 'Invalid item type.' };
    }

    await adminDb.runTransaction(async (transaction) => {
        const inventoryDoc = await transaction.get(inventoryRef);
        const fullFieldPath = itemType === 'Bag' ? `${baseFieldPath}.${fieldToUpdate}` : `${baseFieldPath}.${fieldToUpdate}`;
        const updatePayload: { [key: string]: any } = { updatedAt: FieldValue.serverTimestamp() };

        if (!inventoryDoc.exists) {
            const initialData: any = { updatedAt: FieldValue.serverTimestamp() };
            const setNestedProperty = (obj: any, path: string, value: any) => {
                const keys = path.split('.');
                keys.reduce((acc, currentKey, index) => {
                    if (index === keys.length - 1) {
                        acc[currentKey] = value;
                    } else {
                        acc[currentKey] = acc[currentKey] || {};
                    }
                    return acc[currentKey];
                }, obj);
            };

            const initialItemStock = {
                initial: fieldToUpdate === 'initial' ? (updateMode === 'set' ? change : change) : 0,
                issued: fieldToUpdate === 'issued' ? (updateMode === 'set' ? change : change) : 0
            };

            setNestedProperty(initialData, baseFieldPath, initialItemStock);
            transaction.set(inventoryRef, initialData);

        } else {
            if (updateMode === 'set') {
                updatePayload[fullFieldPath] = change;
            } else {
                updatePayload[fullFieldPath] = FieldValue.increment(change);
            }
             transaction.update(inventoryRef, updatePayload);
        }
    });


    revalidatePath('/admin/dashboard');
    return { success: true, message: `Stock for ${itemType} - ${finalKey || 'main'} updated successfully.` };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Stock update failed: ${e.message}` };
  }
}

export async function resetInventoryAction(
    eventId: string,
    itemType: 'medals'
): Promise<{ success: boolean; message: string }> {
    const actionName = 'resetInventoryAction';
    if (!eventId || !itemType) {
        return { success: false, message: "Event ID and item type are required." };
    }
    
    try {
        const adminDb = getFirestoreInstance();
        const inventoryRef = adminDb.collection('events').doc(eventId).collection('inventory').doc(INVENTORY_DOC_ID);
        
        await inventoryRef.update({
            [itemType]: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp()
        });

        revalidatePath('/admin/dashboard');
        return { success: true, message: `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} inventory has been reset.` };
    } catch (e: any) {
        console.error(`[${actionName}] Error resetting ${itemType} inventory:`, e);
        return { success: false, message: `Failed to reset inventory: ${e.message}` };
    }
}


// NEW: Server action to save the water station plan
export async function saveWaterStationConfigAction(
  eventId: string,
  config: AidStationConfig,
  bikeItems: CustomItem[],
  runItems: CustomItem[],
  venueItems: CustomItem[]
): Promise<{ success: boolean; message: string }> {
  const actionName = 'saveWaterStationConfigAction';
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }
  
  try {
    const adminDb = getFirestoreInstance();
    const inventoryRef = adminDb.collection('events').doc(eventId).collection('inventory').doc(INVENTORY_DOC_ID);
    
    const waterStationConfigPayload = {
      config,
      bikeItems,
      runItems,
      venueItems,
    };
    
    await inventoryRef.set({
        waterStationConfig: waterStationConfigPayload,
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    
    revalidatePath(`/admin/dashboard`);
    return { success: true, message: 'Water station plan saved successfully.' };
  } catch (e: any) {
    console.error(`[${actionName}] Error saving water station config:`, e);
    return { success: false, message: `Failed to save plan: ${e.message}` };
  }
}


export async function cloneWaterStationConfigAction(
  sourceEventId: string,
  targetEventId: string
): Promise<{ success: boolean; message: string }> {
  const actionName = 'cloneWaterStationConfigAction';
  if (!sourceEventId || !targetEventId) {
    return { success: false, message: 'Source and Target Event IDs are required.' };
  }

  try {
    const adminDb = getFirestoreInstance();
    const sourceInventoryRef = adminDb.collection('events').doc(sourceEventId).collection('inventory').doc(INVENTORY_DOC_ID);
    const sourceInventorySnap = await sourceInventoryRef.get();

    if (!sourceInventorySnap.exists || !sourceInventorySnap.data()?.waterStationConfig) {
      return { success: false, message: 'Source event does not have a saved water station plan to clone.' };
    }

    const sourceConfig = sourceInventorySnap.data()?.waterStationConfig;

    const targetInventoryRef = adminDb.collection('events').doc(targetEventId).collection('inventory').doc(INVENTORY_DOC_ID);

    await targetInventoryRef.set({
        waterStationConfig: sourceConfig,
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    
    revalidatePath(`/admin/dashboard`);
    return { success: true, message: 'Water station plan cloned successfully.' };

  } catch (e: any) {
    console.error(`[${actionName}] Error cloning water station config:`, e);
    return { success: false, message: `Failed to clone plan: ${e.message}` };
  }
}
