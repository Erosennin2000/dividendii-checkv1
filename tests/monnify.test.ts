import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bankCodeFor, lookupAccountName, matchBvn, monnifyMode, monnifyOn, setMonnifyFetchForTests, type MonnifyBank } from "@/lib/pilot/monnify";

const BANKS: MonnifyBank[] = [
  { name: "Access Bank", code: "044" }, { name: "Zenith bank PLC", code: "057" }, { name: "Guaranty Trust Bank", code: "058" },
  { name: "First Bank PLC", code: "011" }, { name: "First City Monument Bank", code: "214" }, { name: "United Bank For Africa", code: "033" },
  { name: "Stanbic IBTC Bank", code: "221" }, { name: "Wema Bank", code: "035" }, { name: "Polaris Bank", code: "076" },
];
const ok = (body: unknown) => new Response(JSON.stringify({ requestSuccessful: true, responseMessage: "success", responseCode: "0", responseBody: body }), { status: 200 });

let calls: { url: string; init?: RequestInit }[] = [];
function fakeNetwork(handlers: { bvn?: () => Response; name?: () => Response } = {}) {
  setMonnifyFetchForTests(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/api/v1/auth/login")) return ok({ accessToken: "tok", expiresIn: 3600 });
    if (url.endsWith("/api/v1/banks")) return ok(BANKS);
    if (url.includes("/account/validate")) return handlers.name ? handlers.name() : ok({ accountName: "TOLU ADEWALE BAKARE" });
    if (url.endsWith("/vas/bvn-account-match")) return handlers.bvn ? handlers.bvn() : ok({ matchStatus: "FULL_MATCH", matchPercentage: 100 });
    return new Response("{}", { status: 404 });
  });
}
const env = process.env as unknown as Record<string, string | undefined>;

describe("monnify", () => {
  beforeEach(() => { calls = []; env.MONNIFY_API_KEY = "MK_TEST_X"; env.MONNIFY_SECRET_KEY = "SECRET"; delete env.MONNIFY_BASE_URL; });
  afterEach(() => { setMonnifyFetchForTests(null); delete env.MONNIFY_API_KEY; delete env.MONNIFY_SECRET_KEY; delete env.MONNIFY_BASE_URL; });

  it("is off without both keys, live by default, sandbox when told", () => {
    delete env.MONNIFY_SECRET_KEY; expect(monnifyOn()).toBe(false); expect(monnifyMode()).toBe("off");
    env.MONNIFY_SECRET_KEY = "S"; expect(monnifyMode()).toBe("live");
    env.MONNIFY_BASE_URL = "https://sandbox.monnify.com/"; expect(monnifyMode()).toBe("sandbox");
  });

  it("matches our bank names to Monnify's codes, and says nothing when unsure", () => {
    expect(bankCodeFor("Access Bank", BANKS)).toBe("044");
    expect(bankCodeFor("Zenith Bank", BANKS)).toBe("057");
    expect(bankCodeFor("Guaranty Trust Bank (GTBank)", BANKS)).toBe("058");
    expect(bankCodeFor("First Bank of Nigeria", BANKS)).toBe("011");
    expect(bankCodeFor("First City Monument Bank (FCMB)", BANKS)).toBe("214");
    expect(bankCodeFor("United Bank for Africa (UBA)", BANKS)).toBe("033");
    expect(bankCodeFor("Stanbic IBTC Bank", BANKS)).toBe("221");
    expect(bankCodeFor("Some Unknown Microfinance", BANKS)).toBeNull();
  });

  it("looks up an account name, signing in with Basic auth and using Bearer after", async () => {
    fakeNetwork();
    expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "found", name: "TOLU ADEWALE BAKARE" });
    const login = calls.find((c) => c.url.endsWith("/auth/login"))!;
    expect((login.init!.headers as Record<string, string>).authorization).toBe("Basic " + Buffer.from("MK_TEST_X:SECRET").toString("base64"));
    expect(calls.find((c) => c.url.includes("/account/validate"))!.url).toContain("bankCode=044");
    expect(calls.find((c) => c.url.includes("/account/validate"))!.url.startsWith("https://api.monnify.com")).toBe(true);
    expect(await lookupAccountName("Access Bank", "123")).toEqual({ status: "unavailable" });
  });

  it("says not_found only for a plain no-such-account answer, and unavailable for everything else", async () => {
    const bad = (status: number, msg: string) => () => new Response(JSON.stringify({ requestSuccessful: false, responseMessage: msg, responseCode: "99" }), { status });
    fakeNetwork({ name: bad(400, "Invalid account number") });
    expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "not_found" });
    fakeNetwork({ name: bad(500, "Invalid account number") });
    expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "unavailable" });
    fakeNetwork({ name: bad(403, "IP not whitelisted") });
    expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "unavailable" });
    fakeNetwork();
    expect(await lookupAccountName("Some Unknown Microfinance", "0123456789")).toEqual({ status: "unavailable" });
  });

  it("matches a BVN and sends the right body", async () => {
    fakeNetwork();
    const r = await matchBvn("22212345678", "Access Bank", "0123456789");
    expect(r.status).toBe("match"); expect(r.percent).toBe(100);
    const sent = JSON.parse(String(calls.find((c) => c.url.endsWith("/bvn-account-match"))!.init!.body));
    expect(sent).toEqual({ bankCode: "044", accountNumber: "0123456789", bvn: "22212345678" });
  });

  it("reads partial and no match", async () => {
    fakeNetwork({ bvn: () => ok({ matchStatus: "PARTIAL_MATCH", matchPercentage: 60 }) });
    expect((await matchBvn("22212345678", "Access Bank", "0123456789")).status).toBe("partial");
    fakeNetwork({ bvn: () => ok({ matchStatus: "NO_MATCH", matchPercentage: 0 }) });
    expect((await matchBvn("22212345678", "Access Bank", "0123456789")).status).toBe("no_match");
  });

  it("never throws: an empty wallet or any failure is just 'unchecked'", async () => {
    fakeNetwork({ bvn: () => new Response(JSON.stringify({ requestSuccessful: false, responseMessage: "Insufficient wallet balance", responseCode: "99" }), { status: 400 }) });
    const r = await matchBvn("22212345678", "Access Bank", "0123456789");
    expect(r.status).toBe("unchecked"); expect(r.note).toMatch(/balance/i);
    delete env.MONNIFY_API_KEY;
    expect((await matchBvn("22212345678", "Access Bank", "0123456789")).status).toBe("unchecked");
  });

  it("skips bad input without calling Monnify", async () => {
    fakeNetwork();
    expect((await matchBvn("123", "Access Bank", "0123456789")).status).toBe("unchecked");
    expect((await matchBvn("22212345678", "Nope Bank", "0123456789")).status).toBe("unchecked");
    expect(calls.some((c) => c.url.endsWith("/bvn-account-match"))).toBe(false);
  });
});
