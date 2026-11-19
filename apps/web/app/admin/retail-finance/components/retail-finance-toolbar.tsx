"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";

const links=[
 {
  href:"/admin/retail-finance",
  label:"Recent finance"
 },
 {
  href:"/admin/retail-finance/historical",
  label:"Historical & cross-branch"
 }
];

export default function RetailFinanceToolbar(){
 const pathname=usePathname();

 return <nav
  aria-label="Retail finance navigation"
  style={{
   display:"flex",
   gap:10,
   flexWrap:"wrap",
   marginBottom:20,
   paddingBottom:16,
   borderBottom:"1px solid #dbe3ed"
  }}
 >
  {links.map(link=>{
   const active=pathname===link.href;

   return <Link
    key={link.href}
    href={link.href}
    aria-current={active?"page":undefined}
    style={{
     padding:"10px 16px",
     borderRadius:8,
     border:"1px solid #cbd5e1",
     background:active?"#104c72":"#fff",
     color:active?"#fff":"#104c72",
     textDecoration:"none",
     fontWeight:600
    }}
   >
    {link.label}
   </Link>;
  })}
 </nav>;
}