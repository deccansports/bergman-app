import { fixPageUrlsMigration } from '@/lib/actions/pageActions';

export async function POST() {
  try {
    const result = await fixPageUrlsMigration();
    return Response.json(result);
  } catch (error: any) {
    return Response.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
