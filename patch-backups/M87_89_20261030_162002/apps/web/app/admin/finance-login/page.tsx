'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export default function FinanceLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  function returnDestination() {
    const requested = new URLSearchParams(window.location.search).get('next') || '';
    return /^\/admin\/(finance-reconciliation|finance-operations|finance-casework|finance-command-center)(?:\/|\?|$)/.test(requested) && !requested.includes('\\') && !requested.includes('//') ? requested : '/admin/finance-command-center';
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await fetch('/api/admin-session/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ email, password }) });
      if (!r.ok) throw new Error(r.status === 401 ? 'Invalid credentials' : 'Unable to sign in');
      setPassword(''); router.replace(returnDestination()); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to sign in'); }
    finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 430, margin: '70px auto', padding: 24, fontFamily: 'system-ui' }}>
    <h1>Royal Step Finance Sign In</h1>
    <p>Use your authorized HQ or branch manager account.</p>
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
      <label>Email<input required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} style={{ display: 'block', width: '100%', padding: 9 }} /></label>
      <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} style={{ display: 'block', width: '100%', padding: 9 }} /></label>
      <button disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
    </form>
    {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
  </main>;
}
