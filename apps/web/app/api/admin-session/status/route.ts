import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function apiOrigin() {
  const value = process.env.INTERNAL_API_URL || 'http://127.0.0.1:3001';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid INTERNAL_API_URL');
  return url.origin;
}
export async function GET(request: NextRequest) {
  const token = request.cookies.get('rs_admin_session')?.value;
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!token) return NextResponse.json({ sessionPresent: false }, { status: 200, headers });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let upstream: Response;
    try {
      upstream = await fetch(`${apiOrigin()}/api/v1/auth/session`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal, redirect: 'manual'
      });
    } finally { clearTimeout(timeout); }
    if (upstream.ok) return NextResponse.json({ sessionPresent: true }, { headers });
    if (upstream.status === 401 || upstream.status === 403) {
      const response = NextResponse.json({ sessionPresent: false }, { headers });
      response.cookies.set('rs_admin_session', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
      return response;
    }
    return NextResponse.json({ message: 'Session verification unavailable' }, { status: 503, headers });
  } catch {
    return NextResponse.json({ message: 'Session verification unavailable' }, { status: 503, headers });
  }
}
