import admin from 'firebase-admin';

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, TARGET_EMAIL='', DRY_RUN='1' } = process.env;
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error('Missing Firebase env vars');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const auth = admin.auth();
const dryRun = DRY_RUN !== '0';
const target = TARGET_EMAIL.trim().toLowerCase();

for (const dbId of ['(default)', 'bmdatabase']) {
  const db = dbId === '(default)' ? admin.firestore() : admin.firestore(admin.app(), dbId);
  let q = db.collection('users');
  if (target) q = q.where('email', '==', target);
  const snap = await q.get();

  console.log(`db=${dbId} found=${snap.size} dryRun=${dryRun}`);
  let updated = 0;

  for (const doc of snap.docs) {
    const u = doc.data() || {};
    const email = String(u.email || '').trim().toLowerCase();
    let emailVerified = u.emailVerified ?? false;

    try { emailVerified = !!(await auth.getUser(doc.id)).emailVerified; }
    catch {
      if (email) {
        try { emailVerified = !!(await auth.getUserByEmail(email)).emailVerified; } catch {}
      }
    }

    let clubId = u.clubId ?? null;
    let clubName = u.clubName ?? null;
    const hist = Array.isArray(u.clubHistory) ? u.clubHistory : [];
    if ((!clubId || !clubName) && hist.length) {
      const active = hist.find(e => e?.isActive) || hist[hist.length - 1];
      if (active) {
        clubId = clubId || active.clubId || null;
        clubName = clubName || active.clubName || null;
      }
    }

    const patch = {};
    if (email && u.email !== email) patch.email = email;
    if ((u.emailVerified ?? null) !== emailVerified) patch.emailVerified = emailVerified;
    if ((u.clubId ?? null) !== (clubId ?? null)) patch.clubId = clubId;
    if ((u.clubName ?? null) !== (clubName ?? null)) patch.clubName = clubName;
    if (Object.keys(patch).length) patch.updatedAt = new Date().toISOString();

    if (Object.keys(patch).length) {
      updated++;
      console.log('PATCH', dbId, doc.id, patch);
      if (!dryRun) await doc.ref.set(patch, { merge: true });
    }
  }

  console.log(`db=${dbId} updated=${updated}`);
}
