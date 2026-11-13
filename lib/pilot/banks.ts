/**
 * Nigerian banks a shareholder might use, as the registrar's form would want them written.
 * Commercial and non-interest banks, payment service banks, then digital banks and microfinance banks.
 * Not exhaustive: the form also offers "My bank isn't listed".
 */
export const BANK_GROUPS: { group: string; banks: string[] }[] = [
  {
    group: "Commercial and non-interest banks",
    banks: [
      "Access Bank", "Citibank Nigeria", "Ecobank Nigeria", "Fidelity Bank", "First Bank of Nigeria", "First City Monument Bank (FCMB)",
      "Globus Bank", "Guaranty Trust Bank (GTBank)", "Heritage Bank", "Jaiz Bank", "Keystone Bank", "Lotus Bank", "Optimus Bank",
      "Parallex Bank", "Polaris Bank", "PremiumTrust Bank", "Providus Bank", "Signature Bank", "Stanbic IBTC Bank", "Standard Chartered Bank",
      "Sterling Bank", "SunTrust Bank", "Titan Trust Bank", "Union Bank of Nigeria", "United Bank for Africa (UBA)", "Unity Bank",
      "Wema Bank", "Zenith Bank", "Taj Bank",
    ],
  },
  { group: "Payment service banks", banks: ["9PSB (9 Payment Service Bank)", "Hope PSB", "Momo PSB", "Smartcash PSB"] },
  {
    group: "Digital banks and fintech",
    banks: [
      "Kuda Microfinance Bank", "Moniepoint Microfinance Bank", "OPay Digital Services", "PalmPay", "Carbon (Carbon Microfinance Bank)",
      "VFD Microfinance Bank (V Bank)", "Sparkle Microfinance Bank", "Mint Finex MFB", "FairMoney Microfinance Bank", "Rubies Microfinance Bank",
      "Paga", "Brass (Brass Microfinance Bank)", "Eyowo", "ALAT by Wema", "Lagos Building Investment Company",
    ],
  },
  {
    group: "Microfinance banks",
    banks: [
      "AB Microfinance Bank", "Accion Microfinance Bank", "Addosser Microfinance Bank", "Ekondo Microfinance Bank", "Fina Trust Microfinance Bank",
      "Gateway Mortgage Bank", "Infinity Microfinance Bank", "LAPO Microfinance Bank", "Mayfair Microfinance Bank", "Mkobo Microfinance Bank",
      "NPF Microfinance Bank", "Peace Microfinance Bank", "Page Financials", "Petra Microfinance Bank", "Renmoney Microfinance Bank",
      "Safe Haven Microfinance Bank", "Seed Capital Microfinance Bank", "Stellas Microfinance Bank", "TCF Microfinance Bank",
      "Trustbond Mortgage Bank", "Uhuru Microfinance Bank", "Unical Microfinance Bank", "Hasal Microfinance Bank", "Baobab Microfinance Bank",
      "Covenant Microfinance Bank", "CEMCS Microfinance Bank", "Empire Trust Microfinance Bank", "Fortis Microfinance Bank",
      "Greenwich Merchant Bank", "Imperial Homes Mortgage Bank", "Links Microfinance Bank", "Lightcity Microfinance Bank",
      "Meridian Microfinance Bank", "Nova Merchant Bank", "Rand Merchant Bank", "FSDH Merchant Bank", "Coronation Merchant Bank", "FBNQuest Merchant Bank",
    ],
  },
];
export const OTHER_BANK = "My bank isn't listed";
export const ALL_BANKS = BANK_GROUPS.flatMap((g) => g.banks);
