export type OtpPurpose = 'registration' | 'login' | 'phone_change' | 'withdrawal' | 'payout_account';
export type AccountType = 'rider' | 'driver';
export type SessionScope = 'app' | 'staff';
export type DriverStatus = 'none' | 'pending' | 'approved' | 'rejected';
// Interim account policy: staff can also use rider/driver features on the same
// account. Driver approval is independent; dashboard APIs still require staff scope.
export const APP_ACCOUNT_ROLES = ['user', 'admin', 'super_admin'] as const;
export type AppAccountRole = typeof APP_ACCOUNT_ROLES[number];
export function isAppAccountRole(role: unknown): role is AppAccountRole {
  return APP_ACCOUNT_ROLES.some(value => value === role);
}
export interface AuthUserRow { id: string; full_name: string; phone: string | null; email: string | null; google_id: string | null; avatar_url: string | null; avatar_revision?:number; role: AppAccountRole; active_role: AccountType; is_active: boolean }
export function publicUser(user: AuthUserRow, scope: SessionScope = 'app') { return { id: user.id, name: user.full_name, phone: user.phone, email: user.email, avatarUrl: user.avatar_url, avatarVersion:user.avatar_revision??0, platformRole: scope === 'staff' ? user.role : 'user' as const }; }
