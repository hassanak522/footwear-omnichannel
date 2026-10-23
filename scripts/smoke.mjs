/**
 * Safe, non-mutating API smoke checks. Run against a local/dev API only.
 * Optional env: API_BASE_URL, SMOKE_EMAIL, SMOKE_PASSWORD.
 */
const base = (process.env.API_BASE_URL || 'http://localhost:3001/api/v1').replace(/\/$/, '');
const timeoutMs = 10000;
let failures = 0;
async function request(path, options={}) {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), timeoutMs);
 try {
  const response = await fetch(`${base}${path}`, {...options, signal: controller.signal});
  const body = await response.text();
  let json;
  try { json = JSON.parse(body); } catch { json = body; }
  return {status: response.status, body: json};
 } finally { clearTimeout(timer); }
}
async function check(label, fn) {
 try { const detail = await fn(); console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`); }
 catch (err) { failures++; console.error(`FAIL ${label} — ${err.message}`); }
}
function expectStatus(result, expected) {
 if (result.status !== expected) throw new Error(`expected HTTP ${expected}, received ${result.status}: ${JSON.stringify(result.body).slice(0,300)}`);
}
console.log(`Read-only smoke test against ${base}`);
await check('Health endpoint', async () => {
 const r=await request('/health'); expectStatus(r,200);
 if(r.body?.status!=='ok')throw new Error('health payload missing status ok');
});
await check('Public shipping quote shape', async () => {
 const r=await request('/store/shipping');expectStatus(r,200);
 if(typeof r.body?.available!=='boolean'||r.body?.currency!=='PKR')throw new Error('invalid shipping quote');
 if(r.body.available&&(!/^([0-9]+)([.][0-9]{1,2})?$/.test(r.body.shippingFee)||Number(r.body.shippingFee)<0))throw new Error('invalid configured shipping charge');
});
await check('POS return mutations require authentication', async () => {
 const r=await request('/pos/returns',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})});expectStatus(r,401);
});
await check('Public catalog response', async () => {
 const r=await request('/store/products'); expectStatus(r,200);
 if(!Array.isArray(r.body))throw new Error('expected product array');
 return `${r.body.length} products`;
});
await check('HQ endpoint requires authentication', async () => {
 const r=await request('/hq/overview'); expectStatus(r,401);
});
await check('Loyalty ledger requires authentication', async () => {
 const r=await request('/retail/customers/00000000-0000-4000-8000-000000000000/loyalty-ledger');expectStatus(r,401);
});
await check('Loyalty preview requires authentication', async () => {
 const r=await request('/retail/customers/00000000-0000-4000-8000-000000000000/rewards-preview');expectStatus(r,401);
});
await check('Customer insights require authentication', async () => {
 const r=await request('/retail/customers/00000000-0000-4000-8000-000000000000/insights');expectStatus(r,401);
});
await check('POS sales require authentication', async () => {
 const r=await request('/pos/sales/00000000-0000-4000-8000-000000000000');expectStatus(r,401);
});
await check('HQ sales analytics require authentication', async () => {
 const r=await request('/hq/sales-analytics');expectStatus(r,401);
});
await check('Orders endpoint requires authentication', async () => {
 const r=await request('/orders'); expectStatus(r,401);
});
await check('Invalid login is rejected', async () => {
 const r=await request('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'nonexistent-smoke-test@example.invalid',password:'invalid-test-password'})});
 expectStatus(r,401);
});
if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
 let token;
 await check('Admin login', async () => {
  const r=await request('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:process.env.SMOKE_EMAIL,password:process.env.SMOKE_PASSWORD})});
  expectStatus(r,201); token=r.body?.accessToken;
  if(!token)throw new Error('missing accessToken');
 });
 if(token){
  const headers={authorization:`Bearer ${token}`};
  await check('HQ overview (admin)', async () => {const r=await request('/hq/overview',{headers});expectStatus(r,200);if(!r.body?.stock)throw new Error('missing stock');});
  await check('HQ stock-by-location (admin)', async () => {const r=await request('/hq/stock-by-location',{headers});expectStatus(r,200);if(!Array.isArray(r.body))throw new Error('expected array');});
  await check('HQ sales analytics (admin)', async () => {const r=await request('/hq/sales-analytics',{headers});expectStatus(r,200);if(!Array.isArray(r.body?.byLocation))throw new Error('expected byLocation array');});
  await check('HQ attention (admin)', async () => {const r=await request('/hq/attention',{headers});expectStatus(r,200);if(!r.body?.lowAvailability)throw new Error('missing lowAvailability');});
 }
} else console.log('SKIP authenticated HQ checks (set SMOKE_EMAIL and SMOKE_PASSWORD)');
console.log(failures ? `Smoke tests failed: ${failures}` : 'All executed smoke checks passed');
process.exitCode = failures ? 1 : 0;
