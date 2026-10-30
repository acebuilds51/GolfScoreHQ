import type { Api } from './api';
import { demoApi } from './demoApi';
import { inDemoSite, setDemoSite } from './demoSite';
import { supabaseApi } from './supabaseApi';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Opening /demo puts this browser in the public demo until "Exit demo".
if (typeof location !== 'undefined' && location.pathname === '/demo') setDemoSite(true);

/** Supabase when it's configured, otherwise demo mode. The public demo always uses demo mode. */
export const api: Api = url && key && !inDemoSite() ? supabaseApi(url, key) : demoApi();
/** True in the public demo on the live site (golfscorehq.app/demo). */
export const demoSite = api.mode === 'demo' && inDemoSite();
