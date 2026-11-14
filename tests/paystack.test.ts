import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MailMessage, Mailer } from "@/lib/pilot/mail";
import { PayError, beginStartPayment, beginSuccessPayment, payLink, publicBase, requestSuccessFee, sendPayLink, settlePayment, startFee, successFeeOn, toKobo } from "@/lib/pilot/pay";
import { paystackMode, setPaystackFetchForTests, validWebhookSignature } from "@/lib/pilot/paystack";
import { memoryStore } from "@/lib/pilot/store";
import { createPilot } from "@/lib/pilot/submit";
import { signLink, validLink } from "@/lib/pilot/token";
import { parsePilotInput } from "@/lib/pilot/validate";

const photo = "data:image/jpeg;base64," + readFileSync("tests/fixtures/photo.jpg").toString("base64");
const signature = "data:image/png;base64," + readFileSync("tests/fixtures/signature.png").toString("base64");
const input = () => parsePilotInput({
  profile: {
    surname: "Ogunyemi", firstName: "Adewale", otherNames: "", bvn: "22154874718", bankName: "Guaranty Trust Bank",
    accountNumber: "0123456213", address: "14 Bourdillon Close, Ikoyi", city: "Lagos", state: "Lagos", country: "Nigeria",
    previousAddress: "", chn: "", phone1: "08031234567", phone2: "", email: "adewale@example.com",
  },
  atPurchase: { address: "22 Awolowo Road, Ikoyi", phone: "", nextOfKinName: "Funke Ogunyemi", nextOfKinRelationship: "Spouse", nextOfKinPhone: "" },
  variants: [],
  holdings: [{ registrarId: "coronation", company: "MTN Nigeria Communication PLC" }, { registrarId: "first", company: "CADBURY NIGERIA PLC" }],
  photo, signature, payment: { method: "pay_ahead", acknowledged: true }, consent: true,
});

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(m: MailMessage) { this.sent.push(m); return { messageId: `id-${this.sent.length}` }; }
}

/** A pretend Paystack: remembers what was initialized and lets the test decide how each payment ends. */
function fakePaystack() {
  const inits: { email: string; amount: number; reference: string; callback_url: string; metadata: Record<string, unknown>; currency: string }[] = [];
  const outcome = new Map<string, { status?: string; amount?: number; domain?: string; currency?: string }>();
  setPaystackFetchForTests(async (url, init) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (!String((init?.headers as Record<string, string>)?.authorization ?? "").startsWith("Bearer sk_")) return json({ status: false, message: "Invalid key" }, 401);
    if (url.endsWith("/transaction/initialize")) {
      const b = JSON.parse(String(init?.body));
      inits.push(b);
      return json({ status: true, message: "Authorization URL created", data: { authorization_url: `https://checkout.paystack.com/${b.reference}`, access_code: "ac_" + b.reference, reference: b.reference } });
    }
    const m = url.match(/\/transaction\/verify\/(.+)$/);
    if (m) {
      const ref = decodeURIComponent(m[1]);
      const i = inits.find((x) => x.reference === ref);
      if (!i) return json({ status: false, message: "Transaction reference not found" }, 404);
      const o = outcome.get(ref) ?? {};
      return json({ status: true, message: "Verification successful", data: { id: 4099260516, status: o.status ?? "success", reference: ref, amount: o.amount ?? i.amount, currency: o.currency ?? "NGN", channel: "card", paid_at: "2026-11-14T10:00:00.000Z", domain: o.domain ?? "test", metadata: i.metadata } });
    }
    return json({ status: false, message: "Not found" }, 404);
  });
  return { inits, outcome };
}

const BASE = "https://www.dividendii.com/check";

beforeEach(() => {
  Object.assign(process.env, { PILOT_MODE: "test", PILOT_TEST_EMAIL: "tester@example.com", PILOT_ADMIN_EMAIL: "admin@example.com", MAIL_FROM: "Dividendii <dami@dividendii.com>", PAYSTACK_SECRET_KEY: "sk_test_abc123" });
  delete process.env.PILOT_PUBLIC_URL;
  delete (globalThis as { __pilotSettings?: unknown }).__pilotSettings;
});
afterEach(() => { setPaystackFetchForTests(null); delete process.env.PAYSTACK_SECRET_KEY; });

