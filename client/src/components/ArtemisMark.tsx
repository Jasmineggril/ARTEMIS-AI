/**
 * ARTEMIS AI mark: uses the official logo asset provided for the platform.
 * The image is served from /public/logo.png (Vite public dir).
 */
export function ArtemisMark({ className = "w-10 h-10", inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <img
      src="/logo.png"
      alt="ARTEMIS AI"
      className={`${className} object-contain`}
      style={inverted ? { filter: "brightness(0) invert(1)" } : undefined}
    />
  );
}