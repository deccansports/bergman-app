
'use server';
/**
 * @fileOverview Elite Bergman AI Agent powered by Groq with Auto-Learning.
 *
 * - askEliteAi - Advanced semantic chat with athlete-awareness, event-context, and learned knowledge.
 * - EliteAiInput - Input including user context, question, and event details.
 */

import { z } from 'zod';
import { searchSimilarQuestions, saveChatMemory, formatPastAnswers, searchClubsFromKV, formatClubsContext } from '@/lib/chatMemory';

const EliteAiInputSchema = z.object({
  question: z.string().describe("The user's question."),
  context: z.array(z.object({
    question: z.string(),
    answer: z.string()
  })).describe('Available general knowledge base.'),
  userProfile: z.object({
    name: z.string().optional().nullable(),
    tier: z.string().optional().nullable(),
    points: z.number().optional().nullable(),
    upcomingRaces: z.array(z.string()).optional().nullable(),
    uid: z.string().optional().nullable(),
  }).optional().nullable().describe('The current logged in athlete context.'),
  eventContext: z.array(z.object({
    eventName: z.string(),
    description: z.string().optional().nullable(),
    customRules: z.string().optional().nullable(),
    cutoffInfo: z.string().optional().nullable(),
    venue: z.string().optional().nullable(),
  })).optional().nullable().describe('Specific details about upcoming race events.'),
});

export type EliteAiInput = z.infer<typeof EliteAiInputSchema>;

async function callGroqAPI(prompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 second timeout

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', // Updated from deprecated mixtral-8x7b-32768
        messages: [
          {
            role: 'system',
            content: 'You are the Bergman Elite AI Assistant. Provide accurate, concise answers based on the context provided.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2, // Lower temp for faster, more deterministic responses
        max_tokens: 512, // Reduced from 1024 for faster responses
        top_p: 0.8, // Better for speed
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Groq API error: ${response.status} ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('AI response timed out. Please try a simpler question.');
    }
    throw error;
  }
}

/**
 * Check if question is asking for private data (registrations, personal records, profile info)
 * about someone other than the current user
 */
function checkPrivateDataAccess(question: string, userProfile: EliteAiInput['userProfile']): { allowed: boolean; message?: string } {
  const lowerQuestion = question.toLowerCase();
  
  // Private data keywords that require authentication
  const privateDataKeywords = ['registration', 'bib', 'bibNumber', 'my race', 'my registration', 'my entry', 'my results', 'my performance', 'my profile', 'my data', 'my status'];
  const isPrivateQuery = privateDataKeywords.some(kw => lowerQuestion.includes(kw));
  
  if (isPrivateQuery) {
    // Check if user is logged in
    if (!userProfile || !userProfile.uid) {
      return {
        allowed: false,
        message: 'This is private information. Please **[log in](/login)** to view your registration details, bib numbers, and personal race data.'
      };
    }

    // Check if asking about another athlete
    const anotherAthleteKeywords = ['check', 'lookup', 'search', 'find', 'get', 'see', 'view', 'list'];
    const dataAboutPattern = ['registration for', 'results for', 'profile for', 'data for', 'entry for'];
    
    const isAskingAboutOther = 
      anotherAthleteKeywords.some(kw => lowerQuestion.includes(kw)) &&
      (dataAboutPattern.some(pattern => lowerQuestion.includes(pattern)) ||
       (lowerQuestion.match(/[a-zA-Z]+/g)?.some(word => word.length > 3 && !['registration', 'bib', 'results', 'profile', 'data', 'entry'].includes(word))));
    
    if (isAskingAboutOther) {
      return {
        allowed: false,
        message: 'We **cannot share** another athlete\'s personal data, registrations, or results. This information is private and protected. You can only access your own registration details.'
      };
    }
  }
  
  return { allowed: true };
}


