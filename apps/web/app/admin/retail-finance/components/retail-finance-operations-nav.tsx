"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";

const sections=[
 {
  href:"/admin/finance-command-center",
  label:"Finance Command Center"
 },
 {
  href:"/admin/retail-finance",
  label:"Recent Finance"
 },
 {
  href:"/admin/retail-finance/historical",
  label:"Historical Finance"
 },
 {
  href:"/admin/retail-finance/cases",
  label:"Exception Cases"
 }
];

export default function RetailFinanceOperationsNav(){
 const pathname=usePathname();

 return (
  <nav
   aria-label="Retail finance operations"
   style={{
    display:"flex",
    gap:10,
    flexWrap:"wrap",
    padding:"12px 0",
    margin:"12px 0 22px",
    borderBottom:"1px solid #cbd5e1"
   }}
  >
   {sections.map(section=>{
    const active=pathname===section.href;

    return (
     <Link
      key={section.href}
      href={section.href}
      aria-current={active?"page":undefined}
      style={{
       display:"inline-block",
       padding:"10px 15px",
       borderRadius:8,
       border:"1px solid #cbd5e1",
       textDecoration:"none",
       fontWeight:active?700:500,
       color:active?"#ffffff":"#104c72",
       background:active?"#104c72":"#ffffff"
      }}
     >
      {section.label}
     </Link>
    );
   })}
  </nav>
 );
}