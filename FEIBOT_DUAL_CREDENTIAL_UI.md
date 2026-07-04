# Feibot Dual Credential UI Implementation

## Overview

The Feibot credentials UI has been refactored from a single mixed credential card into two independently managed credential cards:
- **AK-EVENT (Event Credentials)** - Event-scoped credentials
- **AK-ACCOUNT (Account Credentials)** - Account-scoped credentials

This separation prevents confusion and simplifies troubleshooting when credentials have different connection states.

---

## New UI Structure

### 1. AK-EVENT (Event Credentials) Card

**Location**: First card in the dual-card layout (left on desktop)

**Description**:
Event-scoped credentials generated after opening a specific event in Feibot. These credentials are valid only for the bound event and have the highest priority in Auto Mode.

**Fields**:
- **Access Key** - Event-scoped AK input
- **Secret Key** - Event-scoped SK input (password field)
- **Event UUID Display** - Read-only display showing the event UUID these credentials are bound to

**Actions**:
- **Save Event Credentials** - Saves credentials to `events/{eventId}/liveTracking/provider` with encryption
- **Test Connection** - Validates the event credential independently

**Status Indicators**:
- Connection status badge (Connected/Not Connected)
- Validation checks (PASS/WARNING/FAIL):
  - Authentication
  - Event UUID Access
  - Timing Rules API availability
  - Participants API availability
  - Live Results API availability
- Event UUID binding display
- Last authentication timestamp

**Error Handling**:
- Dedicated error alert for event credential save/test failures
- Success message when credentials are validated
- Independent validation doesn't affect account credential status

---

### 2. AK-ACCOUNT (Account Credentials) Card

**Location**: Second card in the dual-card layout (right on desktop)

**Description**:
Account-scoped credentials with access to all events owned by the Feibot account (subject to API permissions). Used as a fallback when Event credentials are not configured or fail with auth errors.

**Fields**:
- **Account ID** - Account identifier (default: "feibot")
- **Access Key** - Account-scoped AK input
- **Secret Key** - Account-scoped SK input (password field)
- **API Base URL** - Read-only display of locked API endpoint

**Actions**:
- **Save Account Credentials** - Saves credentials to `settings/liveTracking/providers/feibot` with encryption
- **Test Connection** - Validates the account credential independently

**Status Indicators**:
- Connection status badge (Connected/Not Connected)
- Validation checks (PASS/WARNING/FAIL):
  - Authentication
  - Events List API availability
  - Timing Rules API availability
  - Participants API availability
  - Live Results API availability
- Number of accessible events (displayed after successful validation)
- Last authentication timestamp

**Error Handling**:
- Dedicated error alert for account credential save/test failures
- Success message when credentials are validated
- Independent validation doesn't affect event credential status

---

### 3. Event Configuration Card

**Purpose**: Maintains the existing event discovery and linking workflow

**Key Features**:
- Bergman event selection dropdown
- Feibot event discovery
- Manual event UUID linking
- Event rediscovery
- Status refresh buttons

---

### 4. Credential Usage Card (NEW)

**Location**: After Feibot Authentication card, before Quick Links

**Purpose**: Shows which credential type is being used for each API operation

**Content**:
```
┌─────────────────────────────────────────────────┐
│ Credential Usage                                 │
│ Shows which credential type is being used       │
├─────────────────────────────────────────────────┤
│ Timing Rules API                        Auto Mode
│ /eventConfigFile/timingRulesGet               
│                                                  │
│ Participants API                        Auto Mode
│ /temporary/participantsGetAll                   │
│                                                  │
│ Live Results API                        Auto Mode
│ /temporary/temporary_ResultDataGetAll          │
│                                                  │
│ ⓘ Auto Mode: System tries Event credentials    │
│   first. On 401/403 auth failures, automatically│
│   retries once with Account credentials. This   │
│   ensures seamless fallback without manual      │
│   intervention.                                  │
└─────────────────────────────────────────────────┘
```

---

## Independent Validation

Each credential type has its own validation state:

- **Event Credential Validation**:
  - Independent of Account credential status
  - Tests event-specific access to event_uuid
  - Shows event UUID binding
  - Displays only event-relevant checks

- **Account Credential Validation**:
  - Independent of Event credential status
  - Tests account-level access to all events
  - Shows number of accessible events
  - Displays only account-relevant checks

**Key Benefit**: If Event credentials fail, you can immediately see if Account credentials work, or vice versa. No confusion from mixed states.

---

## Component Architecture

### New Component: FeibotCredentialCards

**File**: `src/components/admin/FeibotCredentialCards.tsx`

**Props**:
```typescript
{
  bergmanEventId: string;
  resolvedEventUuid: string;
  lockedApiBaseUrl: string;
  apiBaseUrl: string;
  credentials: any;
  onEventCredentialSave?: (data) => void;
  onAccountCredentialSave?: (data) => void;
  onEventCredentialTest?: (data) => void;
  onAccountCredentialTest?: (data) => void;
  loadStatus?: () => Promise<void>;
}
```

