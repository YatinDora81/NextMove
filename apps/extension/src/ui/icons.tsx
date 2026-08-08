/**
 * ui/icons.tsx — the extension's icon set.
 *
 * WHY THIS FILE EXISTS AT ALL. Every icon in the UI used to be a Unicode glyph: `⚙` in the popup
 * header, `✕` on every close button, `▲▼` in table sort headers, `ℹ ✓ ! ×` in Notice, `✨` on the
 * in-page sparkle button. Glyphs are the wrong tool three ways. They resolve to a *font* — a
 * different one per OS, so the same button is a hairline outline on macOS, a heavy black shape on
 * Windows, and a colour emoji on some Android/ChromeOS builds. They sit on the text baseline, so
 * they never optically centre in a button and have to be nudged per-glyph. And they cannot inherit
 * `currentColor` reliably (an emoji presentation glyph ignores `color` entirely), which means the
 * one thing an icon must do in a themed UI — change with its container — is the one thing they
 * cannot do.
 *
 * No icon library, either: SEC 14.1 R-3 keeps `@repo/ui` out, and a dependency whose whole job is
 * to ship 1,500 SVGs so we can use 38 of them is not a trade this bundle makes (SEC 11).
 *
 * DRAWING RULES — hold to these when adding one, or the set stops looking like a set.
 *   · 24×24 viewBox, 22×22 live area (keep every coordinate inside 1…23 so a 2px stroke never
 *     clips at the edge).
 *   · `fill="none"`, `stroke="currentColor"`, round caps and joins.
 *   · Stroke weight 2 up to 23px, 1.5 from 24px up. A 2px stroke that looks correct at 16px reads
 *     as a marker pen at 32px; the step keeps optical weight constant.
 *   · Axis-aligned strokes land on integers so that at 16px (a 2/3 scale) they stay on or near a
 *     device pixel instead of smearing across two. Diagonals and arc endpoints are allowed
 *     fractional coordinates — they antialias regardless, and forcing them to integers distorts
 *     the geometry for no gain.
 *   · Draw for 16px first. Anything with more than ~3 internal details turns to mush at that size;
 *     that is why the gear here has six teeth rather than the conventional eight.
 */

import type { ReactElement, ReactNode, SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Rendered box in px, both axes. 16 is the UI default; 20 for section headers, 24+ for empty states. */
  size?: number;
  /**
   * Escape hatch for a *standalone* icon — one that is the only content of a button, or is itself
   * the information. Passing it flips the icon from `aria-hidden` to `role="img"` with this name.
   * Do NOT pass it next to a visible text label: the label already names the control, and a second
   * name makes screen readers say it twice.
   */
  'aria-label'?: string;
}

export type IconComponent = ((props: IconProps) => ReactElement) & { displayName: string };

/**
 * The shared primitive. Everything below is this plus a `d` attribute.
 *
 * Hidden by default is the right default: an icon nearly always sits beside text that already
 * names the thing, and an unlabelled `<svg>` in the accessibility tree is noise at best. The
 * `focusable="false"` is not redundant — SVG elements are focusable by default in some engines and
 * would otherwise add a dead tab stop between every button.
 */
function Icon({
  size = 16,
  strokeWidth,
  className,
  'aria-label': label,
  children,
  ...rest
}: IconProps & { children: ReactNode }): ReactElement {
  const labelled = typeof label === 'string' && label.length > 0;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? (size >= 24 ? 1.5 : 2)}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
      // After the spread on purpose: these three are the accessibility contract, and a stray
      // `{...props}` from a call site must not be able to unset them. `aria-label` is the
      // supported way to change the outcome.
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Bind one drawing to a named component. */
function icon(displayName: string, art: ReactNode): IconComponent {
  const Component = (props: IconProps): ReactElement => <Icon {...props}>{art}</Icon>;
  Component.displayName = displayName;
  return Component;
}

/* ------------------------------------------------------------------------------------------------
 * Brand
 * ---------------------------------------------------------------------------------------------- */

/**
 * The product mark: an N whose right stem is an arrow climbing out of the letter — "next" and
 * "move" in one figure. Explicitly not a download arrow (which is what the popup header was using
 * as a logo); this one points *up*, and the download arrow lives at `Download` where it belongs.
 */
