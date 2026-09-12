/**
 * The Attestable mark.
 *
 * A shield — coverage — whose check is drawn as two strokes rather than one.
 * They are the two chains: evidence originates on Ethereum, settlement happens
 * on Creditcoin, and the check is the point where one is proven to the other.
 *
 * Theme-aware: the descending stroke uses the page background so the mark reads
 * correctly in both light and dark, rather than being a dark shape that
 * disappears on a dark page.
 */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Attestable"
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      <defs>
        <linearGradient id="attestable-shield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.72" />
        </linearGradient>
      </defs>

      <path
        d="M32 4 54 12v20c0 12.5-8.5 23.5-22 28C18.5 55.5 10 44.5 10 32V12z"
        fill="url(#attestable-shield)"
      />

      {/* source chain */}
      <path
        d="M20 32.5 29 41.5"
        fill="none"
        stroke="var(--bg)"
        strokeWidth="6.5"
        strokeLinecap="round"
        opacity="0.9"
      />
      {/* settlement chain */}
      <path
        d="M29 41.5 45 24"
        fill="none"
        stroke="#ffffff"
        strokeWidth="6.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
