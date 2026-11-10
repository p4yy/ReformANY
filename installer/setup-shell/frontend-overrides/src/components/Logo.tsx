/** Canonical owner-provided ReformANY sage mark. No substitute SVG monogram. */
interface LogoProps { size?: number; className?: string }
export function Logo({ size = 32, className }: LogoProps) {
  return <img src="/brand.png" width={size} height={size} className={className} alt="ReformANY" draggable={false}/>;
}
