
/**
 * Bergman Anti-Spam Heuristics
 */
export function calculateSpamScore(data: { name: string; email: string; message: string }): { isSpam: boolean; score: number } {
  let score = 0;

  // 1. Name Analysis
  if (data.name.length < 3) score += 50;
  if (/\d{5,}/.test(data.name)) score += 40; // Too many digits in name
  if (/[<>(){}[\]]/.test(data.name)) score += 30; // Code chars in name

  // 2. Email Analysis
  if (!data.email.includes("@") || !data.email.includes(".")) score += 100;
  
  // 3. Content Analysis
  const spamKeywords = ['crypto', 'viagra', 'seo', 'marketing', 'buy', 'free', 'investment'];
  const lowerMessage = data.message.toLowerCase();
  
  spamKeywords.forEach(word => {
    if (lowerMessage.includes(word)) score += 15;
  });

  if (lowerMessage.length < 10) score += 30;
  if (/(http|https):\/\//.test(lowerMessage)) score += 10; // Links often found in spam

  return {
    score,
    isSpam: score >= 50
  };
}
