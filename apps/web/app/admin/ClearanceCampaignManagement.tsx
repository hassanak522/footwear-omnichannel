'use client';

import {useEffect,useMemo,useState} from 'react';

type Variant = {
  id:string;
  sku:string;
  size:string;
  color:string;
  price:string|number;
  active:boolean;
};

type Product = {
  id:string;
  title:string;
  active:boolean;
  variants:Variant[];
};

type Location = {
  id:string;
  name:string;
  type:string;
  active:boolean;
};

type Campaign = {
  id:string;
  code:string;
  title:string;
  description?:string|null;
  type:'PERCENT'|'FIXED';
  value:string;
  startsAt:string;
  endsAt:string;
  status:string;
  effectiveStatus:string;
  variants:{variantId:string}[];
  branches:{locationId:string}[];
};

type AgingRow = {
  locationId:string;
  sku:string;
  candidate:boolean;
  onHand:number;
  oldestRecordedAgeDays:number|null;
};

async function api(path:string,method='GET',body?:unknown){
  const response=await fetch('/api/v1'+path,{
    method,
    credentials:'same-origin',
    cache:'no-store',
    headers:{'Content-Type':'application/json'},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
  });

  const result=await response.json().catch(()=>({}));

  if(!response.ok){
    throw new Error(
      Array.isArray(result.message)
        ?result.message.join('; ')
        :result.message||'HTTP '+response.status
    );
  }

  return result;
}

function localDate(daysAhead:number){
  const date=new Date(Date.now()+daysAhead*86400000);
  const local=new Date(
    date.getTime()-date.getTimezoneOffset()*60000
  );
  return local.toISOString().slice(0,16);
}

function displayDate(value:string){
  return new Date(value).toLocaleString('en-PK');
}

