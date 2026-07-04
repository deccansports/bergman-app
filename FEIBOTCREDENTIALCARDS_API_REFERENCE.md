# FeibotCredentialCards Component Reference

## Component Overview

A dual-card React component that manages separate Event and Account Feibot API credentials with independent validation, save, and test flows.

**Location**: `src/components/admin/FeibotCredentialCards.tsx`

**Usage**:
```tsx
<FeibotCredentialCards
  bergmanEventId={bergmanEventId}
  resolvedEventUuid={resolvedEventUuid}
  lockedApiBaseUrl={lockedApiBaseUrl}
  apiBaseUrl={lockedApiBaseUrl}
  credentials={credentials}
  loadStatus={loadStatus}
/>
```

---

## Props Interface

```typescript
interface FeibotCredentialCardsProps {
  bergmanEventId: string;                           // Currently selected Bergman event ID
  resolvedEventUuid: string;                        // Feibot event UUID to bind Event credential to
  lockedApiBaseUrl: string;                         // Locked API base URL (e.g., https://apicn.feibot.com)
  apiBaseUrl: string;                               // API base URL (typically same as lockedApiBaseUrl)
  credentials: any;                                 // Current credentials state (for status display)
  onEventCredentialSave?: (data) => void;          // Optional callback for Event credential save
  onAccountCredentialSave?: (data) => void;        // Optional callback for Account credential save
  onEventCredentialTest?: (data) => void;          // Optional callback for Event credential test
  onAccountCredentialTest?: (data) => void;        // Optional callback for Account credential test
  loadStatus?: () => Promise<void>;                // Optional callback to refresh status after save
}
```

---

## Props Explanation

### Required Props:

**`bergmanEventId: string`**
- Current Bergman event ID selected in the parent component
- Used for logging and context
- Can be empty string if no event selected
- Passed to API calls for event-scoped operations

**`resolvedEventUuid: string`**
- Feibot event UUID that Event credentials will be bound to
- Should be the manually entered or discovered event UUID
- Displayed in read-only field on Event credential card
- Used for validation and saving

**`lockedApiBaseUrl: string`**
- API base URL locked to the documented Feibot endpoint
- Typically: `https://apicn.feibot.com`
- Displayed in read-only fields to prevent modification
- Used for all API calls

**`apiBaseUrl: string`**
- Redundant with lockedApiBaseUrl (can pass same value)
- Kept for consistency with existing LiveTrackingHub pattern
- Used for API calls

**`credentials: any`**
- Current credentials object from parent state
- Used to show current configuration status
- Can be null if no credentials loaded yet

### Optional Props:

**`onEventCredentialSave?: (data) => void`**
- Called when "Save Event Credentials" is clicked
- If not provided, defaults to calling `/api/admin/live-tracking/feibot/save-credentials`
- Receives: `{ accessKey, secretKey, eventUuid }`
- Use this to integrate with parent component's save logic

**`onAccountCredentialSave?: (data) => void`**
- Called when "Save Account Credentials" is clicked
- If not provided, defaults to calling `/api/admin/live-tracking/feibot/save-credentials`
- Receives: `{ accessKey, secretKey, accountId }`
- Use this to integrate with parent component's save logic

**`onEventCredentialTest?: (data) => void`**
- Called when "Test Connection" is clicked on Event card
- If not provided, defaults to calling `/api/live/provider/verify-auth`
- Receives: `{ accessKey, secretKey, eventUuid }`
- Use this for custom validation logic

**`onAccountCredentialTest?: (data) => void`**
- Called when "Test Connection" is clicked on Account card
- If not provided, defaults to calling `/api/live/provider/verify-auth`
- Receives: `{ accessKey, secretKey, accountId }`
- Use this for custom validation logic

**`loadStatus?: () => Promise<void>`**
- Called after successful save to refresh parent status
- Typically calls parent's status loading function
- Allows parent to update UI with new credential state
- Important for showing success feedback

---

## Default API Behavior

If no callback functions are provided, the component makes these API calls:

### Save Event Credential:
```typescript
POST /api/admin/live-tracking/feibot/save-credentials
{
  credentialType: 'event',
  accessKey: string,
  secretKey: string,
  eventUuid: string,
  eventId: string (bergmanEventId),
  apiBaseUrl: string
}
```

### Save Account Credential:
```typescript
POST /api/admin/live-tracking/feibot/save-credentials
{
  credentialType: 'account',
  accessKey: string,
  secretKey: string,
  account: string (accountId),
  eventId: string (bergmanEventId),
  apiBaseUrl: string
}
```

