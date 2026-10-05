import { ApiError } from '../errors';

export function normalizeNigerianPhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  const local = digits.startsWith('234') ? digits.slice(3) : digits.replace(/^0/, '');
  if (!/^\d{10}$/.test(local)) throw new ApiError(400, 'invalid_phone');
  return `+234${local}`;
}
