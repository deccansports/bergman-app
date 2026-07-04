
/**
 * Bergman Anti-Spam Heuristics
 */
export function calculateSpamScore(data: { name: string; email: string; message: string }): { isSpam: boolean; score: number } {
  let score = 0;
  const lowerName = data.name.toLowerCase().trim();
  const lowerEmail = data.email.toLowerCase().trim();
  const lowerMessage = data.message.toLowerCase().trim();

  // 1. Name Analysis
  if (data.name.length < 3) score += 50;
  if (/\d{5,}/.test(data.name)) score += 40; // Too many digits in name
  if (/[<>(){}[\]]/.test(data.name)) score += 30; // Code chars in name
  if (/test|admin|support|seo|marketing/.test(lowerName)) score += 20;
  if (/(.)\1{5,}/.test(lowerName)) score += 20;

  // 2. Email Analysis
  if (!data.email.includes("@") || !data.email.includes(".")) score += 100;
  if (/temp|disposable|mailinator|guerrillamail|10minutemail/.test(lowerEmail)) score += 35;
  
  // 3. Content Analysis
  const spamKeywords = ['crypto', 'viagra', 'seo', 'marketing', 'buy', 'free', 'investment', 'backlink', 'guest post', 'casino', 'loan', 'forex', 'telegram', 'whatsapp', 'rank your website'];
  
  spamKeywords.forEach(word => {
    if (lowerMessage.includes(word)) score += 15;
  });

  if (lowerMessage.length < 10) score += 30;
  if (/(http|https):\/\//.test(lowerMessage)) score += 20;
  if ((lowerMessage.match(/https?:\/\//g) || []).length > 1) score += 20;
  if ((lowerMessage.match(/\b\w+\.com\b/g) || []).length > 1) score += 20;
  if ((lowerMessage.match(/!/g) || []).length > 5) score += 10;
  if ((lowerMessage.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/g) || []).length > 1) score += 15;
  if (/(.)\1{7,}/.test(lowerMessage)) score += 20;
  if (/\b\d{8,}\b/.test(lowerMessage)) score += 10;

  return {
    score,
    isSpam: score >= 45
  };
}