export const NextMoveMark = icon(
  'NextMoveMark',
  <>
    <path d="M4 19V5l11 14V5" />
    <path d="m11 9 4-4 4 4" />
  </>,
);

/* ------------------------------------------------------------------------------------------------
 * Chrome — the icons that replace glyphs in the shell
 * ---------------------------------------------------------------------------------------------- */

/** Six-toothed rather than eight: at 16px the extra teeth close up into a grey ring. */
export const Settings = icon(
  'Settings',
  <>
    <path d="M9.92 2.22 14.08 2.22 14.62 6.38 15.56 6.92 19.43 5.31 21.51 8.91 18.18 11.46 18.18 12.54 21.51 15.09 19.43 18.69 15.56 17.08 14.62 17.62 14.08 21.78 9.92 21.78 9.38 17.62 8.44 17.08 4.57 18.69 2.49 15.09 5.82 12.54 5.82 11.46 2.49 8.91 4.57 5.31 8.44 6.92 9.38 6.38Z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);

export const Close = icon(
  'Close',
  <>
    <path d="m6 6 12 12" />
    <path d="m18 6-12 12" />
  </>,
);

export const ChevronUp = icon('ChevronUp', <path d="m6 15 6-6 6 6" />);
export const ChevronDown = icon('ChevronDown', <path d="m6 9 6 6 6-6" />);
export const ChevronRight = icon('ChevronRight', <path d="m9 6 6 6-6 6" />);
export const ChevronLeft = icon('ChevronLeft', <path d="m15 6-6 6 6 6" />);

export const Check = icon('Check', <path d="m4 12 5 5L20 6" />);

export const Plus = icon(
  'Plus',
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
);

export const Search = icon(
  'Search',
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-5-5" />
  </>,
);

export const ExternalLink = icon(
  'ExternalLink',
  <>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
  </>,
);

export const Copy = icon(
  'Copy',
  <>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
  </>,
);

export const Pencil = icon(
  'Pencil',
  <>
    <path d="M17 3 21 7 8 20H4v-4Z" />
    <path d="m14 6 4 4" />
  </>,
);

export const Trash = icon(
  'Trash',
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </>,
);

export const Download = icon(
  'Download',
  <>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </>,
);

export const Upload = icon(
  'Upload',
  <>
    <path d="M12 15V3" />
    <path d="m7 8 5-5 5 5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </>,
);

/**
 * A 315° arc, not the conventional two half-arrows: two heads at 16px are four pixels of noise,
 * and one unmistakable head reads as "again" just as well.
 */
export const RefreshCw = icon(
  'RefreshCw',
  <>
    <path d="M16.95 7.05A7 7 0 1 0 19 12" />
    <path d="m16 9 3 3 3-3" />
  </>,
);

/**
 * Spins by default via the `jf-spin` class in app.css, which also carries the reduced-motion
 * handling (slowed, never stopped — a frozen spinner reads as a hung UI). Passing `className`
 * replaces that, which is what the Shadow-DOM overlay must do: `app.css` does not reach inside the
 * overlay host, so an overlay caller has to supply a class its own stylesheet defines.
 */
export function Loader({ className = 'jf-spin', ...rest }: IconProps): ReactElement {
  return (
    <Icon className={className} {...rest}>
      <path d="M21 12A9 9 0 1 1 12 3" />
    </Icon>
  );
}
Loader.displayName = 'Loader';

/* ------------------------------------------------------------------------------------------------
 * Status — the Notice/Toast vocabulary
 * ---------------------------------------------------------------------------------------------- */

export const Info = icon(
  'Info',
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </>,
);

/** Stem above, dot below — the mirror of Info, so the two never read as the same icon. */
export const AlertCircle = icon(
  'AlertCircle',
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v5" />
    <path d="M12 16h.01" />
  </>,
);

export const AlertTriangle = icon(
  'AlertTriangle',
  <>
    <path d="M12 3 22 20H2Z" />
    <path d="M12 10v4" />
    <path d="M12 17h.01" />
  </>,
);

export const ShieldCheck = icon(
  'ShieldCheck',
  <>
    <path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6Z" />
    <path d="m9 12 2 2 4-4" />
  </>,
);

export const Clock = icon(
  'Clock',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l4 2" />
  </>,
);

/* ------------------------------------------------------------------------------------------------
 * Actions — fill, AI, sync
 * ---------------------------------------------------------------------------------------------- */

/** The fill action. A bolt, because filling a 40-field Workday form is the "instant" moment. */
export const Zap = icon('Zap', <path d="M14 2 4 13h7l-1 9 10-11h-7Z" />);

/**
 * AI. The concave curves are the whole icon — a four-point star with straight edges reads as a
 * compass rose, and only the caving-in makes it a sparkle.
 */
export const Sparkles = icon(
  'Sparkles',
  <>
    <path d="M12 3q1 8 9 9-8 1-9 9-1-8-9-9 8-1 9-9Z" />
    <path d="M19 3v4" />
    <path d="M17 5h4" />
  </>,
);

/** Baseline + two lobes. Flat-bottomed, so it sits level next to text rather than floating. */
export const Cloud = icon(
  'Cloud',
  <path d="M9.5 18h7a3.5 3.5 0 1 0-1.61-6.61A5.5 5.5 0 1 0 9.5 18Z" />,
);

/** Synced. The tick hangs below the cloud instead of sitting inside it — inside, at 16px, it is
 * three pixels wide and unreadable. */
export const CloudCheck = icon(
  'CloudCheck',
  <>
    <path d="M8 14h5.5a3 3 0 1 0-1.18-5.76A4.5 4.5 0 1 0 8 14Z" />
    <path d="m13 19 2.5 2.5 5.5-5.5" />
  </>,
);

/** Sync off / offline. */
export const CloudOff = icon(
  'CloudOff',
  <>
    <path d="M9.5 18h7a3.5 3.5 0 1 0-1.61-6.61A5.5 5.5 0 1 0 9.5 18Z" />
    <path d="m3 3 18 18" />
  </>,
);

export const Key = icon(
  'Key',
  <>
    <circle cx="7" cy="12" r="4" />
    <path d="M11 12h10" />
    <path d="M17 12v4" />
    <path d="M21 12v3" />
  </>,
);

/* ------------------------------------------------------------------------------------------------
 * Profile — the Options panels
 * ---------------------------------------------------------------------------------------------- */

export const User = icon(
  'User',
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
  </>,
);

export const Users = icon(
  'Users',
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
    <path d="M15 4.6a3.5 3.5 0 0 1 0 6.8" />
    <path d="M17 14a5 5 0 0 1 5 5v1" />
  </>,
);

export const Briefcase = icon(
  'Briefcase',
  <>
    <rect x="2" y="7" width="20" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M2 13h20" />
  </>,
);

export const GraduationCap = icon(
  'GraduationCap',
  <>
    <path d="M2 9 12 4 22 9 12 14Z" />
    <path d="M6 11v4c0 1.3 2.7 2.5 6 2.5s6-1.2 6-2.5v-4" />
    <path d="M22 9v5" />
  </>,
);

/** The chain-link form, not the interlocked-rings one: two arcs and a bar survive 16px, four
 * overlapping arcs do not. */
export const Link = icon(
  'Link',
  <>
    <path d="M9 17H7a5 5 0 0 1 0-10h2" />
    <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
    <path d="M8 12h8" />
  </>,
);

export const FileText = icon(
  'FileText',
  <>
    <path d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7Z" />
    <path d="M14 3v4h4" />
    <path d="M9 9h2" />
    <path d="M9 13h6" />
    <path d="M9 17h6" />
  </>,
);

export const MessageSquare = icon(
  'MessageSquare',
  <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" />,
);

/* ------------------------------------------------------------------------------------------------
 * Theme — for the toggle the `[data-theme]` hooks in app.css exist to serve
 * ---------------------------------------------------------------------------------------------- */

export const Sun = icon(
  'Sun',
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v3" />
    <path d="M12 19v3" />
    <path d="M2 12h3" />
    <path d="M19 12h3" />
    <path d="m4.93 4.93 2.12 2.12" />
    <path d="m16.95 16.95 2.12 2.12" />
    <path d="m4.93 19.07 2.12-2.12" />
    <path d="m16.95 7.05 2.12-2.12" />
  </>,
);

export const Moon = icon(
  'Moon',
  <path d="M10.22 3.18A9 9 0 1 0 20.82 13.78 8 8 0 0 1 10.22 3.18Z" />,
);
