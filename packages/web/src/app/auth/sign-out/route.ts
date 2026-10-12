import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return new NextResponse(null, { status: 403 });
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url), 303);
}
