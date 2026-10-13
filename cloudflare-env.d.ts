declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    HOST_BOOTSTRAP_PASSWORD?: string;
    SESSION_SECRET?: string;
  }
}
