// Icons of the AI suggestions (wish 7, S14) as inline SVG (currentColor), like icons.tsx: iPadOS
// may draw ≈ ⚠ ⟳ as colour emoji that ignore the theme.

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={`grade-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** ≈ partly correct */
export function ApproxIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 9c2.5-2.5 5.5 2.5 8 0s5.5 2.5 8 0M4 16c2.5-2.5 5.5 2.5 8 0s5.5 2.5 8 0" />
    </Svg>
  );
}

/** ? unsure */
export function QuestionIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 9a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1.1-1.2 2v.7M12 18.5v.01" />
    </Svg>
  );
}

/** ⚠ suspicious */
export function WarningIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5l9.5 16.5h-19L12 3.5zM12 10v4.5M12 17.5v.01" />
    </Svg>
  );
}

/** ⟳ AI checking */
export function SyncIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18.5 3v4.5H14M5.5 21v-4.5H10" />
    </Svg>
  );
}

/** ! AI error */
export function AlertIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </Svg>
  );
}

/** Hidden until decided (blind mode), skipped, not checked: an eye with a slash. */
export function EyeOffIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a16 16 0 0 1-2.6 3.2M6.6 6.7C4.4 8.2 3 12 3 12s4 6 9 6c1.6 0 3-.4 4.3-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Svg>
  );
}

/** A dash: not checked, skipped. */
export function DashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 12h12" />
    </Svg>
  );
}
