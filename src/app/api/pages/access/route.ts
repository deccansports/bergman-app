import { NextRequest, NextResponse } from 'next/server';
import { getPagesAction } from '@/lib/actions/pageActions';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = String(searchParams.get('slug') || '').trim();

    if (!slug) {
      return NextResponse.json({ success: false, message: 'slug is required' }, { status: 400 });
    }

    const pagesResult = await getPagesAction();
    const page = pagesResult.pages?.find((p) => p.slug === slug);

    if (!page || !page.published) {
      return NextResponse.json({ success: false, message: 'Page not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      slug,
      requiresLogin: !!page.requiresLogin,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || 'Failed to resolve page access' }, { status: 500 });
  }
}
