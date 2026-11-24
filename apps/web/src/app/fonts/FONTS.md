# Self-hosted fonts — provenance (BUILD-001)

These font assets are vendored so the web **production build performs no
build-time Google Fonts fetch** (`next/font/google` fetches `fonts.googleapis.com`
during `next build`, which failed intermittently in CI —
`TypeError: Cannot read properties of null (reading '1')` in the Google font
loader). They are consumed via `next/font/local` in `apps/web/src/app/layout.tsx`,
preserving the prior families, CSS variables (`--font-space-grotesk`,
`--font-plex-sans`, `--font-plex-mono`), weights, and `display: swap`.

All three families are licensed under the **SIL Open Font License, Version 1.1**
(OFL-1.1), which permits bundling and redistribution with the license text and
copyright notices retained (see the `*-OFL.txt` files in this directory).

## Space Grotesk

- **Family:** Space Grotesk
- **Asset:** `SpaceGrotesk-Variable.woff2` (variable, weight axis 300–700)
- **Original filename:** `woff2/SpaceGrotesk[wght].woff2`
- **Upstream (official project):** https://github.com/floriankarsten/space-grotesk
- **Release:** tag `2.0.0` — asset `SpaceGrotesk-2.0.0.zip`
  (https://github.com/floriankarsten/space-grotesk/releases/download/2.0.0/SpaceGrotesk-2.0.0.zip)
- **License:** SIL OFL 1.1 — `SpaceGrotesk-OFL.txt` (Copyright © Florian Karsten)
- **Weights used:** declared `weight: "500 700"` (preserves prior 500/600/700);
  axis also covers 300–700. **Style:** normal. **Coverage:** Latin (+ extended).
- **SHA-256:** `8e085aa438094f11487a836652edd5c054fa6a96f63fc7c282105ee3a4b08c07`

## IBM Plex Sans

- **Family:** IBM Plex Sans
- **Assets (complete woff2):**
  - `IBMPlexSans-Regular.woff2` (400) — `78efbe80177406a1b80d5925e706e3366290bf0d5309d7b0bd2d7f0d607f3c4c`
  - `IBMPlexSans-Medium.woff2` (500) — `0497fab52b9c10f9efbec00be509b16d449a1e277098f03af929ef1e7cbddb54`
  - `IBMPlexSans-SemiBold.woff2` (600) — `0fe2655c3c88b0b4c578b0046333fde7fb60d18419b9d07b4a1e115ac893e7f6`
- **Upstream (official project):** https://github.com/IBM/plex
- **Release:** tag `@ibm/plex-sans@1.3.6` — asset `ibm-plex-sans.zip`,
  path `ibm-plex-sans/fonts/complete/woff2/`
- **License:** SIL OFL 1.1 — `IBMPlexSans-OFL.txt` (Copyright © IBM Corp. with
  Reserved Font Name "IBM Plex")
- **Weights used:** 400, 500, 600. **Style:** normal. **Coverage:** Latin (complete).

## IBM Plex Mono

- **Family:** IBM Plex Mono
- **Assets (complete woff2):**
  - `IBMPlexMono-Regular.woff2` (400) — `ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350`
  - `IBMPlexMono-Medium.woff2` (500) — `33faf307fa6031fb4062276d7320a6d632de890cbb347576fd80cfa01077bc25`
  - `IBMPlexMono-SemiBold.woff2` (600) — `6a825b4824c01cbb401e829e5a066a1818411bcb3538b5a5792c5ca9b82343c3`
- **Upstream (official project):** https://github.com/IBM/plex
- **Release:** tag `@ibm/plex-mono@2.5.0` — asset `ibm-plex-mono.zip`,
  path `ibm-plex-mono/fonts/complete/woff2/`
- **License:** SIL OFL 1.1 — `IBMPlexMono-OFL.txt` (Copyright © IBM Corp.)
- **Weights used:** 400, 500, 600. **Style:** normal. **Coverage:** Latin (complete).

## Reason for local hosting

`next/font/google` resolves the font CSS from Google at build time; a transient
null response from that service crashed the Next.js font loader and failed the
Web production build non-deterministically. Vendoring the exact OFL fonts and
loading them with `next/font/local` makes the build deterministic and
network-independent for fonts.

## Update procedure

1. Download the family's **official release archive** (links above) for the
   desired version; extract the `complete/woff2` files (IBM Plex) or the variable
   `woff2` (Space Grotesk).
2. Verify each file begins with the `wOF2` signature; record its SHA-256.
3. Replace the asset(s) here, update the version + checksum in this file, and keep
   the matching `*-OFL.txt`.
4. Run `pnpm --filter @telvyn/web build` and the visual checks; do not reintroduce
   `next/font/google` or any runtime/build-time external font request.
