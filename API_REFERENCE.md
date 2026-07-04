# API Endpoint Reference - Club Diagnostics

## Endpoint Comparison

| Endpoint | Purpose | Returns | Best For |
|----------|---------|---------|----------|
| `/api/admin/clubs-list` | Raw club listing | All clubs, sorted by name | Seeing all clubs at once |
| `/api/admin/clubs-debug` | Detailed analysis | Clubs + duplicate groups + server logs | Comprehensive debugging |
| `/api/admin/clubs-duplicates` | Duplicate detection | Duplicates by name & coach | UI display |
| `/api/admin/merge-duplicate-clubs` | Execute merge | Merge result | Merging clubs |

---

## Response Formats

### GET `/api/admin/clubs-list`

**Response**:
```json
{
  "success": true,
  "total_clubs": 59,
  "duplicate_name_groups": 2,
  "duplicates": [
    {
      "name": "trifitzone",
      "clubs": [
        {
          "id": "AgeC53KUjCCUxZW6IYHK",
          "name": "Trifitzone",
          "coach_name": "Coach A",
          "city": "City A"
        },
        {
          "id": "12V54wmUeawY1UYrfTDW",
          "name": "Trifit zone",
          "coach_name": "Coach B",
          "city": "City B"
        }
      ]
    }
  ],
  "clubs": [
    {
      "id": "club_id_1",
      "name": "Club Name",
      "coach": "Coach Name",
      "email": "email@example.com",
      "city": "City"
    }
  ]
}
```

**Use**: To see all clubs with duplicates clearly marked

---

### GET `/api/admin/clubs-debug`

**Response**:
```json
{
  "success": true,
  "timestamp": "2024-03-20T14:30:00Z",
  "summary": {
    "total_clubs": 59,
    "duplicate_name_groups": 2,
    "duplicate_coach_groups": 1
  },
  "duplicate_names": [
    {
      "name": "trifitzone",
      "clubs": [
        {
          "id": "AgeC53KUjCCUxZW6IYHK",
          "name": "Trifitzone",
          "coach_name": "Coach A",
          "coachName": null,
          "city": "City A"
        }
      ]
    }
  ],
  "duplicate_coaches": [
    {
      "coach": "coach name",
      "clubs": [
        {
          "id": "id1",
          "name": "Club 1",
          "coach_name": "Coach name"
        }
      ]
    }
  ],
  "all_clubs": [
    {
      "id": "club_id",
      "name": "Club Name",
      "coach": "Coach Name",
      "city": "City"
    }
  ]
}
```

**Use**: Detailed debugging with both name and coach duplicates

---

### GET `/api/admin/clubs-duplicates`

**Response**:
```json
{
  "success": true,
  "totalClubs": 59,
  "duplicatesByNameCount": 2,
  "duplicatesByCoachCount": 1,
  "details": {
    "byName": {
      "trifitzone": [
        {
          "id": "AgeC53KUjCCUxZW6IYHK",
          "name": "Trifitzone",
          "coach_name": "Coach A",
          "coachName": null,
          "email": "email@example.com",
          "city": "City A"
        },
        {
          "id": "12V54wmUeawY1UYrfTDW",
          "name": "Trifit zone",
          "coach_name": "Coach B",
          "coachName": null,
          "email": "email2@example.com",
          "city": "City B"
        }
      ]
    },
    "byCoach": {
      "coach_name": [
        {
          "id": "id1",
          "name": "Club 1"
        },
        {
          "id": "id2",
          "name": "Club 2"
        }
      ]
    },
    "similarNames": {}
  },
  "allClubs": [
    {
      "id": "club_id",
      "name": "Club Name",
      "coach": "Coach Name",
      "email": "email@example.com",
      "city": "City"
    }
  ]
}
```

**Use**: For UI component to display duplicates, exact format ClubMergeTab expects

---

## Testing Endpoints

### In Browser Console:

```javascript
// Test clubs-list
fetch('/api/admin/clubs-list', { cache: 'no-store' })
  .then(r => r.json())
  .then(d => { 
    console.log('List endpoint:', d);
    console.log('Total:', d.total_clubs);
  })
  .catch(e => console.error('Error:', e));

// Test clubs-debug
fetch('/api/admin/clubs-debug', { cache: 'no-store' })
  .then(r => r.json())
  .then(d => {
    console.log('Debug endpoint:', d);
    console.log('Summary:', d.summary);
    console.log('By Name:', d.duplicate_names);
  })
  .catch(e => console.error('Error:', e));

// Test clubs-duplicates
fetch('/api/admin/clubs-duplicates', { cache: 'no-store' })
  .then(r => r.json())
  .then(d => {
    console.log('Duplicates endpoint:', d);
    console.log('Details:', d.details);
  })
  .catch(e => console.error('Error:', e));
```

### Using curl from terminal:

```bash
# List all clubs
curl "http://localhost:3000/api/admin/clubs-list"

# Get debug info
curl "http://localhost:3000/api/admin/clubs-debug"

# Get duplicates
curl "http://localhost:3000/api/admin/clubs-duplicates"
```

---

## Field Mapping Reference

| Field Name | Source | Meaning |
|-----------|--------|---------|
| `id` | Firestore doc.id | Unique club identifier |
| `name` | Firestore doc.data().name | Club display name |
| `coach_name` | Firestore doc.data().coach_name | Coach name (snake_case field) |
| `coachName` | Firestore doc.data().coachName | Coach name (camelCase field) |
| `email` | Firestore doc.data().email | Club email |
| `city` | Firestore doc.data().city | Club city |
| `state` | Firestore doc.data().state | Club state |

**Note**: Firestore may have both `coach_name` and `coachName` fields. All endpoints normalize this.

---

## Expected Values

### For clubs with known duplicates:

**Trifitzone Duplicates**:
```
ID 1: AgeC53KUjCCUxZW6IYHK
ID 2: 12V54wmUeawY1UYrfTDW
Normalized Name: "trifitzone"
```

**TRIBLR Duplicates**:
```
ID 1: KtwokOGkZJ54s21PtSpV
ID 2: afu8lsZ3RM5s36NpTV1p
Normalized Name: "triblr"
```

### Expected Counts:
- Total clubs: 59 (or after merge: 57)
- Duplicate name groups: 2 (before merge)
- Duplicate coach groups: may vary

---

## Error Responses

### 500 Error Response:
```json
{
  "success": false,
  "error": "Error message here",
  "details": "Detailed error information"
}
```

**Common Errors**:
- `Cannot find module '@/lib/firebaseAdmin'` → Import path wrong
- `adminDb.collection is not a function` → Firestore not initialized
- `Network error` → Server not running

---

## Troubleshooting by Response

### No duplicates found but you expect them:

1. Check `total_clubs` in response - if lower than expected, may have been synced/cleaned
2. Check exact club names - may have spaces/case differences
3. Try `/api/admin/clubs-debug` to see all clubs
4. Compare normalized names with `byName` keys

### Different endpoint showing different totals:

| Scenario | Cause | Solution |
|----------|-------|----------|
| All show same count but no dups | Dups already merged | Check merge history |
| Different totals | Data inconsistency | Force full sync |
| One endpoint errors | API issue | Check server logs |

---

## Performance Notes

- `clubs-list`: Sorts all clubs (slower for large counts)
- `clubs-debug`: Full analysis with all steps (slowest)
- `clubs-duplicates`: Optimized for UI (fastest)

For large club counts (1000+), `clubs-duplicates` recommended.
