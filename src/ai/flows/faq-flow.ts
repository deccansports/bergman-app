
'use server';
/**
 * @fileOverview Elite Bergman AI Agent.
 *
 * - askEliteAi - Advanced semantic chat with athlete-awareness and event-context.
 * - EliteAiInput - Input including user context, question, and event details.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

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

const eliteAiFlow = ai.defineFlow(
  {
    name: 'eliteAiFlow',
    inputSchema: EliteAiInputSchema,
    outputSchema: z.string(),
  },
  async (input) => {
    const contextString = input.context
      .map(faq => `Q: ${faq.question}\nA: ${faq.answer}`)
      .join('\n\n');

    const eventString = input.eventContext?.map(e => `
      EVENT: ${e.eventName}
      VENUE: ${e.venue || 'TBD'}
      DESCRIPTION: ${e.description || 'N/A'}
      CUTOFFS: ${e.cutoffInfo || 'Standard rules apply'}
      SPECIAL RULES: ${e.customRules || 'None'}
    `).join('\n---\n') || 'No specific event data provided.';

    const profileString = input.userProfile 
      ? `ATHLETE CONTEXT:
         - Name: ${input.userProfile.name}
         - Tier: ${input.userProfile.tier}
         - Points: ${input.userProfile.points}
         - Registered for: ${input.userProfile.upcomingRaces?.join(', ') || 'No upcoming races'}`
      : 'ATHLETE CONTEXT: Guest User (Unknown)';

    const llmResponse = await ai.generate({
      model: googleAI.model('gemini-2.5-flash'),
      prompt: `You are the Bergman Elite AI Assistant, a premium, precise, and highly knowledgeable agent for the Bergman Triathlon series in India.

      YOUR MISSION:
      Provide accurate, encouraging, and status-aware answers based *strictly* on the provided context.

      CORE RULES:
      1. Use the "ATHLETE CONTEXT" to personalize your responses (e.g., "Welcome back, [Name]", "As a [Tier] athlete, you have...").
      2. Answer questions based on the "KNOWLEDGE BASE" and "EVENT KNOWLEDGE" provided. 
      3. If the answer is not in the context, do not make it up. Politely suggest they contact our team by visiting the "Contact Us" page.
      4. Use internal Markdown links for navigation:
         - Club Rankings: [Club Rankings](/club-rankings)
         - Athlete Rankings: [Athlete Rankings](/athlete-rankings)
         - Performance Rewards: [Rewards](/rewards)
         - Official Shop: [Shop](/shop)
         - Upcoming Races: [Races](/races)
         - Contact Support: [Contact Us](/contact-us)
      5. Maintain a "Premium Sporty" tone: Fast, clean, and professional.
      6. If the user asks about cutoffs, distances, or specific venue info, check the EVENT KNOWLEDGE first.
      7. USE MARKDOWN FORMATTING: 
         - Use **bold** for emphasis or key terms.
         - Use bulleted or numbered lists for steps or policy points.
         - Use headers (##) if describing a complex process.
         - Ensure the output is visually structured and easy to read.

      ${profileString}

      EVENT KNOWLEDGE:
      ---
      ${eventString}
      ---

      KNOWLEDGE BASE:
      ---
      ${contextString || "Standard race rules apply."}
      ---

      USER'S QUESTION:
      ${input.question}`,
      config: {
        temperature: 0.3,
      },
    });

    return llmResponse.text;
  }
);

export async function askEliteAi(input: EliteAiInput): Promise<string> {
  try {
    // Verify API key is available
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_GENAI_API_KEY is not configured');
    }
    
    const result = await eliteAiFlow(input);
    return result;
  } catch (error) {
    console.error("Elite AI Flow Error:", error);
    
    // Extract error details
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    
    // Handle 403 Forbidden specifically
    if (errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
      throw new Error('AI service is currently unavailable. Please check your API configuration or try again later.');
    }
    
    // Handle other API errors
    if (errorMsg.includes('generativelanguage.googleapis.com')) {
      throw new Error('Unable to reach AI service. Please ensure your Google API key is valid.');
    }
    
    throw new Error(`AI service error: ${errorMsg}`);
  }
}
