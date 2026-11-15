'use client';

import {useEffect,useMemo,useState} from 'react';

type Staff = {
 id:string;
 name:string;
 email:string;
 status:string;
 roles:{role:{code:string;name:string}}[];
 locations:{location:{id:string;name:string;code:string;type:string}}[];
};

type Location = {
 id:string;
 name:string;
 code:string;
 type:string;
 active?:boolean;
};

const roleOptions = [
 {code:'WAREHOUSE_MANAGER',name:'Warehouse Manager'},
 {code:'BRANCH_MANAGER',name:'Branch Manager'},
 {code:'CASHIER',name:'Cashier'}
];

const emptyForm = {
 name:'',
 email:'',
 password:'',
 role:'BRANCH_MANAGER',
 locationId:'',
 status:'ACTIVE'
};

async function request(path:string,method='GET',body?:unknown){
 const response=await fetch('/api/v1'+path,{
  method,
  credentials:'same-origin',
  headers:{'Content-Type':'application/json'},
  cache:'no-store',
  ...(body!==undefined?{body:JSON.stringify(body)}:{})
 });

 const data=await response.json().catch(()=>({}));

 if(!response.ok){
  throw new Error(
   Array.isArray(data.message)
    ?data.message.join('; ')
    :data.message||`HTTP ${response.status}`
  );
 }

 return data;
}

