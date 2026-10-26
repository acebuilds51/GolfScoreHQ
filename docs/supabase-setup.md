# Setting up Supabase

The web app runs in demo mode until it's pointed at a Supabase project. These steps create the free project and load the database.

## 1. Create the project (about 5 minutes)

1. Go to [supabase.com](https://supabase.com) and sign up (signing in with GitHub is easiest).
2. **New project**
   - Name: `golfscorehq`
   - Database password: generate one and save it in your password manager. You won't need it day to day.
   - Region: **East US (Ohio)** (closest to Michigan)
   - Plan: **Free**

## 2. Load the database

Pick one:

**A. Copy and paste (no tools needed)**
In the Supabase dashboard open **SQL Editor → New query**. Paste each file from `supabase/migrations/` **in filename order** and press **Run** after each one:

1. `20261026000000_init.sql`
2. `20261027000000_ctp_marker_chain.sql`
3. `20261028000000_pricing_tiers.sql`
4. `20261029000000_pro_features.sql`
5. `20261030000000_join_request_identity.sql`

**B. Command line**

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

## 3. Sign-in settings

**Authentication → URL Configuration**

- Site URL: `http://localhost:5173` (change to the real domain at launch)
- Redirect URLs: add `http://localhost:5173/**`

Email sign-in links are on by default. Supabase's built-in email sender allows only a few emails per hour, which is fine for testing. Before the pilots, connect a real email provider (Resend) under **Authentication → Emails → SMTP**.

## 4. Connect the app

**Project Settings → API**: copy the **Project URL** and the **anon public** key into `apps/web/.env.local`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

The anon key is meant to be public: the database's access rules protect the data. **Never** put the `service_role` key in the app or share it.

Restart the dev server and the demo banner disappears.
