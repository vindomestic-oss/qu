// Status icons as inline SVG (currentColor): iPadOS may draw ✓ ⚑ ⏳ as colour emoji that ignore the theme.

interface IconProps {
  size?: number;
}

function Svg({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg className="grade-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 12.5l5 5L20 6.5" />
    </Svg>
  );
}

export function CrossIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function FlagIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </Svg>
  );
}

export function HourglassIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" />
    </Svg>
  );
}

export function CircleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="7.5" />
    </Svg>
  );
}

export function PencilIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3" />
    </Svg>
  );
}

/** Earlier grades of the same answer (wish 7): a clock with a return arrow. */
export function HistoryIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7.5V12l3 2" />
    </Svg>
  );
}
