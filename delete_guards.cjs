var admin = require('firebase-admin');
var sa = require('/Users/vaibhav/Downloads/racehub-ao1fu-d54c807cc479.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
var db = admin.firestore();
db.collection('registrationDeletionGuards').get().then(function(snap) {
  console.log('total docs:', snap.size);
  var guards = snap.docs.filter(function(d) {
    return String(d.data().guardType || '').includes('athlete');
  });
  console.log('athlete_event guards:', guards.length);
  guards.forEach(function(d) { console.log(' -', d.id); });
  if (!guards.length) { process.exit(0); return; }
  var b = db.batch();
  guards.forEach(function(d) { b.delete(d.ref); });
  return b.commit();
}).then(function() {
  console.log('done');
  process.exit(0);
}).catch(function(e) {
  console.error(e.message);
  process.exit(1);
});
