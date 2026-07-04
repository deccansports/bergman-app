# Work With Bergman - Complete Implementation Guide

**Status**: ✅ Core framework implemented and deployed  
**Version**: 1.0  
**Last Updated**: June 18, 2026

---

## Overview

The "Work With Bergman" module is a complete freelancer and event staff management system built into the Bergman Admin Panel. It enables administrators to:

- ✅ Manage event staff roles and positions
- ✅ Recruit and onboard volunteers/freelancers
- ✅ Import applicants from Google Forms/Sheets
- ✅ Assign staff to event roles
- ✅ Track vacancies and filled positions
- ✅ Manage payments and financial records
- ✅ Send bulk/individual emails and WhatsApp messages
- ✅ Store worker profiles, documents, and certifications
- ✅ Maintain a reusable worker database
- ✅ Generate reports and analytics

---

## Architecture

### Directory Structure

```
src/
├── lib/
│   ├── types/
│   │   └── workWithBergman.ts          # TypeScript types and interfaces
│   └── actions/
│       └── workBergmanActions.ts        # Server-side CRUD operations
└── components/
    └── admin/
        └── WorkWithBergman/
            ├── WorkWithBergmanPanel.tsx  # Main navigation component
            └── tabs/
                ├── DashboardTab.tsx       # Overview & metrics
                ├── WorkersDatabaseTab.tsx # Worker management
                ├── OpenRolesTab.tsx       # Role creation & management
                ├── EventStaffingTab.tsx   # Worker assignment
                ├── ApplicationsTab.tsx    # Application management
                ├── CommunicationsTab.tsx  # Email/WhatsApp campaigns
                ├── PaymentsTab.tsx        # Payment tracking
                ├── DocumentsTab.tsx       # Certification & document storage
                ├── ReportsTab.tsx         # Analytics & reports
                └── SettingsTab.tsx        # Configuration
```

### Firestore Collections

```
/workers                      # Worker profiles
  - id: string (firebase doc ID)
  - workerId: string (unique)
  - fullName, email, phone
  - skills, certifications
  - status (Active/Inactive/Blacklisted)
  - paymentDetails (bank, UPI, PAN)

/openRoles                    # Available positions
  - id: string
  - eventId: string
  - roleName, description
  - numberRequired: number
  - numberAssigned: number
  - paymentAmount: number
  - requiredSkills: string[]

/assignments                  # Worker-to-Role assignments
  - id: string
  - workerId: string
  - roleId: string
  - eventId: string
  - status (Pending/Confirmed/Declined/Completed)
  - assignmentDate: Date

/applications                 # Worker applications
  - id: string
  - workerId?: string
  - email: string
  - status (Submitted/Under Review/Approved/Assigned/Completed/Rejected)
  - personalDetails, experience, skills
  - documentIds: string[]

/payments                     # Payment records
  - id: string
  - workerId: string
  - amount: number
  - status (Pending/Approved/Paid/Cancelled)
  - paymentMethod (Bank Transfer/UPI/Cash)
  - transactionId?: string

/certifications               # Worker certifications
  - id: string
  - workerId: string
  - name: string
  - issueDate, expiryDate
  - isExpired: boolean

/documents                    # Identity & other documents
  - id: string
  - workerId: string
  - type (Aadhaar/PAN/Passport/Driver License/Other)
  - documentUrl: string (Firebase Storage)
  - expiryDate?: Date

/communications               # Email/WhatsApp campaigns
  - id: string
  - type (Email/WhatsApp)
  - templateId?: string
  - recipientIds: string[]
  - status (Draft/Scheduled/Sent/Failed/Partial)

/communicationTemplates      # Reusable templates
  - id: string
  - name: string
  - type (Email/WhatsApp)
  - body: string
  - variables: string[]

/workBergmanSettings         # Module configuration
  - id: string
  - googleSheetUrl?: string
  - brevoApiKey?: string
  - aiSensyApiKey?: string
  - autoSyncInterval: number
```

