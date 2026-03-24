// src/app/api/ai/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import { searchKnowledgeBaseAction } from "@/lib/actions/faqActions";
import { getCalendarEventsAction } from "@/lib/actions/eventActions";
import { getFirestoreInstance } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { isBefore, parseISO, startOfDay } from "date-fns";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `
You are the Bergman Elite AI Assistant.

YOUR ROLE:
- Help athletes with registrations, race info, rules, and timings.
- Answer ONLY from provided context (FAQs and Website Data).
- Keep the tone elite, motivating, and professional.
- For rules or policies, provide the FULL information as found in the context.
- Keep answers under 250 words unless providing full rules.

RULES:
- No guessing or hallucination.
- If not found in the context → say: "I couldn’t find an exact answer for that yet. Please contact info@bergmantri.com."

LINKS:
- Club Rankings: /club-rankings
- Athlete Rankings: /athlete-rankings
- Official Shop: /shop
- Upcoming Races: /races
`;

export async function POST(req: NextRequest) {
  try {
    const { question, userProfile } = await req.json();

    if (!question) {
      return NextResponse.json({ error: "Question required" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_GENAI_API_KEY;

    if (!apiKey) {
      console.error("❌ Missing GOOGLE_GENAI_API_KEY in environment");
      throw new Error("Missing API Configuration");
    }

    const [knowledgeContext, eventResult] = await Promise.all([
      searchKnowledgeBaseAction(question),
      getCalendarEventsAction()
    ]);

    const today = startOfDay(new Date());

    const upcomingEvents = (eventResult?.events || []).filter(e => {
      if (!e.eventDate || e.eventDate === "TBD") return true;
      try {
        return !isBefore(parseISO(e.eventDate), today);
      } catch {
        return false;
      }
    });

    const eventKnowledge = upcomingEvents.map(e => {
      const cutoffs = e.ticketDefinitions
        ?.map(t => `${t.ticketName}: ${t.cutoffs?.overall || "N/A"}`)
        .join(" | ");

      return `EVENT: ${e.eventName}\nDATE: ${e.eventDate}\nVENUE: ${e.venueName}\nCUTOFFS: ${cutoffs}\n---`;
    }).join("\n");

    const athleteContext = userProfile
      ? `ATHLETE PROFILE:\nName: ${userProfile.name}\nTier: ${userProfile.tier}\n`
      : "";

    const prompt = `
SYSTEM:
${SYSTEM_PROMPT}

KNOWLEDGE BASE (WEBSITE & FAQS):
${knowledgeContext}

UPCOMING EVENT DATA:
${eventKnowledge}

${athleteContext}

USER QUESTION:
${question}
`;

    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1000 
          }
        })
      }
    );

    const data = await apiRes.json();

    if (!apiRes.ok) {
      console.error("❌ Gemini API Error:", JSON.stringify(data, null, 2));
      throw new Error(data?.error?.message || "AI engine recalibration required.");
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I couldn’t find an exact answer for that yet. Please contact info@bergmantri.com.";

    // LOGGING (NON-BLOCKING)
    try {
      const adminDb = getFirestoreInstance();
      await adminDb.collection("aiLogs").add({
        userName: userProfile?.name || "Guest",
        question,
        answer: reply,
        timestamp: FieldValue.serverTimestamp()
      });
    } catch (logErr) {
      console.warn("⚠️ Log failed:", logErr);
    }

    return NextResponse.json({ reply });

  } catch (err: any) {
    console.error("🔥 AI API ERROR:", err.message);

    return NextResponse.json(
      {
        reply: "Please try again in a moment or contact info@bergmantri.com.",
        error: err.message
      },
      { status: 500 }
    );
  }
}
