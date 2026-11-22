import { afterEach, describe, expect, it } from "vitest";
import { accountLookupOn, lookupMode, lookupProvider } from "@/lib/pilot/accountLookup";

const env = process.env as unknown as Record<string, string | undefined>;
const clear = () => { for (const k of ["PAYSTACK_SECRET_KEY", "MONNIFY_API_KEY", "MONNIFY_SECRET_KEY", "ACCOUNT_LOOKUP", "MONNIFY_BASE_URL"]) delete env[k]; };

/** The account-name lookup follows the owner's decision: Paystack by default, Monnify only when asked (or when Paystack is not set). Details are in accountLookup.test.ts. */
describe("which service looks up account names", () => {
  afterEach(clear);
  it("is off with no keys", () => { clear(); expect(lookupProvider()).toBe("off"); expect(accountLookupOn()).toBe(false); expect(lookupMode()).toBe("off"); });
  it("uses Paystack when its key is set, and calls a test key test mode", () => {
    clear(); env.PAYSTACK_SECRET_KEY = "sk_live_x"; expect(lookupProvider()).toBe("paystack"); expect(lookupMode()).toBe("live");
    env.PAYSTACK_SECRET_KEY = "sk_test_x"; expect(lookupMode()).toBe("test");
  });
  it("uses Monnify only when asked, or when there is no Paystack key", () => {
    clear(); env.PAYSTACK_SECRET_KEY = "sk_live_x"; env.MONNIFY_API_KEY = "k"; env.MONNIFY_SECRET_KEY = "s";
    expect(lookupProvider()).toBe("paystack");
    env.ACCOUNT_LOOKUP = "monnify"; expect(lookupProvider()).toBe("monnify");
    delete env.ACCOUNT_LOOKUP; delete env.PAYSTACK_SECRET_KEY; expect(lookupProvider()).toBe("monnify");
  });
});
