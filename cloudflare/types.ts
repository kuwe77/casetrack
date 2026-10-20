export interface Env {
  DB: D1Database;
  FILES?: R2Bucket;
  ASSETS: Fetcher;
  AUTH_SECRET: string;
  APP_ORIGIN?: string;
}
export interface Identity {
  userId: string;
  email: string;
  firmId: string | null;
  role: string | null;
  keyId?: string;
  scopes: string[];
}
