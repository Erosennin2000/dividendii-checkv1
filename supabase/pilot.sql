-- Dividendii check app: tables and the private bucket for the PDFs.
-- Paste this whole file into Supabase > SQL Editor > New query > Run. Safe to run twice.

create table if not exists public.pilot_submissions (
  id           text primary key,
  ref          text not null,
  created_at   timestamptz not null,
  email        text,
  send_status  text,
  mode         text,
  data         jsonb not null            -- the full record: details, holdings, emails sent, payment, note
);
create index if not exists pilot_submissions_created_idx on public.pilot_submissions (created_at desc);
create index if not exists pilot_submissions_ref_idx     on public.pilot_submissions (ref);
create index if not exists pilot_submissions_email_idx   on public.pilot_submissions (email);

create table if not exists public.pilot_leads (
  id          text primary key,          -- sha-256 of the email, so one row per person
  email       text,
  updated_at  timestamptz not null,
  data        jsonb not null
);
create index if not exists pilot_leads_updated_idx on public.pilot_leads (updated_at desc);

create table if not exists public.pilot_settings (
  id          text primary key,          -- always 'main'
  updated_at  timestamptz not null,
  data        jsonb not null             -- what the admin saved on the settings page
);
alter table public.pilot_settings enable row level security;

create table if not exists public.pilot_feedback (
  id     text primary key,
  at     timestamptz not null,
  email  text,
  read   boolean not null default false,
  data   jsonb not null                -- the message, rating, page and who sent it
);
create index if not exists pilot_feedback_at_idx on public.pilot_feedback (at desc);
alter table public.pilot_feedback enable row level security;

-- Lock the tables. With row level security on and no policies, the public (anon) key can read and write nothing.
-- Only the server, using the service-role key, can touch them.
alter table public.pilot_submissions enable row level security;
alter table public.pilot_leads       enable row level security;

-- Private bucket for the filled PDFs (no public access; the server reads them with the service-role key).
insert into storage.buckets (id, name, public)
values ('pilot-submissions', 'pilot-submissions', false)
on conflict (id) do nothing;
