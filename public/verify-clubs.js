/**
 * Quick verification script for club duplicates
 * Run this in browser console to check exact duplicate structure
 */

async function verifyClubDuplicates() {
  console.log('🔍 Starting club duplicate verification...\n');

  try {
    // Step 1: Get all clubs list
    console.log('📦 Step 1: Fetching complete clubs list...');
    const listRes = await fetch('/api/admin/clubs-list', { cache: 'no-store' });
    const listData = await listRes.json();
    console.log(`   Found ${listData.total_clubs} total clubs`);
    console.log(`   Duplicate name groups: ${listData.duplicate_name_groups}\n`);

    if (!listData.success) {
      console.error('   ❌ Failed to fetch clubs list');
      return;
    }

    // Step 2: Get debug info
    console.log('🔍 Step 2: Fetching detailed debug info...');
    const debugRes = await fetch('/api/admin/clubs-debug', { cache: 'no-store' });
    const debugData = await debugRes.json();
    console.log(`   Total clubs in debug: ${debugData.summary.total_clubs}`);
    console.log(`   Duplicate names: ${debugData.summary.duplicate_name_groups}`);
    console.log(`   Duplicate coaches: ${debugData.summary.duplicate_coach_groups}\n`);

    // Step 3: Show duplicates by name
    if (debugData.duplicate_names && debugData.duplicate_names.length > 0) {
      console.log('⚠️  Duplicate Clubs by Name:');
      debugData.duplicate_names.forEach((group, idx) => {
        console.group(`Group ${idx + 1}: "${group.name}"`);
        group.clubs.forEach((club, cidx) => {
          console.log(`  ${cidx + 1}. ID: ${club.id}`);
          console.log(`     Name: ${club.name}`);
          console.log(`     Coach: ${club.coach_name || club.coachName}`);
          console.log(`     City: ${club.city}`);
        });
        console.groupEnd();
      });
    } else {
      console.log('✅ No duplicate clubs by name found');
    }

    // Step 4: Show duplicates by coach
    if (debugData.duplicate_coaches && debugData.duplicate_coaches.length > 0) {
      console.log('\n⚠️  Duplicate Coaches:');
      debugData.duplicate_coaches.forEach((group, idx) => {
        console.group(`Coach ${idx + 1}: "${group.coach}"`);
        group.clubs.forEach((club, cidx) => {
          console.log(`  ${cidx + 1}. ID: ${club.id}, Name: ${club.name}`);
        });
        console.groupEnd();
      });
    } else {
      console.log('\n✅ No duplicate coaches found');
    }

    // Step 5: Get duplicates endpoint
    console.log('\n🔄 Step 3: Fetching duplicates endpoint response...');
    const dupsRes = await fetch('/api/admin/clubs-duplicates', { cache: 'no-store' });
    const dupsData = await dupsRes.json();
    console.log(`   Found ${dupsData.totalClubs} clubs`);
    console.log(`   Duplicates by name: ${dupsData.duplicatesByNameCount}`);
    console.log(`   Duplicates by coach: ${dupsData.duplicatesByCoachCount}\n`);

    // Step 6: Summary
    console.log('📊 SUMMARY:');
    console.log(`   ✓ List endpoint: ${listData.total_clubs} clubs`);
    console.log(`   ✓ Debug endpoint: ${debugData.summary.total_clubs} clubs`);
    console.log(`   ✓ Duplicates endpoint: ${dupsData.totalClubs} clubs`);
    console.log(`   ✓ Name duplicates: ${debugData.summary.duplicate_name_groups}`);
    console.log(`   ✓ Coach duplicates: ${debugData.summary.duplicate_coach_groups}`);

    if (
      listData.total_clubs === debugData.summary.total_clubs &&
      debugData.summary.total_clubs === dupsData.totalClubs
    ) {
      console.log('\n✅ All endpoints agree on club count!');
    } else {
      console.log('\n⚠️  Endpoints have different club counts - potential issue!');
    }

    // Return data for further inspection
    return {
      list: listData,
      debug: debugData,
      duplicates: dupsData,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('❌ Error during verification:', error);
    return null;
  }
}

// Run the verification
console.log('Club Duplicate Verification Script Loaded');
console.log('Run: verifyClubDuplicates() to start verification\n');
verifyClubDuplicates();
