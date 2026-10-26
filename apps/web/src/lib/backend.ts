import type { Api } from './api';
import { demoApi } from './demoApi';
import { supabaseApi } from './supabaseApi';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Supabase when it's configured, otherwise demo mode. */
export const api: Api = url && key ? supabaseApi(url, key) : demoApi();
