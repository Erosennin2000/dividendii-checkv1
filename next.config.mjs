/** @type {import('next').NextConfig} */
const nextConfig = {
  // The site serves this app under www.dividendii.com/check (see the main site's vercel.json).
  basePath: "/check",
  env: { NEXT_PUBLIC_BASE_PATH: "/check" },
  poweredByHeader: false,
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // The blank registrar PDFs are read from disk at request time, so ship them with the functions that fill forms.
    outputFileTracingIncludes: {
      "/api/pilot/submit": ["./lib/forms/pdf/**"],
      "/api/pilot/dispatch": ["./lib/forms/pdf/**"],
      "/api/pilot/submissions/[id]": ["./lib/forms/pdf/**"],
      "/api/pilot/submissions/[id]/file": ["./lib/forms/pdf/**"],
    },
  },
};
export default nextConfig;
