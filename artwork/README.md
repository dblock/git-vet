# Svet Artwork

Svet's original crocodile mascot flips a wall switch, turning a warm light bulb on and off.

![Svet's crocodile mascot beside the Svet wordmark](social-preview.png)

## Assets

| Asset | SVG | PNG | PNG size |
| --- | --- | --- | --- |
| Full mascot, transparent | [Source](mascot.svg) | [Export](mascot.png) | 840 x 940 |
| Full-body circular badge | [Vector](mascot-badge.svg) | [Export](mascot-badge.png) | 512 x 512 |
| Circular avatar | [Vector](avatar.svg) | [Export](avatar.png) | 512 x 512 |
| Wordmark, light backgrounds | [Vector](logo.svg) | [Export](logo.png) | 760 x 250 |
| Wordmark, dark backgrounds | [Vector](logo-dark.svg) | [Export](logo-dark.png) | 760 x 250 |
| Small icon | [Vector](favicon.svg) | [Export](favicon.png) | 32 x 32 |
| Social preview | [Vector](social-preview.svg) | [Export](social-preview.png) | 1200 x 630 |

Use the full mascot when there is room for the switch, and the head with a light bulb for avatars and small icons. Keep the original proportions and leave space around the silhouette. Use the light-lettered wordmark on dark backgrounds.

The main README uses the animated SVG circular badge at 133 pixels wide, inline beneath the title. SVGs loop every four seconds, synchronizing the hand, rocker switch, bulb, and glow. They respect `prefers-reduced-motion` by showing the static on state. PNG exports show that same on state for social previews and applications without SVG animation support.

The social preview is ready for use as a repository's social image; committing it does not automatically configure GitHub's repository settings.

## Palette

| Color       | Hex       | Role                            |
| ----------- | --------- | ------------------------------- |
| Forest      | `#173D32` | Outlines and lettering          |
| Fern        | `#27824B` | Details and secondary lettering |
| Leaf        | `#57BF72` | Crocodile                       |
| Mint        | `#C5E6AE` | Avatar and accents              |
| Pale lime   | `#D9EFAC` | Belly and jaw                   |
| Paper green | `#DDEEDB` | Social preview background       |
| Warm light  | `#FFE79B` | Illuminated bulb and glow       |

## Editing and Exporting

The editable source is [mascot.svg](mascot.svg). Its `croc-head`, `light-bulb`, `croc-icon`, and `crocodile` groups supply the geometry for every variant. Shared CSS keyframes animate the switch and lighting. Layouts and lettering are defined in [render-artwork.mjs](../scripts/render-artwork.mjs); generated SVGs are self-contained and have no external image dependencies.

Install [librsvg](https://gitlab.gnome.org/GNOME/librsvg) (`rsvg-convert`) and [pngquant](https://pngquant.org/) separately. For example, on macOS:

```sh
brew install librsvg pngquant
```

From the repository root, after `npm ci`:

```sh
npm run format
npm run artwork
```

This regenerates the avatar, full-body circular badge, both wordmarks, icon, social preview, and optimized PNG exports. Lettering uses Arial with Helvetica and sans-serif fallbacks; rasterized lettering can vary with installed fonts. Review the rendered images after changing geometry or layouts.

These are optional artwork-development tools, not Svet runtime dependencies. Ordinary installation, linting, and testing do not require them. The artwork is covered by the repository's [MIT license](../LICENSE).