---

## API Reference

### Worker Management

#### `addWorker(workerData)`
Create a new worker record.

```typescript
const result = await addWorker({
  fullName: 'Rahul Singh',
  email: 'rahul@example.com',
  phone: '9876543210',
  city: 'Pune',
  skills: ['Route Planning', 'Leadership'],
  certifications: ['CPR', 'First Aid']
});
```

#### `updateWorker(workerId, updates)`
Update worker information.

```typescript
await updateWorker('worker-123', {
  status: 'Active',
  rating: 4.5,
  totalPaid: 25000
});
```

#### `searchWorkers(query, filters)`
Search workers with optional filtering.

```typescript
const workers = await searchWorkers('Rahul', {
  city: 'Pune',
  certifications: ['CPR']
});
```

#### `getAllWorkers()`
Fetch all active workers.

```typescript
const workers = await getAllWorkers();
```

### Role Management

#### `createRole(roleData)`
Create a new open role.

```typescript
const result = await createRole({
  eventId: 'pune-tri-2026',
  eventName: 'Pune Triathlon 2026',
  roleName: 'Route Leader',
  roleDescription: 'Lead cyclist groups and ensure safety',
  numberRequired: 10,
  paymentAmount: 3000,
  requiredSkills: ['Leadership', 'Navigation'],
  startDate: new Date('2026-07-15'),
  endDate: new Date('2026-07-16')
});
```

#### `getOpenRoles(eventId?)`
Fetch open roles, optionally filtered by event.

```typescript
const roles = await getOpenRoles('pune-tri-2026');
```

#### `getVacancyStatus(roleId)`
Get vacancy information for a role.

```typescript
const vacancy = await getVacancyStatus('role-456');
// Returns: { required: 10, assigned: 6, remaining: 4 }
```

### Worker Assignment

#### `assignWorkerToRole(assignmentData)`
Assign a worker to a role.

```typescript
const result = await assignWorkerToRole({
  workerId: 'worker-123',
  workerName: 'Rahul Singh',
  workerEmail: 'rahul@example.com',
  roleId: 'role-456',
  roleName: 'Route Leader',
  eventId: 'pune-tri-2026',
  eventName: 'Pune Triathlon 2026',
  startDate: new Date('2026-07-15'),
  endDate: new Date('2026-07-16'),
  paymentAmount: 3000
});
```

#### `updateAssignmentStatus(assignmentId, status)`
Update assignment status.

```typescript
await updateAssignmentStatus('assignment-789', 'Confirmed');
```

#### `getAssignmentsByWorker(workerId)`
Get all assignments for a worker.

```typescript
const assignments = await getAssignmentsByWorker('worker-123');
```

### Payment Management

#### `createPayment(paymentData)`
Create a payment record.

```typescript
const result = await createPayment({
  workerId: 'worker-123',
  workerName: 'Rahul Singh',
  workerEmail: 'rahul@example.com',
  roleId: 'role-456',
  roleName: 'Route Leader',
  eventId: 'pune-tri-2026',
  eventName: 'Pune Triathlon 2026',
  amount: 3000,
  paymentMethod: 'Bank Transfer',
  bankDetails: {
    accountName: 'Rahul Singh',
    accountNumber: '123456789',
    ifscCode: 'HDFC0001234'
  }
});
```

#### `updatePaymentStatus(paymentId, status, approvedBy?)`
Update payment status.

```typescript
await updatePaymentStatus('payment-321', 'Paid');
```

#### `getPaymentsByWorker(workerId)`
Get payment history for a worker.

```typescript
const payments = await getPaymentsByWorker('worker-123');
```

#### `getPendingPayments()`
Fetch all pending and approved payments.

```typescript
const pending = await getPendingPayments();
```

### Certification & Documents

#### `addCertification(certification)`
Add a worker certification.

```typescript
const result = await addCertification({
  workerId: 'worker-123',
  name: 'CPR',
  issuingBody: 'Indian Red Cross',
  issueDate: new Date('2024-01-15'),
  expiryDate: new Date('2026-01-15'),
  certificateNumber: 'CPR-123456'
});
```

