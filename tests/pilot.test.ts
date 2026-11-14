import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { PILOT_COMPANIES, companiesFor, payAheadTotal } from "@/lib/pilot/config";
import { defaultSettings, effectiveSettings, publicConfig } from "@/lib/pilot/settings";
import { mergeStored, parseSettingsPatch } from "@/lib/pilot/settingsShared";
import type { MailMessage, Mailer } from "@/lib/pilot/mail";
import { resetRateLimit, tooMany } from "@/lib/pilot/rateLimit";
import { DEMO_CODE, leadIdFor, parseStart, startLead, verifyLead } from "@/lib/pilot/leads";
import { memoryStore, supabaseStore } from "@/lib/pilot/store";
import { ALL_BANKS, BANK_GROUPS } from "@/lib/pilot/banks";
import { AdminError, adminLogin, requirePilotAdmin } from "@/lib/pilot/admin";
import { signToken, verifyToken } from "@/lib/pilot/token";
import { chasePilot, createPilot, dispatchPilot, resendPilot, submitPilot } from "@/lib/pilot/submit";
import { pdfSafe } from "@/lib/pilot/text";
import { PilotValidationError, parsePilotInput, pilotProblems } from "@/lib/pilot/validate";

const photo = "data:image/jpeg;base64," + readFileSync("tests/fixtures/photo.jpg").toString("base64");
const signature = "data:image/png;base64," + readFileSync("tests/fixtures/signature.png").toString("base64");

const raw = (over: Record<string, unknown> = {}) => ({
  profile: {
    surname: "Ogunyemi", firstName: "Adewale", otherNames: "Bamidele", bvn: "22154874718", bankName: "Guaranty Trust Bank",
    accountNumber: "0123456213", address: "14 Bourdillon Close, Ikoyi", city: "Lagos", state: "Lagos", country: "Nigeria",
    previousAddress: "", chn: "", phone1: "08031234567", phone2: "", email: "Adewale@Example.com",
  },
  atPurchase: { address: "22 Awolowo Road, Ikoyi", phone: "08099990000", nextOfKinName: "Funke Ogunyemi", nextOfKinRelationship: "Spouse", nextOfKinPhone: "" },
  variants: ["A. B. Ogunyemi", "Wale Ogunyemi"],
  holdings: [
    { registrarId: "coronation", company: "MTN Nigeria Communication PLC" },
    { registrarId: "coronation", company: "Dangote Cement PLC" },
    { registrarId: "first", company: "CADBURY NIGERIA PLC" },
  ],
  photo, signature,
  payment: { method: "pay_ahead", acknowledged: true },
  consent: true,
  ...over,
});

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  failFor: (m: MailMessage) => boolean = () => false;
  async send(m: MailMessage) {
    if (this.failFor(m)) throw new Error("550 mailbox unavailable");
    this.sent.push(m);
    return { messageId: `id-${this.sent.length}` };
  }
}

beforeEach(() => {
  Object.assign(process.env, { PILOT_MODE: "test", PILOT_TEST_EMAIL: "tester@example.com", PILOT_ADMIN_EMAIL: "admin@example.com", MAIL_FROM: "Dividendii <dami@dividendii.com>" });
  resetRateLimit();
  delete (globalThis as { __pilotSettings?: unknown }).__pilotSettings;
});

describe("pilot company list", () => {
  it("covers all 21 registrars, and leaves FBN Holdings out", () => {
    expect(new Set(PILOT_COMPANIES.map((c) => c.registrarId)).size).toBe(21);
    expect(companiesFor("coronation").length).toBe(30);
    expect(PILOT_COMPANIES.some((c) => /FBN HOLDINGS/i.test(c.company))).toBe(false);
    expect(payAheadTotal(12)).toBe(1800);
  });
});

