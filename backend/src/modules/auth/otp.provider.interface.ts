export interface OtpProvider { send(phone: string, code: string): Promise<void>; }
