import { create } from 'zustand';
import { getWallet, type WalletBalance } from '@/services/paymentService';

interface WalletState extends WalletBalance {loading:boolean;error:string|null;refresh:()=>Promise<void>;reset:()=>void}
const empty:WalletBalance={walletKobo:0,earningsKobo:0,withdrawableKobo:0,owedKobo:0,cashDebtLimitKobo:0,canGoOnline:true};
export const useWalletStore=create<WalletState>((set)=>({...empty,loading:false,error:null,
  refresh:async()=>{set({loading:true,error:null});try{set({...await getWallet(),loading:false});}catch(error){set({loading:false,error:error instanceof Error?error.message:'Could not load wallet'});}},
  reset:()=>set({...empty,loading:false,error:null}),
}));