export default function ClearanceCampaignManagement(){
  const [campaigns,setCampaigns]=useState<Campaign[]>([]);
  const [products,setProducts]=useState<Product[]>([]);
  const [locations,setLocations]=useState<Location[]>([]);
  const [aging,setAging]=useState<AgingRow[]>([]);

  const [code,setCode]=useState('');
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [type,setType]=useState<'PERCENT'|'FIXED'>('PERCENT');
  const [value,setValue]=useState('');
  const [startsAt,setStartsAt]=useState(localDate(0));
  const [endsAt,setEndsAt]=useState(localDate(7));

  const [selectedVariants,setSelectedVariants]=useState<string[]>([]);
  const [selectedBranches,setSelectedBranches]=useState<string[]>([]);

  const [search,setSearch]=useState('');
  const [statusFilter,setStatusFilter]=useState('ALL');
  const [agingDays,setAgingDays]=useState(90);

  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');

  async function load(){
    setLoading(true);
    setError('');

    try{
      const [c,p,l]=await Promise.all([
        api('/hq/clearance-campaigns'),
        api('/catalog/products'),
        api('/inventory/locations')
      ]);

      if(!Array.isArray(c)||!Array.isArray(p)||!Array.isArray(l)){
        throw new Error('Unexpected API response');
      }

      setCampaigns(c);
      setProducts(p);
      setLocations(l);
    }catch(e){
      setError(e instanceof Error?e.message:'Unable to load data');
    }finally{
      setLoading(false);
    }
  }

  useEffect(()=>{
    void load();
  },[]);

  const branches=useMemo(
    ()=>locations.filter(l=>l.type==='BRANCH'&&l.active),
    [locations]
  );

  const variants=useMemo(
    ()=>products
      .filter(p=>p.active)
      .flatMap(p=>
        (p.variants||[])
          .filter(v=>v.active)
          .map(v=>({...v,productTitle:p.title}))
      ),
    [products]
  );

  const agingPairs=useMemo(
    ()=>new Set(
      aging
        .filter(r=>r.candidate&&r.onHand>0)
        .map(r=>r.locationId+':'+r.sku)
    ),
    [aging]
  );

  const suggestedIds=useMemo(
    ()=>variants
      .filter(v=>selectedBranches.some(
        branchId=>agingPairs.has(branchId+':'+v.sku)
      ))
      .map(v=>v.id),
    [variants,selectedBranches,agingPairs]
  );

  const filteredVariants=variants.filter(v=>{
    const q=search.trim().toLowerCase();

    return !q||
      v.sku.toLowerCase().includes(q)||
      v.productTitle.toLowerCase().includes(q)||
      v.size.toLowerCase().includes(q)||
      v.color.toLowerCase().includes(q);
  });

  const filteredCampaigns=campaigns.filter(c=>
    statusFilter==='ALL'||c.effectiveStatus===statusFilter
  );

  function toggle(
    id:string,
    selected:string[],
    setter:(ids:string[])=>void
  ){
    setter(
      selected.includes(id)
        ?selected.filter(x=>x!==id)
        :[...selected,id]
    );
  }

  async function loadAging(){
    setBusy(true);
    setError('');

    try{
      if(!Number.isInteger(agingDays)||
         agingDays<1||agingDays>3650){
        throw new Error('Aging threshold must be 1–3650 days');
      }

      const result=await api(
        '/hq/aging-inventory?thresholdDays='+agingDays
      );

      if(!Array.isArray(result.rows)){
        throw new Error('Unexpected aging report response');
      }

      setAging(result.rows);
      setSuccess('Aging recommendations loaded');
    }catch(e){
      setError(e instanceof Error?e.message:'Aging report failed');
    }finally{
      setBusy(false);
    }
  }

  async function create(e:React.FormEvent){
    e.preventDefault();
    setError('');
    setSuccess('');

    const amount=Number(value);

    if(!code.trim()||!title.trim()){
      setError('Campaign code and title are required');
      return;
    }

    if(!Number.isFinite(amount)||amount<=0||
       (type==='PERCENT'&&amount>100)||
       !/^\d+(\.\d{1,2})?$/.test(value)){
      setError('Enter a valid discount with up to two decimals');
      return;
    }

    if(selectedVariants.length===0||selectedBranches.length===0){
      setError('Select at least one SKU and one branch');
      return;
    }

    const start=new Date(startsAt);
    const end=new Date(endsAt);

    if(!Number.isFinite(start.getTime())||
       !Number.isFinite(end.getTime())||
       end<=start){
      setError('End date must be later than start date');
      return;
    }

    setBusy(true);

    try{
      const result=await api('/hq/clearance-campaigns','POST',{
        code:code.trim().toUpperCase(),
        title:title.trim(),
        description:description.trim(),
        type,
        value:amount,
        startsAt:start.toISOString(),
        endsAt:end.toISOString(),
        variantIds:selectedVariants,
        branchIds:selectedBranches
      });

      setSuccess('Draft campaign created: '+result.code);
      setCode('');
      setTitle('');
      setDescription('');
      setValue('');
      setSelectedVariants([]);
      setSelectedBranches([]);
      await load();
    }catch(e){
      setError(e instanceof Error?e.message:'Creation failed');
    }finally{
      setBusy(false);
    }
  }

  async function changeStatus(
    campaign:Campaign,
    action:'activate'|'cancel'
  ){
    const question=action==='activate'
      ?'Activate '+campaign.code+'?'
      :'Cancel '+campaign.code+'?';

    if(!window.confirm(question))return;

    setBusy(true);
    setError('');
    setSuccess('');

    try{
      await api(
        '/hq/clearance-campaigns/'+campaign.id+'/'+action,
        'POST',
        {}
      );

      setSuccess(
        campaign.code+' '+(
          action==='activate'?'activated':'cancelled'
        )
      );

      await load();
    }catch(e){
      setError(e instanceof Error?e.message:'Action failed');
    }finally{
      setBusy(false);
    }
  }

  const inputStyle:React.CSSProperties={
    width:'100%',
    maxWidth:440
  };

  return (
    <section className="stack">
      <div className="row">
        <div>
          <h2>Clearance Sale Management</h2>
          <p className="muted">
            Manage branch-specific clearance campaigns without
            changing catalog prices.
          </p>
        </div>

        <button
          type="button"
          className="secondary"
          disabled={loading||busy}
          onClick={()=>void load()}
        >
          Refresh
        </button>
      </div>

      {error&&<p role="alert" className="error">{error}</p>}
      {success&&<p role="status">{success}</p>}

      <div className="grid">
        {[
          ['Total campaigns',campaigns.length],
          ['Active',campaigns.filter(
            c=>c.effectiveStatus==='ACTIVE'
          ).length],
          ['Scheduled',campaigns.filter(
            c=>c.effectiveStatus==='SCHEDULED'
          ).length],
          ['Drafts',campaigns.filter(
            c=>c.effectiveStatus==='DRAFT'
          ).length]
        ].map(([label,count])=>(
          <div className="card" key={String(label)}>
            <div className="muted">{label}</div>
            <div className="metric">{count}</div>
          </div>
        ))}
      </div>

      <form className="card stack" onSubmit={create}>
        <h3>Create clearance campaign</h3>

        <div className="grid">
          <label>
            Campaign code
            <input
              required
              maxLength={50}
              pattern="[A-Za-z0-9_-]{3,50}"
              style={inputStyle}
              value={code}
              onChange={e=>setCode(e.target.value.toUpperCase())}
              placeholder="CLEARANCE-WINTER-2026"
            />
          </label>

          <label>
            Campaign title
            <input
              required
              minLength={3}
              maxLength={150}
              style={inputStyle}
              value={title}
              onChange={e=>setTitle(e.target.value)}
              placeholder="Winter stock clearance"
            />
          </label>

          <label>
            Discount type
            <select
              value={type}
              onChange={e=>setType(
                e.target.value as 'PERCENT'|'FIXED'
              )}
            >
              <option value="PERCENT">Percentage (%)</option>
              <option value="FIXED">Fixed amount (PKR)</option>
            </select>
          </label>

          <label>
            Discount value
            <input
              required
              type="number"
              min="0.01"
              max={type==='PERCENT'?100:100000000}
              step="0.01"
              value={value}
              onChange={e=>setValue(e.target.value)}
            />
          </label>

          <label>
            Start date and time
            <input
              required
              type="datetime-local"
              value={startsAt}
              onChange={e=>setStartsAt(e.target.value)}
            />
          </label>

          <label>
            End date and time
            <input
              required
              type="datetime-local"
              value={endsAt}
              onChange={e=>setEndsAt(e.target.value)}
            />
          </label>
        </div>

        <label>
          Description
          <textarea
            rows={3}
            maxLength={1000}
            value={description}
            onChange={e=>setDescription(e.target.value)}
          />
        </label>

        <h3>Select retail branches</h3>

        <div className="grid">
          {branches.map(branch=>(
            <label key={branch.id}>
              <input
                type="checkbox"
                checked={selectedBranches.includes(branch.id)}
                onChange={()=>toggle(
                  branch.id,
                  selectedBranches,
                  setSelectedBranches
                )}
              />
              {' '}{branch.name}
            </label>
          ))}
        </div>

        {branches.length===0&&(
          <p className="muted">No active retail branches available.</p>
        )}

        <h3>Aging inventory recommendations</h3>

        <div className="row">
          <label>
            Aging threshold (days)
            <input
              type="number"
              min={1}
              max={3650}
              value={agingDays}
              onChange={e=>setAgingDays(Number(e.target.value))}
            />
          </label>

          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={()=>void loadAging()}
          >
            Load aging candidates
          </button>

          <button
            type="button"
            className="secondary"
            disabled={busy||suggestedIds.length===0}
            onClick={()=>setSelectedVariants(old=>
              Array.from(new Set([...old,...suggestedIds]))
            )}
          >
            Add suggested SKUs ({suggestedIds.length})
          </button>
        </div>

        <p className="muted">
          Recommendations are matched by SKU and selected branch.
          They do not automatically activate discounts.
        </p>

        <h3>Select footwear variants</h3>

        <input
          aria-label="Search SKU or product"
          placeholder="Search SKU, product, size or color"
          value={search}
          onChange={e=>setSearch(e.target.value)}
        />

        <div className="row">
          <button
            type="button"
            className="secondary"
            onClick={()=>setSelectedVariants(old=>
              Array.from(new Set([
                ...old,
                ...filteredVariants.map(v=>v.id)
              ]))
            )}
          >
            Select filtered
          </button>

          <button
            type="button"
            className="secondary"
            onClick={()=>setSelectedVariants([])}
          >
            Clear selection
          </button>

          <strong>
            {selectedVariants.length} selected
          </strong>
        </div>

        <div
          className="tablewrap"
          style={{maxHeight:340,overflowY:'auto'}}
        >
          <table>
            <thead>
              <tr>
                <th>Select</th>
                <th>SKU</th>
                <th>Product</th>
                <th>Size</th>
                <th>Color</th>
                <th>Current price</th>
                <th>Aging candidate</th>
              </tr>
            </thead>

            <tbody>
              {filteredVariants.slice(0,1000).map(v=>(
                <tr key={v.id}>
                  <td>
                    <input
                      aria-label={'Select '+v.sku}
                      type="checkbox"
                      checked={selectedVariants.includes(v.id)}
                      onChange={()=>toggle(
                        v.id,
                        selectedVariants,
                        setSelectedVariants
                      )}
                    />
                  </td>
                  <td>{v.sku}</td>
                  <td>{v.productTitle}</td>
                  <td>{v.size}</td>
                  <td>{v.color}</td>
                  <td>PKR {Number(v.price).toLocaleString('en-PK')}</td>
                  <td>{suggestedIds.includes(v.id)?'Yes':'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredVariants.length>1000&&(
          <p className="muted">
            Showing first 1,000 matches. Narrow the search to
            select additional SKUs.
          </p>
        )}

        <button
          type="submit"
          disabled={busy||loading}
        >
          {busy?'Processing...':'Create draft campaign'}
        </button>
      </form>

      <section className="card stack">
        <div className="row">
          <h3>Existing clearance campaigns</h3>

          <label>
            Status
            <select
              value={statusFilter}
              onChange={e=>setStatusFilter(e.target.value)}
            >
              {[
                'ALL','DRAFT','SCHEDULED',
                'ACTIVE','EXPIRED','CANCELLED'
              ].map(s=>(
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Campaign</th>
                <th>Discount</th>
                <th>SKUs</th>
                <th>Branches</th>
                <th>Starts</th>
                <th>Ends</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredCampaigns.map(c=>(
                <tr key={c.id}>
                  <td>{c.code}</td>
                  <td>{c.title}</td>
                  <td>
                    {c.type==='PERCENT'
                      ?c.value+'%'
                      :'PKR '+Number(c.value).toLocaleString('en-PK')}
                  </td>
                  <td>{c.variants.length}</td>
                  <td>
                    {c.branches.map(b=>
                      locations.find(l=>l.id===b.locationId)?.name||
                      b.locationId.slice(0,8)
                    ).join(', ')}
                  </td>
                  <td>{displayDate(c.startsAt)}</td>
                  <td>{displayDate(c.endsAt)}</td>
                  <td>{c.effectiveStatus}</td>
                  <td>
                    {c.status==='DRAFT'&&(
                      <button
                        type="button"
                        disabled={busy}
                        onClick={()=>void changeStatus(c,'activate')}
                      >
                        Activate
                      </button>
                    )}

                    {(c.status==='DRAFT'||c.status==='ACTIVE')&&(
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        onClick={()=>void changeStatus(c,'cancel')}
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredCampaigns.length===0&&(
          <p className="muted">No matching campaigns.</p>
        )}
      </section>

      <p className="muted">
        Campaign management is enabled. POS checkout discounts
        remain disabled until the server-authoritative checkout
        integration is implemented.
      </p>
    </section>
  );
}
