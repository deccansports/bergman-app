
# Bergman Athlete Hub - Technical Documentation

## 🏗 High-Level Architecture
The Bergman Athlete Hub is a multi-tenant endurance sports platform built with **Next.js 15** and **Firebase**. It uses a hybrid rendering approach where high-frequency data (Rankings, Profiles) is cached at the edge via **Cloudflare KV**, while transactional data (Registrations, Orders) lives in **Firestore**.

## 👥 User Roles & Permissions

### 1. Athlete (The Participant)
- **Dashboard**: Action-oriented view showing the next race countdown and assigned BIB.
- **Prestige**: Access to the Global Athlete League (BGAL) rankings and Performance Rewards.
- **Management**: Ability to self-serve deferrals, category changes, and cancellations (within policy windows).

### 2. Club Owner (The Coach)
- **Roster View**: See every athlete affiliated with the club.
- **Engagement**: Send automated "Encouragement" campaigns to athletes who haven't signed up for upcoming races.
- **Analytics**: Track total club points contributed by members to rise in the Club Leaderboard.

### 3. Volunteer (The Field Staff)
- **Check-in**: QR/Manual search for paperless waiver signing.
- **Logistics**: Serialized bike racking and locker management.
- **Loop Counting**: Real-time digital counters for multi-lap segments (Swim/Bike/Run).

### 4. Admin (The Super-User)
- **Governance**: Full control over 36+ modules.
- **Finance**: Automated Zoho Books synchronization and Razorpay refund management.
- **System Control**: Toggle maintenance modes for specific dashboards during race weekends.

## 🏆 The Admin Dashboard Ecosystem
The Admin Dashboard is a wrapping grid of 36+ specialized modules handling:
- **Event Lifecycle**: From creating tickets with dynamic pricing tiers to publishing final results.
- **Marketing**: Multi-channel broadcasters (WhatsApp/Email) with template-based personalization.
- **Data Integrity**: Tools for merging duplicate athletes, assigning missing BIBs, and clearing stale caches.
- **Integrations**: 
    - **Zoho Books**: Automated GST invoicing.
    - **AiSensy**: High-priority WhatsApp alerts.
    - **Cloudflare KV**: Sub-second global ranking distribution.
    - **Razorpay/Stripe**: Multi-currency payment processing.

## 🔧 The Sync Engine
The system uses a "Snapshot Strategy." Transactional data is stored in Firestore. When rankings or event details are updated, the **Data Sync** tool mirrors this data to Cloudflare KV. This protects the database from heavy read costs and ensures the public site remains lightning-fast during peak race-day traffic.
