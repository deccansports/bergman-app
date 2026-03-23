// functions/src/index.ts
import { onRequest } from "firebase-functions/v2/https";
import * as functions from "firebase-functions/v2";
import { db } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { sendFeedbackCouponEmail } from "./auth/brevoService";
import { sendFeedbackCouponWhatsApp } from "./auth/aisensyService";
export { processWhatsAppCampaign } from "./whatsapp/processCampaign";

// This is the hardcoded Event ID for "BERGMAN OZAR PUNE 2026"
const EVENT_ID = "zZ3gkTtYMQkRnFycRmxy";

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export const generateFeedbackCoupon = onRequest(
  {
    secrets: ["SECRET_KEY", "BREVO_API_KEY", "AISENSY_API_KEY"],
    cors: true,
  },
  async (req, res) => {
    const SECRET_KEY = process.env.SECRET_KEY?.trim();
    const receivedKey = (req.headers["x-secret-key"] as string)?.trim();

    if (!receivedKey || receivedKey !== SECRET_KEY) {
      functions.logger.warn("Unauthorized attempt to generate feedback coupon.", { 
          headers: req.headers,
          receivedKey: receivedKey,
          expectedKey: SECRET_KEY,
          keysMatch: receivedKey === SECRET_KEY,
      });
      res.status(403).send("Unauthorized");
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    try {
      const { name, email, mobile } = req.body;

      if (!name || !email || !mobile) {
        res.status(400).json({ error: "Missing fields" });
        return;
      }

      const lowerEmail = email.toLowerCase();
      
      const existingClaim = await db.collection("feedbackCouponClaims").doc(lowerEmail).get();
      
      if (existingClaim.exists) {
        const existingCoupon = existingClaim.data()?.couponCode;
      
        try {
          await sendFeedbackCouponEmail(lowerEmail, name, existingCoupon);
        } catch (e: any) {
          functions.logger.error("Brevo email failed:", e.message);
        }
      
        try {
          await sendFeedbackCouponWhatsApp(mobile, name, existingCoupon);
        } catch (e: any) {
          functions.logger.error("AiSensy WhatsApp failed:", e.message);
        }
      
        res.status(200).json({
          success: true,
          message: "Coupon already generated and resent.",
          coupon: existingCoupon
        });
      
        return;
      }
      
      const couponCode = "BMFB-" +
        name.replace(/\s+/g, "").substring(0, 4).toUpperCase() +
        "-" +
        generateRandomString(4);
      
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);

      await db.collection("coupons").doc(couponCode).set({
        code: couponCode,
        email: lowerEmail,
        eventId: EVENT_ID,
        discountType: 'percentage',
        discountValue: 12,
        expiryDate,
        used: false,
        couponType: "Feedback Coupon",
        isActive: true,
        usageLimit: 1,
        usageCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "feedback-system"
      });

      await db.collection("feedbackCouponClaims").doc(lowerEmail).set({
        email: lowerEmail,
        couponCode,
        createdAt: FieldValue.serverTimestamp(),
      });

      try {
        await sendFeedbackCouponEmail(lowerEmail, name, couponCode);
      } catch (e: any) {
        functions.logger.error("Brevo email failed:", e.message, e.stack);
      }

      try {
        await sendFeedbackCouponWhatsApp(mobile, name, couponCode);
      } catch (e: any) {
        functions.logger.error("AiSensy WhatsApp failed:", e.message, e.stack);
      }


      res.json({
        success: true,
        coupon: couponCode,
        message: "Coupon generated and saved successfully!"
      });
      return;

    } catch (error: any) {
      console.error("COUPON ERROR:", error);
      functions.logger.error("Error in generateFeedbackCoupon:", error);
      res.status(500).json({ error: error.message });
      return;
    }
  }
);
