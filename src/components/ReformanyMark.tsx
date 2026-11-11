import type { SVGProps } from "react";

/** ReformANY's circular green mark. Transparent by default, with no tile. */
export default function ReformanyMark({
  size = 20,
  tile = false,
  ...rest
}: { size?: number; tile?: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" {...rest}>
      {tile && <rect width="32" height="32" rx="9" fill="#4E8F72" />}
      <path d="M22.4 20.6A7.8 7.8 0 1 1 23.6 14" stroke="#E1E6D9" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="23.6" cy="17.6" r="1.9" fill="#B4C99F" />
      <circle cx="16" cy="16" r="2.6" fill="#E1E6D9" />
    </svg>
  );
}
