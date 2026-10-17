import type { PoolClient } from 'pg';

export type EmailClient = Pick<PoolClient, 'query'>;
export const emailTemplates = ['welcome_rider','welcome_driver','admin_signup','application_received','admin_application','application_reviewed','activity_update','test'] as const;
export type EmailTemplate = typeof emailTemplates[number];
export const emailStatuses = ['waiting_email','waiting_admin','blocked','queued','sending','accepted','delivered','delayed','failed','bounced','complained','suppressed','uncertain','skipped'] as const;
export type EmailStatus = typeof emailStatuses[number];
export interface EmailPayload {
  name: string;
  accountType?: 'rider'|'driver';
  userId?: string;
  occurredAt?: string;
  services?: Array<{name:string;status:string}>;
  heading?: string;
  message?: string;
  reference?: string;
  dashboardPath?: string;
  appPath?: string;
}
export interface EmailRequest {
  from: string;
  to: string[];
  reply_to?: string;
  subject: string;
  text: string;
  html: string;
  tags: Array<{name:string;value:string}>;
}
export interface EmailRow {
  id:string;user_id:string|null;event_key:string;recipient_key:string;audience:'customer'|'admin';recipient:string|null;
  template:EmailTemplate;template_version:number;payload:EmailPayload;subject:string;status:EmailStatus;attempts:number;retryable:boolean;
  control_key:string;
  request:EmailRequest|null;first_attempt_at:Date|null;provider_id:string|null;last_error:string|null;
  lease_token:string|null;lease_until:Date|null;accepted_at:Date|null;delivered_at:Date|null;provider_event_at:Date|null;
  created_at:Date;updated_at:Date;
}