export default function StaffManagement(){
 const [users,setUsers]=useState<Staff[]>([]);
 const [locations,setLocations]=useState<Location[]>([]);
 const [form,setForm]=useState({...emptyForm});
 const [editing,setEditing]=useState<string|null>(null);
 const [resetId,setResetId]=useState<string|null>(null);
 const [resetPassword,setResetPassword]=useState('');
 const [search,setSearch]=useState('');
 const [roleFilter,setRoleFilter]=useState('');
 const [statusFilter,setStatusFilter]=useState('');
 const [locationFilter,setLocationFilter]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [success,setSuccess]=useState('');

 async function load(){
  const [staff,places]=await Promise.all([
   request('/staff-management/users'),
   request('/inventory/locations')
  ]);

  if(!Array.isArray(staff)||!Array.isArray(places)){
   throw new Error('Unexpected API response');
  }

  setUsers(staff);
  setLocations(places);
 }

 useEffect(()=>{
  load().catch(e=>setError(e.message));
 },[]);

 const availableLocations=locations.filter(l=>
  l.active!==false &&
  l.type===(form.role==='WAREHOUSE_MANAGER'?'WAREHOUSE':'BRANCH')
 );

 const filtered=useMemo(()=>users.filter(u=>{
  const q=search.toLowerCase();
  return (
   (u.name.toLowerCase().includes(q)||u.email.toLowerCase().includes(q)) &&
   (!roleFilter||u.roles.some(r=>r.role.code===roleFilter)) &&
   (!statusFilter||u.status===statusFilter) &&
   (!locationFilter||u.locations.some(l=>l.location.id===locationFilter))
  );
 }),[users,search,roleFilter,statusFilter,locationFilter]);

 function update(key:string,value:string){
  setForm(previous=>({...previous,[key]:value}));
 }

 function edit(user:Staff){
  setEditing(user.id);
  setForm({
   name:user.name,
   email:user.email,
   password:'',
   role:user.roles[0]?.role.code||'BRANCH_MANAGER',
   locationId:user.locations[0]?.location.id||'',
   status:user.status
  });
  setError('');
  setSuccess('');
 }

 function cancel(){
  setEditing(null);
  setForm({...emptyForm});
 }

 async function save(e:React.FormEvent){
  e.preventDefault();
  setBusy(true);
  setError('');
  setSuccess('');

  try{
   if(editing){
    await request(`/staff-management/users/${editing}`,'PATCH',{
     name:form.name,
     email:form.email,
     role:form.role,
     locationId:form.locationId,
     status:form.status
    });
   }else{
    await request('/staff-management/users','POST',{
     name:form.name,
     email:form.email,
     password:form.password,
     role:form.role,
     locationId:form.locationId
    });
   }

   await load();
   setSuccess(editing?'Staff updated':'Staff created');
   cancel();
  }catch(e){
   setError(e instanceof Error?e.message:'Save failed');
  }finally{
   setBusy(false);
  }
 }

 async function changeStatus(user:Staff){
  const status=user.status==='ACTIVE'?'DISABLED':'ACTIVE';
  if(!window.confirm(`${status==='DISABLED'?'Disable':'Activate'} ${user.name}?`))return;

  setBusy(true);
  setError('');
  setSuccess('');

  try{
   await request(`/staff-management/users/${user.id}`,'PATCH',{status});
   await load();
   setSuccess('Account status updated');
  }catch(e){
   setError(e instanceof Error?e.message:'Status update failed');
  }finally{
   setBusy(false);
  }
 }

 async function reset(e:React.FormEvent){
  e.preventDefault();
  if(!resetId)return;

  setBusy(true);
  setError('');
  setSuccess('');

  try{
   await request(`/staff-management/users/${resetId}/reset-password`,
    'POST',{password:resetPassword});
   setResetId(null);
   setResetPassword('');
   setSuccess('Password reset successfully');
  }catch(e){
   setError(e instanceof Error?e.message:'Password reset failed');
  }finally{
   setBusy(false);
  }
 }

 return <div className="stack">
  <section className="card stack">
   <div className="row">
    <h2>Staff Management</h2>
    <button className="secondary" disabled={busy}
     onClick={()=>load().catch(e=>setError(e.message))}>Refresh</button>
   </div>

   <p>Manage Royal Step warehouse, branch and cashier accounts.</p>

   {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
   {success&&<p role="status" style={{color:'#15803d'}}>{success}</p>}

   <div className="grid">
    <label>Search
     <input value={search} placeholder="Name or email"
      onChange={e=>setSearch(e.target.value)}/>
    </label>

    <label>Role
     <select value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}>
      <option value="">All roles</option>
      <option value="SUPER_ADMIN">Super Admin</option>
      {roleOptions.map(r=><option key={r.code} value={r.code}>{r.name}</option>)}
     </select>
    </label>

    <label>Status
     <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
      <option value="">All statuses</option>
      <option value="ACTIVE">Active</option>
      <option value="DISABLED">Disabled</option>
     </select>
    </label>

    <label>Location
     <select value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}>
      <option value="">All locations</option>
      {locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
     </select>
    </label>
   </div>

   <p>{filtered.length} staff account(s)</p>

   <div style={{overflowX:'auto'}}>
    <table style={{width:'100%'}}>
     <thead><tr>
      <th>Name</th><th>Email</th><th>Role</th>
      <th>Location</th><th>Status</th><th>Actions</th>
     </tr></thead>
     <tbody>
      {filtered.map(user=>{
       const privileged=user.roles.some(r=>r.role.code==='SUPER_ADMIN');
       return <tr key={user.id}>
        <td>{user.name}</td>
        <td>{user.email}</td>
        <td>{user.roles.map(r=>r.role.name).join(', ')}</td>
        <td>{user.locations.map(l=>l.location.name).join(', ')}</td>
        <td>{user.status}</td>
        <td>
         {privileged?'Protected':<>
          <button className="secondary" disabled={busy}
           onClick={()=>edit(user)}>Edit</button>{' '}
          <button className="secondary" disabled={busy}
           onClick={()=>changeStatus(user)}>
           {user.status==='ACTIVE'?'Disable':'Activate'}
          </button>{' '}
          <button className="secondary" disabled={busy}
           onClick={()=>{
            setResetId(user.id);
            setResetPassword('');
           }}>Reset password</button>
         </>}
        </td>
       </tr>;
      })}
     </tbody>
    </table>
   </div>
  </section>

  <section className="card stack">
   <h2>{editing?'Edit Staff':'Create Staff'}</h2>

   <form className="stack" onSubmit={save}>
    <div className="grid">
     <label>Name
      <input required minLength={2} value={form.name}
       onChange={e=>update('name',e.target.value)}/>
     </label>

     <label>Email
      <input type="email" required value={form.email}
       onChange={e=>update('email',e.target.value)}/>
     </label>

     {!editing&&<label>Temporary password
      <input type="password" required minLength={10}
       autoComplete="new-password" value={form.password}
       onChange={e=>update('password',e.target.value)}/>
     </label>}

     <label>Role
      <select value={form.role} onChange={e=>
       setForm(previous=>({...previous,role:e.target.value,locationId:''}))
      }>
       {roleOptions.map(r=><option key={r.code} value={r.code}>{r.name}</option>)}
      </select>
     </label>

     <label>Location
      <select required value={form.locationId}
       onChange={e=>update('locationId',e.target.value)}>
       <option value="">Select location</option>
       {availableLocations.map(l=><option key={l.id} value={l.id}>
        {l.name} ({l.code})
       </option>)}
      </select>
     </label>

     {editing&&<label>Status
      <select value={form.status} onChange={e=>update('status',e.target.value)}>
       <option value="ACTIVE">Active</option>
       <option value="DISABLED">Disabled</option>
      </select>
     </label>}
    </div>

    <div className="row">
     <button disabled={busy} type="submit">
      {busy?'Saving...':editing?'Save changes':'Create staff'}
     </button>
     {editing&&<button type="button" className="secondary"
      onClick={cancel}>Cancel</button>}
    </div>
   </form>
  </section>

  {resetId&&<section className="card stack">
   <h2>Reset Password</h2>
   <form className="stack" onSubmit={reset}>
    <label>New password
     <input type="password" minLength={10} required
      autoComplete="new-password" value={resetPassword}
      onChange={e=>setResetPassword(e.target.value)}/>
    </label>
    <div className="row">
     <button disabled={busy}>Reset password</button>
     <button type="button" className="secondary"
      onClick={()=>{
       setResetId(null);
       setResetPassword('');
      }}>Cancel</button>
    </div>
   </form>
  </section>}
 </div>;
}