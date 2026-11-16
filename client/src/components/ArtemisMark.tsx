/**
 * ARTEMIS AI mark: a crescent (Artemis) enclosing a leaf vein over a
 * territory contour — preservation + data. Original SVG, no third-party art.
 */
export function ArtemisMark({ className = "w-10 h-10", inverted = false }: { className?: string; inverted?: boolean }) {
  const bg = inverted ? "rgba(255,255,255,0.14)" : "#0F5132";
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="ARTEMIS AI">
      <rect width="48" height="48" rx="12" fill={bg} />
      <path d="M31.5 9.5a15 15 0 1 0 7 20.6A12 12 0 0 1 31.5 9.5Z" fill="#34D399" opacity="0.9" />
      <path d="M17 33c4-9 9-13 16-15-5 4-8 9-10 15" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M10 38c6-2 10-2 14 0s9 2 14 0" fill="none" stroke="#7DD3FC" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
