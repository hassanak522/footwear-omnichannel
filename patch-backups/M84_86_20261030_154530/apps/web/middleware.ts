import { NextRequest, NextResponse } from 'next/server';
export function middleware(request: NextRequest) {
  if (!request.cookies.has('rs_admin_session')) {
    const url = new URL('/admin/finance-login', request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ['/admin/finance-reconciliation/:path*', '/admin/finance-operations/:path*', '/admin/finance-casework/:path*', '/admin/finance-command-center/:path*'] };
