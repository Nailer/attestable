/**
 * The Attestable mark.
 *
 * A monogram A whose crossbar is a separate, brighter element that spans — and
 * slightly overhangs — the two legs. The legs are the two chains: evidence
 * originates on one, settlement happens on the other. The crossbar is the proof
 * that bridges them, which is the only reason the two halves form one letter.
 *
 * It sits on its own ground rather than borrowing the page's. The previous mark
 * painted a stroke in var(--bg), so it only resolved correctly on a surface it
 * happened to match — it broke anywhere else it was placed.
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
        <linearGradient id="attestable-ground" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#1b2740" />
          <stop offset="1" stopColor="#0d1421" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="15" fill="url(#attestable-ground)" />

      {/* the two chains */}
      <path
        d="M17 49 L32 16 L47 49"
        fill="none"
        stroke="#ffffff"
        strokeWidth="6.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* the proof that bridges them */}
      <path d="M20.5 38.5 H43.5" fill="none" stroke="#4a9eff" strokeWidth="6.2" strokeLinecap="round" />
    </svg>
  );
}
