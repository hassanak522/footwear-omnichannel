import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const allowed = new Set(['finance-reconciliation','finance-verification','finance-operations','finance-casework','finance-command-center']);
const methods = ['GET','POST','PATCH'];
function upstreamOrigin() {
  const value = process.env.INTERNAL_API_URL || 'http://127.0.0.1:3001';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid INTERNAL_API_URL');
  return url.origin;
}
async function proxy(request: NextRequest, context: { params: { path: string[] } }) {
  const segments = context.params.path;
  if (!segments?.length || !allowed.has(segments[0]) || segments.some(s => !/^[a-zA-Z0-9_-]{1,120}$/.test(s))) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  const token = request.cookies.get('rs_admin_session')?.value;
  if (!token) return NextResponse.json({ message: 'Sign in to finance console' }, { status: 401 });
  if (!methods.includes(request.method)) return NextResponse.json({ message: 'Method not allowed' }, { status: 405 });
  if (request.method !== 'GET') {
    if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ message: 'Invalid origin' }, { status: 403 });
    if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ message: 'JSON required' }, { status: 415 });
  }
  try {
    const url = `${upstreamOrigin()}/api/v1/${segments.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
    const body = request.method === 'GET' ? undefined : await request.text();
    if (body && body.length > 65536) return NextResponse.json({ message: 'Payload too large' }, { status: 413 });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let upstream: Response;
    try { upstream = await fetch(url, { method: request.method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body, cache: 'no-store', signal: controller.signal, redirect: 'manual' }); }
    finally { clearTimeout(timeout); }
    const text = await upstream.text();
    const response = new NextResponse(text, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('content-type')?.startsWith('application/json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    if (upstream.status === 401) response.cookies.set('rs_admin_session', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
    return response;
  } catch { return NextResponse.json({ message: 'Finance API unavailable' }, { status: 502 }); }
}
export { proxy as GET, proxy as POST, proxy as PATCH };
