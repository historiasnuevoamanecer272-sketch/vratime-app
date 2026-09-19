# VratiMe visual system

## Brand anchor

The circular leaf-and-arrow mark is the primary VratiMe sign. Its source is `src/assets/images/app-logo.png`; PWA icons live in `public/app-logo-*.png`; `public/favicon.svg` is the matching lightweight browser icon.

## Palette

- Forest: `#075D63` — headings and strong actions.
- Sea: `#0B8FA5` — discovery, movement and progress.
- Fresh green: `#78B97A` — reuse and completion.
- Paper/aqua surfaces — calm, high-contrast mobile backgrounds.

Warm kraft/wood can appear only as a material accent. Brown must not be used as a main interface colour.

## Illustration rules

`src/assets/visuals/v1/` contains transparent, 384px WebP illustrations for the first visual package:

- the four top-level material families: glass, textiles, paper and packaging;
- pallets as a specific packaging subcategory;
- an optimistic empty-listings state;
- a completed-handover state.

Use category illustrations only in large discovery cards, never in compact chips or map markers. Listing photos stay primary whenever a user supplied one. New illustrations must be transparent, text-free, readable at 56px, and use the sea/green palette.

## Interface rules

- Native line icons describe actions and navigation.
- Category illustrations describe materials.
- Progress uses a short visible path, not colour alone.
- Achievements use the same rounded icon tile system rather than mixed 3D badges.
- Respect `prefers-reduced-motion`; no decorative animation is required for comprehension.
