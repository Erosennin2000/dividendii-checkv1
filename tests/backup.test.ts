import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as exportGet } from "@/app/api/pilot/export/route";
import { GET as keepaliveGet } from "@/app/api/pilot/keepalive/route";
import { setPassword } from "@/lib/pilot/account";
import { startLead } from "@/lib/pilot/leads";
import type { MailMessage, Mailer } from "@/lib/pilot/mail";
import { memoryStore } from "@/lib/pilot/store";
import { pdfListCsv } from "@/lib/pilot/client";

class FakeMailer implements Mailer {
  async send(_m: MailMessage) { return { messageId: "x" }; }
}

beforeEach(() => {
  const g = globalThis as { __pilotMem?: unknown; __pilotSettings?: unknown };
  delete g.__pilotMem; delete g.__pilotSettings;
  Object.assign(process.env, { PILOT_MODE: "test", PILOT_OTP: "demo", PILOT_TEST_EMAIL: "t@example.com" });
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.PILOT_STORE;
});
afterEach(() => { vi.unstubAllEnvs(); });

async function addLeads(n: number) {
  const store = memoryStore();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const { leadId } = await startLead({ firstName: `A${i}`, surname: "Ola", otherNames: "", variants: [], email: `a${i}@example.com`, chn: "" }, { store, mailer: new FakeMailer() });
    ids.push(leadId);
  }
  return { store, ids };
}
const call = (qs: string) => exportGet(new Request(`https://x/check/api/pilot/export?${qs}`));

describe("staff backup", () => {
  it("pages through a whole table, oldest first, with nothing missed or repeated", async () => {
    const { store } = await addLeads(5);
    const seen: string[] = [];
    for (let off = 0; off < 5; off += 2) seen.push(...((await store.exportPage("leads", off, 2)) as { email: string }[]).map((l) => l.email));
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(await store.exportPage("leads", 5, 2)).toEqual([]);
  });

  it("never exports code or password hashes", async () => {
    const { store } = await addLeads(1);
    await setPassword({ email: "a0@example.com", code: "123456", password: "correct horse 9" }, store);
    const body = await (await call("kind=leads&offset=0")).json();
    expect(body.rows).toHaveLength(1);
    const row = body.rows[0];
    expect(row.hasPassword).toBe(true);
    for (const k of ["codeHash", "codeExpires", "attempts", "passwordHash", "sessionVersion"]) expect(row).not.toHaveProperty(k);
    expect(JSON.stringify(body)).not.toContain("scrypt$");
    expect(body.next).toBeNull();
  });

  it("returns settings, empty tables, and refuses an unknown table", async () => {
    expect((await (await call("kind=settings")).json()).rows).toHaveLength(1);
    expect((await (await call("kind=submissions")).json()).rows).toEqual([]);
    expect((await (await call("kind=feedback")).json()).rows).toEqual([]);
    expect((await call("kind=secrets")).status).toBe(400);
  });

  it("is staff only once the app is live", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await call("kind=leads");
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain("example.com");
  });

  it("writes the PDF list as a spreadsheet, quoting awkward names", () => {
    const csv = pdfListCsv([{ reference: "R1", submissionId: "s1", name: 'Ade "AJ" Ola', email: "a@b.com", registrar: "first", kind: "mandate", filename: "m.pdf", storagePath: "s1/m.pdf" }]);
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain('"Ade ""AJ"" Ola"');
  });
});

describe("keep-alive", () => {
  it("answers ok and returns no data", async () => {
    await addLeads(1);
    const res = await keepaliveGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
