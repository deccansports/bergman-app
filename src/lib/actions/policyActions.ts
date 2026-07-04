'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';

const DEFAULT_POLICY_HTML = `
<h3>Cancellation / Category Change / Deferral Policy</h3>
<p>Please review the latest policy before continuing. Key points:</p>
<ul>
  <li>Cancellation, deferral, and category-change requests are governed by Bergman policy windows.</li>
  <li>Applicable fees, refunds, and timelines depend on event date, request date, and category.</li>
  <li>Final approval and accounting actions are processed according to official policy terms.</li>
</ul>
<p>For full details, visit:</p>
<p><a href="/refund-policy" target="_blank" rel="noopener noreferrer">Visit Refund Policy</a></p>
`;

export async function getCancellationCategoryDeferralPolicyAction(): Promise<{
  success: boolean;
  message: string;
  html?: string;
}> {
  const actionName = 'getCancellationCategoryDeferralPolicyAction';

  try {
    const db = getFirestoreInstance();
    const candidateIds = [
      'cancellation-category-deferral',
      'cancellation_category_deferral',
      'refund-policy',
    ];

    for (const id of candidateIds) {
      const snap = await db.collection('policies').doc(id).get();
      if (!snap.exists) continue;

      const data = snap.data() || {};
      const html = String((data as any).html || (data as any).contentHtml || (data as any).content || '').trim();
      if (html) {
        return { success: true, message: 'Policy fetched.', html };
      }
    }

    return { success: true, message: 'Default policy used.', html: DEFAULT_POLICY_HTML };
  } catch (e: any) {
    console.warn(`[${actionName}] Falling back to default policy:`, e?.message || e);
    return { success: true, message: 'Default policy used.', html: DEFAULT_POLICY_HTML };
  }
}
