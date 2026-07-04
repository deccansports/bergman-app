// src/lib/zoho/customer.ts
import { zohoFetch } from "./fetch";
import { getStateName } from "../utils";

/**
 * FIND CUSTOMER BY EMAIL (Includes Inactive)
 */
export async function findZohoCustomerByEmail(email: string): Promise<any | null> {
  if (!email) return null;
  const cleanEmail = email.toLowerCase().trim();
  
  try {
    const data = await zohoFetch('/contacts', { params: { email: cleanEmail, status: 'all' } });
    if (data.contacts && Array.isArray(data.contacts) && data.contacts.length > 0) {
        return data.contacts[0];
    }
    return null;
  } catch { return null; }
}

/**
 * FIND CUSTOMER BY NAME
 * Used as a rescue lookup when email search misses but name exists.
 */
export async function findZohoCustomerByName(name: string): Promise<any | null> {
  if (!name) return null;
  const cleanName = name.trim().replace(/[^\x20-\x7E]/g, "");
  try {
    const data = await zohoFetch('/contacts', { params: { contact_name: cleanName, status: 'all' } });
    if (!data.contacts || !Array.isArray(data.contacts)) return null;
    
    return data.contacts.find((contact: any) => 
        (contact.contact_name || '').trim().toLowerCase() === cleanName.toLowerCase()
    ) || null;
  } catch { return null; }
}

/**
 * CREATE CUSTOMER
 */
export async function createZohoCustomer(data: any): Promise<any> {
    const cleanData = { ...data };
    
    if (!cleanData.contact_name) {
        cleanData.contact_name = cleanData.name && cleanData.email 
            ? `${cleanData.name} (${cleanData.email})` 
            : (cleanData.name || cleanData.email);
    }
    
    if (cleanData.contact_name) {
        cleanData.contact_name = cleanData.contact_name
            .replace(/[^\x20-\x7E]/g, "")
            .substring(0, 100)
            .trim();
    }

    if (!cleanData.gst_treatment) {
        cleanData.gst_treatment = data.gstin ? "business_gst" : "consumer";
    }

    if (cleanData.mobile || cleanData.phone) {
        const phone = (cleanData.mobile || cleanData.phone).replace(/\D/g, '').slice(-10);
        cleanData.mobile = phone;
        cleanData.phone = phone;
    }
    
    return (await zohoFetch(`/contacts`, { method: "POST", body: cleanData })).contact;
}

/**
 * UPDATE CUSTOMER
 */
export async function updateZohoCustomer(contactId: string, data: any): Promise<any> {
  const cleanData = { ...data };
  
  if (cleanData.contact_name) {
      cleanData.contact_name = cleanData.contact_name
          .replace(/[^\x20-\x7E]/g, "")
          .substring(0, 100)
          .trim();
  }

  if (cleanData.billing_address) {
      const addr = cleanData.billing_address;
      Object.keys(addr).forEach(k => { 
          if (addr[k] === '') addr[k] = undefined;
          if (k === 'state' && addr[k]) addr[k] = getStateName(addr[k]) || addr[k];
      });
      if (addr.state) addr.country = "India";
      if (addr.address) addr.address = addr.address.replace(/[^\x20-\x7E]/g, "").replace(/[<>"'`]/g, "").substring(0, 128).trim();
      if (addr.city) addr.city = addr.city.replace(/[^\x20-\x7E]/g, "").substring(0, 50).trim();
  }

  return zohoFetch(`/contacts/${contactId}`, { method: "PUT", body: cleanData });
}
