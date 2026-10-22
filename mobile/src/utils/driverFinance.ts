import type { WalletEntry } from '@/services/paymentService';

/** Parse naira without rounding fractional kobo or accepting scientific notation. */
export function withdrawalAmountKobo(value: string): number | null {
  const text = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replaceAll(',', '').split('.');
  const kobo = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return kobo > 0n && kobo <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(kobo) : null;
}

export function driverActivityLabel(entry: WalletEntry): string {
  const labels: Record<string, string> = {
    trip_commission_cash: 'Cash trip commission', trip_settlement_wallet: 'Wallet trip earnings',
    topup: 'Commission payment', withdrawal_request: 'Withdrawal requested', withdrawal_reversal: 'Withdrawal returned',
    adjustment: 'Earnings adjustment', refund: 'Refund',
  };
  const fallback = entry.type.replaceAll('_', ' ').trim();
  return labels[entry.type] ?? (entry.description?.trim() || (fallback ? fallback[0].toUpperCase() + fallback.slice(1) : 'Earnings activity'));
}

export function withdrawalStatus(status: string): { label: string; tone: 'success' | 'warning' | 'danger' | 'textMuted'; icon: 'check' | 'clock' | 'refresh' | 'close' } {
  if (status === 'success' || status === 'succeeded') return { label: 'Succeeded', tone: 'success', icon: 'check' };
  if (status === 'pending') return { label: 'Pending', tone: 'warning', icon: 'clock' };
  if (status === 'processing') return { label: 'Processing', tone: 'warning', icon: 'refresh' };
  if (status === 'failed') return { label: 'Failed', tone: 'danger', icon: 'close' };
  if (status === 'reversed') return { label: 'Reversed', tone: 'danger', icon: 'refresh' };
  return { label: status.replaceAll('_', ' ') || 'Unknown status', tone: 'textMuted', icon: 'clock' };
}
