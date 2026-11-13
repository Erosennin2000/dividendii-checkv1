# Check my dividends: setup (one time)

This app serves **www.dividendii.com/check**. It is a separate project from the main site; the main site's `vercel.json` passes `/check` through to it.

Nothing here costs money. Stop and ask before accepting any prompt to upgrade or pay.

## 1. Records: Supabase (free)
1. Create a free project at supabase.com. Open **SQL Editor**, paste `supabase/pilot.sql`, run it once.
2. **Project Settings > API**: copy the URL, anon key and service-role key (secret).
3. **Authentication > Users > Add user**: create your staff login (email + password). Put the same email in `PILOT_ADMIN_EMAILS`.

Free Supabase projects pause after about a week with no use. If /check stops saving, open the project in Supabase and press Restore. Opening the project once a week avoids it.

## 2. Email
Easiest and free: create a mailbox in cPanel (Email Accounts), for example `support@dividendii.com`. Use cPanel's "Connect devices" values: `SMTP_HOST` (mail.dividendii.com), `SMTP_PORT` 587, `SMTP_USER` (the full address), `SMTP_PASS`.

## 3. Put the app online (Vercel)
1. Push this folder to a new GitHub repository, then in Vercel: Add New > Project > import it. **Name the project `dividendii-check`** so its address is `https://dividendii-check.vercel.app`. If Vercel gives another address, tell me, or edit the two `/check` lines in the main site's `vercel.json`.
2. Add the environment variables from `.env.example`. Leave `PILOT_MODE=test` and `PILOT_OTP=demo` for now.
3. Deploy. Then upload the main site update (dividendii-site-update.zip) so `/check` starts pointing here.

## 4. Test, then go live
- Open https://www.dividendii.com/check, run through with your own details. In test mode every registrar email goes to `PILOT_TEST_EMAIL`. The email code is `123456`.
- Check /check/admin: sign in, open the submission, look at both PDFs.
- To go live: set `PILOT_OTP=email`, `PILOT_MODE=live`, set `PILOT_SECRET`, redeploy. Do not do this before your lawyer has read the privacy notice and the Letter of Authority wording (`lib/pilot/authority.ts`).

## Things to know
- Fees shown: ₦150 per company plus 7.5% VAT, asked only after a registrar confirms money; then 5% when paid. Defaults live in `lib/pilot/config.ts` and can be changed at /check/admin/settings.
- Vercel's free Hobby plan is for non-commercial use. Once you take your first fee the app is commercial and Vercel may ask for the paid plan. That is a cost; I will not switch it on without asking you.
- The app collects BVN, bank account, photo and signature and emails them to registrars. Some registrars may want a bank-stamped form or a wet signature; expect a few to reply asking for more.
