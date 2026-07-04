const { kv } = require('@vercel/kv');

async function checkVaibhavData() {
  const vaibhavUid = 'bMLrIYV7SgfNhGhFVo3E6nOmXK23'; // Get from your auth
  const userIndexKey = `user:${vaibhavUid}:events:index`;
  
  try {
    const userIndex = await kv.get(userIndexKey);
    console.log('User Index:', JSON.stringify(userIndex, null, 2));
    
    if (userIndex && Array.isArray(userIndex)) {
      for (const summary of userIndex) {
        const detailKey = `event:${summary.eventId}:participant:${summary.bookingId}`;
        const detail = await kv.get(detailKey);
        console.log(`Detail [${detailKey}]:`, JSON.stringify(detail, null, 2));
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkVaibhavData();
