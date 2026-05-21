// Inline SVG icon set for the Operator Console.
// Ported verbatim from the design prototype so the console stays pixel-faithful
// and dependency-free (currentColor-driven, sized in px).

export type IconName =
  | "play"
  | "pause"
  | "stop"
  | "clock"
  | "cpu"
  | "alert"
  | "check"
  | "x"
  | "up"
  | "down"
  | "search"
  | "copy"
  | "file"
  | "diff"
  | "rewind"
  | "doc"
  | "user"
  | "code"
  | "refresh"
  | "tag"
  | "more"
  | "circle"
  | "send"
  | "warn"
  | "edit";

interface IconProps {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 14 }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (name) {
    case "play":
      return (
        <svg {...common}>
          <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pause":
      return (
        <svg {...common}>
          <rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none" />
          <rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none" />
        </svg>
      );
    case "stop":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" fill="currentColor" stroke="none" rx="1" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 14" />
        </svg>
      );
    case "cpu":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <line x1="2" y1="9" x2="4" y2="9" />
          <line x1="2" y1="15" x2="4" y2="15" />
          <line x1="20" y1="9" x2="22" y2="9" />
          <line x1="20" y1="15" x2="22" y2="15" />
          <line x1="9" y1="2" x2="9" y2="4" />
          <line x1="15" y1="2" x2="15" y2="4" />
          <line x1="9" y1="20" x2="9" y2="22" />
          <line x1="15" y1="20" x2="15" y2="22" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case "up":
      return (
        <svg {...common}>
          <polyline points="6 14 12 8 18 14" />
        </svg>
      );
    case "down":
      return (
        <svg {...common}>
          <polyline points="6 10 12 16 18 10" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="9" y="9" width="11" height="11" rx="1.5" />
          <path d="M5 15V5a1.5 1.5 0 0 1 1.5-1.5H15" />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="14 3 14 9 20 9" />
        </svg>
      );
    case "diff":
      return (
        <svg {...common}>
          <line x1="5" y1="6" x2="19" y2="6" />
          <line x1="5" y1="12" x2="19" y2="12" />
          <line x1="5" y1="18" x2="11" y2="18" />
        </svg>
      );
    case "rewind":
      return (
        <svg {...common}>
          <polygon points="11 5 5 12 11 19 11 5" fill="currentColor" stroke="none" />
          <polygon points="20 5 14 12 20 19 20 5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "doc":
      return (
        <svg {...common}>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="14 3 14 9 20 9" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="14" y2="17" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
        </svg>
      );
    case "code":
      return (
        <svg {...common}>
          <polyline points="8 7 3 12 8 17" />
          <polyline points="16 7 21 12 16 17" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
          <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
        </svg>
      );
    case "tag":
      return (
        <svg {...common}>
          <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="19" cy="12" r="1.5" fill="currentColor" />
        </svg>
      );
    case "circle":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      );
    case "warn":
      return (
        <svg {...common}>
          <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    default:
      return null;
  }
}