describe("fees", () => {
  it("start fee is per company plus 7.5% VAT, to the kobo", () => {
    expect(startFee(1, 150)).toBe(161.25);
    expect(startFee(3, 150)).toBe(483.75);
    expect(toKobo(161.25)).toBe(16125);
    expect(successFeeOn(85000, 5)).toBe(4250);
    expect(successFeeOn(1234.56, 5)).toBe(61.73);
  });
  it("the key decides the mode", () => {
    expect(paystackMode({ PAYSTACK_SECRET_KEY: "" } as unknown as NodeJS.ProcessEnv)).toBe("off");
    expect(paystackMode({ PAYSTACK_SECRET_KEY: "sk_test_x" } as unknown as NodeJS.ProcessEnv)).toBe("test");
    expect(paystackMode({ PAYSTACK_SECRET_KEY: "sk_live_x" } as unknown as NodeJS.ProcessEnv)).toBe("live");
  });
  it("sends people back to our own site only", () => {
    expect(publicBase("https://www.dividendii.com")).toBe(BASE);
    expect(publicBase("https://dividendiicheck21registrars.vercel.app")).toBe("https://dividendiicheck21registrars.vercel.app/check");
    expect(publicBase("https://evil.example")).toBe(BASE);
    expect(publicBase(null)).toBe(BASE);
    expect(publicBase("https://x.vercel.app", { PILOT_PUBLIC_URL: "https://www.dividendii.com/" } as unknown as NodeJS.ProcessEnv)).toBe(BASE);
  });
});

describe("start fee with Paystack", () => {
  it("saves the forms unpaid and unsent, charges the right amount, and sends only after Paystack confirms", async () => {
    const ps = fakePaystack();
    const store = memoryStore(), mailer = new FakeMailer();
    const sub = await createPilot(input(), { store, mailer });
    expect(sub.payment).toMatchObject({ method: "pay_ahead", amountDue: 322.5, status: "awaiting_payment" });
    expect(sub.sendStatus).toBe("queued");

    const begun = await beginStartPayment(sub, BASE, { store, mailer });
    if (begun.paid) throw new Error("should not be paid yet");
    expect(begun.url).toContain("checkout.paystack.com");
    expect(ps.inits[0]).toMatchObject({ email: "adewale@example.com", amount: 32250, currency: "NGN", callback_url: BASE + "/pilot/paid" });
    expect(ps.inits[0].metadata).toMatchObject({ submissionId: sub.id, kind: "start" });
    expect(begun.reference).toMatch(/^DVD-[A-Z0-9]{6}-S-[0-9a-f]{10}$/);
    expect(mailer.sent.length).toBe(0); // nothing to a registrar before payment

    const done = await settlePayment(begun.reference, { store, mailer });
    expect(done).toMatchObject({ kind: "start", ok: true });
    const saved = (await store.get(sub.id))!;
    expect(saved.payment).toMatchObject({ status: "paid", via: "paystack", channel: "card", reference: begun.reference });
    expect(saved.sendStatus).toBe("sent");
    expect(mailer.sent.filter((m) => m.attachments?.length).length).toBe(2); // one per registrar
    const conf = mailer.sent.find((m) => !m.attachments?.length)!;
    expect(conf.text).toContain("Start fee paid: ₦322.50");

    // The webhook arriving afterwards must not send anything twice.
    const again = await settlePayment(begun.reference, { store, mailer });
    expect(again.ok).toBe(true);
    expect(mailer.sent.length).toBe(3);
  }, 60_000);

  it("an abandoned, underpaid or wrong-mode payment leaves the forms unsent", async () => {
    const ps = fakePaystack();
    const store = memoryStore(), mailer = new FakeMailer();
    const sub = await createPilot(input(), { store, mailer });
    const a = await beginStartPayment(sub, BASE, { store, mailer });
    if (a.paid) throw new Error("unexpected");

    ps.outcome.set(a.reference, { status: "abandoned" });
    expect(await settlePayment(a.reference, { store, mailer })).toMatchObject({ ok: false, message: "The payment was not completed." });

    ps.outcome.set(a.reference, { status: "success", amount: 100 });
    expect((await settlePayment(a.reference, { store, mailer })).ok).toBe(false);

    ps.outcome.set(a.reference, { status: "success", currency: "USD" });
    expect((await settlePayment(a.reference, { store, mailer })).ok).toBe(false);

    const saved = (await store.get(sub.id))!;
    expect(saved.payment.status).toBe("awaiting_payment");
    expect(saved.sendStatus).toBe("queued");
    expect(mailer.sent.length).toBe(0);
  }, 60_000);

  it("a live submission cannot be settled with a test payment", async () => {
    process.env.PILOT_MODE = "live";
    const ps = fakePaystack();
    const store = memoryStore(), mailer = new FakeMailer();
    const sub = await createPilot(input(), { store, mailer });
    const a = await beginStartPayment(sub, BASE, { store, mailer });
    if (a.paid) throw new Error("unexpected");
    expect((await settlePayment(a.reference, { store, mailer })).ok).toBe(false); // fake Paystack says domain "test"
    ps.outcome.set(a.reference, { domain: "live" });
    expect((await settlePayment(a.reference, { store, mailer })).ok).toBe(true);
  }, 60_000);

  it("with no key, online payment is refused politely", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const store = memoryStore(), mailer = new FakeMailer();
    const sub = await createPilot(input(), { store, mailer });
    await expect(beginStartPayment(sub, BASE, { store, mailer })).rejects.toBeInstanceOf(PayError);
  }, 60_000);

  it("staff can email a pay link, and the link is signed", async () => {
    fakePaystack();
    const store = memoryStore(), mailer = new FakeMailer();
    const sub = await createPilot(input(), { store, mailer });
    const after = await sendPayLink(sub.id, BASE, { store, mailer });
    const m = mailer.sent[0];
    expect(m.to).toBe("adewale@example.com");
    expect(m.text).toContain("₦322.50");
    expect(m.text).toContain(payLink(BASE, sub, "start"));
    expect(after.emails.at(-1)).toMatchObject({ kind: "pay_link", status: "sent" });
    expect(validLink(sub.id, signLink(sub.id))).toBe(true);
    expect(validLink(sub.id, signLink("someone-else"))).toBe(false);
    expect(validLink(sub.id, "")).toBe(false);
  }, 60_000);
});