describe("validation", () => {
  it("accepts a complete submission and tidies it", () => {
    const i = parsePilotInput(raw());
    expect(i.profile.email).toBe("adewale@example.com");
    expect(i.profile.phone1).toBe("+2348031234567");
    expect(i.profile.previousAddress).toBe("22 Awolowo Road, Ikoyi"); // the form's "previous address" box carries the address at purchase
    expect(i.holdings.length).toBe(3);
    expect(i.variants).toEqual(["A. B. Ogunyemi", "Wale Ogunyemi"]);
  });

  it("lists everything that's missing", () => {
    const i = parsePilotInput(raw());
    expect(pilotProblems({ ...i, consent: false, signature: null })).toEqual(["your signature", "a tick to let us send your forms"]);
    expect(() => parsePilotInput(raw({ consent: false }))).toThrow(PilotValidationError);
    expect(() => parsePilotInput(raw({ payment: { method: "debit_after", acknowledged: false } }))).toThrow(/understand the fees/);
    expect(() => parsePilotInput(raw({ atPurchase: { address: "", phone: "", nextOfKinName: "", nextOfKinRelationship: "", nextOfKinPhone: "" } }))).toThrow(/next of kin/);
  });

  it("refuses registrars and companies we don't cover", () => {
    expect(() => parsePilotInput(raw({ holdings: [{ registrarId: "acme", company: "Zenith Bank Plc" }] }))).toThrow(/isn't a registrar we cover/);
    expect(() => parsePilotInput(raw({ holdings: [{ registrarId: "veritas", company: "Dangote Cement PLC" }] }))).toThrow(/isn't on that registrar/);
    expect(() => parsePilotInput(raw({ holdings: [{ registrarId: "first", company: "FBN HOLDINGS PLC" }] }))).toThrow(/isn't on that registrar/);
    expect(() => parsePilotInput(raw({ holdings: [{ registrarId: "coronation", company: "Anything I Typed" }] }))).toThrow(/isn't on that registrar/);
  });

  it("drops duplicate holdings", () => {
    const h = { registrarId: "coronation", company: "Dangote Cement PLC" };
    expect(parsePilotInput(raw({ holdings: [h, h] })).holdings.length).toBe(1);
  });
});

describe("pdfSafe", () => {
  it("keeps the letter and drops the mark on Yoruba and Igbo names", () => {
    expect(pdfSafe("Ọládẹ̀jọ Adébáyò")).toBe("Oladejo Adebayo");
    expect(pdfSafe("Nkem’s ₦200")).toBe("Nkem's N200");
  });
});

describe("submitPilot", () => {
  it("test mode: one email per registrar to the test inbox with both PDFs, then a confirmation to the shareholder", async () => {
    const mailer = new FakeMailer();
    const store = memoryStore();
    const sub = await submitPilot(parsePilotInput(raw()), { store, mailer });

    expect(sub.sendStatus).toBe("sent");
    expect(sub.ref).toMatch(/^DVD-[A-Z2-9]{6}$/);
    const reg = mailer.sent.filter((m) => m.attachments?.length);
    expect(reg.length).toBe(2);
    for (const m of reg) {
      expect(m.to).toBe("tester@example.com");
      expect(m.subject).toMatch(/^\[TEST, would go to /);
      expect(m.text).toContain("TEST MODE");
      expect(m.text).toContain("22 Awolowo Road"); // address at purchase
      expect(m.text).toContain("Funke Ogunyemi"); // next of kin
      expect(m.text).toContain("Wale Ogunyemi"); // other spellings
      expect(m.from).toBe("Dividendii <dami@dividendii.com>");
      expect(m.attachments!.map((a) => a.filename.split("-")[0])).toEqual(["Mandate", "Letter"]);
      for (const a of m.attachments!) expect((await PDFDocument.load(a.content)).getPageCount()).toBeGreaterThan(0);
    }
    const first = reg.find((m) => m.subject.includes("first") || m.text.includes("First Registrars"))!;
    expect(first.text).toContain("CADBURY NIGERIA PLC");
    expect(first.text).not.toContain("MTN Nigeria");

    const conf = mailer.sent.find((m) => !m.attachments?.length)!;
    expect(conf.to).toBe("adewale@example.com");
    expect(conf.text).toContain(sub.ref);
    expect(conf.text).toContain("₦150"); // start fee per company
    expect(conf.text).toContain("₦483.75"); // 3 companies, with VAT
    expect(conf.text).not.toContain("22154874718"); // no BVN in the shareholder's email

    const saved = await store.get(sub.id);
    expect(saved?.payment).toMatchObject({ method: "pay_ahead", amountDue: 483.75, status: "awaiting_payment" });
    expect(saved?.files.length).toBe(4);
    expect(saved?.emails.filter((e) => e.kind === "registrar").every((e) => e.wouldHaveGoneTo)).toBe(true);
  }, 60_000);

  it("live mode: goes to the registrar's own address and blind-copies the admin", async () => {
    process.env.PILOT_MODE = "live";
    const mailer = new FakeMailer();
    await submitPilot(parsePilotInput(raw({ holdings: [{ registrarId: "coronation", company: "Dangote Cement PLC" }] })), { store: memoryStore(), mailer });
    const m = mailer.sent.find((x) => x.attachments?.length)!;
    expect(m.to).toBe("customercare@coronationregistrars.com");
    expect(m.bcc).toBe("admin@example.com");
    expect(m.subject).not.toContain("TEST");
  }, 60_000);

  it("every submission owes the start fee: per company, plus VAT", async () => {
    const sub = await submitPilot(parsePilotInput(raw({ payment: { method: "debit_after", acknowledged: true } })), { store: memoryStore(), mailer: new FakeMailer() });
    expect(sub.payment).toMatchObject({ method: "pay_ahead", amountDue: 483.75, status: "awaiting_payment" });
  }, 60_000);

  it("keeps the record when a send fails, then resends only what failed", async () => {
    const mailer = new FakeMailer();
    mailer.failFor = (m) => !!m.attachments?.length && m.text.includes("First Registrars");
    const store = memoryStore();
    const sub = await submitPilot(parsePilotInput(raw()), { store, mailer });
    expect(sub.sendStatus).toBe("partial");
    expect((await store.get(sub.id))?.emails.find((e) => e.status === "failed")?.error).toContain("550");

    mailer.failFor = () => false;
    const before = mailer.sent.length;
    const again = await resendPilot(sub.id, null, { store, mailer });
    expect(again.sendStatus).toBe("sent");
    expect(mailer.sent.length - before).toBe(1); // only First went again; the shareholder already had a confirmation
    await expect(resendPilot(sub.id, null, { store, mailer })).rejects.toThrow(/Every email went through/);
  }, 60_000);

  it("fills forms for names with Yoruba marks without crashing", async () => {
    const r = raw();
    r.profile.surname = "Ọládẹ̀jọ"; r.profile.firstName = "Adébáyò";
    const sub = await submitPilot(parsePilotInput(r), { store: memoryStore(), mailer: new FakeMailer() });
    expect(sub.sendStatus).toBe("sent");
    expect(sub.profile.surname).toBe("Ọládẹ̀jọ"); // the record keeps the original
  }, 60_000);
});

describe("rate limit", () => {
  it("lets six through an hour per address, then stops", () => {
    for (let i = 0; i < 6; i++) expect(tooMany("1.2.3.4")).toBe(false);
    expect(tooMany("1.2.3.4")).toBe(true);
    expect(tooMany("5.6.7.8")).toBe(false);
  });
});

describe("step 1: lead and email check", () => {
  const start = { firstName: "Adewale", surname: "Ogunyemi", otherNames: "", variants: ["A. B. Ogunyemi"], email: "Adewale@Example.com", chn: "c001 234" };

  it("saves the lead at once, with email and CHN, before any code is entered", async () => {
    const store = memoryStore();
    const { leadId, demo } = await startLead(parseStart(start), { store, mailer: new FakeMailer() });
    expect(demo).toBe(true);
    expect(leadId).toBe(leadIdFor("adewale@example.com"));
    const lead = await store.getLead(leadId);
    expect(lead).toMatchObject({ email: "adewale@example.com", chn: "C001234", verifiedAt: null, submittedRef: null });
    expect(lead?.variants).toEqual(["A. B. Ogunyemi"]);
  });

  it("demo mode: code 123456 works, sends no email, and returns a token that names the lead", async () => {
    const store = memoryStore(), mailer = new FakeMailer();
    const { leadId } = await startLead(parseStart(start), { store, mailer });
    expect(mailer.sent.length).toBe(0);
    const { token } = await verifyLead(leadId, DEMO_CODE, { store });
    expect(verifyToken(token)).toEqual({ leadId, email: "adewale@example.com" });
    expect((await store.getLead(leadId))?.verifiedAt).toBeTruthy();
  });

  it("email mode: emails a random 6-digit code from the Vendii address", async () => {
    process.env.PILOT_OTP = "email";
    try {
      const store = memoryStore(), mailer = new FakeMailer();
      const { leadId, demo } = await startLead(parseStart(start), { store, mailer });
      expect(demo).toBe(false);
      const code = /code is (\d{6})/.exec(mailer.sent[0].text)![1];
      expect(mailer.sent[0].to).toBe("adewale@example.com");
      await expect(verifyLead(leadId, code === "000000" ? "111111" : "000000", { store })).rejects.toThrow(/right code/);
      await verifyLead(leadId, code, { store });
    } finally { delete process.env.PILOT_OTP; }
  });

  it("locks after five wrong codes and rejects expired ones", async () => {
    const store = memoryStore();
    const { leadId } = await startLead(parseStart(start), { store, mailer: new FakeMailer() });
    for (let i = 0; i < 5; i++) await expect(verifyLead(leadId, "999999", { store })).rejects.toThrow(/right code/);
    await expect(verifyLead(leadId, DEMO_CODE, { store })).rejects.toThrow(/Too many/);
    const again = await startLead(parseStart(start), { store, mailer: new FakeMailer() });
    await expect(verifyLead(again.leadId, DEMO_CODE, { store, now: () => new Date(Date.now() + 20 * 60_000) })).rejects.toThrow(/expired/);
  });

  it("tokens can't be forged, altered or reused after they expire", () => {
    const t = signToken("lead1", "a@b.co");
    expect(verifyToken(t)).toEqual({ leadId: "lead1", email: "a@b.co" });
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ l: "lead2", e: "x@y.co", x: Date.now() + 1e9 })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`)).toBe(null);
    expect(verifyToken(`${payload}.AAAA`)).toBe(null);
    expect(verifyToken(t, Date.now() + 4 * 60 * 60_000)).toBe(null);
    expect(verifyToken("nope")).toBe(null);
  });

  it("refuses a start with no name or a bad email", () => {
    expect(() => parseStart({ ...start, email: "nope" })).toThrow(/valid email/);
    expect(() => parseStart({ ...start, firstName: "" })).toThrow(/first name/);
  });

  it("a submission marks its lead as sent", async () => {
    const store = memoryStore(), mailer = new FakeMailer();
    const { leadId } = await startLead(parseStart(start), { store, mailer });
    const sub = await submitPilot(parsePilotInput(raw()), { store, mailer, leadId });
    expect(sub.leadId).toBe(leadId);
    expect((await store.getLead(leadId))?.submittedRef).toBe(sub.ref);
  }, 60_000);
});


describe("instant submit, then send", () => {
  it("createPilot saves and sends nothing; dispatchPilot sends once, all registrars together", async () => {
    const store = memoryStore(), mailer = new FakeMailer();
    const sub = await createPilot(parsePilotInput(raw()), { store, mailer });
    expect(sub.sendStatus).toBe("queued");
    expect(mailer.sent.length).toBe(0);
    expect((await store.get(sub.id))?.files.length).toBe(4);

    const done = await dispatchPilot(sub.id, { store, mailer });
    expect(done.sendStatus).toBe("sent");
    expect(mailer.sent.length).toBe(3); // two registrars and the confirmation
    await dispatchPilot(sub.id, { store, mailer });
    expect(mailer.sent.length).toBe(3); // a second call does not send again
  }, 60_000);

  it("a queued submission can be sent from the admin page (resend), and chasing needs a first send", async () => {
    const store = memoryStore(), mailer = new FakeMailer();
    const sub = await createPilot(parsePilotInput(raw()), { store, mailer });
    await expect(chasePilot(sub.id, "first", "", { store, mailer })).rejects.toThrow(/hasn't gone yet/);
    const sent = await resendPilot(sub.id, null, { store, mailer });
    expect(sent.sendStatus).toBe("sent");
  }, 60_000);
});

describe("chase", () => {
  it("emails one registrar again with both PDFs, the company count and the staff line", async () => {
    const store = memoryStore(), mailer = new FakeMailer();
    const sub = await submitPilot(parsePilotInput(raw()), { store, mailer });
    const before = mailer.sent.length;
    const after = await chasePilot(sub.id, "first", "The shareholder has called twice.", { store, mailer });
    expect(mailer.sent.length - before).toBe(1);
    const m = mailer.sent[mailer.sent.length - 1];
    expect(m.subject).toMatch(/Follow-up/);
    const nFirst = sub.holdings.filter((h) => h.registrarId === "first").length;
    expect(m.text).toContain(`Holdings (${nFirst}):`);
    expect(m.text).toContain("The shareholder has called twice.");
    expect(m.text).toContain(sub.ref);
    expect(m.attachments!.length).toBe(2);
    expect(after.emails[after.emails.length - 1]).toMatchObject({ kind: "chase", registrarId: "first", status: "sent" });
    expect(after.sendStatus).toBe("sent");
    await expect(chasePilot(sub.id, "nope", "", { store, mailer })).rejects.toThrow(/isn't on this submission/);
  }, 60_000);
});

describe("bank and account number", () => {
  it("lists banks, fintechs and microfinance banks with no duplicates", () => {
    expect(BANK_GROUPS.length).toBe(4);
    for (const b of ["Access Bank", "Guaranty Trust Bank (GTBank)", "Kuda Microfinance Bank", "Moniepoint Microfinance Bank", "OPay Digital Services", "PalmPay", "LAPO Microfinance Bank"]) expect(ALL_BANKS).toContain(b);
    expect(new Set(ALL_BANKS).size).toBe(ALL_BANKS.length);
  });

  it("an account number must be exactly ten digits", () => {
    for (const acct of ["123456789", "12345678901", "12345 6789", ""]) {
      const r = raw(); r.profile.accountNumber = acct;
      expect(() => parsePilotInput(r)).toThrow(/10-digit account number/);
    }
    const ok = raw(); ok.profile.accountNumber = "0123456789";
    expect(parsePilotInput(ok).profile.accountNumber).toBe("0123456789");
  });
});

/** A tiny stand-in for Supabase: PostgREST tables, Storage objects and Auth, in memory. */
function fakeSupabase() {
  const tables = new Map<string, Map<string, Record<string, any>>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const objects = new Map<string, Buffer>();
  const seen: { path: string; auth: string | undefined }[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const u = new URL(req.url!, "http://x");
      seen.push({ path: u.pathname, auth: req.headers.authorization });
      const send = (code: number, data?: unknown, type = "application/json") => { res.writeHead(code, { "content-type": type }); res.end(data === undefined ? "" : Buffer.isBuffer(data) ? data : JSON.stringify(data)); };
      let m: RegExpMatchArray | null;
      if ((m = u.pathname.match(/^\/rest\/v1\/(\w+)$/))) {
        const t = tables.get(m[1]) ?? new Map(); tables.set(m[1], t);
        if (req.method === "POST") { const row = JSON.parse(body.toString()); t.set(row.id, row); return send(201); }
        let rows = [...t.values()];
        const id = u.searchParams.get("id"); if (id) rows = rows.filter((r) => `eq.${r.id}` === id);
        const ord = u.searchParams.get("order"); if (ord) { const [col, dir] = ord.split("."); rows.sort((a, b) => (dir === "desc" ? -1 : 1) * String(a[col]).localeCompare(String(b[col]))); }
        const lim = Number(u.searchParams.get("limit") ?? 1000);
        return send(200, rows.slice(0, lim).map((r) => ({ data: r.data })));
      }
      if (req.method === "POST" && u.pathname.startsWith("/storage/v1/object/")) { objects.set(decodeURIComponent(u.pathname.replace("/storage/v1/object/", "")), body); return send(200, { Key: "ok" }); }
      if (req.method === "GET" && u.pathname.startsWith("/storage/v1/object/authenticated/")) {
        const f = objects.get(decodeURIComponent(u.pathname.replace("/storage/v1/object/authenticated/", "")));
        return f ? send(200, f, "application/pdf") : send(404, { error: "not found" });
      }
      if (u.pathname === "/auth/v1/user") {
        const t = (req.headers.authorization ?? "").replace("Bearer ", "");
        return t === "token-admin" ? send(200, { email: "Admin@Vendii.com" }) : t === "token-other" ? send(200, { email: "someone@else.com" }) : send(401, { msg: "bad jwt" });
      }
      if (u.pathname === "/auth/v1/token") {
        const b = JSON.parse(body.toString());
        return b.password === "right" ? send(200, { access_token: "token-admin", expires_in: 3600 }) : send(400, { error: "invalid_grant" });
      }
      send(404, { error: "no route" });
    });
  });
  return { server, tables, objects, seen };
}

describe("Supabase store and staff sign-in", () => {
  const fake = fakeSupabase();
  let url = "";
  const saved = { ...process.env };
  beforeEach(async () => {
    if (!fake.server.listening) await new Promise<void>((r) => fake.server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(fake.server.address() as { port: number }).port}`;
    Object.assign(process.env, { SUPABASE_URL: url + "/", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key", PILOT_ADMIN_EMAILS: "admin@vendii.com", PILOT_STORE: "supabase" });
  });

  it("saves the record and PDFs, lists newest first, updates and reads files back", async () => {
    const store = await supabaseStore();
    const mailer = new FakeMailer();
    const a = await createPilot(parsePilotInput(raw()), { store, mailer });
    expect(fake.objects.size).toBe(4);
    expect([...fake.objects.keys()][0]).toMatch(/^pilot-submissions\/[0-9a-f]{24}\/Mandate-/);
    expect(fake.seen.every((s) => s.auth === "Bearer service-key")).toBe(true);

    const done = await dispatchPilot(a.id, { store, mailer });
    expect(done.sendStatus).toBe("sent");
    const row = fake.tables.get("pilot_submissions")!.get(a.id)!;
    expect(row).toMatchObject({ ref: a.ref, email: "adewale@example.com", send_status: "sent", mode: "test" });
    expect(row.data.emails.length).toBe(3);

    const b = await createPilot(parsePilotInput(raw()), { store, mailer });
    const list = await store.list();
    expect(list.map((x) => x.id)).toEqual([b.id, a.id]);
    const pdf = await store.readFile(a.files[0].path);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);

    await store.update(a.id, { note: "Chased Monday" });
    expect((await store.get(a.id))?.note).toBe("Chased Monday");
    expect(await store.get("missing")).toBe(null);

    await store.saveLead({ id: "l1", email: "a@b.co", firstName: "A", surname: "B", otherNames: "", variants: [], chn: "", createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z", verifiedAt: null, codeHash: null, codeExpires: null, attempts: 0, submittedRef: null });
    expect((await store.getLead("l1"))?.email).toBe("a@b.co");
    expect((await store.listLeads()).length).toBe(1);
  }, 60_000);

  it("only staff on the list get in", async () => {
    const req = (t?: string) => new Request("http://x/api", { headers: t ? { authorization: `Bearer ${t}` } : {} });
    const status = async (p: Promise<void>) => { try { await p; return 200; } catch (e) { expect(e instanceof AdminError).toBe(true); return (e as AdminError).status; } };
    expect(await status(requirePilotAdmin(req("token-admin")))).toBe(200);
    expect(await status(requirePilotAdmin(req()))).toBe(401);
    expect(await status(requirePilotAdmin(req("junk")))).toBe(401);
    expect(await status(requirePilotAdmin(req("token-other")))).toBe(403);
  });

  it("staff sign in with email and password", async () => {
    expect((await adminLogin(" Admin@vendii.com ", "right")).token).toBe("token-admin");
    const code = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e) { return (e as AdminError).status; } };
    expect(await code(adminLogin("admin@vendii.com", "wrong"))).toBe(401);
    expect(await code(adminLogin("someone@else.com", "right"))).toBe(403);
    Object.assign(process.env, saved);
  });
});

describe("admin settings", () => {
  it("with nothing saved, behaves like the environment says", () => {
    const e = effectiveSettings(null);
    expect(e.mode).toBe("test");
    expect(e.senderEmail).toBe("dami@dividendii.com");
    expect(e.senderName).toBe("Dividendii");
    expect(e.testInbox).toBe("tester@example.com");
    expect(Object.keys(e.registrars).length).toBe(21);
    expect(e.registrars.veritas).toEqual({ enabled: true, email: "enquiry@veritasregistrars.com" });
    expect(e.payAheadPerCompany).toBe(150);
    expect(e.debitRatePercent).toBe(5);
  });

  it("rejects bad input in plain words and leaves other settings alone", () => {
    expect(() => parseSettingsPatch({ senderEmail: "not-an-email" })).toThrow(/sending email/);
    expect(() => parseSettingsPatch({ registrars: { veritas: { email: "nope" } } })).toThrow(/Veritas/);
    expect(() => parseSettingsPatch({ payment: { accountNumber: "123" } })).toThrow(/10 digits/);
    expect(() => parseSettingsPatch({ payAheadPerCompany: -5 })).toThrow(/pay-ahead/);
    expect(() => parseSettingsPatch({ debitRatePercent: 90 })).toThrow(/percentage/);
    expect(() => parseSettingsPatch({ brandName: "  " })).toThrow(/business name/);
    const p = parseSettingsPatch({ replyTo: "ops@vendii.ng", registrars: { ghost: { email: "x@y.com" }, veritas: { enabled: false } } });
    expect(p).toEqual({ replyTo: "ops@vendii.ng", registrars: { veritas: { enabled: false } } });
    expect(parseSettingsPatch({ senderName: 'Eve" <evil@x.com>\r\nBcc: a@b.com' }).senderName).not.toMatch(/[<>"\r\n]/);
  });

  it("a saved change is used by the very next submission: sender, brand, registrar address, price, note", async () => {
    process.env.PILOT_MODE = "test";
    const store = memoryStore();
    await store.saveSettings(mergeStored(null, parseSettingsPatch({
      mode: "live", brandName: "Vendii", senderName: "Vendii Team", senderEmail: "hello@vendii.ng", replyTo: "support@vendii.ng", adminCopy: "boss@vendii.ng",
      registrarNote: "Please confirm receipt.", payAheadPerCompany: 500,
      registrars: { centurion: { email: "customercare@centurionregistrars.com" } },
      payment: { bank: "GTBank", accountName: "Vendii Ltd", accountNumber: "0123456789" },
    })));
    const mailer = new FakeMailer();
    const holdings = [{ registrarId: "centurion", company: companiesFor("centurion")[0].company }, { registrarId: "veritas", company: companiesFor("veritas")[0].company }];
    const sub = await submitPilot(parsePilotInput(raw({ holdings })), { store, mailer });
    void leadIdFor;
    expect(sub.mode).toBe("live");
    expect(sub.payment).toMatchObject({ method: "pay_ahead", amountDue: 1075 }); // 2 companies x 500 + VAT
    const reg = mailer.sent.filter((m) => m.attachments?.length);
    expect(reg.map((m) => m.to).sort()).toEqual(["customercare@centurionregistrars.com", "enquiry@veritasregistrars.com"]);
    for (const m of reg) {
      expect(m.from).toBe("Vendii Team <hello@vendii.ng>");
      expect(m.replyTo).toBe("support@vendii.ng");
      expect(m.bcc).toBe("boss@vendii.ng");
      expect(m.text).toContain("Vendii is sending this on behalf of");
      expect(m.text).toContain("Please confirm receipt.");
      expect(m.text).not.toContain("Dividendi");
    }
    const conf = mailer.sent.find((m) => !m.attachments?.length)!;
    expect(conf.text).toContain("₦500");
  }, 60_000);

  it("switching a registrar off refuses it, and pausing is reported to the form", () => {
    const e = effectiveSettings({ registrars: { veritas: { enabled: false } }, acceptingSubmissions: false });
    expect(publicConfig(e).registrars.some((r) => r.id === "veritas")).toBe(false);
    expect(publicConfig(e).open).toBe(false);
    expect(() => parsePilotInput(raw({ holdings: [{ registrarId: "veritas", company: companiesFor("veritas")[0].company }] }), { isOpen: (id) => e.registrars[id].enabled }))
      .toThrow(/isn't taking submissions/);
  });

  it("renaming the business renames the sender, unless a sender name was set on purpose", () => {
    expect(effectiveSettings({ brandName: "Vendii" }).senderName).toBe("Vendii");
    expect(effectiveSettings({ brandName: "Vendii", senderName: "Vendii Team" }).senderName).toBe("Vendii Team");
  });

  it("the form's own address is used again when an admin clears the box", () => {
    const e = effectiveSettings({ registrars: { centurion: { email: "" } } });
    expect(e.registrars.centurion.email).toBe(defaultSettings().registrars.centurion.email);
  });
});
