import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountError, checkPassword, hashPassword, passwordProblem, readSession, sendAccountCode, setPassword, signInWithPassword, signSession, sameOrigin } from "@/lib/pilot/account";
import { accountView, lastFour } from "@/lib/pilot/accountView";
import { leadIdFor, startLead, verifyLead } from "@/lib/pilot/leads";
import type { MailMessage, Mailer } from "@/lib/pilot/mail";
import { memoryStore } from "@/lib/pilot/store";
import { createPilot } from "@/lib/pilot/submit";
import { parsePilotInput } from "@/lib/pilot/validate";

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(m: MailMessage) { this.sent.push(m); return { messageId: "x" }; }
}
const photo = "data:image/jpeg;base64," + readFileSync("tests/fixtures/photo.jpg").toString("base64");
const signature = "data:image/png;base64," + readFileSync("tests/fixtures/signature.png").toString("base64");

beforeEach(() => {
  process.env.PILOT_OTP = "demo";
  const g = globalThis as { __pilotMem?: unknown; __pilotSettings?: unknown };
  delete g.__pilotMem; delete g.__pilotSettings;
  Object.assign(process.env, { PILOT_MODE: "test", PILOT_OTP: "demo", PILOT_TEST_EMAIL: "t@example.com" });
});

async function confirmed(email = "ade@example.com") {
  const store = memoryStore(), mailer = new FakeMailer();
  const { leadId } = await startLead({ firstName: "Ade", surname: "Ola", otherNames: "", variants: [], email, chn: "C123456789" }, { store, mailer });
  await verifyLead(leadId, "123456", { store });
  return { store, mailer, leadId };
}

describe("passwords and sessions", () => {
  it("hashes passwords and checks them", () => {
    const h = hashPassword("correct horse 9");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h).not.toContain("correct");
    expect(checkPassword("correct horse 9", h)).toBe(true);
    expect(checkPassword("correct horse 8", h)).toBe(false);
    expect(passwordProblem("short")).toMatch(/8 characters/);
    expect(passwordProblem("12345678")).toMatch(/letters/);
    expect(passwordProblem("good pass 1")).toBeNull();
  });
  it("signs sessions, rejects tampering and expiry", () => {
    const { value } = signSession({ id: "abc", sessionVersion: 2 }, "password", 1_000);
    expect(readSession(value, 2_000)).toMatchObject({ leadId: "abc", version: 2, via: "password" });
    expect(readSession(value.replace(/^./, "x"), 2_000)).toBeNull();
    expect(readSession(value, 1_000 + 8 * 86400_000)).toBeNull(); // past 7 days
    const code = signSession({ id: "abc" }, "code", 1_000);
    expect(code.maxAge).toBe(6 * 3600);
  });
  it("only our own site may change an account", () => {
    const req = (origin: string | null, host = "dividendiicheck21registrars.vercel.app") => new Request("https://x/check/api/account/login", { method: "POST", headers: { ...(origin ? { origin } : {}), host } });
    expect(sameOrigin(req("https://www.dividendii.com"))).toBe(true);
    expect(sameOrigin(req("https://dividendiicheck21registrars.vercel.app"))).toBe(true);
    expect(sameOrigin(req("https://evil.vercel.app"))).toBe(false);
    expect(sameOrigin(req("https://dividendii.com.evil.com"))).toBe(false);
  });
});

