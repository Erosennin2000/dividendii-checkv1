import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountLookupOn, lookupAccountName, lookupBankCheck, lookupDetail, lookupMode, lookupProvider } from "@/lib/pilot/accountLookup";
import { clearPaystackBankCache, setPaystackFetchForTests } from "@/lib/pilot/paystack";

const BANKS = [
  { name: "Access Bank", code: "044", active: true }, { name: "Guaranty Trust Bank", code: "058", active: true },
  { name: "Zenith Bank", code: "057", active: true }, { name: "Paycom", code: "999992", active: true },
  { name: "Old Closed Bank", code: "999", active: false },
];
const env = process.env as unknown as Record<string, string | undefined>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
let calls: string[] = [];

function net(resolve: () => Response = () => json(200, { status: true, message: "Account number resolved", data: { account_number: "0123456789", account_name: "TOLU ADEWALE BAKARE" } })) {
  setPaystackFetchForTests(async (url, init) => {
    calls.push(url);
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer " + env.PAYSTACK_SECRET_KEY);
    if (url.includes("/bank/resolve")) return resolve();
    if (url.includes("/bank?")) return json(200, { status: true, message: "Banks retrieved", data: BANKS, meta: { next: null, previous: null, perPage: 100 } });
    return json(404, {});
  });
}

describe("account lookup through Paystack", () => {
  beforeEach(() => {
    calls = []; clearPaystackBankCache();
    env.PAYSTACK_SECRET_KEY = "sk_live_abc"; delete env.ACCOUNT_LOOKUP; delete env.MONNIFY_API_KEY; delete env.MONNIFY_SECRET_KEY;
  });
  afterEach(() => { setPaystackFetchForTests(null); delete env.PAYSTACK_SECRET_KEY; delete env.ACCOUNT_LOOKUP; delete env.MONNIFY_API_KEY; delete env.MONNIFY_SECRET_KEY; });

  it("picks Paystack by default, Monnify only when asked or when Paystack is not set", () => {
    expect(lookupProvider()).toBe("paystack"); expect(accountLookupOn()).toBe(true); expect(lookupMode()).toBe("live");
    env.MONNIFY_API_KEY = "k"; env.MONNIFY_SECRET_KEY = "s";
    expect(lookupProvider()).toBe("paystack");
    env.ACCOUNT_LOOKUP = "monnify"; expect(lookupProvider()).toBe("monnify");
    delete env.ACCOUNT_LOOKUP; delete env.PAYSTACK_SECRET_KEY; expect(lookupProvider()).toBe("monnify");
    delete env.MONNIFY_API_KEY; expect(lookupProvider()).toBe("off"); expect(accountLookupOn()).toBe(false); expect(lookupMode()).toBe("off");
    env.ACCOUNT_LOOKUP = "paystack"; expect(lookupProvider()).toBe("off");
    env.PAYSTACK_SECRET_KEY = "sk_test_x"; expect(lookupMode()).toBe("test");
  });

  it("finds the bank code from Paystack's own list and returns the account name", async () => {
    net();
    expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "found", name: "TOLU ADEWALE BAKARE" });
    const resolve = calls.find((c) => c.includes("/bank/resolve"))!;
    expect(resolve).toContain("bank_code=044"); expect(resolve).toContain("account_number=0123456789");
    expect(calls.find((c) => c.includes("/bank?"))).toContain("country=nigeria");
    expect((await lookupDetail("Opay Digital Services Limited (OPay)", "0123456789")).bankMatch?.code).toBe("999992");
    expect((await lookupDetail("Guaranty Trust Bank (GTBank)", "0123456789")).bankMatch?.code).toBe("058");
  });

  it("never says 'no such account': a refusal, rate limit, failure or empty answer all let the customer carry on", async () => {
    for (const [status, msg] of [[403, "Forbidden"], [429, "slow"], [401, "Invalid key"], [500, "oops"]] as const) {
      net(() => json(status, { status: false, message: msg }));
      expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "unavailable" });
    }
    setPaystackFetchForTests(async () => { throw new TypeError("network down"); });
    clearPaystackBankCache();
    expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "unavailable" });
    net(() => json(200, { status: true, message: "ok", data: {} }));
    expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "unavailable" });
  });

  it("only warns ('unconfirmed') when Paystack says it could not resolve, and only for a live key and an exact bank match", async () => {
    net(() => json(422, { status: false, message: "Could not resolve account name. Check parameters or try again." }));
    expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "unconfirmed" });
    expect(await lookupAccountName("Guaranty Trust Bank (GTBank)", "0123456789")).toEqual({ status: "unconfirmed" });
    env.PAYSTACK_SECRET_KEY = "sk_test_x"; net(() => json(422, { status: false, message: "Could not resolve account name." }));
    expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "unavailable" });
    env.PAYSTACK_SECRET_KEY = "sk_live_abc"; net(() => json(422, { status: false, message: "Something else went wrong" }));
    expect(await lookupAccountName("Access Bank", "0123456789")).toEqual({ status: "unavailable" });
  });

  it("makes no call for a bad number or a bank it cannot match, and explains why", async () => {
    net();
    expect((await lookupDetail("Access Bank", "123")).note).toMatch(/10 digits/);
    const r = await lookupDetail("Some Unknown Microfinance", "0123456789");
    expect(r.verdict).toBe("unavailable"); expect(r.note).toMatch(/not in Paystack/);
    expect(calls.some((c) => c.includes("/bank/resolve"))).toBe(false);
  });

  it("explains a test key and a 403 in plain words", async () => {
    env.PAYSTACK_SECRET_KEY = "sk_test_x";
    net(() => json(400, { status: false, message: "x" }));
    expect((await lookupDetail("Access Bank", "0123456789")).note).toMatch(/test key/i);
    env.PAYSTACK_SECRET_KEY = "sk_live_abc";
    net(() => json(403, { status: false, message: "IP not allowed" }));
    expect((await lookupDetail("Access Bank", "0123456789")).note).toMatch(/IP address/);
  });

  it("the staff check reports the bank list and which of our banks it cannot match", async () => {
    net();
    const r = await lookupBankCheck();
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.providerBanks).toBe(4); expect(r.unmatched!.length).toBeGreaterThan(0); expect(r.matched! + r.unmatched!.length).toBe(r.ours); }
    setPaystackFetchForTests(async () => json(401, { status: false, message: "Invalid key" })); clearPaystackBankCache();
    expect((await lookupBankCheck()).ok).toBe(false);
  });
});
