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
1. Push this folder to a new GitHub repository, then in Vercel: Add New > Project > import it. **Name the project `dividendii-check`** so its address is `https://dividendii-check.vercel.app` (yours is `https://dividendiicheck21registrars.vercel.app`, already set in the site update). If Vercel gives another address, tell me, or edit the two `/check` lines in the main site's `vercel.json`.
2. Add the environment variables from `.env.example`. Leave `PILOT_MODE=test` and `PILOT_OTP=demo` for now.
3. Deploy. Then upload the main site update (dividendii-site-update.zip) so `/check` starts pointing here.

## 4. Test, then go live
- Open https://www.dividendii.com/check, run through with your own details. In test mode every registrar email goes to `PILOT_TEST_EMAIL`. The email code is `123456`.
- Check /check/admin: sign in, open the submission, look at both PDFs.
- To go live: set `PILOT_OTP=email`, `PILOT_MODE=live`, set `PILOT_SECRET`, redeploy. Do not do this before your lawyer has read the privacy notice and the Letter of Authority wording (`lib/pilot/authority.ts`).

## 5. Payments (Paystack)
How it works: at step 4 the app works out the start fee (₦150 per company plus 7.5% VAT), saves the forms, and sends the person to Paystack's page. The forms go to the registrars only after Paystack confirms the payment. The 5% success fee is asked for later from the staff page.

**Switch on test payments**
1. Paystack dashboard > **Settings > API Keys & Webhooks**. Make sure the dashboard toggle says **Test Mode**. Copy the **Test Secret Key** (starts `sk_test_`).
2. Vercel > the check app project > Settings > Environment Variables: add `PAYSTACK_SECRET_KEY` with that key, and `PILOT_PUBLIC_URL` = `https://www.dividendii.com`. Redeploy.
3. Back in Paystack, on the same page, set **Test Webhook URL** to `https://dividendiicheck21registrars.vercel.app/check/api/paystack/webhook` (your check app's own Vercel address). Save.
4. Try it: fill the form, press **Pay and send**, and pay with test card `4084 0840 8408 4081`, any future expiry, CVV `408`. You should land on "Payment received", the registrar emails should arrive in your test inbox, and the staff page should show "Paid by Paystack".
5. Also try cancelling on Paystack's page: you should see "The payment was not completed" with a button to try again, and nothing should be emailed.

**Go live (three changes)**
1. Paystack must have activated your business for live payments.
2. In Vercel, replace `PAYSTACK_SECRET_KEY` with the **Live Secret Key** (starts `sk_live_`). Redeploy.
3. In Paystack, set the **Live Webhook URL** to the same webhook address as above.
`PILOT_MODE=live` (real registrar emails) is a separate switch. A live submission can never be settled with a test payment, so switch both together.

**Staff page**
- **Email a pay link**: for someone who saved their forms but did not finish paying.
- **Mark as paid by hand**: if they paid you another way. Then press Send on each registrar.
- **Email the success-fee request**: once you believe the registrar has paid them. They open the link, type what they received, and pay 5% on Paystack. It is trust-based.
- **Mark as received by hand**: for a success fee paid another way.
- Refunds are done in the Paystack dashboard.

**Costs**: Paystack keeps 1.5% of each local payment (plus ₦100 only on payments of ₦2,500 or more, capped at ₦2,000). On a ₦161.25 start fee that is about ₦2.42. You absorb it; the customer pays exactly the amount shown.

## 6. Accounts, the investing demo and feedback
- **Run `supabase/pilot.sql` once more** in Supabase > SQL Editor. It is safe to re-run and adds the `pilot_feedback` table. Nothing else changes.
- **How accounts work:** there is no sign-up. Confirming the email on step 1 of the form creates the account and signs the person in for a few hours. After paying they see "Go to my account", where they can set a password at once. Next time they go to **www.dividendii.com/check/account** (or "My account" in the header), choose **Set or reset my password**, get a 6-digit code by email and choose a password. In test mode (`PILOT_OTP=demo`) no email is sent and the code is **123456**.
- **What they see:** each check, with a timeline per registrar (completed → paid → sent → whatever you record), the fees, a message from you, and what they gave us with BVN, account, phone and CHN cut to the last four. No photo, signature or full numbers.
- **Updating progress:** on the staff page, open a submission, use **Progress the customer sees**: pick the registrar and what happened (replied, needs more from you, money confirmed, paid, nothing found, closed), add an optional note. **Message at the top of their account** is a free line they see first. Both appear in their account straight away.
- **Investing tab:** "Coming soon", the SEC "applied, pending" line, **Join the waitlist**, and **Look around the demo**. The demo is the existing investing app on the main site at /app, with sample data and a banner on every screen. Only signed-in account holders can open it; anyone else is sent to sign in. The staff demo console stays closed. To hide the demo, set `VITE_ACCOUNT_DEMO=false` on the main site in Vercel and redeploy.
- **Feedback:** account holders send it from the Feedback tab (also linked from the demo banner). You read it under **Feedback** on the staff page, mark it read, reply by email, or export it as CSV. The **Leads and accounts** tab shows who has set a password and who joined the waitlist.
- `PILOT_SECRET` also signs the account sessions. Set it before going live; changing it later signs everyone out.

## Things to know
- Fees shown: ₦150 per company plus 7.5% VAT, paid at step 4 before the forms are sent; then 5% when they are paid. Defaults live in `lib/pilot/config.ts` and can be changed at /check/admin/settings.
- Vercel's free Hobby plan is for non-commercial use. Once you take your first fee the app is commercial and Vercel may ask for the paid plan. That is a cost; I will not switch it on without asking you.
- The app collects BVN, bank account, photo and signature and emails them to registrars. Some registrars may want a bank-stamped form or a wet signature; expect a few to reply asking for more.
