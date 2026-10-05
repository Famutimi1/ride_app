import { apiClient } from '@/lib/apiClient';

export interface WalletBalance {walletKobo:number;earningsKobo:number;withdrawableKobo:number;owedKobo:number;cashDebtLimitKobo:number;canGoOnline:boolean}
export interface WalletEntry {id:string;transactionId:string;direction:'debit'|'credit';amountKobo:number;balanceAfterKobo:number;createdAt:string;type:string;description:string|null;referenceType:string|null;referenceId:string|null}
export interface PayoutAccount {id:string;bank_code:string;bank_name:string;account_last4:string;account_name:string;created_at:string}
export interface Withdrawal {id:string;amount_kobo:number;fee_kobo:number;status:string;requested_at:string;completed_at:string|null;bank_name?:string;account_last4?:string}
export interface EarningsSummary {range:string;trips:number;grossKobo:number;commissionKobo:number;netKobo:number;cashTrips:number;walletTrips:number}
export const formatNaira=(kobo:number)=>`₦${Math.trunc(kobo/100).toLocaleString('en-NG')}${Math.abs(kobo%100)===0?'':`.${String(Math.abs(kobo%100)).padStart(2,'0')}`}`;
export const getWallet=()=>apiClient.get<WalletBalance>('/wallet').then((response)=>response.data);
export const getWalletTransactions=(account:'wallet'|'earnings',cursor?:string)=>apiClient.get<{items:WalletEntry[];nextCursor:string|null}>('/wallet/transactions',{params:{account,cursor}}).then((response)=>response.data);
export const createTopup=(amountKobo:number,target:'wallet'|'earnings')=>apiClient.post<{reference:string;authorizationUrl:string}>('/payments/topups',{amountKobo,target}).then((response)=>response.data);
export const getTopup=(reference:string)=>apiClient.get<{status:string;amountKobo:number;target:string}>(`/payments/topups/${encodeURIComponent(reference)}`).then((response)=>response.data);
export const getBanks=()=>apiClient.get<{name:string;code:string}[]>('/payments/banks').then((response)=>response.data);
export const resolveBankAccount=(accountNumber:string,bankCode:string)=>apiClient.post<{accountName:string}>('/payout-accounts/resolve',{accountNumber,bankCode}).then((response)=>response.data);
export const sendPayoutOtp=()=>apiClient.post('/payout-accounts/otp').then((response)=>response.data);
export const addPayoutAccount=(input:{accountNumber:string;bankCode:string;otpCode:string})=>apiClient.post<{account:PayoutAccount}>('/payout-accounts',input).then((response)=>response.data);
export const getPayoutAccounts=()=>apiClient.get<{accounts:PayoutAccount[]}>('/payout-accounts').then((response)=>response.data);
export const deactivatePayoutAccount=(id:string)=>apiClient.delete(`/payout-accounts/${id}`).then((response)=>response.data);
export const sendWithdrawalOtp=()=>apiClient.post('/withdrawals/otp').then((response)=>response.data);
export const requestWithdrawal=(payoutAccountId:string,amountKobo:number,otpCode:string)=>apiClient.post<{id:string;reference:string;status:string}>('/withdrawals',{payoutAccountId,amountKobo,otpCode}).then((response)=>response.data);
export const getWithdrawals=()=>apiClient.get<{withdrawals:Withdrawal[]}>('/withdrawals').then((response)=>response.data);
export const getEarningsSummary=(range:'today'|'week'|'month')=>apiClient.get<EarningsSummary>('/driver/earnings/summary',{params:{range}}).then((response)=>response.data);
