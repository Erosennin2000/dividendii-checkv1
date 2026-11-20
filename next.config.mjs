/**
 * Security headers, sent on every page and API reply of this app.
 *  - frame-ancestors / X-Frame-Options: nobody can put this site inside another page (stops "clickjacking").
 *  - script-src: only our own scripts run. 'unsafe-inline' is needed because Next.js writes small inline scripts into each page;
 *    everything else (other websites' scripts, eval) is blocked. A per-request nonce would remove it, at the cost of making every page dynamic.
 *  - connect-src 'self': the browser may only talk to this site's own API (Supabase, Paystack and Monnify are called from the server, never the browser).
 *  - frame-src/object-src blob:: the staff PDF preview shows a PDF held in the browser.
 *  - HSTS: browsers will only use https for this site. No includeSubDomains, so mail and api subdomains are unaffected.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The site serves this app under www.dividendii.com/check (see the main site's vercel.json).
  basePath: "/check",
  env: { NEXT_PUBLIC_BASE_PATH: "/check" },
  poweredByHeader: false,
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // The blank registrar PDFs are read from disk at request time, so ship them with the functions that fill forms.
  outputFileTracingIncludes: {
    "/api/pilot/submit": ["./lib/forms/pdf/**"],
    "/api/pilot/dispatch": ["./lib/forms/pdf/**"],
    "/api/pilot/submissions/[id]": ["./lib/forms/pdf/**"],
    "/api/pilot/submissions/[id]/file": ["./lib/forms/pdf/**"],
  },
};
export default nextConfig;
