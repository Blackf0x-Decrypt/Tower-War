// Vercel has no `cloudflare:workers` binding. The decree route reads this
// object first, then falls back to process.env.
export const env: Record<string, string | undefined> = process.env;
