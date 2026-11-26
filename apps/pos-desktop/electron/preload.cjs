const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pos',{
 prepareRefund:(locationId,payload)=>ipcRenderer.invoke('refund:prepare',locationId,payload),
 resolveRefund:(id,response)=>ipcRenderer.invoke('refund:resolve',id,response),
 listRefunds:()=>ipcRenderer.invoke('refund:list'),
 updateRefund:(id,status,response)=>ipcRenderer.invoke('refund:update',id,status,response),
printExchange:id=>ipcRenderer.invoke('exchange:receipt',id),
 resolveExchange:(id,response)=>ipcRenderer.invoke('exchange:resolve',id,response),
 prepareExchange:payload=>ipcRenderer.invoke('exchange:prepare',payload),
 listExchanges:()=>ipcRenderer.invoke('exchange:list'),
 updateExchange:(id,status,response,error)=>ipcRenderer.invoke('exchange:update',id,status,response,error),

 isQaOffline:()=>ipcRenderer.invoke('qa:is-offline'),
 prepareClearance:payload=>ipcRenderer.invoke('clearance:prepare',payload),
 printClearance:id=>ipcRenderer.invoke('clearance:receipt',id),
 listClearance:()=>ipcRenderer.invoke('clearance:list'),
 updateClearance:(id,status,response,error)=>ipcRenderer.invoke('clearance:update',id,status,response,error), prepareDiscounted:payload=>ipcRenderer.invoke('discounted:prepare',payload),listDiscounted:()=>ipcRenderer.invoke('discounted:list'),updateDiscounted:(id,status,response,error)=>ipcRenderer.invoke('discounted:update',id,status,response,error),printDiscounted:id=>ipcRenderer.invoke('discounted:receipt',id),
 getConfig:key=>ipcRenderer.invoke('config:get',key),setConfig:(key,value)=>ipcRenderer.invoke('config:set',key,value),
 listCatalog:()=>ipcRenderer.invoke('catalog:list'),replaceCatalog:items=>ipcRenderer.invoke('catalog:replace',items),
 printReceipt:id=>ipcRenderer.invoke('receipt:print',id),saveSale:payload=>ipcRenderer.invoke('sales:save',payload),listSales:()=>ipcRenderer.invoke('sales:list'),pendingSales:()=>ipcRenderer.invoke('sales:pending'),setSaleResult:(id,status,error)=>ipcRenderer.invoke('sales:result',id,status,error)
});

