export type OtpPurpose = 'registration' | 'login' | 'phone_change' | 'withdrawal' | 'payout_account';
export type AccountType = 'rider' | 'driver';
export type DriverStatus = 'none' | 'pending' | 'approved' | 'rejected';
export interface AuthUserRow { id: string; full_name: string; phone: string | null; email: string | null; google_id: string | null; avatar_url: string | null; role: 'user' | 'admin' | 'super_admin'; active_role: AccountType; is_active: boolean }
export function publicUser(user: AuthUserRow) { return { id: user.id, name: user.full_name, phone: user.phone, email: user.email, avatarUrl: user.avatar_url, platformRole: user.role }; }
