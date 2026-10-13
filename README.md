# Baritone Bedrock — website

The website of [Baritone Bedrock](https://github.com/miked06/baritone-bedrock), the Baritone pathfinding bot ported to Minecraft Bedrock for Windows.

**Live:** https://miked06.github.io/bartione-bedrock-website/

## What's inside

A static site (plain HTML, CSS and JavaScript, no build step), served by GitHub Pages.

| Path | |
|---|---|
| `index.html` | The page |
| `assets/css/style.css` | Styles (dark theme in Baritone's render colors, responsive, `prefers-reduced-motion` aware) |
| `assets/js/hero.js` | The hero scene: an isometric voxel world where a bot runs A*, shows its path and walks to the goal |
| `assets/js/pathfinder.js` | The interactive pathfinder demo (A* with Baritone's costs in ticks) |
| `assets/js/main.js` | Scroll reveals, counters, the Minecraft chat demo, the gallery and lightbox |
| `assets/js/media.js` | The gallery list |
| `media/` | Gameplay videos and screenshots |

## Run it locally

Any static server works:

```bash
python -m http.server 8000
```

then open http://localhost:8000.

## Publishing

GitHub Pages serves the `main` branch from the repository root (*Settings → Pages → Deploy from a branch → `main` / `/ (root)`*). `.nojekyll` disables Jekyll processing.

## Adding gameplay media

Put the file in `media/` (H.264 MP4 at 1280×720 without audio, or JPEG), then add an entry to `assets/js/media.js`:

```js
{ type: "video", src: "media/clip.mp4", poster: "media/clip.jpg", title: "Title", cmd: "#goto ...", text: "caption" }
```

Not affiliated with Mojang Studios or Microsoft. "Minecraft" is a trademark of Mojang Synergies AB.
