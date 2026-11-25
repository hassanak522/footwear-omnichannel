// R10_3D21_RETAIL_NAVIGATION
export default function RetailOperationsPage(){
 return (
  <main style={{
   maxWidth:1000,
   margin:'0 auto',
   padding:24
  }}>
   <h1>Retail Operations</h1>

   <p>
    Royal Step branch operations and management accountability.
   </p>

   <div style={{
    display:'grid',
    gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',
    gap:16
   }}>
    <section className="card">
     <h2>Corrective actions</h2>
     <p>
      Review assigned actions, deadlines and completion evidence.
     </p>
     <a href="/retail-ops/corrective-actions">
      Open corrective action workspace
     </a>
    </section>
   </div>

   <p><a href="/">Return to home</a></p>
  </main>
 );
}