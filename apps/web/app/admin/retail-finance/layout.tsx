import FinanceNav from "../finance-nav";

export default function RetailFinanceLayout({
 children
}:{
 children:React.ReactNode
}){
 return <><FinanceNav/>{children}</>;
}