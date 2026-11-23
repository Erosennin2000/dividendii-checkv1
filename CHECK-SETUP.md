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
- To go live: set `PILOT_MODE=live`, set `PILOT_SECRET`, redeploy. Do not do this before your lawyer has read the privacy notice and the Power of Attorney wording (`lib/pilot/authority.ts`).
- **Before the first live customer (new):**
  1. In Vercel > Settings > Environment Variables add `CRON_SECRET` (any long random text, 32+ characters). Vercel sends it to the daily check described in section 8b. Without it the daily check refuses to run.
  2. In /check/admin/settings set **Mode** to live and fill **Copy me on every live registrar email**. That address is on CC, so registrars see it. It is also where staff alerts go (failed payment, paid but forms not sent, failed registrar email).
  3. Do a real ₦ payment of your own with a live Paystack key, check both registrar emails arrive (use your own address as the registrar address in Settings first), then put the real registrar addresses back.
- **The test code 123456 can no longer work once you are live.** If `PILOT_MODE` is `live`, or the Paystack key is a live one (`sk_live_...`), or the Settings page is set to live, the app always emails a random code and refuses 123456, even if `PILOT_OTP` was left on `demo`. Check it once after going live: ask for a code with a spare email address and confirm the code arrives by email.

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

## 7. Bank checks (Monnify)

What it does, and what it costs:

| Check | When | Cost |
|---|---|---|
| Account name lookup ("The bank shows this account as ...") | Step 3, as soon as the bank and 10-digit account number are filled in | Free |
| BVN and account name match | Once per submission, right before the forms are sent, after the start fee is paid | about N10 per submission |

Neither ever blocks a customer or holds forms back. If Monnify is off, your wallet is empty, the bank name can't be matched or anything fails, the result is "Not checked" and the forms go out as normal. A mismatch only shows as a flag on the staff page (open the submission, row "Bank check").

To switch it on:

