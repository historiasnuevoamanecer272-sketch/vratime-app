/*!
 * Handshake paths: https://github.com/lucide-icons/lucide/blob/main/icons/handshake.svg
 * ISC License — Copyright (c) 2026 Lucide Icons and Contributors
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
const paths = {
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  map: (
    <>
      <path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z" />
      <path d="M9 3v15" />
      <path d="M15 6v15" />
    </>
  ),
  deals: (
    <>
      <path d="M8 12h8" />
      <path d="M9 16l-3-3a3 3 0 0 1 4.2-4.2l.8.8.8-.8A3 3 0 0 1 16 13l-3 3a2.8 2.8 0 0 1-4 0z" />
      <path d="M16.5 7.5l.7-.7a3 3 0 0 1 4.2 4.2L18 14.4" />
      <path d="M5.5 7.5l-.7-.7A3 3 0 0 0 .6 11L4 14.4" />
    </>
  ),
  user: (
    <>
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h10" />
      <path d="M18 6h2" />
      <circle cx="16" cy="6" r="2" />
      <path d="M4 18h2" />
      <path d="M10 18h10" />
      <circle cx="8" cy="18" r="2" />
      <path d="M4 12h5" />
      <path d="M13 12h7" />
      <circle cx="11" cy="12" r="2" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 4c-7.5 0-13 4.8-13 11a5 5 0 0 0 5 5c6.2 0 8-7.2 8-16z" />
      <path d="M4 20c3-6 7-9 12-10" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5l7 7-7 7" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18.5 9A7 7 0 0 0 6.2 6.3L4 9" />
      <path d="M5.5 15A7 7 0 0 0 17.8 17.7L20 15" />
    </>
  ),
  chevronUp: <path d="M6 15l6-6 6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  gift: (
    <>
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="M12 8v13" />
      <path d="M3 12h18" />
      <path d="M7.5 8A2.5 2.5 0 1 1 12 6a2.5 2.5 0 1 1 4.5 2" />
    </>
  ),
  truck: (
    <>
      <path d="M3 7h11v10H3z" />
      <path d="M14 10h4l3 3v4h-7z" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h4l2-3h4l2 3h4v12H4z" />
      <circle cx="12" cy="14" r="4" />
    </>
  ),
  location: (
    <>
      <path d="M12 21s7-5.4 7-12a7 7 0 0 0-14 0c0 6.6 7 12 7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  message: (
    <>
      <path d="M21 12a8 8 0 0 1-8 8H6l-3 2 1.3-4A8 8 0 1 1 21 12z" />
    </>
  ),
  check: (
    <>
      <path d="M20 6L9 17l-5-5" />
    </>
  ),
  close: (
    <>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </>
  ),
  star: (
    <>
      <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2 7.5 14 3 9.6l6.2-.9L12 3z" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  logout: (
    <>
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M14 4h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="8" r="5" />
      <path d="M8.5 12.5L7 21l5-3 5 3-1.5-8.5" />
    </>
  ),
  install: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="3" />
      <path d="M10 18h4" />
      <path d="M12 7v7" />
      <path d="M9 11l3 3 3-3" />
    </>
  ),
  box: (
    <>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l2.2-5 4.2 10 2.1-5H21" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  handover: (
    <>
      <path d="M3 15h4l3 3h5l6-5a2 2 0 0 0-3-2l-3 2" />
      <path d="M7 15l3-5h4a2 2 0 0 1 0 4h-3" />
      <path d="M3 12v6" />
    </>
  ),
  handshake: (
    <>
      <path d="m11 17 2 2a1 1 0 1 0 3-3" />
      <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
      <path d="m21 3 1 11h-2" />
      <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
      <path d="M3 4h8" />
    </>
  ),
  mountain: (
    <>
      <path d="M3 20l6-10 3 5 3-8 6 13z" />
      <path d="M7.8 12l1.2 2 1.2-2M13.7 10l1.3 2 1.4-2" />
    </>
  ),
  waves: (
    <>
      <path d="M3 8c2 2 4 2 6 0s4-2 6 0 4 2 6 0" />
      <path d="M3 13c2 2 4 2 6 0s4-2 6 0 4 2 6 0" />
      <path d="M3 18c2 2 4 2 6 0s4-2 6 0 4 2 6 0" />
    </>
  ),
  bottle: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v4l-2 3v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V10l-2-3V3" />
      <path d="M8 13h8" />
    </>
  ),
  jar: (
    <>
      <path d="M7 4h10" />
      <path d="M6 7h12" />
      <rect x="6" y="7" width="12" height="14" rx="3" />
      <path d="M9 11h6" />
    </>
  ),
  shirt: (
    <>
      <path d="M9 4a4 4 0 0 0 6 0l5 3-3 5-2-1v10H9V11l-2 1-3-5z" />
    </>
  ),
  fabric: (
    <>
      <path d="M5 5h14v14H5z" />
      <path d="M5 10c3-2 5 2 8 0s4 1 6 0" />
      <path d="M5 15c3-2 5 2 8 0s4 1 6 0" />
    </>
  ),
  file: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v5h5" />
      <path d="M10 13h5" />
      <path d="M10 17h5" />
    </>
  ),
  eggCarton: (
    <>
      <path d="M4 10h16l-2 10H6z" />
      <path d="M6 10l2-6h8l2 6" />
      <circle cx="9" cy="14" r="2" />
      <circle cx="15" cy="14" r="2" />
    </>
  ),
  pallet: (
    <>
      <path d="M4 7h16v9H4z" />
      <path d="M8 7v9M12 7v9M16 7v9" />
      <path d="M3 19h18" />
      <path d="M6 16v3M18 16v3" />
    </>
  ),
  empty: (
    <>
      <path d="M4 7h16v11a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
      <path d="M8 7a4 4 0 0 1 8 0" />
      <path d="M9 13h6" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 5c5-3 8 3 14 0v9c-6 3-9-3-14 0" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
  collection: (
    <>
      <path d="M12 21s7-5.4 7-12a7 7 0 0 0-14 0c0 6.6 7 12 7 12z" />
      <path d="M8 10h8M8 13h8M10 7v6M14 7v6" />
    </>
  ),
};

export default function Icon({ name, size = 22, className = '', strokeWidth = 2, filled = false }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] || paths.leaf}
    </svg>
  );
}