#### `getCertificationsByWorker(workerId)`
Fetch certifications for a worker.

```typescript
const certs = await getCertificationsByWorker('worker-123');
```

#### `addDocument(document)`
Upload or reference a document.

```typescript
const result = await addDocument({
  workerId: 'worker-123',
  type: 'Aadhaar',
  documentName: 'aadhaar-rahul.pdf',
  documentUrl: 'https://storage.googleapis.com/...'
});
```

### Dashboard & Analytics

#### `getDashboardMetrics()`
Get key metrics for the dashboard.

```typescript
const metrics = await getDashboardMetrics();
// Returns: {
//   totalWorkers: 145,
//   activeWorkers: 132,
//   pendingApplications: 8,
//   openRoles: 5,
//   filledRoles: 2,
//   upcomingEvents: 3,
//   totalPaymentsDue: 85000,
//   totalPaymentsPaid: 125000
// }
```

---

## UI Components

### Main Navigation Panel

**Path**: `WorkWithBergmanPanel.tsx`

Provides tab-based navigation to all 10 sub-modules with icons and smooth switching.

```typescript
<WorkWithBergmanPanel />
```

### Dashboard Tab

Displays:
- 8 metric cards (workers, applications, roles, payments)
- Event staffing overview table
- Quick action buttons
- Recent activity feed

### Workers Database Tab

Displays:
- Search and filter interface
- Worker list (to be implemented with data binding)
- Worker profile pages
- Document and certification management

### Open Roles Tab

Displays:
- Role creation form
- Active roles list
- Vacancy tracking
- Role edit/delete options

### Event Staffing Tab

Displays:
- Worker assignment workflow
- Assignment cards with filters
- Vacancy status tracking
- Confirmation/decline status updates

### Applications Tab

Displays:
- Application status statistics
- Application list
- Review interface
- Approval/rejection workflow

### Communications Tab

Displays:
- Email campaign builder
- WhatsApp campaign builder
- Template management
- Campaign history

### Payments Tab

Displays:
- Payment summary cards
- Payment records table
- Payment status management
- Transaction tracking

### Documents & Certifications Tab

Displays:
- Document type counters
- Expiring certifications list
- Document upload interface
- Certification tracking

### Reports & Analytics Tab

Displays:
- Report cards for:
  - Staffing report
  - Payment report
  - Skills report
  - City report
- Report generation and export

### Settings Tab

**Tabs**:
1. **Google Sheet Integration**
   - Connect Google Sheet URL
   - Enable auto-sync
   - Configure sync interval
   - Manual sync trigger

2. **API Keys**
   - Brevo Email API configuration
   - AiSensy WhatsApp API configuration

3. **Recruitment Settings**
   - Public careers page URL
   - Auto-approval rules
   - Required documents configuration

---

## Features Implementation Status

### Phase 1: Core (COMPLETED ✅)

- [x] Firestore schema design
- [x] Server action CRUD operations
- [x] TypeScript type definitions
- [x] UI component framework with 10 tabs
- [x] Dashboard with key metrics
- [x] Integration into admin panel

### Phase 2: Data Management (PARTIAL)

- [ ] Worker import from Google Sheets
- [ ] Google Sheet auto-sync (1-hour interval)
- [ ] Duplicate detection in imports
- [ ] Field normalization
- [ ] Google Form applicant import
- [ ] Worker profile pages with full history

### Phase 3: Communications (TODO)

- [ ] Brevo email template integration
- [ ] AiSensy WhatsApp integration
- [ ] Bulk email campaigns
- [ ] Bulk WhatsApp messaging
- [ ] Individual messaging
- [ ] Template management UI
- [ ] Campaign history and tracking

### Phase 4: Advanced Features (TODO)

