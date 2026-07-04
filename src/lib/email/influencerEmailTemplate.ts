// src/lib/email/influencerEmailTemplate.ts
// Reads the local HTML template, substitutes params, and inlines all CSS via juice
// so the email renders correctly in Gmail/Outlook/Apple Mail (which strip <style> blocks).

import fs from 'fs';
import path from 'path';
import juice from 'juice';

const TEMPLATE_PATH = path.join(process.cwd(), 'brevo infulencer template');

export function buildInfluencerEmailHtml(params: Record<string, string>): string {
  // 1. Read the raw HTML source
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  // 2. Replace all {{ params.xxx }} placeholders with real values
  html = html.replace(/\{\{\s*params\.(\w+)\s*\}\}/g, (_match, key) => {
    return params[key] ?? '';
  });

  // 3. Inline all CSS so it survives Gmail / Outlook stripping <style> blocks
  const inlined = juice(html, {
    removeStyleTags: false,   // keep <style> as fallback for clients that do support it
    applyStyleTags: true,     // also apply them as inline style="" attributes
    preserveMediaQueries: true,
    preserveFontFaces: true,
  });

  return inlined;
}
