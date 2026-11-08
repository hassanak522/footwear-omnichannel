import { NextRequest, NextResponse } from 'next/server';
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ message: 'Invalid origin' }, { status: 403 });
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set('rs_admin_session', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
