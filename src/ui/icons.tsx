/** Small inline icon set (decorative; always paired with visible or aria text). */
import type { ReactElement, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function icon(paths: ReactElement) {
  return function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

export const LockIcon = icon(
  <>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>,
);
export const SaveIcon = icon(
  <>
    <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
    <path d="M8 3v5h7V3M8 21v-7h8v7" />
  </>,
);
export const UndoIcon = icon(<path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />);
export const RedoIcon = icon(<path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />);
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const EditIcon = icon(<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />);
export const TrashIcon = icon(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />);
export const CloseIcon = icon(<path d="M6 6l12 12M18 6 6 18" />);
export const MenuIcon = icon(<path d="M4 6h16M4 12h16M4 18h16" />);
export const ZoomInIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
  </>,
);
export const ZoomOutIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M8 11h6" />
  </>,
);
export const FitIcon = icon(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const TargetIcon = icon(
  <>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2" />
  </>,
);
export const TreeIcon = icon(
  <>
    <rect x="9" y="3" width="6" height="5" rx="1" />
    <rect x="3" y="16" width="6" height="5" rx="1" />
    <rect x="15" y="16" width="6" height="5" rx="1" />
    <path d="M12 8v4M6 16v-4h12v4" />
  </>,
);
export const PeopleIcon = icon(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" />
  </>,
);
export const PersonIcon = icon(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </>,
);
export const ShieldIcon = icon(<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />);
export const FileIcon = icon(
  <>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </>,
);
export const PhotoIcon = icon(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="m21 16-5-5-8 8" />
  </>,
);
