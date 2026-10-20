import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/chatcloud';
  const nextUrl = new URL(next, origin);
  const redirectUrl = nextUrl.origin === origin ? nextUrl : new URL('/chatcloud', origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Return user to login if confirmation fails
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}