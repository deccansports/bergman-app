import test from 'node:test';
import assert from 'node:assert/strict';

import { authOtpConfig } from '@/lib/auth/authConfig';
import {
  __buildTemplatePayloadForTest,
  getActiveEmailProviderConfig,
  sendTemplateEmailViaProvider,
} from '@/lib/auth/emailProvider';

test('template IDs remain unchanged after provider migration', () => {
  assert.equal(authOtpConfig.brevo.registrationConfirmationTemplateId, 199);
  assert.equal(authOtpConfig.brevo.waiverOtpTemplateId, 174);
  assert.equal(authOtpConfig.brevo.feedbackCouponTemplateId, 250);
});

test('provider payload keeps template ID and normalized recipient', () => {
  const payload = __buildTemplatePayloadForTest({
    templateId: 257,
    recipientEmail: 'USER@Example.COM ',
    params: { name: 'Athlete' },
    senderEmail: 'info@bergmantri.com',
    senderName: 'Bergman',
  });

  assert.equal(payload.templateId, 257);
  assert.equal(payload.to[0].email, 'user@example.com');
  assert.equal(payload.sender.email, 'info@bergmantri.com');
});

test('sendTemplateEmailViaProvider uses BergTechno endpoint and API key header', async () => {
  process.env.BERGTECHNO_EMAIL_API_BASE_URL = 'https://api.bergtechno.example';
  process.env.BERGTECHNO_EMAIL_API_KEY = 'secret-key';
  process.env.BERGTECHNO_EMAIL_API_KEY_HEADER = 'x-bt-key';
  process.env.BERGTECHNO_EMAIL_TEMPLATE_SEND_PATH = '/emails/send-template';

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = global.fetch;

  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    return {
      ok: true,
      json: async () => ({ success: true }),
    } as Response;
  }) as typeof fetch;

  try {
    await getActiveEmailProviderConfig(true);
    const sent = await sendTemplateEmailViaProvider({
      templateId: 199,
      recipientEmail: 'athlete@example.com',
      params: { name: 'Athlete' },
    });

    assert.equal(sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.bergtechno.example/emails/send-template');
    assert.equal((calls[0].init.headers as Record<string, string>)['x-bt-key'], 'secret-key');
  } finally {
    global.fetch = originalFetch;
  }
});
