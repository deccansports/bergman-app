# Work With Bergman - Quick Reference & Developer Guide

## Quick Start

### Access the Module

1. Go to Admin Dashboard → Admin Panel
2. Scroll to or search for "Work With Bergman" tab
3. Select from navigation menu

### 10-Tab Navigation

| Tab | Purpose | Key Features |
|-----|---------|--------------|
| **Dashboard** | Overview & metrics | 8 stat cards, staffing table, activity feed |
| **Workers Database** | Worker management | Search, filter, profiles, documents |
| **Open Roles** | Role creation | Create, edit, delete, vacancy tracking |
| **Event Staffing** | Worker assignments | Assign workers to roles, status tracking |
| **Applications** | Application processing | Review, approve/reject, track workflow |
| **Communications** | Email/WhatsApp | Bulk campaigns, templates, templates |
| **Payments** | Payment tracking | Records, approvals, methods, reports |
| **Documents & Certifications** | Credential storage | Upload, track expiry, notifications |
| **Reports & Analytics** | Data insights | Staffing, payments, skills, location reports |
| **Settings** | Configuration | APIs, Google Sheets, auto-sync, recruitment |

---

## Server Actions Cheat Sheet

### Workers

```typescript
import { addWorker, updateWorker, searchWorkers, getAllWorkers } from '@/lib/actions/workBergmanActions';

// Add worker
await addWorker({ fullName, email, phone, skills, ... })

// Update worker
await updateWorker(workerId, { status: 'Active', rating: 4.5 })

// Search workers
const workers = await searchWorkers('Rahul', { city: 'Pune' })

// Get all active
const all = await getAllWorkers()
```

### Roles

```typescript
import { createRole, updateRole, getOpenRoles, getVacancyStatus } from '@/lib/actions/workBergmanActions';

// Create role
await createRole({ eventId, roleName, numberRequired, paymentAmount, ... })

// Get roles by event
const roles = await getOpenRoles(eventId)

// Check vacancy
const vacancy = await getVacancyStatus(roleId)
// { required: 10, assigned: 6, remaining: 4 }
```

### Assignments

```typescript
import { assignWorkerToRole, updateAssignmentStatus, getAssignmentsByWorker } from '@/lib/actions/workBergmanActions';

// Assign worker to role
await assignWorkerToRole({ workerId, roleId, eventId, ... })

// Update status
await updateAssignmentStatus(assignmentId, 'Confirmed')

// Get worker assignments
const assignments = await getAssignmentsByWorker(workerId)
```

### Payments

```typescript
import { createPayment, updatePaymentStatus, getPaymentsByWorker, getPendingPayments } from '@/lib/actions/workBergmanActions';

// Create payment
await createPayment({ workerId, amount, paymentMethod, ... })

// Update status
await updatePaymentStatus(paymentId, 'Paid')

// Get pending
const pending = await getPendingPayments()
```

### Certifications & Documents

```typescript
import { addCertification, getCertificationsByWorker, addDocument, getDocumentsByWorker } from '@/lib/actions/workBergmanActions';

// Add certification
await addCertification({ workerId, name: 'CPR', expiryDate, ... })

// Get certs
const certs = await getCertificationsByWorker(workerId)

// Add document
await addDocument({ workerId, type: 'Aadhaar', documentUrl, ... })

// Get documents
const docs = await getDocumentsByWorker(workerId)
```

### Dashboard

