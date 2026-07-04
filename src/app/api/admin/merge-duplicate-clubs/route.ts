import { mergeDuplicateClubs, mergeKnownDuplicates } from '@/lib/actions/clubMergeActions';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // If primaryClubId is provided, use custom merge
    if (body.primaryClubId && body.duplicateClubIds) {
      console.log('[Merge Duplicates API] Custom merge operation...');
      const result = await mergeDuplicateClubs(
        body.primaryClubId,
        body.duplicateClubIds
      );
      return Response.json({
        success: result.success,
        message: result.message,
        result,
      });
    }
    
    // Otherwise, merge known duplicates
    console.log('[Merge Duplicates API] Merging known duplicates...');
    const results = await mergeKnownDuplicates();
    
    return Response.json({
      success: true,
      message: 'Successfully merged all duplicate clubs',
      results,
    });
  } catch (error: any) {
    console.error('[Merge Duplicates API] Error:', error);
    return Response.json(
      { 
        success: false,
        error: error.message || 'Failed to merge duplicate clubs'
      },
      { status: 500 }
    );
  }
}
