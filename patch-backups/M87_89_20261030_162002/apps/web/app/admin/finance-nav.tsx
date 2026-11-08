'use client';
import { usePathname, useRouter } from 'next/navigation';
const pages = [
  ['/admin', 'HQ operations'],
  ['/admin/finance-command-center', 'Command center'],
  ['/admin/finance-reconciliation', 'Reconciliation'],
  ['/admin/finance-operations', 'Operations'],
  ['/admin/finance-casework', 'Casework'],
] as const;
export default function FinanceNav() {
  const pathname = usePathname(); const router = useRouter();
  async function signOut() {
    const response = await fetch('/api/admin-session/logout', {method:'POST',credentials:'same-origin'});
    if (response.ok) { router.replace('/admin/finance-login'); router.refresh(); }
    else alert('Unable to sign out. Please retry.');
  }
  return <nav aria-label="Royal Step finance navigation" style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:12,padding:'14px 20px',borderBottom:'1px solid #ddd',fontFamily:'system-ui'}}>
    <strong>Royal Step HQ</strong>
    {pages.map(([href,label])=><a key={href} href={href} aria-current={pathname===href?'page':undefined} style={{fontWeight:pathname===href?700:400}}>{label}</a>)}
    <button type="button" onClick={signOut} style={{marginLeft:'auto'}}>Sign out</button>
  </nav>;
}
