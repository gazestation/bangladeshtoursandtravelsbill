import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient<any> | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes("your-project")) return null;
  if (!cachedClient) cachedClient = createClient<any>(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return cachedClient;
}