### Test Event Credential:
```typescript
POST /api/live/provider/verify-auth
{
  provider: 'feibot',
  credentialType: 'event',
  eventUuid: string,
  eventId: string (bergmanEventId),
  apiBaseUrl: string,
  accessKey: string,
  secretKey: string
}

Response: {
  success: boolean,
  message: string,
  checks: DiagnosticCheck[],
  // credential-specific fields
}
```

### Test Account Credential:
```typescript
POST /api/live/provider/verify-auth
{
  provider: 'feibot',
  credentialType: 'account',
  eventId: string (bergmanEventId),
  apiBaseUrl: string,
  accessKey: string,
  secretKey: string,
  accountId: string
}

Response: {
  success: boolean,
  message: string,
  checks: DiagnosticCheck[],
  eventsCount: number,
  // credential-specific fields
}
```

---

## Component Features

### Event Credential Card:

**Inputs**:
- Access Key (text)
- Secret Key (password)
- Event UUID (read-only display)

**Actions**:
- Save Event Credentials
- Test Connection

**Display**:
- Connected status badge
- Error alert (if save/test fails)
- Success message (if save/test succeeds)
- Validation checks with PASS/FAIL/WARNING status
- Event UUID binding display
- Last authentication timestamp

**State Management**:
- `eventAccessKey`: Current AK value
- `eventSecretKey`: Current SK value
- `savingEventCredential`: Loading state for save
- `testingEventConnection`: Loading state for test
- `eventValidation`: Validation result object
- `eventMessage`: Success message
- `eventError`: Error message

### Account Credential Card:

**Inputs**:
- Account ID (text, default "feibot")
- Access Key (text)
- Secret Key (password)
- API Base URL (read-only display)

**Actions**:
- Save Account Credentials
- Test Connection

**Display**:
- Connected status badge
- Error alert (if save/test fails)
- Success message (if save/test succeeds)
- Validation checks with PASS/FAIL/WARNING status
- Number of accessible events
- Last authentication timestamp

**State Management**:
- `accountId`: Current Account ID value
- `accountAccessKey`: Current AK value
- `accountSecretKey`: Current SK value
- `savingAccountCredential`: Loading state for save
- `testingAccountConnection`: Loading state for test
- `accountValidation`: Validation result object
- `accountMessage`: Success message
- `accountError`: Error message

---

## Validation Structure

```typescript
interface CredentialValidationResult {
  credentialType: 'event' | 'account';
  success: boolean;
  message: string;
  checks?: DiagnosticCheck[];
  connected?: boolean;
  eventsCount?: number;           // Only for account
  eventUuidBound?: string;        // Only for event
  lastAuthAt?: string;
}

interface DiagnosticCheck {
  key: string;
  label: string;
  status: 'PASS' | 'WARNING' | 'FAIL';
  httpStatus: number;
  message?: string;
}
```

---

## Usage Examples

### Basic Usage (Default API Calls):
```tsx
<FeibotCredentialCards
  bergmanEventId={bergmanEventId}
  resolvedEventUuid={resolvedEventUuid}
  lockedApiBaseUrl="https://apicn.feibot.com"
  apiBaseUrl="https://apicn.feibot.com"
  credentials={credentials}
  loadStatus={async () => {
    const data = await fetch('/api/live/provider/status');
    setCredentials(await data.json());
  }}
/>
```

### Custom Save Handlers:
```tsx
<FeibotCredentialCards
  bergmanEventId={bergmanEventId}
  resolvedEventUuid={resolvedEventUuid}
  lockedApiBaseUrl="https://apicn.feibot.com"
  apiBaseUrl="https://apicn.feibot.com"
  credentials={credentials}
  onEventCredentialSave={async (data) => {
    // Custom logic for event credential save
    const result = await myCustomSaveFunction(data);
    // Show custom feedback
  }}
  onAccountCredentialSave={async (data) => {
    // Custom logic for account credential save
    const result = await myCustomSaveFunction(data);
    // Show custom feedback
  }}
  loadStatus={async () => {
    // Refresh status
  }}
/>
```

### Integrated with LiveTrackingHub (Current Implementation):
```tsx
<FeibotCredentialCards
  bergmanEventId={bergmanEventId}
  resolvedEventUuid={resolvedEventUuid}
  lockedApiBaseUrl={lockedApiBaseUrl}
  apiBaseUrl={lockedApiBaseUrl}
  credentials={credentials}
  loadStatus={loadStatus}
/>
```

---

## Event Credential Card: Detailed Flow

### Save Flow:
```
User fills AK/SK → Click "Save Event Credentials"
    ↓
Input validation (checks if AK, SK, eventUuid present)
    ↓
POST to /api/admin/live-tracking/feibot/save-credentials
    ↓
Success: Clear inputs, show success message, call loadStatus()
    ↓
Error: Show error message, keep inputs intact
```

