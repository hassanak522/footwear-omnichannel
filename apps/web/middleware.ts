import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  if (!request.cookies.has('rs_admin_session')) {
    const login = new URL(
      '/admin/finance-login',
      request.url
    );

    login.searchParams.set(
      'next',
      request.nextUrl.pathname + request.nextUrl.search
    );

    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/finance-reconciliation/:path*',
    '/admin/finance-operations/:path*',
    '/admin/finance-casework/:path*',
    '/admin/finance-command-center/:path*',
    '/admin/retail/:path*',
    '/admin/payment-reconciliation/:path*',
    '/admin/finance-controls/:path*'
  ]
};