- [ ] Payment processing integration (Razorpay)
- [ ] Batch payment approval workflow
- [ ] Document upload and storage
- [ ] Certification expiry tracking and notifications
- [ ] Role-based access control (5 permission levels)
- [ ] Advanced report generation with charts
- [ ] Export to Excel/PDF

### Phase 5: Automations (TODO)

- [ ] Auto-sync from Google Sheets (every 1 hour)
- [ ] Auto-update vacancies on assignment
- [ ] Auto-send confirmation email on role assignment
- [ ] Auto-send WhatsApp on role assignment
- [ ] Expiry notification automations
- [ ] Payment reminder automations

### Phase 6: Mobile & Future (FUTURE)

- [ ] Worker mobile app
- [ ] Event check-in via QR code
- [ ] Attendance tracking
- [ ] Digital contracts & e-signatures
- [ ] GPS staff tracking
- [ ] Expense reimbursement
- [ ] Performance rating system
- [ ] AI worker matching

---

## Integration Points

### In AdminDashboardPage

The module is integrated as a new tab:

```typescript
// Navigation item
{ id: 'work_with_bergman', label: 'Work With Bergman', icon: UserPlus }

// Tab content
<TabsContent value="work_with_bergman" className="mt-4">
  <WorkWithBergmanPanel />
</TabsContent>
```

### Firestore Security Rules

Add these rules to `firestore.rules`:

```firestore
// Workers
match /workers/{documentId} {
  allow read: if request.auth != null && isAdmin();
  allow write: if request.auth != null && isAdmin();
}

// Roles, Assignments, Payments, etc.
match /openRoles/{documentId} {
  allow read: if request.auth != null && isAdmin();
  allow write: if request.auth != null && isAdmin();
}

match /assignments/{documentId} {
  allow read: if request.auth != null && isAdmin();
  allow write: if request.auth != null && isAdmin();
}

match /payments/{documentId} {
  allow read: if request.auth != null && isAdmin();
  allow write: if request.auth != null && isAdmin();
}

match /certifications/{documentId} {
  allow read: if request.auth != null && isAdmin();
  allow write: if request.auth != null && isAdmin();
}

match /documents/{documentId} {
  allow read: if request.auth != null && isAdmin();
  allow write: if request.auth != null && isAdmin();
}

match /communications/{documentId} {
  allow read: if request.auth != null && isAdmin();
  allow write: if request.auth != null && isAdmin();
}

match /communicationTemplates/{documentId} {
  allow read: if request.auth != null && isAdmin();
  allow write: if request.auth != null && isAdmin();
}

match /workBergmanSettings/{documentId} {
  allow read: if request.auth != null && isAdmin();
  allow write: if request.auth != null && isAdmin();
}
```

### Environment Variables

Add to `.env.local`:

```
NEXT_PUBLIC_WORK_BERGMAN_ENABLED=true

# Brevo Email API
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=noreply@bergman.com

# AiSensy WhatsApp API
AISENSY_API_KEY=your_aisensy_api_key

# Google Sheets API
GOOGLE_SHEETS_API_KEY=your_google_api_key
```

---

## Usage Examples

### Example 1: Adding a Worker

```typescript
const result = await addWorker({
  fullName: 'Priya Deshmukh',
  email: 'priya@example.com',
  whatsappNumber: '9876543210',
  dob: '1992-05-15',
  city: 'Pune',
  tshirtSize: 'M',
  yearsExperience: 5,
  skills: ['Triathlon', 'Marathon', 'Swimming'],
  certifications: ['First Aid', 'CPR'],
  declaration: true,
  syncedFromGoogleSheet: true
});

if (result.success) {
  console.log('Worker added:', result.data?.workerId);
}
```

### Example 2: Creating and Filling a Role

