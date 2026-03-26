// src/app/api/admin/bulk-upload-users/route.ts
import { NextResponse } from 'next/server';
import { getFirestoreInstance, getAuthInstance } from '@/lib/firebaseAdmin';
import * as XLSX from 'xlsx';
import { startJob, updateJobProgress } from '@/lib/jobManager';
import { parse as parseDateFns, isValid as isDateValid } from 'date-fns';
import { _updateUserFromParticipantData } from '@/lib/actions/userActions';

// This function now represents the background processing task
async function processUserUploadJob(jobId: string, fileBuffer: Buffer) {
  const actionName = '[API /bulk-upload-users BG Job]';
  let successCount = 0;
  let errorCount = 0;
  let results: Array<{ row: number; email: string; name: string; status: 'success' | 'error' | 'warning'; detail: string }> = [];

  const parseSheetDate = (dateVal?: any): string | null => {
    if (!dateVal) return null;
    let date: Date | null = null;
    if (typeof dateVal === 'number' && dateVal > 25569) { // Excel's numeric date format
      date = new Date((dateVal - 25569) * 86400 * 1000);
    } else if (typeof dateVal === 'string') {
      const trimmedDate = dateVal.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
        date = parseDateFns(trimmedDate, 'yyyy-MM-dd', new Date());
      } else if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(trimmedDate)) {
        const formattedStr = trimmedDate.replace(/\//g, '-');
        date = parseDateFns(formattedStr, 'dd-MM-yyyy', new Date());
      } else {
        date = new Date(trimmedDate);
      }
    } else if (dateVal instanceof Date) {
      date = dateVal;
    }
    if (date && isDateValid(date)) {
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return null;
  };

  try {
    const adminDb = getFirestoreInstance();
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { raw: false });
    const totalRows = jsonData.length;

    // Helper to get value from row with case-insensitive and alternative header names
    const getVal = (row: any, primaryHeader: string, altHeaders: string[] = []): string | null => {
        const lowerPrimary = primaryHeader.toLowerCase();
        const lowerAlts = altHeaders.map(h => h.toLowerCase());
        for (const key in row) {
            const lowerKey = key.toLowerCase();
            if (lowerKey === lowerPrimary || lowerAlts.includes(lowerKey)) {
                const value = row[key];
                return value !== null && value !== undefined ? String(value).trim() : null;
            }
        }
        return null;
    };


    for (let i = 0; i < totalRows; i++) {
        const row = jsonData[i];
        const rowIndex = i + 2;
        
        const name = getVal(row, 'Athlete Name');
        const email = getVal(row, 'Email Address');

        if (!name || !email) {
            results.push({ row: rowIndex, email: email || 'N/A', name: name || 'N/A', status: 'error', detail: `Row ${rowIndex}: Name and Email are required.` });
            errorCount++;
            await updateJobProgress(jobId, { status: 'processing', progress: ((i + 1) / totalRows) * 100, results });
            continue;
        }
        
        const lowerEmail = email.toLowerCase();

        try {
            const userPayload = {
                name: name,
                email: lowerEmail,
                mobile: getVal(row, 'Phone Number', ['Phone number']),
                gender: getVal(row, 'Gender'),
                dob: parseSheetDate(getVal(row, 'DOB')),
                tshirtSize: getVal(row, 'T-shirt Size'),
                bloodGroup: getVal(row, 'Blood Group'),
                emergencyContactNumber: getVal(row, 'Emergency Contact'),
                address: getVal(row, 'Address'),
                city: getVal(row, 'City'),
                state: getVal(row, 'State'),
                country: getVal(row, 'Country') || 'India',
                pincode: getVal(row, 'Pincode'),
            };
            
            // This helper function handles both creation and update logic
            await _updateUserFromParticipantData(userPayload);

            results.push({ row: rowIndex, email: lowerEmail, name, status: 'success', detail: `User profile created/updated.` });
            successCount++;
        } catch (innerError: any) {
            results.push({ row: rowIndex, email: lowerEmail, name, status: 'error', detail: `Error: ${innerError.message}` });
            errorCount++;
        }
        await updateJobProgress(jobId, { status: 'processing', progress: ((i + 1) / totalRows) * 100, results });
    }
    
    let finalMsg = `Processing complete. Success/Updated: ${successCount}, Failed: ${errorCount}.`;
    await updateJobProgress(jobId, { status: 'completed', progress: 100, results, message: finalMsg });

  } catch (error: any) {
    console.error(`[${actionName}] Critical error for job ${jobId}:`, error);
    await updateJobProgress(jobId, { status: 'failed', progress: 100, results, message: `Critical error: ${error.message}` });
  }
}

export async function POST(request: Request) {
  const actionName = '[API /bulk-upload-users]';
  try {
    const formData = await request.formData();
    const file = formData.get('userSheet') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, message: "User data file is required." }, { status: 400 });
    }
    
    const bytes = await file.arrayBuffer();
    const fileBuffer = Buffer.from(bytes);
    
    const { jobId } = await startJob();
    
    // Do not await this. Let it run in the background.
    processUserUploadJob(jobId, fileBuffer);

    return NextResponse.json({ success: true, message: "Upload started.", jobId });

  } catch (error: any) {
    console.error(`[${actionName}] Critical error during initial upload handling:`, error);
    return NextResponse.json({ success: false, message: `Critical upload error: ${error.message}.` }, { status: 500 });
  }
}
