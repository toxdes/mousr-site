# mousr-site

Static product site for [Mousr](https://github.com/toxdes/mousr). Plain HTML, CSS, and JavaScript, assembled by a small Bun build.

| Page | Purpose |
| --- | --- |
| `index.html` | Landing page, features, install instructions, Sway setup |
| `docs.html` | Usage, CLI and configuration reference, architecture |
| `releases.html` | Release notes, generated from Mousr's `CHANGELOG.md` |
| `demo.html` | Interactive canvas demo on an emulated Sway desktop |

## Build and preview

```sh
bun run build                          # fetch from mousr main
bun run build --source ../mousr        # use a local checkout
bun run dev                            # http://localhost:3000
```

Serve `dist/`, not the sources: they contain `@@...@@` placeholders. Fonts (Inter, Geist Mono) load from Google Fonts and fall back to system fonts offline.

## Layout

- `assets/css/site.css`: the single stylesheet: design tokens (light and dark, blue accent) and every component.
- `assets/js/core.js`: port of Mousr's grid layout, refinement lens, motion curve, and overlay renderer
  (`src/grid.rs`, `src/mode.rs`, `src/motion.rs`, `src/animation.rs`, `src/render.rs`).
- `assets/js/demo.js`: emulated desktop, input handling, and the feature-clip autoplay.
- `assets/js/demo-page.js`: demo page controls, settings, challenges, and event log.

When Mousr changes its defaults or grid algorithm, update `core.js` to match.
Grid output was checked against the Rust crate for 1920×1080, 1280×720, and 800×450 at zoom 1.0 and 4.0.

## Sync with Mousr

`build.js` reads `VERSION`, `CHANGELOG.md`, `CLI_REFERENCE.md`, and `CONFIGURATION.md` from [mousr main](https://github.com/toxdes/mousr). Edit those files there, not here.

- `VERSION` fills download links, `install`, and docs examples.
- Archive checksums come from hashing `packages.toxdes.com/releases/mousr_VERSION_{amd64,arm64}.tar.gz`. A missing archive stops the build, so publish the release before rebuilding the site.
- The two reference files replace the CLI and Configuration sections of `docs.html`. Headings shift one level and their ids get a `cli-` or `config-` prefix. Links to other repository files point at GitHub.
- `CHANGELOG.md` renders `releases.html` (parser in `releases.js`, shared with glesha-site). Headings must be `## VERSION - YYYY-MM-DD`; `## Unreleased` stays off the page. An invalid changelog stops the build.
- Leftover placeholders stop the build before `dist/` is complete.

Rebuild and deploy after each Mousr release or docs change.

## Performance

- Feature clips build when within 200px of the viewport, run only while visible, render at 30 fps, and cap pixel density at 1.5×. The interactive demo caps at 2× and 60 fps.
- Emulators skip frames when nothing has changed for 2.6 s.
- Reduced motion shows a still frame. With data saver, ≤4 GB memory, or ≤4 CPU cores, clips show a still frame and play on hover or tap.
- `assets/img/clip-poster.webp` is the clip background until the script draws. Regenerate it after visual changes to the emulated desktop: render a paused 960×540 `MousrDemo.Emulator` with `maxDpr: 1` and save `canvas.toDataURL("image/webp", 0.6)`.

