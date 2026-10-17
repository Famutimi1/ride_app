import { create } from 'zustand';
import { getWallet, type WalletBalance } from '@/services/paymentService';

interface WalletState extends WalletBalance {loading:boolean;error:string|null;refresh:()=>Promise<void>;reset:()=>void}
const empty:WalletBalance={walletKobo:0,earningsKobo:0,withdrawableKobo:0,owedKobo:0,cashDebtLimitKobo:0,canGoOnline:true};
let walletGeneration = 0;
export const useWalletStore=create<WalletState>((set)=>({...empty,loading:false,error:null,
  refresh:async()=>{const generation=walletGeneration;set({loading:true,error:null});try{const balance=await getWallet();if(generation===walletGeneration)set({...balance,loading:false});}catch(error){if(generation===walletGeneration)set({loading:false,error:error instanceof Error?error.message:'Could not load wallet'});}},
  reset:()=>{walletGeneration+=1;set({...empty,loading:false,error:null});},
}));
