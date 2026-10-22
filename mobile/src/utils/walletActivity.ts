import type { WalletEntry } from '@/services/paymentService';

/** Ledger types describe what happened; a credit alone does not mean a top-up. */
export function walletActivityLabel(entry: WalletEntry): string {
  const labels: Record<string, string> = {
    topup: 'Wallet top-up',
    trip_hold: 'Ride hold',
    trip_hold_release: 'Hold released',
    trip_settlement_wallet: 'Ride payment',
    refund: 'Ride refund',
    adjustment: 'Wallet adjustment',
  };
  const fallback = entry.type.replaceAll('_', ' ').trim();
  return labels[entry.type] ?? (entry.description?.trim() || (fallback ? fallback[0].toUpperCase() + fallback.slice(1) : 'Wallet activity'));
}

export function walletActivityDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}
