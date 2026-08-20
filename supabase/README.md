# Supabase

Migrations are additive and must be applied in timestamp order. Before applying them to production, create a data, Auth user and Storage backup.

The revival migration moves contact details from `profiles` to the RLS-protected `profile_contacts` table, preserves old transactions as canceled/completed history, and installs the transactional RPC used by the web app.

After applying a migration, verify the row counts and run the privacy checks documented in `docs/ACCEPTANCE.md`.
