# VratiMe visual system

## Brand anchor

The circular leaf-and-arrow mark is the primary VratiMe sign. Its source is `src/assets/images/app-logo.png`; PWA icons live in `public/app-logo-*.png`; `public/favicon.svg` is the matching lightweight browser icon.

## Palette

- Forest: `#075D63` — headings and strong actions.
- Sea: `#0B8FA5` — discovery, movement and progress.
- Fresh green: `#78B97A` — reuse and completion.
- Adriatic: `#176B87` — wanted listings, search and regional depth.
- Limestone: `#F4F0E7` — warm surfaces and breathing room.
- Terracotta: `#C9724A` — accepted reservation and restrained coastal accent.
- Olive: `#7C9A62` — natural secondary accent.
- Sand: `#E9C77B` — waiting and attention without alarm.
- Paper/aqua surfaces — calm, high-contrast mobile backgrounds.

Turquoise remains the brand anchor, but it must not represent every state. Warm kraft/wood can appear only as a material accent. Brown must not be used as a main interface colour.

## Montenegro identity

VratiMe should feel local without turning working screens into travel advertising. Use regional motifs on large, low-information surfaces: authentication, onboarding, page headers, support, empty and success states.

- Suitable motifs: Adriatic bays, layered limestone mountains, restrained cypress/olive greenery, pale stone and small terracotta roofs.
- Suitable code-native patterns: contour lines, gentle wave bands and mountain silhouettes at low contrast.
- Do not place scenic decoration behind dense form fields, map controls, contact details or critical actions.
- Do not use Montenegro flags, tourist slogans, identifiable private homes or photographic people as generic decoration.
- The canonical regional asset is `src/assets/visuals/v2/montenegro-adriatic-hero-v1.webp`.

## Illustration rules

`src/assets/visuals/v1/` contains transparent, 384px WebP illustrations for the first visual package:

- the four top-level material families: glass, textiles, paper and packaging;
- pallets as a specific packaging subcategory;
- an optimistic empty-listings state;
- a completed-handover state.

Use category illustrations only in large discovery cards, never in compact chips or map markers. Listing photos stay primary whenever a user supplied one. New illustrations must be transparent, text-free, readable at 56px, and use the sea/green palette.

Regional hero illustrations live in `src/assets/visuals/v2/`. They may be wider than category art, but must be responsive, decorative (`alt=""`) and must not push the primary action below the first useful viewport.

## Interface rules

- Native line icons describe actions and navigation.
- Category illustrations describe materials.
- Give, wanted, pending, reserved, completed and canceled states use separate semantic colours and icons.
- Progress uses a short visible path, not colour alone.
- Achievements use the same rounded icon tile system rather than mixed 3D badges.
- Respect `prefers-reduced-motion`; no decorative animation is required for comprehension.
- Motion is short and purposeful: marker feedback, address confirmation, card/photo entry, request confirmation, deal-stage progress and timer movement. Important confirmations use three light pulses, never continuous flashing; all of them remain open until the person closes them.
- Bottom navigation uses a distinct but accessible colour accent for each destination, while its icon and text label always remain visible.
- Follow the mappings in `ICONOGRAPHY.md`; do not use a truck to mean “search” or “ready to hand over”.
