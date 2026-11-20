import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountLookupOn, lookupAccount, lookupProviders, tryAccount } from "@/lib/pilot/accountLookup";
import { setMonnifyFetchForTests } from "@/lib/pilot/monnify";
import { clearPaystackBanksForTests, setPaystackFetchForTests } from "@/lib/pilot/paystack";
import { successFeeEmail } from "@/lib/pilot/mail";
import { defaultSettings } from "@/lib/pilot/settings";
import type { PilotSubmission } from "@/lib/pilot/types";

const env = process.env as unknown as Record<string, string | undefined>;
const PBANKS = [
  { name: "Access Bank", code: "044", active: true, currency: "NGN" }, { name: "Guaranty Trust Bank", code: "058", active: true, currency: "NGN" },
  { name: "Zenith Bank", code: "057", active: true, currency: "NGN" }, { name: "Old Closed Bank", code: "999", active: false, currency: "NGN" },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let paystackCalls: string[] = [];
function fakePaystack(resolve: () => Response = () => json({ status: true, message: "Account number resolved", data: { account_number: "0123456789", account_name: "TOLU ADEWALE BAKARE" } })) {
  setPaystackFetchForTests(async (url) => {
    paystackCalls.push(url);
    if (url.includes("/bank?")) return json({ status: true, message: "Banks retrieved", data: PBANKS });
    if (url.includes("/bank/resolve")) return resolve();
    return json({ status: false, message: "no" }, 404);
  });
}
const mok = (body: unknown) => new Response(JSON.stringify({ requestSuccessful: true, responseMessage: "success", responseCode: "0", responseBody: body }), { status: 200 });
let monnifyCalls = 0;
function fakeMonnify(validate: () => Response) {
  setMonnifyFetchForTests(async (url) => {
    monnifyCalls++;
    if (url.endsWith("/api/v1/auth/login")) return mok({ accessToken: "t", expiresIn: 3600 });
    if (url.endsWith("/api/v1/banks")) return mok([{ name: "Access Bank", code: "044" }]);
    if (url.includes("/account/validate")) return validate();
    return new Response("{}", { status: 404 });
  });
}

beforeEach(() => {
  paystackCalls = []; monnifyCalls = 0; clearPaystackBanksForTests();
  for (const k of ["PAYSTACK_SECRET_KEY", "MONNIFY_API_KEY", "MONNIFY_SECRET_KEY", "MONNIFY_BASE_URL"]) delete env[k];
});
afterEach(() => { setPaystackFetchForTests(null); setMonnifyFetchForTests(null); });

describe("account name lookup providers", () => {
  it("is off with no keys, and ignores test and sandbox keys", () => {
    expect(lookupProviders()).toEqual([]);
    env.PAYSTACK_SECRET_KEY = "sk_test_x"; env.MONNIFY_API_KEY = "k"; env.MONNIFY_SECRET_KEY = "s"; env.MONNIFY_BASE_URL = "https://sandbox.monnify.com";
    expect(lookupProviders()).toEqual([]);
    expect(accountLookupOn()).toBe(false);
  });

  it("uses live Paystack when Monnify is only sandbox, and shows the name", async () => {
    env.PAYSTACK_SECRET_KEY = "sk_live_x"; env.MONNIFY_API_KEY = "k"; env.MONNIFY_SECRET_KEY = "s"; env.MONNIFY_BASE_URL = "https://sandbox.monnify.com";
    fakePaystack();
    expect(lookupProviders()).toEqual(["paystack"]);
    const r = await lookupAccount("Guaranty Trust Bank", "0123456789");
    expect(r).toMatchObject({ verdict: "found", name: "TOLU ADEWALE BAKARE", provider: "paystack" });
    expect(paystackCalls.find((u) => u.includes("/bank/resolve"))).toContain("bank_code=058");
    expect(monnifyCalls).toBe(0);
  });

  it("only warns, never stops a customer, when Paystack can't resolve", async () => {
    env.PAYSTACK_SECRET_KEY = "sk_live_x";
    fakePaystack(() => json({ status: false, message: "Could not resolve account name. Check parameters or try again." }, 422));
    expect((await lookupAccount("Access Bank", "0123456789")).verdict).toBe("unconfirmed");
    // a close-but-not-exact bank name: we can't be sure we asked the right bank, so nothing is said at all
    expect((await lookupAccount("Zenith", "0123456789")).verdict).not.toBe("not_found");
  });

  it("says nothing when Paystack is rate-limited, down, unauthorised or the bank isn't listed", async () => {
    env.PAYSTACK_SECRET_KEY = "sk_live_x";
    for (const [status, message] of [[429, "Too many requests"], [401, "Invalid key"], [500, "Something broke"], [422, "Bank code is not supported"], [403, "Service unavailable, try again later"]] as const) {
      fakePaystack(() => json({ status: false, message }, status));
      expect((await lookupAccount("Access Bank", "0123456789")).verdict, `${status} ${message}`).toBe("unavailable");
    }
    fakePaystack();
    expect((await lookupAccount("Totally Unknown Microfinance", "0123456789")).verdict).toBe("unavailable");
    setPaystackFetchForTests(async () => { throw new Error("network down"); });
    clearPaystackBanksForTests();
    expect((await lookupAccount("Access Bank", "0123456789")).verdict).toBe("unavailable");
    expect((await lookupAccount("Access Bank", "123")).verdict).toBe("unavailable");
  });

  it("skips banks Paystack lists as closed", async () => {
    env.PAYSTACK_SECRET_KEY = "sk_live_x";
    fakePaystack();
    expect((await lookupAccount("Old Closed Bank", "0123456789")).verdict).toBe("unavailable");
  });

  it("asks live Monnify first, and falls back to Paystack when Monnify can't answer", async () => {
    env.PAYSTACK_SECRET_KEY = "sk_live_x"; env.MONNIFY_API_KEY = "k"; env.MONNIFY_SECRET_KEY = "s"; // live (no sandbox URL)
    fakePaystack();
    fakeMonnify(() => mok({ accountName: "FROM MONNIFY" }));
    expect(lookupProviders()).toEqual(["monnify", "paystack"]);
    expect(await lookupAccount("Access Bank", "0123456789")).toMatchObject({ verdict: "found", name: "FROM MONNIFY", provider: "monnify", tried: ["monnify"] });
    expect(paystackCalls).toEqual([]);
    fakeMonnify(() => new Response(JSON.stringify({ requestSuccessful: false, responseMessage: "Insufficient wallet balance", responseCode: "99" }), { status: 400 }));
    expect(await lookupAccount("Access Bank", "0123456789")).toMatchObject({ verdict: "found", name: "TOLU ADEWALE BAKARE", provider: "paystack", tried: ["monnify", "paystack"] });
  });

  it("a clear Monnify 'no such account' on live keys still stops step 3, and Paystack is not asked", async () => {
    env.PAYSTACK_SECRET_KEY = "sk_live_x"; env.MONNIFY_API_KEY = "k"; env.MONNIFY_SECRET_KEY = "s";
    fakePaystack();
    fakeMonnify(() => new Response(JSON.stringify({ requestSuccessful: false, responseMessage: "Unable to resolve account name", responseCode: "99" }), { status: 422 }));
    expect(await lookupAccount("Access Bank", "0123456789")).toMatchObject({ verdict: "not_found", provider: "monnify" });
    expect(paystackCalls).toEqual([]);
  });

  it("the staff try-box reports who answered and the raw message", async () => {
    env.PAYSTACK_SECRET_KEY = "sk_live_x";
    fakePaystack(() => json({ status: false, message: "Could not resolve account name. Check parameters or try again." }, 422));
    expect(await tryAccount("Access Bank", "0123456789")).toMatchObject({ verdict: "unconfirmed", provider: "paystack", httpStatus: 422, paystackMode: "live", tried: ["paystack"] });
  });
});

describe("success fee email", () => {
  const sub = { ref: "DVD-1", profile: { firstName: "Ade" }, holdings: [{ company: "MTN Nigeria" }] } as unknown as PilotSubmission;
  it("offers the Paystack link and, when set, the bank account to transfer to", () => {
    const s = defaultSettings();
    s.payment = { bank: "Zenith Bank", accountName: "Dividendii Limited", accountNumber: "1012345678" } as typeof s.payment;
    const m = successFeeEmail(sub, "https://x/pay?k=1", "", s);
    expect(m.text).toContain("https://x/pay?k=1");
    expect(m.text).toContain("Zenith Bank, account 1012345678");
    expect(m.html).toContain("1012345678");
    s.payment = { bank: "", accountName: "", accountNumber: "" } as typeof s.payment;
    expect(successFeeEmail(sub, "https://x/pay?k=1", "", s).text).not.toContain("bank transfer");
  });
});