describe("the account", () => {
  it("is made by confirming the email; the password is set with a code; sign-in then works", async () => {
    const { store, mailer, leadId } = await confirmed();
    await expect(signInWithPassword("ade@example.com", "anything 1", store)).rejects.toBeInstanceOf(AccountError);

    const r = await sendAccountCode("ADE@example.com", { store, mailer });
    expect(r.demo).toBe(true);
    expect(mailer.sent.length).toBe(0); // demo mode sends nothing; the code is 123456
    await expect(setPassword({ email: "ade@example.com", code: "000000", password: "good pass 1" }, store)).rejects.toThrow(/isn't right/);
    const lead = await setPassword({ email: "ade@example.com", code: "123456", password: "good pass 1" }, store);
    expect(lead.passwordHash).toBeTruthy();
    expect(lead.sessionVersion).toBe(1);
    // A used code can't be used again.
    await expect(setPassword({ email: "ade@example.com", code: "123456", password: "other pass 2" }, store)).rejects.toThrow(/Ask for a new one/);

    const signed = await signInWithPassword("ade@example.com", "good pass 1", store);
    expect(signed.id).toBe(leadId);
    await expect(signInWithPassword("ade@example.com", "wrong pass 1", store)).rejects.toThrow(/Wrong email or password/);
    await expect(signInWithPassword("nobody@example.com", "good pass 1", store)).rejects.toThrow(/Wrong email or password/);
  });

  it("can set the first password without a code straight after the form, but not a second one", async () => {
    const { store, leadId } = await confirmed();
    const session = readSession(signSession({ id: leadId, sessionVersion: 0 }, "code").value)!;
    await setPassword({ password: "first pass 1", session }, store);
    await expect(setPassword({ password: "second pass 2", session }, store)).rejects.toThrow(/already have a password/);
  });

  it("asking for a code never reveals whether an account exists", async () => {
    const { store, mailer } = await confirmed();
    process.env.PILOT_OTP = "email";
    mailer.sent.length = 0;
    await expect(sendAccountCode("stranger@example.com", { store, mailer })).resolves.toEqual({ demo: false });
    expect(mailer.sent.length).toBe(0);
    await sendAccountCode("ade@example.com", { store, mailer });
    expect(mailer.sent.length).toBe(1);
    expect(mailer.sent[0].subject).toMatch(/code to set your password: \d{6}/);
  });

  it("starting the form again keeps the password", async () => {
    const { store, mailer, leadId } = await confirmed();
    await setPassword({ email: "ade@example.com", code: (await sendAccountCode("ade@example.com", { store, mailer }), "123456"), password: "good pass 1" }, store);
    await startLead({ firstName: "Ade", surname: "Ola", otherNames: "", variants: [], email: "ade@example.com", chn: "" }, { store, mailer });
    expect((await store.getLead(leadId))?.passwordHash).toBeTruthy();
  });
});

describe("what the account shows", () => {
  it("lists only that person's checks and hides the sensitive numbers", async () => {
    const store = memoryStore(), mailer = new FakeMailer();
    const mk = (email: string) => createPilot(parsePilotInput({
      profile: { surname: "Ola", firstName: "Ade", otherNames: "", bvn: "22154874718", bankName: "Guaranty Trust Bank", accountNumber: "0123456213", address: "14 Bourdillon Close", city: "Lagos", state: "Lagos", country: "Nigeria", previousAddress: "", chn: "C123456789", phone1: "08031234567", phone2: "", email },
      atPurchase: { address: "22 Awolowo Road", phone: "", nextOfKinName: "Funke Ola", nextOfKinRelationship: "Spouse", nextOfKinPhone: "" },
      variants: [], holdings: [{ registrarId: "coronation", company: "MTN Nigeria Communication PLC" }], photo, signature,
      payment: { method: "pay_ahead", acknowledged: true }, consent: true,
    }), { store, mailer });
    const mine = await mk("ade@example.com");
    await mk("someone@example.com");
    await store.update(mine.id, { progress: [{ registrarId: "coronation", status: "money_found", note: "₦42,000 found", at: "2026-11-20T10:00:00Z" }], customerMessage: "We chased them twice." });

    const subs = await store.listByEmail("ade@example.com");
    expect(subs.map((s) => s.ref)).toEqual([mine.ref]);
    const lead = (await store.getLead(leadIdFor("ade@example.com"))) ?? { id: leadIdFor("ade@example.com"), email: "ade@example.com", firstName: "Ade", surname: "Ola", otherNames: "", variants: [], chn: "C123456789", createdAt: "", updatedAt: "", verifiedAt: null, codeHash: null, codeExpires: null, attempts: 0, submittedRef: null };
    const v = accountView(lead, subs, "https://www.dividendii.com/check");
    const json = JSON.stringify(v);
    expect(json).not.toContain("22154874718");
    expect(json).not.toContain("0123456213");
    expect(json).not.toContain("08031234567");
    expect(json).not.toContain("data:image");
    expect(v.submissions[0].details).toMatchObject({ bvn: "••••4718", account: "••••6213", phone: "••••4567", chn: "••••6789" });
    expect(v.submissions[0].message).toBe("We chased them twice.");
    const steps = v.submissions[0].registrars[0].steps.map((s) => s.label);
    expect(steps).toContain("Registrar confirmed money in your name");
    expect(v.submissions[0].registrars[0].current).toBe("Registrar confirmed money in your name");
    expect(lastFour("")).toBe("");
  }, 60_000);
});