describe("success fee", () => {
  async function sentSubmission() {
    const ps = fakePaystack();
    const store = memoryStore(), mailer = new FakeMailer();
    const sub = await createPilot(input(), { store, mailer });
    const a = await beginStartPayment(sub, BASE, { store, mailer });
    if (a.paid) throw new Error("unexpected");
    await settlePayment(a.reference, { store, mailer });
    mailer.sent.length = 0;
    return { ps, store, mailer, sub: (await store.get(sub.id))! };
  }

  it("cannot be asked for before the forms have gone", async () => {
    fakePaystack();
    const store = memoryStore(), mailer = new FakeMailer();
    const sub = await createPilot(input(), { store, mailer });
    await expect(requestSuccessFee(sub.id, "", BASE, { store, mailer })).rejects.toThrow(/haven't gone/);
  }, 60_000);

  it("staff ask by email; the shareholder states what they received and pays 5%", async () => {
    const { ps, store, mailer, sub } = await sentSubmission();
    const asked = await requestSuccessFee(sub.id, "Africa Prudential told us they paid you on 3 December.", BASE, { store, mailer });
    expect(asked.successFee).toMatchObject({ requests: 1, status: "requested" });
    const m = mailer.sent[0];
    expect(m.to).toBe("adewale@example.com");
    expect(m.subject).toContain("5% success fee");
    expect(m.text).toContain(payLink(BASE, sub, "success"));
    expect(m.text).toContain("Africa Prudential told us");
    expect(m.text).not.toContain("22154874718");

    await expect(beginSuccessPayment(sub, 0, BASE, { store, mailer })).rejects.toBeInstanceOf(PayError);
    await expect(beginSuccessPayment(sub, 500, BASE, { store, mailer })).rejects.toThrow(/too small/); // 5% of 500 is ₦25

    const b = await beginSuccessPayment((await store.get(sub.id))!, 85000, BASE, { store, mailer });
    expect(b.fee).toBe(4250);
    expect(ps.inits.at(-1)).toMatchObject({ amount: 425000 });
    expect(ps.inits.at(-1)!.metadata).toMatchObject({ kind: "success", received: 85000 });

    const done = await settlePayment(b.reference, { store, mailer });
    expect(done).toMatchObject({ kind: "success", ok: true });
    const saved = (await store.get(sub.id))!;
    expect(saved.successFee).toMatchObject({ status: "paid", declared: 85000, fee: 4250, via: "paystack", requests: 1 });
    expect(saved.payment.status).toBe("paid"); // the start fee record is untouched
  }, 60_000);
});

describe("webhook signature", () => {
  it("accepts only a body signed with the secret key", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "DVD-ABC123-S-0011223344" } });
    const good = createHmac("sha512", "sk_test_abc123").update(body).digest("hex");
    expect(validWebhookSignature(body, good)).toBe(true);
    expect(validWebhookSignature(body + " ", good)).toBe(false);
    expect(validWebhookSignature(body, createHmac("sha512", "sk_test_other").update(body).digest("hex"))).toBe(false);
    expect(validWebhookSignature(body, null)).toBe(false);
  });
});
