import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

export default function NotFound() {
  return (
    <>
      <SiteHeader active="none" />
      <div className="center-note">
        <div>
          <h1>That page doesn&apos;t exist</h1>
          <p>The link may be old.</p>
          <a className="btn" href="/check">Back to Check my dividends</a>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
