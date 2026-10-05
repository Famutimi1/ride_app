export class ApiError extends Error {
  constructor(public status: number, public code: string, public details?: Record<string, unknown>) {
    super(code);
    this.name = 'ApiError';
  }
}
