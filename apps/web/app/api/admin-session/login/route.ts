import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
function apiBase() {
  const value = process.env.INTERNAL_API_URL || 'http://127.0.0.1:3001';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid INTERNAL_API_URL');
  return url.origin;
}
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ message: 'Invalid origin' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ message: 'JSON required' }, { status: 415 });
  let credentials: { email?: unknown; password?: unknown };
  try { credentials = await request.json(); } catch { return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 }); }
  if (typeof credentials.email !== 'string' || typeof credentials.password !== 'string' || credentials.email.length > 320 || credentials.password.length > 1024) return NextResponse.json({ message: 'Invalid credentials' }, { status: 400 });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let upstream: Response;
    try { upstream = await fetch(`${apiBase()}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials), cache: 'no-store', signal: controller.signal }); }
    finally { clearTimeout(timeout); }
    if (!upstream.ok) return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
    const data = await upstream.json();
    if (typeof data.accessToken !== 'string' || !data.accessToken) return NextResponse.json({ message: 'Invalid login response' }, { status: 502 });
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set('rs_admin_session', data.accessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 3600 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch { return NextResponse.json({ message: 'Authentication service unavailable' }, { status: 502 }); }
}
