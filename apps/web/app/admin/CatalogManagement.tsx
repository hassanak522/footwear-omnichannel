'use client';

import {useEffect,useMemo,useState} from 'react';

type Any = Record<string,any>;

type Variant = {
 id:string;sku:string;barcode:string;size:string;color:string;
 price:string|number;cost:string|number|null;active:boolean;
};

type Product = {
 id:string;title:string;slug:string;description:string|null;
 active:boolean;categoryId:string;brandId:string|null;
 category?:{name:string};brand?:{name:string}|null;
 variants:Variant[];
};

type Option = {id:string;name:string};

async function api(path:string,method='GET',body?:unknown){
 const response=await fetch('/api/v1'+path,{
  method,credentials:'same-origin',cache:'no-store',
  headers:{'Content-Type':'application/json'},
  ...(body!==undefined?{body:JSON.stringify(body)}:{})
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok){
  throw new Error(Array.isArray(data.message)
   ?data.message.join('; ')
   :data.message||`HTTP ${response.status}`);
 }
 return data;
}

export default function CatalogManagement(){
 const [newCategory,setNewCategory]=useState({name:'',slug:''});
 const [newProduct,setNewProduct]=useState({
  title:'',slug:'',categoryId:'',description:''
 });
 const [newVariant,setNewVariant]=useState({
  productId:'',sku:'',barcode:'',size:'',color:'',price:'',cost:''
 });
 const [showCreate,setShowCreate]=useState(false);
 const [products,setProducts]=useState<Product[]>([]);
 const [categories,setCategories]=useState<Option[]>([]);
 const [search,setSearch]=useState('');
 const [categoryFilter,setCategoryFilter]=useState('');
 const [statusFilter,setStatusFilter]=useState('');
 const [editingProduct,setEditingProduct]=useState<Product|null>(null);
 const [editingVariant,setEditingVariant]=useState<Variant|null>(null);
 const [productForm,setProductForm]=useState<Any>({});
 const [variantForm,setVariantForm]=useState<Any>({});
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [success,setSuccess]=useState('');

 async function load(){
  const [p,c]=await Promise.all([
   api('/catalog/products'),
   api('/catalog/categories')
  ]);
  if(!Array.isArray(p)||!Array.isArray(c)){
   throw new Error('Invalid catalog response');
  }
  setProducts(p);
  setCategories(c);
 }

 useEffect(()=>{load().catch(e=>setError(e.message));},[]);

 const filtered=useMemo(()=>products.filter(p=>{
  const q=search.trim().toLowerCase();
  const matchesSearch=!q||
   p.title.toLowerCase().includes(q)||
   p.slug.toLowerCase().includes(q)||
   p.variants.some(v=>
    v.sku.toLowerCase().includes(q)||
    v.barcode.toLowerCase().includes(q)
   );
  return matchesSearch&&
   (!categoryFilter||p.categoryId===categoryFilter)&&
   (!statusFilter||
    (statusFilter==='active'?p.active:!p.active));
 }),[products,search,categoryFilter,statusFilter]);

 async function createCategory(e:React.FormEvent){
  e.preventDefault();
  setBusy(true);setError('');setSuccess('');
  try{
   await api('/catalog/categories','POST',newCategory);
   await load();
   setNewCategory({name:'',slug:''});
   setSuccess('Category created');
  }catch(e:any){setError(e.message);}
  finally{setBusy(false);}
 }

 async function createProduct(e:React.FormEvent){
  e.preventDefault();
  setBusy(true);setError('');setSuccess('');
  try{
   await api('/catalog/products','POST',newProduct);
   await load();
   setNewProduct({
    title:'',slug:'',categoryId:'',description:''
   });
   setSuccess('Product created');
  }catch(e:any){setError(e.message);}
  finally{setBusy(false);}
 }

 async function createVariant(e:React.FormEvent){
  e.preventDefault();
  setBusy(true);setError('');setSuccess('');
  try{
   const price=Number(newVariant.price);
   const cost=newVariant.cost===''?undefined:Number(newVariant.cost);

   if(newVariant.price.trim()===''||
      !Number.isFinite(price)||price<0||
      (cost!==undefined&&(!Number.isFinite(cost)||cost<0))){
    throw new Error('Enter valid non-negative prices');
   }

   await api('/catalog/variants','POST',{
    productId:newVariant.productId,
    sku:newVariant.sku,
    barcode:newVariant.barcode,
    size:newVariant.size,
    color:newVariant.color,
    price,
    ...(cost===undefined?{}:{cost})
   });

   await load();
   setNewVariant({
    productId:'',sku:'',barcode:'',size:'',color:'',price:'',cost:''
   });
   setSuccess('Variant created');
  }catch(e:any){setError(e.message);}
  finally{setBusy(false);}
 }
 function startProduct(p:Product){
  setEditingVariant(null);
  setEditingProduct(p);
  setProductForm({
   title:p.title,slug:p.slug,
   description:p.description||'',
   categoryId:p.categoryId,
   active:p.active
  });
  setError('');setSuccess('');
 }

 function startVariant(v:Variant){
  setEditingProduct(null);
  setEditingVariant(v);
  setVariantForm({
   sku:v.sku,barcode:v.barcode,
   size:v.size,color:v.color,
   price:String(v.price),
   cost:v.cost==null?'':String(v.cost),
   active:v.active
  });
  setError('');setSuccess('');
 }

 async function saveProduct(){
  if(!editingProduct)return;
  setBusy(true);setError('');setSuccess('');
  try{
   await api('/catalog/products/'+editingProduct.id,'PATCH',productForm);
   await load();
   setEditingProduct(null);
   setSuccess('Product updated successfully');
  }catch(e:any){setError(e.message);}
  finally{setBusy(false);}
 }

 async function saveVariant(){
  if(!editingVariant)return;
  setBusy(true);setError('');setSuccess('');
  try{
   const price=Number(variantForm.price);
   const cost=variantForm.cost===''?null:Number(variantForm.cost);
   if(!Number.isFinite(price)||price<0||
      (cost!==null&&(!Number.isFinite(cost)||cost<0))){
    throw new Error('Enter valid non-negative prices');
   }
   await api('/catalog/variants/'+editingVariant.id,'PATCH',{
    sku:variantForm.sku,
    barcode:variantForm.barcode,
    size:variantForm.size,
    color:variantForm.color,
    price,
    ...(cost!==null?{cost}:{})
    ,active:variantForm.active
   });
   await load();
   setEditingVariant(null);
   setSuccess('Variant updated successfully');
  }catch(e:any){setError(e.message);}
  finally{setBusy(false);}
 }

 async function toggleProduct(p:Product){
  if(!window.confirm(
   `${p.active?'Deactivate':'Activate'} ${p.title}?`
  ))return;
  setBusy(true);setError('');setSuccess('');
  try{
   await api('/catalog/products/'+p.id,'PATCH',{active:!p.active});
   await load();
   setSuccess('Product status updated');
  }catch(e:any){setError(e.message);}
  finally{setBusy(false);}
 }

 return <section className="card stack">
  <h2>Product Catalog Management</h2>
  <p className="muted">
   Manage products, sizes, colors, prices and availability.
  </p>

  {error&&<p role="alert" className="error">{error}</p>}
  {success&&<p role="status">{success}</p>}

  {/* R2-C2 CREATE FORMS */}
  <div className="row">
   <h3>Catalog setup</h3>
   <button type="button" className="secondary"
    onClick={()=>setShowCreate(v=>!v)}>
    {showCreate?'Hide creation forms':'+ Add Category / Product / Variant'}
   </button>
  </div>

  {showCreate&&<div className="stack">
   <form className="card stack" onSubmit={createCategory}>
    <h3>1. Add category</h3>
    <label>Category name<input required minLength={2}
     value={newCategory.name}
     onChange={e=>setNewCategory({...newCategory,name:e.target.value})}/></label>
    <label>Category slug<input required minLength={2}
     placeholder="mens-footwear"
     value={newCategory.slug}
     onChange={e=>setNewCategory({...newCategory,slug:e.target.value})}/></label>
    <button disabled={busy}>Create category</button>
   </form>

   <form className="card stack" onSubmit={createProduct}>
    <h3>2. Add product</h3>
    <label>Product title<input required minLength={2}
     value={newProduct.title}
     onChange={e=>setNewProduct({...newProduct,title:e.target.value})}/></label>
    <label>Product slug<input required minLength={2}
     value={newProduct.slug}
     onChange={e=>setNewProduct({...newProduct,slug:e.target.value})}/></label>
    <label>Category<select required value={newProduct.categoryId}
     onChange={e=>setNewProduct({...newProduct,categoryId:e.target.value})}>
     <option value="">Select category</option>
     {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
    </select></label>
    <label>Description<textarea
     value={newProduct.description}
     onChange={e=>setNewProduct({...newProduct,description:e.target.value})}/></label>
    <button disabled={busy}>Create product</button>
   </form>

   <form className="card stack" onSubmit={createVariant}>
    <h3>3. Add variant / SKU</h3>
    <label>Product<select required value={newVariant.productId}
     onChange={e=>setNewVariant({...newVariant,productId:e.target.value})}>
     <option value="">Select product</option>
     {products.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}
    </select></label>
    {(['sku','barcode','size','color','price','cost'] as const).map(k=>
     <label key={k}>{k.toUpperCase()}
      <input
       required={k!=='cost'}
       type={k==='price'||k==='cost'?'number':'text'}
       min={k==='price'||k==='cost'?0:undefined}
       step={k==='price'||k==='cost'?'0.01':undefined}
       value={newVariant[k]}
       onChange={e=>setNewVariant({...newVariant,[k]:e.target.value})}/>
     </label>
    )}
    <button disabled={busy}>Create variant</button>
   </form>
  </div>}
  <div className="row">
   <input aria-label="Search products"
    placeholder="Search product, SKU or barcode"
    value={search} onChange={e=>setSearch(e.target.value)}/>
   <select aria-label="Filter category"
    value={categoryFilter}
    onChange={e=>setCategoryFilter(e.target.value)}>
    <option value="">All categories</option>
    {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
   </select>
   <select aria-label="Filter status"
    value={statusFilter}
    onChange={e=>setStatusFilter(e.target.value)}>
    <option value="">All statuses</option>
    <option value="active">Active</option>
    <option value="inactive">Inactive</option>
   </select>
   <button className="secondary" disabled={busy}
    onClick={()=>load().catch(e=>setError(e.message))}>
    Refresh
   </button>
  </div>

  <p>{filtered.length} products found</p>

  {filtered.map(p=><article className="card" key={p.id}>
   <div className="row">
    <strong>{p.title}</strong>
    <span>{p.category?.name||'Uncategorized'}</span>
    <span>{p.active?'Active':'Inactive'}</span>
    <button className="secondary" disabled={busy}
     onClick={()=>startProduct(p)}>Edit product</button>
    <button className="secondary" disabled={busy}
     onClick={()=>toggleProduct(p)}>
     {p.active?'Deactivate':'Activate'}
    </button>
   </div>
   <p className="muted">{p.slug}</p>

   <div style={{overflowX:'auto'}}>
    <table>
     <thead><tr>
      <th>SKU</th><th>Barcode</th><th>Size</th>
      <th>Color</th><th>Price</th><th>Status</th><th>Action</th>
     </tr></thead>
     <tbody>
      {p.variants.map(v=><tr key={v.id}>
       <td>{v.sku}</td><td>{v.barcode}</td>
       <td>{v.size}</td><td>{v.color}</td>
       <td>PKR {Number(v.price).toLocaleString()}</td>
       <td>{v.active?'Active':'Inactive'}</td>
       <td><button className="secondary" disabled={busy}
        onClick={()=>startVariant(v)}>Edit</button></td>
      </tr>)}
     </tbody>
    </table>
   </div>
  </article>)}

  {editingProduct&&<form className="card stack"
   onSubmit={e=>{e.preventDefault();void saveProduct();}}>
   <h3>Edit product</h3>
   <label>Title<input required minLength={2}
    value={productForm.title}
    onChange={e=>setProductForm({...productForm,title:e.target.value})}/></label>
   <label>Slug<input required minLength={2}
    value={productForm.slug}
    onChange={e=>setProductForm({...productForm,slug:e.target.value})}/></label>
   <label>Description<textarea
    value={productForm.description}
    onChange={e=>setProductForm({...productForm,description:e.target.value})}/></label>
   <label>Category<select required
    value={productForm.categoryId}
    onChange={e=>setProductForm({...productForm,categoryId:e.target.value})}>
    {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
   </select></label>
   <label><input type="checkbox" checked={productForm.active}
    onChange={e=>setProductForm({...productForm,active:e.target.checked})}/>
    Active</label>
   <div className="row">
    <button disabled={busy}>Save product</button>
    <button type="button" className="secondary"
     onClick={()=>setEditingProduct(null)}>Cancel</button>
   </div>
  </form>}

  {editingVariant&&<form className="card stack"
   onSubmit={e=>{e.preventDefault();void saveVariant();}}>
   <h3>Edit variant</h3>
   {(['sku','barcode','size','color','price','cost'] as const)
    .map(k=><label key={k}>{k}
     <input
      required={k!=='cost'}
      type={k==='price'||k==='cost'?'number':'text'}
      min={k==='price'||k==='cost'?0:undefined}
      step={k==='price'||k==='cost'?'0.01':undefined}
      value={variantForm[k]||''}
      onChange={e=>setVariantForm({...variantForm,[k]:e.target.value})}/>
    </label>)}
   <label><input type="checkbox" checked={variantForm.active}
    onChange={e=>setVariantForm({...variantForm,active:e.target.checked})}/>
    Active</label>
   <div className="row">
    <button disabled={busy}>Save variant</button>
    <button type="button" className="secondary"
     onClick={()=>setEditingVariant(null)}>Cancel</button>
   </div>
  </form>}
 </section>;
}