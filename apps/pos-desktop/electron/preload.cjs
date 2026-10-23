const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pos',{
 getConfig:key=>ipcRenderer.invoke('config:get',key),setConfig:(key,value)=>ipcRenderer.invoke('config:set',key,value),
 listCatalog:()=>ipcRenderer.invoke('catalog:list'),replaceCatalog:items=>ipcRenderer.invoke('catalog:replace',items),
 printReceipt:id=>ipcRenderer.invoke('receipt:print',id),saveSale:payload=>ipcRenderer.invoke('sales:save',payload),listSales:()=>ipcRenderer.invoke('sales:list'),pendingSales:()=>ipcRenderer.invoke('sales:pending'),setSaleResult:(id,status,error)=>ipcRenderer.invoke('sales:result',id,status,error)
});