export async function askEliteAi(input: EliteAiInput): Promise<string> {
  try {
    // 🔐 CHECK PRIVATE DATA ACCESS FIRST
    const accessCheck = checkPrivateDataAccess(input.question, input.userProfile);
    if (!accessCheck.allowed) {
      return accessCheck.message || 'Access denied to private information.';
    }

    const contextString = (input.context && Array.isArray(input.context))
      ? input.context
        .map(faq => `Q: ${faq.question}\nA: ${faq.answer}`)
        .join('\n\n')
      : 'No general knowledge base provided.';

    const eventString = (input.eventContext && Array.isArray(input.eventContext))
      ? input.eventContext.map(e => `
      EVENT: ${e.eventName}
      VENUE: ${e.venue || 'TBD'}
      DESCRIPTION: ${e.description || 'N/A'}
      CUTOFFS: ${e.cutoffInfo || 'Standard rules apply'}
      SPECIAL RULES: ${e.customRules || 'None'}
    `).join('\n---\n')
      : 'No specific event data provided.';

    const profileString = input.userProfile 
      ? `ATHLETE CONTEXT:
         - Name: ${input.userProfile.name}
         - Tier: ${input.userProfile.tier}
         - Points: ${input.userProfile.points}
         - Registered for: ${input.userProfile.upcomingRaces?.join(', ') || 'No upcoming races'}`
      : 'ATHLETE CONTEXT: Guest User (Unknown)';

    // 🚀 OPTIMIZATION: Run memory & clubs lookup in parallel, but don't block main response
    let learnedContext = '';
    let clubsContext = '';
    
    // Start parallel non-blocking tasks
    const parallelTasks = [];
    
    // Task 1: Search learned memories (non-blocking - for future improvement)
    const memoryTask = searchSimilarQuestions(input.question, 2)
      .then(memories => formatPastAnswers(memories))
      .then(context => { learnedContext = context; })
      .catch(err => console.warn('Memory search failed:', err));
    
    // Task 2: Search clubs if applicable (non-blocking)
    const clubKeywords = ['club', 'training', 'coach', 'coaching', 'trainer', 'endurance', 'triathlon club', 'join club'];
    const isClubQuery = clubKeywords.some(kw => input.question.toLowerCase().includes(kw));
    
    if (isClubQuery) {
      const clubsTask = (async () => {
        try {
          const cities = ['bangalore', 'bengaluru', 'pune', 'mumbai', 'delhi', 'hyderabad', 'goa', 'kolkata', 'chennai', 'ahmedabad'];
          const mentionedCity = cities.find(city => input.question.toLowerCase().includes(city));
          
          const clubs = await searchClubsFromKV(mentionedCity);
          if (clubs.length > 0) {
            clubsContext = `\n\nRELEVANT CLUBS FOR TRAINING:\n${await formatClubsContext(clubs)}`;
          }
        } catch (err) {
          console.warn('Clubs search failed:', err);
        }
      })();
      parallelTasks.push(clubsTask);
    }
    
    parallelTasks.push(memoryTask);
    
    // Don't wait for parallel tasks - proceed to AI call immediately
    // These will complete in the background and be available if needed later

    const prompt = `You are the Bergman Elite AI Assistant for Bergman Triathlon events in India.

RULES: 
- Answer ONLY from the provided context. If info not available, suggest [Contact Us](/contact-us)
- Use **bold**, bullet lists, and links for clarity
- Link format: [Text](/path)
- Personalize with athlete's name if available

${profileString}

EVENTS:
${eventString}

FAQs:
${contextString}${learnedContext}${clubsContext}

QUESTION: ${input.question}`;

    console.log('[Elite AI] Calling Groq with question:', input.question);
    const result = await callGroqAPI(prompt);
    console.log('[Elite AI] Groq responded successfully');
    
    // Save this Q&A to memory for future learning (non-blocking)
    saveChatMemory(input.question, result).catch(err => console.warn('Memory save failed:', err));
    
    return result;
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Elite AI] Flow Error:', {
      message: errorMsg,
      type: error instanceof Error ? error.constructor.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined
    });
    
    // Handle Groq API errors
    if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
      console.error('[Elite AI] Authentication failed - Invalid Groq API key');
      throw new Error('AI service authentication failed. Please check your configuration.');
    }
    
    if (errorMsg.includes('429') || errorMsg.includes('Rate limit')) {
      throw new Error('AI service is busy. Please try again in a moment.');
    }
    
    if (errorMsg.includes('GROQ_API_KEY')) {
      console.error('[Elite AI] Groq API key not configured');
      throw new Error('AI service is not configured. Please contact support.');
    }
    
    // Generic error with safe message
    throw new Error('AI service error: Please try again or contact support.');
  }
}