```typescript
import { getDashboardMetrics } from '@/lib/actions/workBergmanActions';

const metrics = await getDashboardMetrics()
// {
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

## Type Definitions

### Worker Type

```typescript
interface Worker {
  id: string;
  workerId: string;              // Unique ID
  fullName: string;
  email: string;
  phone?: string;
  city?: string;
  status: 'Active' | 'Inactive' | 'Blacklisted';
  skills?: string[];
  certifications?: string[];
  eventsWorked?: number;
  totalPaid?: number;
  paymentPending?: number;
  bankAccountNumber?: string;
  upiId?: string;
  panNumber?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### OpenRole Type

```typescript
interface OpenRole {
  id: string;
  eventId: string;
  eventName: string;
  roleName: string;
  roleDescription: string;
  numberRequired: number;
  numberAssigned?: number;      // Auto-calculated
  paymentAmount: number;
  requiredSkills?: string[];
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### WorkerAssignment Type

```typescript
interface WorkerAssignment {
  id: string;
  workerId: string;
  workerName: string;
  workerEmail: string;
  roleId: string;
  roleName: string;
  eventId: string;
  eventName: string;
  status: 'Pending' | 'Confirmed' | 'Declined' | 'Completed';
  paymentAmount?: number;
  paymentStatus?: 'Pending' | 'Approved' | 'Paid' | 'Cancelled';
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### Payment Type

```typescript
interface Payment {
  id: string;
  workerId: string;
  workerName: string;
  workerEmail: string;
  amount: number;
  paymentMethod: 'Bank Transfer' | 'UPI' | 'Cash';
  status: 'Pending' | 'Approved' | 'Paid' | 'Cancelled';
  transactionId?: string;
  paidDate?: Date;
  approvedDate?: Date;
  bankDetails?: {
    accountName: string;
    accountNumber: string;
    ifscCode: string;
  };
  upiId?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Component Architecture

### Main Panel

```
WorkWithBergmanPanel
├── Tabs Navigation (10 items)
├── TabsContent value="dashboard"
│   └── DashboardTab
├── TabsContent value="workers"
│   └── WorkersDatabaseTab
├── TabsContent value="roles"
│   └── OpenRolesTab
├── TabsContent value="staffing"
│   └── EventStaffingTab
├── TabsContent value="applications"
│   └── ApplicationsTab
├── TabsContent value="communications"
│   └── CommunicationsTab
├── TabsContent value="payments"
│   └── PaymentsTab
├── TabsContent value="documents"
│   └── DocumentsTab
├── TabsContent value="reports"
│   └── ReportsTab
└── TabsContent value="settings"
    └── SettingsTab
```

### Dashboard Tab Components

```
DashboardTab
├── StatCard (x8) - Metric display
├── Event Overview Table
├── Quick Actions Button Group
└── Recent Activity Feed
```

---

## Common Tasks

### Add a Worker

```typescript
async function addNewWorker(formData) {
  const result = await addWorker({
    fullName: formData.name,
    email: formData.email,
    phone: formData.phone,
    city: formData.city,
    skills: formData.skillsSelected,
    certifications: formData.certs,
    declaration: formData.agreedToTerms
  });
  
  if (result.success) {
    toast.success('Worker added successfully');
    // Refresh worker list
  } else {
    toast.error(result.error);
  }
}
```

### Create a Role and Assign Workers

```typescript
async function createRoleAndAssignWorkers(roleData, workerIds) {
  // Step 1: Create role
  const roleResult = await createRole(roleData);
  if (!roleResult.success) {
    toast.error('Failed to create role');
    return;
  }
  
  const roleId = roleResult.data.id;
  
  // Step 2: Assign workers
  const assignments = await Promise.all(
    workerIds.map(workerId =>
      assignWorkerToRole({
        workerId,
        roleId,
        eventId: roleData.eventId,
        ...otherAssignmentData
      })
    )
  );
  
  const successCount = assignments.filter(a => a.success).length;
  toast.success(`Assigned ${successCount}/${workerIds.length} workers`);
}
```

### Process Payments Workflow

```typescript
async function processPendingPayments() {
  // Get pending payments
  const pending = await getPendingPayments();
  
  // Batch approve
  for (const payment of pending) {
    if (shouldApprove(payment)) {
      await updatePaymentStatus(payment.id, 'Approved', currentUserId);
    }
  }
  
  // Later: Mark as paid
  const approved = await getPendingPayments();
  for (const payment of approved) {
    if (isProcessed(payment)) {
      await updatePaymentStatus(payment.id, 'Paid');
    }
  }
}
```

---

## Firestore Query Examples

### Get all active workers in a city

```typescript
const snap = await adminDb.collection('workers')
  .where('status', '==', 'Active')
  .where('city', '==', 'Pune')
  .get();

const workers = snap.docs.map(doc => doc.data());
```

### Get assignments for an event

```typescript
const snap = await adminDb.collection('assignments')
  .where('eventId', '==', 'pune-tri-2026')
  .where('status', '!=', 'Declined')
  .get();

const assignments = snap.docs.map(doc => doc.data());
```

### Get payment summary by worker

```typescript
const snap = await adminDb.collection('payments')
  .where('workerId', '==', 'worker-123')
  .get();

const total = snap.docs.reduce((sum, doc) => {
  if (doc.data().status === 'Paid') {
    sum += doc.data().amount;
  }
  return sum;
}, 0);
```

---

## UI Component Usage

### Card Component

```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

<Card>
  <CardHeader>
    <CardTitle>Workers</CardTitle>
  </CardHeader>
  <CardContent>
    {/* Content here */}
  </CardContent>
</Card>
```

### Button Component

```typescript
import { Button } from '@/components/ui/button';

<Button>Add Worker</Button>
<Button variant="outline">Cancel</Button>
<Button variant="destructive">Delete</Button>
```

### Table Component

```typescript
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Email</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {items.map(item => (
      <TableRow key={item.id}>
        <TableCell>{item.name}</TableCell>
        <TableCell>{item.email}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

### Tabs Component

```typescript
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

<Tabs value={activeTab} onValueChange={setActiveTab}>
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Content 1</TabsContent>
  <TabsContent value="tab2">Content 2</TabsContent>
</Tabs>
```

---

## Error Handling

All server actions return consistent response:

```typescript
{
  success: boolean;
  data?: T;
  error?: string;
}
```

Usage pattern:

```typescript
const result = await addWorker(data);

if (result.success) {
  console.log('Worker added:', result.data);
  // Show success toast
} else {
  console.error('Error:', result.error);
  // Show error toast
}
```

---

## Performance Tips

1. **Batch Operations**: Use Promise.all for multiple operations
2. **Pagination**: Implement pagination for large lists
3. **Caching**: Consider KV cache for frequently accessed data
4. **Lazy Loading**: Load data on demand in tabs
5. **Debouncing**: Debounce search operations

---

## Next Development Tasks

### High Priority

- [ ] Implement Google Sheets import
- [ ] Build worker profile detail pages
- [ ] Create worker assignment UI with filters
- [ ] Implement payment approval workflow

### Medium Priority

- [ ] Email template integration
- [ ] WhatsApp integration
- [ ] Document upload functionality
- [ ] Advanced reporting

### Low Priority

- [ ] Mobile app
- [ ] GPS tracking
- [ ] Performance ratings
- [ ] AI recommendations

---

*Last Updated: June 18, 2026*
*Framework Version: 1.0*
*Status: Core framework complete, ready for feature development*
