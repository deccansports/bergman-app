// src/app/api/proxy-image/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Image URL is required' }, { status: 400 });
  }

  try {
    // Fetch the image from the external URL
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    // Get the image data as a blob
    const imageBlob = await response.blob();
    const imageBuffer = Buffer.from(await imageBlob.arrayBuffer());
    
    const headers = new Headers();
    headers.set('Content-Type', imageBlob.type);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    // Set Content-Disposition to 'inline' to suggest browser to display the file, not download it.
    headers.set('Content-Disposition', 'inline');


    // Create a new response with the image data and appropriate headers
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: headers,
    });
  } catch (error: any) {
    console.error(`[API /proxy-image] Error fetching image from ${imageUrl}:`, error);
    return NextResponse.json({ error: `Failed to retrieve image: ${error.message}` }, { status: 500 });
  }
}