1. In Monnify, open **Developer > API Keys** and copy the **API Key** and **Secret Key** (use the LIVE ones, Monnify's BVN checks have no sandbox).
2. In Vercel, open the **check app** project > **Settings > Environment Variables** and add `MONNIFY_API_KEY` and `MONNIFY_SECRET_KEY` (and `MONNIFY_CONTRACT_CODE` if you like; these two checks don't use it). Redeploy.
3. Top up the Monnify wallet with a small amount (N2,000 to N5,000 is plenty to start). Without it, only the BVN match is skipped.
4. Open the staff page > **Settings**. Under the bank details you will see "Bank checks (Monnify)" and a **Test the Monnify connection (free)** button. It signs in, downloads Monnify's bank list and tells you how many of our banks it could match. For any it can't match with confidence it lists the nearest Monnify names, so you can tell me which to link. A bank matched only by a close (not exact) name still gets a lookup, but a "not found" from it never stops a customer; only a clear "no such account" answer on a confidently matched bank, on live keys, shows the customer a warning.
   Below that there is **Try one account (free)**: type a bank and a 10-digit account number and it shows exactly what a customer would see, plus Monnify's own status and message. Use it with a real account of yours before going live. Sandbox (test) keys return made-up names, so a "found" there proves nothing.
5. Try step 3 with a real account number. You should see "The bank shows this account as ...".

Each BVN check in test mode also costs N10 (it is a real call), so test with a handful only.

## 7b. Account name lookup with Paystack (free)

Step 3 shows "The bank shows this account as ..." from **live Monnify keys if you have them, otherwise your live Paystack key** (Paystack's Resolve Account Number is free for Nigerian accounts). Test and sandbox keys are never used for this, because they answer for pretend banks.

- Paystack can only **warn** ("We couldn't confirm this account, please double-check"). It never stops a customer, because Paystack gives the same answer when a bank is slow. Only a clear "no such account" from live Monnify stops step 3.
- If your Monnify keys are sandbox ones, set `MONNIFY_BASE_URL=https://sandbox.monnify.com` in Vercel. Without it the app assumes they are live, the sign-in fails, and it quietly falls back to Paystack.
- The BVN and account name match (N10) still needs live Monnify keys. On sandbox it shows "Not checked" and nothing is lost.
- Staff > Settings > **Test the bank lookups (free)** shows how many of our banks Paystack could match, with the nearest names for any it couldn't. **Try one account** shows exactly what a customer would see.

## 8. Backup and keeping the free database awake

- **Backup:** open /check/admin and press **Download backup**. It saves two files to your computer: one full backup of every record (submissions, leads, feedback, settings; passwords and codes are left out) and one spreadsheet listing every PDF with its customer. The backup holds BVN, bank and phone details, so keep it somewhere private and delete old copies. The PDFs themselves stay in Supabase Storage; open any submission to download its PDFs. Supabase's free plan has **no automatic backups**, so press this button regularly (weekly while you are live is sensible).
- **Keep-alive:** Supabase's free plan pauses a project after a week with no activity. `vercel.json` in this app has a weekly job (Mondays) that calls `/check/api/pilot/keepalive`, which reads one record and returns nothing else. After deploying, open Vercel > this project > **Settings > Cron Jobs** and confirm the job is listed. If it isn't, any free pinger that opens `https://www.dividendii.com/check/api/pilot/keepalive` once a week does the same. Real customers also keep it awake.
- If the project ever shows as paused, press **Restore** in Supabase. Nothing is lost on a pause.

## 8b. The daily check and staff alerts

- `vercel.json` has a second cron job, daily at 06:30 UTC (07:30 Lagos), that calls `/check/api/pilot/daily-check`. It emails you one list of submissions that **paid but whose forms were not sent**, or that are not fully sent. It only reads; it changes nothing. It needs `CRON_SECRET` (see section 4).
- Instant alerts go to the **Copy me** address (or the reply-to address if that is empty) when: a Paystack payment fails to settle, a start fee was paid but sending failed, a registrar email is refused or fails, or a customer pays twice.
- A refused address is shown as **Not sent**, never "Sent". The customer sees Resend once and then contacts us.
- **Deleting a person's data:** open the submission in /check/admin, expand "Delete this person's record", type the reference, press Delete permanently. It removes the record and every PDF and image. If that was the person's last submission, their account (including the password they set) and any feedback they sent are removed too. Copies already emailed to a registrar cannot be recalled. Download a backup first if you may need it.
- Staff actions on a submission record which staff member did them (progress updates show "by <email>"). Progress updates can no longer be removed; add a correcting update instead.

## 9. Email limits (Zoho)

Zoho's help page does not promise an unlimited daily amount. It describes a rolling hourly limit of roughly **50 to 500 external emails per hour per mailbox**, which moves with the mailbox's sending reputation, and says bulk or burst sending is not supported. Going over blocks sending for up to an hour.

What we send per customer: 1 code email, 1 email per registrar (typically 2 to 4), 1 receipt, plus start-fee and success-fee mails. Roughly 6 to 8 emails for a typical customer. At the low end of Zoho's range that is about 6 to 8 customers an hour from one mailbox. A failed send shows on the staff page and can be re-sent, nothing is lost, but customer codes would be delayed behind a queue of registrar mail.

If launch day brings a burst: use a separate sending service for the app (Zoho's own ZeptoMail is one; it is paid per email, so tell me before you sign up) and keep the Zoho mailbox for replies. The only change is the four `SMTP_` settings in Vercel.

## 10. The two fees

- **Start fee:** N150 per company plus 7.5% VAT, paid by Paystack before the forms are sent.
- **Success fee:** 5% of what the customer received. Staff open the submission and press **Ask for the success fee**. The customer gets an email with a Paystack link (they type the amount they received and pay the 5%) and, if you filled in the bank details under Settings, your account to pay by transfer instead. The registrar pays the customer directly, so this relies on the customer telling us the amount.
- **VAT on the 5%:** 7.5% VAT is added to the 5% (decided by you; confirm with your accountant). A customer who received ₦85,000 pays ₦4,250 plus ₦318.75 VAT, ₦4,568.75 in all.
- **The start fee is not refundable** once the forms are sent. The pay step and the receipt email say so.

## Things to know
- Fees shown: ₦150 per company plus 7.5% VAT, paid at step 4 before the forms are sent; then 5% when they are paid. Defaults live in `lib/pilot/config.ts` and can be changed at /check/admin/settings.
- You are on Vercel Pro and Supabase Pro, so the commercial-use rule and the free-plan pause no longer apply. The weekly keep-alive job is harmless and can stay. Supabase's own backups are on its Backups page; the Download backup button is still a good second copy.
- The app collects BVN, bank account, photo and signature and emails them to registrars. Some registrars may want a bank-stamped form or a wet signature; expect a few to reply asking for more.
