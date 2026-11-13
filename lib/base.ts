/** The app lives under /check on the main site. Plain fetch() and <img> do not add Next's basePath, so use this. */
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const withBase = (path: string) => BASE + path;
