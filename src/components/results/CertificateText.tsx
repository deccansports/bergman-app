// src/components/results/CertificateText.tsx
export function cleanText(value: string | null | undefined): string {
    if (!value) return "";
    // Removes emojis and other non-standard characters that can break PDF generation
    // This regex is compatible with ES5 environments.
    return value.replace(/[^\x00-\x7F]/g, "").trim();
}