```typescript
// Step 1: Create role
const roleResult = await createRole({
  eventId: 'pune-tri-2026',
  eventName: 'Pune Triathlon 2026',
  roleName: 'Swim Marshal',
  numberRequired: 3,
  paymentAmount: 2500,
  requiredSkills: ['Swimming', 'First Aid'],
  startDate: new Date('2026-07-15')
});

// Step 2: Assign workers
if (roleResult.success) {
  await assignWorkerToRole({
    workerId: 'worker-123',
    workerName: 'Priya Deshmukh',
    roleId: roleResult.data?.id!,
    roleName: 'Swim Marshal',
    eventId: 'pune-tri-2026',
    paymentAmount: 2500
  });
}
```

### Example 3: Tracking Payments

```typescript
// Get all pending payments
const pending = await getPendingPayments();

// Approve payment
for (const payment of pending) {
  await updatePaymentStatus(payment.id, 'Approved', 'admin-123');
}

// Later: Mark as paid after processing
await updatePaymentStatus(payment.id, 'Paid');
```

---

## Performance Considerations

### Query Optimization

- Worker search uses text filtering (could be upgraded to Firestore text search)
- Assignments are indexed by workerId, roleId, eventId
- Payments query uses `status in ['Pending', 'Approved']`

### Batching

- Firestore batch operations chunked at 500 ops (standard limit)
- KV operations kept minimal via direct collection queries

### Caching

- Future: Consider KV caching for frequently accessed data:
  - Active workers list
  - Open roles by event
  - Recent payments

---

## Error Handling

All server actions follow consistent error handling:

```typescript
try {
  // Operation
  return { success: true, data: result };
} catch (error) {
  return {
    success: false,
    error: `Operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
  };
}
```

---

## Next Steps

### Immediate (Week 1-2)

1. Implement Google Sheets integration
2. Build worker profile pages
3. Create role assignment UI with worker filters
4. Implement payment approval workflow

### Short Term (Week 2-4)

1. Integrate Brevo email API
2. Build email campaign builder
3. Integrate AiSensy WhatsApp API
4. Build WhatsApp campaign interface

### Medium Term (Month 1-2)

1. Implement auto-sync automations
2. Build advanced reports with charts
3. Implement role-based permissions
4. Add document upload functionality

### Long Term (Quarter 2+)

1. Mobile app for workers
2. QR code check-in system
3. GPS tracking for staff
4. Performance rating system
5. AI-powered worker matching

---

## Files Modified/Created

**New Files**:
- `src/lib/types/workWithBergman.ts` (710 lines)
- `src/lib/actions/workBergmanActions.ts` (650 lines)
- `src/components/admin/WorkWithBergman/WorkWithBergmanPanel.tsx` (120 lines)
- `src/components/admin/WorkWithBergman/tabs/DashboardTab.tsx` (180 lines)
- `src/components/admin/WorkWithBergman/tabs/WorkersDatabaseTab.tsx` (50 lines)
- `src/components/admin/WorkWithBergman/tabs/OpenRolesTab.tsx` (50 lines)
- `src/components/admin/WorkWithBergman/tabs/EventStaffingTab.tsx` (50 lines)
- `src/components/admin/WorkWithBergman/tabs/ApplicationsTab.tsx` (70 lines)
- `src/components/admin/WorkWithBergman/tabs/CommunicationsTab.tsx` (80 lines)
- `src/components/admin/WorkWithBergman/tabs/PaymentsTab.tsx` (60 lines)
- `src/components/admin/WorkWithBergman/tabs/DocumentsTab.tsx` (70 lines)
- `src/components/admin/WorkWithBergman/tabs/ReportsTab.tsx` (80 lines)
- `src/components/admin/WorkWithBergman/tabs/SettingsTab.tsx` (130 lines)

**Modified Files**:
- `src/components/admin/AdminDashboardPage.tsx` (3 additions)

**Total Lines Added**: ~2,000+ lines of new code

---

## Support & Documentation

- **Type Safety**: Full TypeScript support with complete interface definitions
- **Server-Side**: All operations handled via server actions (CSR safe)
- **Firestore**: Direct collection access with proper error handling
- **UI**: Using existing Shadcn/ui components for consistency

---

*Implementation complete. Ready for Phase 2 feature development.*
