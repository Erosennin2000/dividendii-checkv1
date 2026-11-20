import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bankCodeFor, lookupAccountName, matchBank, matchBvn, monnifyMode, monnifyOn, rawAccountLookup, setMonnifyFetchForTests, suggestBanks, unmatchedBanks, type MonnifyBank } from "@/lib/pilot/monnify";

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

  it("never says 'no such account' on sandbox keys, even for a plain no-such-account reply", async () => {
    env.MONNIFY_BASE_URL = "https://sandbox.monnify.com";
    fakeNetwork({ name: () => new Response(JSON.stringify({ requestSuccessful: false, responseMessage: "Invalid account number", responseCode: "99" }), { status: 400 }) });
    expect(await lookupAccountName("Guaranty Trust Bank (GTBank)", "0123456789")).toEqual({ status: "unavailable" });
    expect(calls.some((c) => c.url.startsWith("https://sandbox.monnify.com") && c.url.includes("/account/validate"))).toBe(true);
  });

  it("does not treat 'invalid bank code', sign-in or wallet replies as a missing account", async () => {
    for (const msg of ["Invalid bank code", "Invalid credentials", "Insufficient wallet balance", "IP address not whitelisted"]) {
      fakeNetwork({ name: () => new Response(JSON.stringify({ requestSuccessful: false, responseMessage: msg, responseCode: "99" }), { status: 400 }) });
      expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "unavailable" });
    }
    fakeNetwork({ name: () => new Response(JSON.stringify({ requestSuccessful: false, responseMessage: "Unable to resolve account name", responseCode: "99" }), { status: 422 }) });
    expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "not_found" });
  });

  it("looks up a bank that is only a close match, but never lets that block anyone", async () => {
    const list: MonnifyBank[] = [...BANKS, { name: "Kuda Digital Bank", code: "090267" }];
    expect(matchBank("Kuda Microfinance Bank", list)).toMatchObject({ code: "090267", confidence: "fuzzy" });
    setMonnifyFetchForTests(async (url) => {
      if (url.endsWith("/auth/login")) return ok({ accessToken: "tok", expiresIn: 3600 });
      if (url.endsWith("/api/v1/banks")) return ok(list);
      return new Response(JSON.stringify({ requestSuccessful: false, responseMessage: "Invalid account number", responseCode: "99" }), { status: 400 });
    });
    expect(await lookupAccountName("Kuda Microfinance Bank", "0123456789")).toEqual({ status: "unavailable" });
    expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "not_found" }); // an exact match still can block
  });

  it("ignores spacing, filler words and uses known alternative names", () => {
    const list: MonnifyBank[] = [
      { name: "MintFinex Microfinance Bank", code: "1" }, { name: "9 Payment Service Bank", code: "2" }, { name: "OPay Digital Services Limited", code: "3" },
      { name: "Wema Bank", code: "035" }, { name: "Titan Trust Bank", code: "4" }, { name: "Hope PSB", code: "5" }, { name: "Paycom", code: "100004" },
    ];
    expect(bankCodeFor("Mint Finex MFB", list)).toBe("1");
    expect(bankCodeFor("9PSB (9 Payment Service Bank)", list)).toBe("2");
    expect(bankCodeFor("OPay Digital Services", list)).toBe("3");
    expect(bankCodeFor("ALAT by Wema", list)).toBe("035");
    expect(bankCodeFor("Titan Trust Bank", list)).toBe("4");
    expect(bankCodeFor("Hope PSB", list)).toBe("5");
    expect(unmatchedBanks(["Peace Microfinance Bank", "Hope PSB"], list)).toEqual(["Peace Microfinance Bank"]);
  });

  it("never picks a bank when two fit equally well", () => {
    const two: MonnifyBank[] = [{ name: "Alpha Digital Bank", code: "1" }, { name: "Alpha Services Bank", code: "2" }];
    expect(bankCodeFor("Alpha Microfinance Bank", two)).toBeNull();
  });

  it("suggests the closest names in Monnify's list for a bank it could not match", () => {
    const list: MonnifyBank[] = [{ name: "Page Financial Services", code: "7" }, { name: "Paga", code: "8" }, { name: "Zenith bank PLC", code: "057" }];
    const near = suggestBanks("Page Financials", list);
    expect(near[0]).toEqual({ name: "Page Financial Services", code: "7" });
    expect(near.some((n) => n.name.startsWith("Zenith"))).toBe(false);
  });

  it("'try one account' shows the match and what Monnify said, and never throws", async () => {
    fakeNetwork();
    const ok1 = await rawAccountLookup("Access Bank", "0123456789");
    expect(ok1).toMatchObject({ verdict: "found", name: "TOLU ADEWALE BAKARE", mode: "live", bankMatch: { code: "044", confidence: "exact" } });
    fakeNetwork({ name: () => new Response(JSON.stringify({ requestSuccessful: false, responseMessage: "Invalid account number", responseCode: "99" }), { status: 400 }) });
    expect(await rawAccountLookup("Access Bank", "0123456789")).toMatchObject({ verdict: "not_found", httpStatus: 400, monnifyMessage: "Invalid account number" });
    expect(await rawAccountLookup("Nope Bank", "0123456789")).toMatchObject({ verdict: "unavailable", bankMatch: null });
    setMonnifyFetchForTests(async () => { throw new Error("network down"); });
    expect((await rawAccountLookup("Access Bank", "0123456789")).verdict).toBe("unavailable");
    delete env.MONNIFY_API_KEY;
    expect(await rawAccountLookup("Access Bank", "0123456789")).toMatchObject({ verdict: "unavailable", mode: "off" });
  });
});