### Test Flow:
```
User fills AK/SK → Click "Test Connection"
    ↓
Input validation
    ↓
POST to /api/live/provider/verify-auth
    ↓
Success: Show validation checks, display event UUID binding, show timestamp
    ↓
Error: Show validation checks with failures, display error message
```

---

## Account Credential Card: Detailed Flow

### Save Flow:
```
User fills Account ID, AK/SK → Click "Save Account Credentials"
    ↓
Input validation (checks if AK, SK present)
    ↓
POST to /api/admin/live-tracking/feibot/save-credentials
    ↓
Success: Clear inputs, show success message, call loadStatus()
    ↓
Error: Show error message, keep inputs intact
```

### Test Flow:
```
User fills Account ID, AK/SK → Click "Test Connection"
    ↓
Input validation
    ↓
POST to /api/live/provider/verify-auth
    ↓
Success: Show validation checks, display event count, show timestamp
    ↓
Error: Show validation checks with failures, display error message
```

---

## Error Handling

All errors are caught and displayed in dedicated alerts on each card:

- **Event errors**: Shown only on Event card
- **Account errors**: Shown only on Account card
- **No cross-contamination**: Errors on one card don't affect the other

Example error messages:
```
- "Access Key, Secret Key, and Event UUID are required"
- "Request failed with HTTP 401"
- "Unauthorized"
- "Failed to save event credentials."
- "Failed to verify event credential."
```

---

## Success Messages

Clear success feedback is provided:

**Event Card**:
- "Event credentials saved successfully."
- "Event credential verified successfully."

**Account Card**:
- "Account credentials saved successfully."
- "Account credential verified successfully."

---

## Visual Feedback

### During Save:
- Button shows loading spinner: `<Loader2 className="animate-spin" />`
- Button text: "Saving…"
- Save button disabled

### During Test:
- Button shows loading spinner
- Button text: "Testing…"
- Test button disabled

### After Validation:
- If success: Green checkmark, "Connected" badge appears
- If failure: Red alert icon, specific error message
- Validation checks displayed with color coding

---

## Accessibility Features

- All inputs have associated labels
- Password inputs use type="password"
- Buttons have clear action labels
- Error messages in alert components
- Success messages in alert components
- Status badges for quick visual feedback
- Validation checks clearly marked as PASS/FAIL/WARNING

---

## Performance Considerations

- Component uses `useCallback` for handler memoization
- Separate state for each credential type (no unnecessary re-renders)
- No external dependencies beyond React and UI components
- Efficient state updates

---

## TypeScript Support

Full TypeScript support with:
- Typed props interface
- Typed internal state
- Typed validation results
- Typed diagnostic checks
- Type-safe callbacks

---

## Integration with LiveTrackingHub

In LiveTrackingHub.tsx:
```tsx
import FeibotCredentialCards from '@/components/admin/FeibotCredentialCards';

// In render method:
<FeibotCredentialCards
  bergmanEventId={bergmanEventId}
  resolvedEventUuid={resolvedEventUuid}
  lockedApiBaseUrl={lockedApiBaseUrl}
  apiBaseUrl={lockedApiBaseUrl}
  credentials={credentials}
  loadStatus={loadStatus}
/>
```

The component:
- Doesn't modify parent state directly
- Calls provided callbacks for save/test operations
- Requests status refresh via loadStatus callback
- Displays current credential state from props

---

## API Endpoint Requirements

The component expects these API endpoints to exist:

1. `POST /api/admin/live-tracking/feibot/save-credentials`
   - Accepts credentialType: 'event' | 'account'
   - Stores credentials encrypted in Firestore

2. `POST /api/live/provider/verify-auth`
   - Accepts credentialType: 'event' | 'account'
   - Returns validation checks and status

3. `GET /api/live/provider/status` (for loadStatus callback)
   - Returns current credential status

---

## Future Enhancement Hooks

The component is designed to support:
- Custom validation logic (via callbacks)
- Custom save logic (via callbacks)
- Parent component integration
- Status refresh on demand
- Credential mode selection (future)
- Health dashboard integration (future)

---

## Component Size

- **Lines of Code**: ~400
- **Bundle Impact**: Minimal (self-contained)
- **Dependencies**: React, Lucide icons, Shadcn UI components
- **Import Statement**: Single import in LiveTrackingHub

---

## Deployment Checklist

- [x] Component tested with TypeScript
- [x] ESLint validation passed
- [x] No console errors
- [x] Proper error handling
- [x] Success feedback messages
- [x] Responsive design
- [x] Backward compatible
- [x] No breaking changes
- [x] Production ready
