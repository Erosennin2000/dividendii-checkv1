/**
 * Every "why we ask" pop-up on the Check pages, in one place so the words are easy to change.
 * Each entry: a short title, the reason, and (optionally) where to find the thing.
 * Keep to plain English. Do not name the payment company, the bank-check company, the regulator or any broker here
 * (a test checks that), and never promise anything the app does not do.
 */
export interface WhyText { title: string; why: string; where?: string }

export const WHY = {
  firstName: {
    title: "Your first name",
    why: "Registers hold your name exactly as it was written when you bought the shares. We start with the name on your ID, then you add other ways it may have been written.",
  },
  otherNames: {
    title: "Other names",
    why: "Many registers list a middle name, and some spell it differently or leave it out. Adding it gives the registrar one more way to find you.",
  },
  surname: {
    title: "Your surname",
    why: "Your surname is the main thing a registrar searches on, so it should match your ID.",
  },
  variants: {
    title: "Other ways your name was written",
    why: "When you bought your shares you may have written your name differently: surname first, with initials, with a maiden name, or with a spelling slip. The register keeps it exactly as you wrote it then, so a search on today's spelling can miss you. Every spelling you add is another way for the registrar to find your shares.",
    where: "An old share certificate or dividend warrant shows how your name was written.",
  },
  email: {
    title: "Your email",
    why: "We send a 6-digit code here to confirm the address is yours. We also email you a confirmation and updates, and we save your progress so you don't lose your place.",
  },
  chn: {
    title: "CHN or CSCS number",
    why: "This number links your shares to you at the CSCS, the central record of shares in Nigeria. With it on the form, the registrar can go straight to your holding instead of searching by name. If you don't have it, leave it blank.",
    where: "It is printed on a dividend warrant or your CSCS statement.",
  },
  code: {
    title: "Why we send a code",
    why: "The code stops anyone using your email address without you, and makes sure our messages reach you. It works for 15 minutes.",
  },
  search: {
    title: "Find by company name",
    why: "Many people don't know which registrar looks after their shares, and you don't need to. Type the company's name and we find its registrar from our own list.",
  },
  registrar: {
    title: "What is a registrar?",
    why: "A registrar is the company that keeps a listed company's list of shareholders and pays out its dividends. Each company uses one, and each registrar needs its own form from you.",
  },
  bank: {
    title: "Your bank",
    why: "This is where the registrar pays any dividend. It goes straight into an account in your own name. Dividendii never holds your dividend.",
  },
  bvn: {
    title: "Your BVN",
    why: "Registrars ask for your BVN on the mandate form so a dividend goes only to an account that belongs to you. Where we can, we also check that your bank account name matches your BVN record, to catch typing mistakes. A BVN only identifies you. It does not give anyone access to your money.",
    where: "Don't know it? Dial *565*0# on the phone number linked to your bank.",
  },
  account: {
    title: "Your account number",
    why: "The registrar pays your dividend into this account, so one wrong digit sends it nowhere or to someone else. We check the number with your bank and show the name it holds, so you can catch a mistake before you send.",
  },
  address: {
    title: "Your home address now",
    why: "The registrar's form asks for your current address so it can write to you and bring the register up to date.",
  },
  mobile: {
    title: "Your mobile number",
    why: "The registrar or we may need to reach you if something needs confirming. It also goes on the form.",
  },
  atPurchase: {
    title: "When you bought the shares",
    why: "The register still holds the details you gave back then, and they may differ from today's. The registrar matches you to your old record using them. Fill in what you remember and skip what you don't.",
  },
  addressThen: {
    title: "Your address at that time",
    why: "This is usually the address on your old record. Giving it back lets the registrar match you to that record.",
  },
  phoneThen: {
    title: "Your phone number at that time",
    why: "It may be the number on your old record. Skip it if you don't remember.",
  },
  kin: {
    title: "Next of kin at that time",
    why: "Registers often record a next of kin. Matching it is one more way for the registrar to confirm the record is yours. Skip what you don't remember.",
  },
  photo: {
    title: "Passport photograph",
    why: "Your photo goes in the passport box on the registrar's mandate form. Registrars will not process the form without it.",
  },
  signature: {
    title: "Your signature",
    why: "Registrars compare your signature with the specimen they hold from when you bought the shares, so sign the way you signed then. It also goes on your letter of authority.",
  },
  fee: {
    title: "Why there is a fee",
    why: "The start fee covers our work on each company, whatever the outcome. It is not a promise that money will be found. The success fee is paid only if a dividend actually reaches your account, and you pay it then.",
  },
  goAhead: {
    title: "Why we need your go-ahead",
    why: "A registrar only deals with someone you have formally authorised. This lets us complete your forms and send them for you, for the holdings you listed only. We can't sell or transfer your shares.",
  },
} satisfies Record<string, WhyText>;
export type WhyKey = keyof typeof WHY;

/** The one-line "how long and how hard" note under each step's heading, with its reason. */
export interface StepText { time: string; level: string; why: string }
export const STEP_NOTES = {
  1: { time: "About 2 minutes", level: "Easy", why: "We start with who you are so we can search the registers under every way your name may have been written, and send you a code to confirm it is really you." },
  code: { time: "Under a minute", level: "Easy", why: "A quick check that the email address is yours before we go any further." },
  2: { time: "About 2 minutes", level: "Easy", why: "Each company keeps its shareholder list with one registrar. We need to know which registrars hold your shares, so we send each of them your form." },
  3: { time: "About 3 minutes", level: "Have your BVN and bank account to hand", why: "The registrar needs these to match you to its register and to pay any dividend into your own account." },
  4: { time: "About 2 minutes", level: "Easy", why: "A registrar will only act on a form that carries your photo and your signature. This is also where you see our fee and give your go-ahead." },
} satisfies Record<string | number, StepText>;
export type StepKey = keyof typeof STEP_NOTES;
