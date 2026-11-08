import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) {
  return NextResponse.json({ sessionPresent: Boolean(request.cookies.get('rs_admin_session')?.value) }, { headers: { 'Cache-Control': 'no-store' } });
}
