/**
 * The Dividendii logo: the gold roundel with the navy diamond, and the name in text.
 * `height` is the roundel's diameter. With `word` false, only the roundel is shown.
 */
export function Logo({ height = 24, onDark = false, word = true }: { height?: number; onDark?: boolean; word?: boolean }) {
  return (
    <span className="logo" style={{ display: "inline-flex", alignItems: "center", gap: Math.round(height * 0.32) }}>
      <svg width={height} height={height} viewBox="0 0 30 30" role="img" aria-label="Dividendii" style={{ flex: "none" }}>
        <circle cx="15" cy="15" r="15" fill="#C59F56" />
        <path d="M15 5 L19 15 L15 25 L11 15 Z" fill="#17375A" />
        <circle cx="15" cy="15" r="2" fill="#C59F56" />
      </svg>
      {word && <span style={{ fontWeight: 700, fontSize: Math.round(height * 0.82), letterSpacing: "-0.01em", color: onDark ? "#fff" : "#17375A", lineHeight: 1 }}>Dividendii</span>}
    </span>
  );
}
