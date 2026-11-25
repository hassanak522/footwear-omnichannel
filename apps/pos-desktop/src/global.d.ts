export type Variant={id:string;barcode:string;sku:string;title:string;size:string;color:string;price:number};
export type SalePayload={customerId?:string;deviceId:string;shiftId:string;localSaleId?:string;soldAt?:string;lines:{variantId:string;quantity:number;unitPrice:number}[];tenders:{type:'CASH'|'CARD';amount:number;reference?:string}[]};
declare global{interface Window{pos:{
 resolveExchange:(id:string,response:any)=>Promise<boolean>;
 printExchange:(id:string)=>Promise<{success:boolean;reason?:string}>;
prepareExchange:(payload:any)=>Promise<{id:string;payload:any}>;
 listExchanges:()=>Promise<{
  id:string;
  payload:string;
  status:string;
  created_at:string;
  server_response:string|null;
  error:string|null;
 }[]>;
 updateExchange:(
  id:string,
  status:'UNKNOWN'|'ACCEPTED',
  response?:any,
  error?:string
 )=>Promise<boolean>;
prepareClearance:(payload:any)=>Promise<{id:string;payload:any}>;
printClearance:(id:string)=>Promise<{success:boolean;reason?:string}>;listClearance:()=>Promise<any[]>;
updateClearance:(id:string,status:string,response?:any,error?:string)=>Promise<void>;prepareDiscounted:(payload:any)=>Promise<{id:string;payload:any}>;listDiscounted:()=>Promise<any[]>;updateDiscounted:(id:string,status:string,response?:any,error?:string)=>Promise<void>;printDiscounted:(id:string)=>Promise<{success:boolean;reason?:string}>;getConfig:(key:string)=>Promise<any>;setConfig:(key:string,value:any)=>Promise<void>;listCatalog:()=>Promise<Variant[]>;replaceCatalog:(items:Variant[])=>Promise<number>;printReceipt:(id:string)=>Promise<{success:boolean;reason?:string}>;saveSale:(sale:SalePayload)=>Promise<string>;listSales:()=>Promise<any[]>;pendingSales:()=>Promise<{id:string;payload:string;attempts:number}[]>;setSaleResult:(id:string,status:string,error?:string)=>Promise<void>}}}export {};
