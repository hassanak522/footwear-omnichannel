"use client";

import {useState} from "react";

const BASE="/api/v1";

const panel:React.CSSProperties={
 background:"#fff",
 border:"1px solid #dbe3ed",
 borderRadius:12,
 padding:22,
 marginBottom:20
};

const fieldStyle:React.CSSProperties={
 padding:11,
 border:"1px solid #cbd5e1",
 borderRadius:8,
 width:"100%",
 boxSizing:"border-box",
 background:"#fff"
};

const buttonStyle:React.CSSProperties={
 padding:"11px 16px",
 background:"#104c72",
 color:"#fff",
 border:0,
 borderRadius:8,
 cursor:"pointer"
};

const secondaryButton:React.CSSProperties={
 ...buttonStyle,
 background:"#eaf4fb",
 color:"#104c72"
};

type Result={
 title:string;
 data:unknown;
 error:boolean;
};

export default function CustomerFinance(){
 const [email,setEmail]=useState("");
 const [password,setPassword]=useState("");
 const [token,setToken]=useState("");

 const [customerId,setCustomerId]=useState("");
 const [saleId,setSaleId]=useState("");

 const [returnId,setReturnId]=useState("");
 const [method,setMethod]=useState("CASH");
 const [refundId,setRefundId]=useState("");
 const [reference,setReference]=useState("");

 const [code,setCode]=useState("");
 const [title,setTitle]=useState("");
 const [type,setType]=useState("PERCENT");
 const [value,setValue]=useState("10");
 const [start,setStart]=useState("");
 const [end,setEnd]=useState("");

 const [result,setResult]=useState<Result|null>(null);
 const [busy,setBusy]=useState(false);

 async function call(
  path:string,
  method="GET",
  body?:unknown,
  authToken=token
 ){
  const response=await fetch(BASE+path,{
   method,
   credentials:"same-origin",
   cache:"no-store",
   headers:{
    "Content-Type":"application/json",
    ...(authToken
     ?{Authorization:"Bearer "+authToken}
     :{})
   },
   body:body===undefined
    ?undefined
    :JSON.stringify(body)
  });

  const data=await response.json().catch(()=>({}));

  if(!response.ok){
   const message=Array.isArray(data.message)
    ?data.message.join(", ")
    :data.message||"HTTP "+response.status;

   throw new Error(message);
  }

  return data;
 }

 async function run(
  label:string,
  action:()=>Promise<unknown>
 ){
  setBusy(true);
  setResult(null);

  try{
   const data=await action();
   setResult({
    title:label,
    data,
    error:false
   });
  }catch(e){
   setResult({
    title:label,
    data:e instanceof Error?e.message:String(e),
    error:true
   });
  }finally{
   setBusy(false);
  }
 }

 function field(
  label:string,
  element:React.ReactNode,
  help?:string
 ){
  return (
   <label style={{
    display:"grid",
    gap:6,
    marginBottom:14
   }}>
    <strong style={{fontSize:13}}>
     {label}
    </strong>
    {element}
    {help&&
     <span style={{
      fontSize:12,
      color:"#64748b"
     }}>
      {help}
     </span>
    }
   </label>
  );
 }

 function actionButton(
  label:string,
  action:()=>Promise<unknown>,
  secondary=false,
  disabled=false
 ){
  return (
   <button
    type="button"
    disabled={busy||disabled}
    style={{
     ...(secondary
      ?secondaryButton
      :buttonStyle),
     opacity:busy||disabled?0.55:1
    }}
    onClick={()=>void run(label,action)}
   >
    {busy?"Please wait…":label}
   </button>
  );
 }

 function required(value:string,label:string){
  if(!value.trim()){
   throw new Error(label+" is required.");
  }
  return value.trim();
 }

 function promotionDates(){
  if(!start||!end){
   throw new Error(
    "Select both promotion dates."
   );
  }

  const startsAt=new Date(start);
  const endsAt=new Date(end);

  if(
   !Number.isFinite(startsAt.getTime())||
   !Number.isFinite(endsAt.getTime())
  ){
   throw new Error("Invalid promotion dates.");
  }

  if(startsAt>=endsAt){
   throw new Error(
    "End date must be after start date."
   );
  }

  const amount=Number(value);

  if(!Number.isFinite(amount)||amount<=0){
   throw new Error(
    "Promotion value must be greater than zero."
   );
  }

  if(type==="PERCENT"&&amount>100){
   throw new Error(
    "Percentage cannot exceed 100."
   );
  }

  return {
   code:required(code,"Promotion code"),
   title:required(title,"Promotion title"),
   type,
   value:amount,
   startsAt:startsAt.toISOString(),
   endsAt:endsAt.toISOString()
  };
 }

 return (
  <main style={{
   maxWidth:1120,
   margin:"0 auto",
   padding:"28px 20px 48px",
   fontFamily:"system-ui",
   color:"#172b4d"
  }}>
   <header style={{marginBottom:24}}>
    <div style={{
     color:"#ef3321",
     fontSize:12,
     fontWeight:700,
     letterSpacing:1
    }}>
     ROYAL STEP / FINANCE
    </div>

    <h1 style={{
     color:"#104c72",
     margin:"8px 0"
    }}>
     Customer Finance
    </h1>

    <p style={{color:"#64748b"}}>
     Manage customer-sale associations,
     refund records and draft promotions.
    </p>
   </header>

   {!token?(
    <section style={{
     ...panel,
     maxWidth:450
    }}>
     <h2 style={{color:"#104c72"}}>
      Finance Sign In
     </h2>

     <p style={{color:"#64748b"}}>
      Sign in using an authorized
      account to access customer finance.
     </p>

     {field(
      "Email",
      <input
       style={fieldStyle}
       type="email"
       autoComplete="username"
       value={email}
       onChange={e=>setEmail(e.target.value)}
      />
     )}

     {field(
      "Password",
      <input
       style={fieldStyle}
       type="password"
       autoComplete="current-password"
       value={password}
       onChange={e=>setPassword(e.target.value)}
      />
     )}

     {actionButton(
      "Sign In",
      async()=>{
       const data=await call(
        "/auth/login",
        "POST",
        {email,password},
        ""
       );

       const accessToken=
        data.accessToken||
        data.access_token||
        data.token;

       if(!accessToken){
        throw new Error(
         "No access token returned."
        );
       }

       setToken(accessToken);
       setPassword("");

       return {signedIn:true};
      },
      false,
      !email.trim()||!password
     )}
    </section>
   ):(
    <>
     <div style={{
      display:"flex",
      justifyContent:"space-between",
      alignItems:"center",
      gap:12,
      marginBottom:18,
      flexWrap:"wrap"
     }}>
      <span style={{color:"#166534"}}>
       Finance session active
      </span>

      <button
       style={secondaryButton}
       onClick={()=>{
        setToken("");
        setPassword("");
        setResult(null);
       }}
      >
       Sign Out
      </button>
     </div>

     <section style={panel}>
      <h2 style={{color:"#104c72"}}>
       Customer Sales
      </h2>

      <p style={{color:"#64748b"}}>
       Link an accepted sale to a customer,
       or retrieve the customer's sale history.
      </p>

      <div style={{
       display:"grid",
       gridTemplateColumns:
        "repeat(auto-fit,minmax(240px,1fr))",
       gap:16
      }}>
       {field(
        "Customer ID",
        <input
         style={fieldStyle}
         value={customerId}
         onChange={e=>setCustomerId(e.target.value)}
         placeholder="Customer record ID"
        />
       )}

       {field(
        "Accepted Sale ID",
        <input
         style={fieldStyle}
         value={saleId}
         onChange={e=>setSaleId(e.target.value)}
         placeholder="Accepted sale ID"
        />
       )}
      </div>

      <div style={{
       display:"flex",
       flexWrap:"wrap",
       gap:10
      }}>
       {actionButton(
        "Link Customer to Sale",
        ()=>call(
         "/customer-finance/sale-customer",
         "POST",
         {
          customerId:required(
           customerId,"Customer ID"
          ),
          saleId:required(
           saleId,"Sale ID"
          )
         }
        )
       )}

       {actionButton(
        "View Customer Sales",
        ()=>call(
         "/customer-finance/customer-sales?customerId="+
         encodeURIComponent(
          required(customerId,"Customer ID")
         )
        ),
        true
       )}
      </div>
     </section>

     <section style={panel}>
      <h2 style={{color:"#104c72"}}>
       Refund Management
      </h2>

      <p style={{
       color:"#92400e",
       background:"#fffbeb",
       padding:12,
       borderRadius:8
      }}>
       Refund approval and refund payment
       are separate steps. Recording a paid
       refund does not transfer money.
      </p>

      <div style={{
       display:"grid",
       gridTemplateColumns:
        "repeat(auto-fit,minmax(240px,1fr))",
       gap:16
      }}>
       {field(
        "Approved Return ID",
        <input
         style={fieldStyle}
         value={returnId}
         onChange={e=>setReturnId(e.target.value)}
         placeholder="Approved return record"
        />
       )}

       {field(
        "Proposed Refund Method",
        <select
         style={fieldStyle}
         value={method}
         onChange={e=>setMethod(e.target.value)}
        >
         <option value="CASH">Cash</option>
         <option value="CARD">Card</option>
         <option value="BANK">Bank Transfer</option>
         <option value="OTHER">Other</option>
        </select>
       )}
      </div>

      <div style={{
       display:"flex",
       flexWrap:"wrap",
       gap:10,
       marginBottom:20
      }}>
       {actionButton(
        "Request Refund Approval",
        ()=>call(
         "/customer-finance/refunds",
         "POST",
         {
          returnId:required(
           returnId,"Approved Return ID"
          ),
          method
         }
        )
       )}

       {actionButton(
        "View Refund Requests",
        ()=>call(
         "/customer-finance/refunds"
        ),
        true
       )}
      </div>

      <hr style={{
       border:0,
       borderTop:"1px solid #e2e8f0",
       margin:"20px 0"
      }}/>

      <h3>Review and Record Refund</h3>

      {field(
       "Refund ID",
       <input
        style={fieldStyle}
        value={refundId}
        onChange={e=>setRefundId(e.target.value)}
        placeholder="Refund request ID"
       />
      )}

      <div style={{marginBottom:18}}>
       {actionButton(
        "Approve Refund",
        async()=>{
         const id=required(
          refundId,"Refund ID"
         );

         if(!window.confirm(
          "Approve this refund request?"
         )){
          return {cancelled:true};
         }

         return call(
          "/customer-finance/refunds/"+
          encodeURIComponent(id)+
          "/approve",
          "POST"
         );
        }
       )}
      </div>

      {field(
       "External Payment Reference",
       <input
        style={fieldStyle}
        value={reference}
        onChange={e=>setReference(e.target.value)}
        placeholder="Bank or payment receipt reference"
       />,
       "Enter the reference from a payment already made."
      )}

      {actionButton(
       "Record Refund as Paid",
       async()=>{
        const id=required(
         refundId,"Refund ID"
        );

        const ref=required(
         reference,"Payment reference"
        );

        if(!window.confirm(
         "Confirm this refund has ALREADY "+
         "been paid externally? "+
         "This action records settlement "+
         "only and does not send funds."
        )){
         return {cancelled:true};
        }

        return call(
         "/customer-finance/refunds/"+
         encodeURIComponent(id)+
         "/mark-paid",
         "POST",
         {reference:ref}
        );
       }
      )}
     </section>

     <section style={panel}>
      <h2 style={{color:"#104c72"}}>
       Draft Promotions
      </h2>

      <p style={{color:"#64748b"}}>
       Define promotional offers for future
       use. These drafts are not automatically
       applied at checkout.
      </p>

      <div style={{
       display:"grid",
       gridTemplateColumns:
        "repeat(auto-fit,minmax(240px,1fr))",
       gap:16
      }}>
       {field(
        "Promotion Code",
        <input
         style={fieldStyle}
         value={code}
         onChange={e=>setCode(e.target.value)}
        />
       )}

       {field(
        "Promotion Name",
        <input
         style={fieldStyle}
         value={title}
         onChange={e=>setTitle(e.target.value)}
        />
       )}

       {field(
        "Discount Type",
        <select
         style={fieldStyle}
         value={type}
         onChange={e=>setType(e.target.value)}
        >
         <option value="PERCENT">
          Percentage
         </option>
         <option value="FIXED">
          Fixed Amount
         </option>
        </select>
       )}

       {field(
        type==="PERCENT"
         ?"Discount Percentage"
         :"Discount Amount",
        <input
         style={fieldStyle}
         type="number"
         min="0.01"
         step="0.01"
         value={value}
         onChange={e=>setValue(e.target.value)}
        />
       )}

       {field(
        "Start Date and Time",
        <input
         style={fieldStyle}
         type="datetime-local"
         value={start}
         onChange={e=>setStart(e.target.value)}
        />
       )}

       {field(
        "End Date and Time",
        <input
         style={fieldStyle}
         type="datetime-local"
         value={end}
         onChange={e=>setEnd(e.target.value)}
        />
       )}
      </div>

      <div style={{
       display:"flex",
       flexWrap:"wrap",
       gap:10
      }}>
       {actionButton(
        "Save Draft Promotion",
        ()=>call(
         "/customer-finance/promotions",
         "POST",
         promotionDates()
        )
       )}

       {actionButton(
        "View Promotions",
        ()=>call(
         "/customer-finance/promotions"
        ),
        true
       )}
      </div>
     </section>
    </>
   )}

   {result&&(
    <section
     aria-live="polite"
     style={{
      ...panel,
      borderColor:result.error
       ?"#fecaca"
       :"#cbd5e1"
     }}
    >
     <h2 style={{
      color:result.error
       ?"#b91c1c"
       :"#104c72"
     }}>
      {result.error
       ?"Action Could Not Be Completed"
       :"Operation Result"}
     </h2>

     <p><strong>{result.title}</strong></p>

     {typeof result.data==="string"
      ?<p style={{overflowWrap:"anywhere"}}>
        {result.data}
       </p>
      :Array.isArray(result.data)
       ?<>
        <p>
         {result.data.length} records returned
        </p>
        <details>
         <summary style={{cursor:"pointer"}}>
          View Records
         </summary>
         <pre style={{
          whiteSpace:"pre-wrap",
          overflowWrap:"anywhere",
          background:"#f8fafc",
          padding:12,
          borderRadius:8
         }}>
          {JSON.stringify(result.data,null,2)}
         </pre>
        </details>
       </>
       :<details open>
         <summary style={{cursor:"pointer"}}>
          View Response
         </summary>
         <pre style={{
          whiteSpace:"pre-wrap",
          overflowWrap:"anywhere",
          background:"#f8fafc",
          padding:12,
          borderRadius:8
         }}>
          {JSON.stringify(result.data,null,2)}
         </pre>
        </details>
     }
    </section>
   )}
  </main>
 );
}