**Internal State Management**:
- Event credential fields: `eventAccessKey`, `eventSecretKey`
- Account credential fields: `accountId`, `accountAccessKey`, `accountSecretKey`
- Event validation: `eventValidation`, `eventError`, `eventMessage`
- Account validation: `accountValidation`, `accountError`, `accountMessage`
- Loading states: `savingEventCredential`, `testingEventConnection`, etc.

**Features**:
- Fully self-contained credential management
- Independent save/test flows for each credential type
- Automatic cache invalidation on save
- Status refresh on successful save
- Detailed error messages per credential type

---

## Updated LiveTrackingHub Layout

The Setup tab now has this structure:

```
┌─ Setup Tab ─────────────────────────────────────────┐
│                                                      │
│ ┌─ Credential Cards Section ────────────────────┐  │
│ │                                                │  │
│ │  ┌─────────────────────┬─────────────────────┐ │  │
│ │  │ AK-EVENT            │ AK-ACCOUNT          │ │  │
│ │  │ (Event Credentials) │ (Account Credentials)│ │  │
│ │  └─────────────────────┴─────────────────────┘ │  │
│ │                                                │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ ┌─ Event Configuration ─────────────────────────┐  │
│ │ Link Bergman event to Feibot event           │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ ┌─ Status Card ─────────────────────────────────┐  │
│ │ Provider status and readiness                │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ ┌─ Feibot Authentication ───────────────────────┐  │
│ │ Configured values (masked)                   │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ ┌─ Credential Usage (NEW) ──────────────────────┐  │
│ │ Which credential for each API                │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ ┌─ Quick Links ─────────────────────────────────┐  │
│ │ Runtime access links                         │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## Design Benefits

### 1. **Reduced Confusion**
Clear separation prevents mixing Event and Account credentials in the UI.

### 2. **Independent Validation**
Each credential type has its own validation state, making troubleshooting straightforward:
- Event credential failing? You immediately see Account credential status
- Account credential working? You know fallback is available

### 3. **Clear Descriptions**
Each card has a detailed description explaining when and why to use that credential type.

### 4. **Visual Status Indicators**
- Connected badge on each card
- Individual error/success alerts
- Separate validation check lists

### 5. **Better Error Messages**
Errors are specific to the credential type being tested, not conflated with the other.

### 6. **Admin Clarity**
Administrators can immediately see:
- Which credential type is available
- Which credential type is working
- Which credential type failed and why

---

## Usage Flow

### Setting up both credentials:

1. **Fill in AK-EVENT card**:
   - Enter Event Access Key
   - Enter Event Secret Key
   - Event UUID is auto-populated
   - Click "Save Event Credentials"
   - Click "Test Connection" to validate

2. **Fill in AK-ACCOUNT card**:
   - Enter Account ID (usually "feibot")
   - Enter Account Access Key
   - Enter Account Secret Key
   - Click "Save Account Credentials"
   - Click "Test Connection" to validate

3. **Check Credential Usage**:
   - All endpoints now show "Auto Mode"
   - System will automatically use Event credentials first
   - If Event fails with 401/403, it retries with Account

### Troubleshooting:

- **Timing Rules not loading?** Check the Credential Usage card
- **Event credential failing?** Check AK-EVENT validation checks
- **Account credential working but Event not?** Fallback will automatically use Account
- **Both failing?** Check both validation check lists for specific failures

---

## Technical Implementation

### Files Modified:

1. **New**: `src/components/admin/FeibotCredentialCards.tsx`
   - Dual-card credential component
   - Independent validation and save logic
   - Separate state for each credential type

2. **Updated**: `src/components/admin/LiveTrackingHub.tsx`
   - Imports new FeibotCredentialCards component
   - Replaced old single card with new dual-card layout
   - Added Credential Usage indicator card
   - Updated tab structure for clarity

### Validation:
- ✅ TypeScript compilation: 0 errors
- ✅ ESLint: 0 warnings/errors
- ✅ Ready for production deployment

---

## API Integration

The dual-card component properly integrates with:

- `POST /api/admin/live-tracking/feibot/save-credentials`
  - Accepts `credentialType: 'event' | 'account'`
  - Routes to appropriate Firestore storage location

- `POST /api/live/provider/verify-auth`
  - Accepts `credentialType: 'event' | 'account'`
  - Tests credentials independently
  - Returns credential-specific validation checks

---

## Future Enhancements

1. **Credential Mode Selector**: Radio buttons for AUTO / EVENT / ACCOUNT modes
2. **Per-credential health dashboard**: Show which credential was used for last 10 sync operations
3. **Sync history**: Display which credential successfully fetched each set of data
4. **Health metrics**: Response times, success rates, retry frequency per credential type

---

## Summary

The Feibot credentials UI has been successfully separated into two independent, clearly labeled cards:
- **AK-EVENT** for event-scoped credentials
- **AK-ACCOUNT** for account-scoped credentials

Each has its own validation, status display, and error handling. A new "Credential Usage" card shows which credential type is being used for each API operation, with automatic fallback explanation. This design significantly improves clarity and simplifies troubleshooting for administrators.
