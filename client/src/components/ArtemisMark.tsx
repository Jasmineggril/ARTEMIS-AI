/**
 * ARTEMIS AI brand mark — vector redraw of the official logo
 * (attached_assets/brand/artemis-logo-original.webp): green "A" with the forest
 * inside, satellite orbit and leaf.
 *
 * - detail="full": detailed symbol (forest, satellite) — use at 56 px and up.
 * - detail="small" (default): simplified mark (A + orbit + leaf) that stays
 *   legible down to 16 px.
 * - inverted: the mark sits on a dark background (white orbit/satellite);
 *   otherwise the light-background variant is used (deep-green orbit).
 * SVG files live in client/public/brand/ so gradients never collide.
 */
export function ArtemisMark({
  className = "w-10 h-10",
  inverted = false,
  detail = "small",
  decorative = true,
}: {
  className?: string;
  inverted?: boolean;
  detail?: "small" | "full";
  decorative?: boolean;
}) {
  const base = detail === "full" ? "/brand/artemis-symbol" : "/brand/artemis-mark-small";
  const alt = decorative ? "" : "ARTEMIS AI";
  if (inverted) {
    return <img src={`${base}-on-dark.svg`} alt={alt} className={`${className} object-contain`} draggable={false} />;
  }
  return (
    <>
      <img src={`${base}-on-light.svg`} alt={alt} className={`${className} object-contain dark:hidden`} draggable={false} />
      <img src={`${base}-on-dark.svg`} alt="" aria-hidden className={`${className} object-contain hidden dark:block`} draggable={false} />
    </>
  );
}

/** Wordmark as in the logo: "ARTEMIS" + "AI" in emerald. Real text (sharp, accessible). */
export function ArtemisWordmark({ inverted = false, className = "" }: { inverted?: boolean; className?: string }) {
  return (
    <span className={`font-display font-extrabold tracking-tight ${inverted ? "text-white" : "text-[#0B2A20] dark:text-white"} ${className}`}>
      ARTEMIS <span className={inverted ? "text-emerald-400" : "text-emerald-700 dark:text-emerald-400"}>AI</span>
    </span>
  );
}
