# projection-map

A browser-based projection mapping tool for designing and running multi-surface visual shows. No install, no build step — just Node.js for the local server.

## What it does

- **Multi-surface canvas** — draw and warp as many surfaces as you need, each an independently positioned quad
- **Per-surface content** — fill any surface with a solid color, gradient, image, video, or animated effect
- **Live output window** — open a second browser window (or put it on a projector) and it syncs in real time via BroadcastChannel
- **Corner warping** — drag each of the four corners independently to match any physical surface; corners snap to corners on adjacent surfaces for crisp edges
- **Effects library** — plasma, color wave, particles, fire, noise, grid, checkerboard, tunnel, spiral, rays, moiré, ripple, starfield, glitch, mandala, scanner, and more
- **Multi-select** — click-drag on empty canvas to marquee-select multiple surfaces, then move them together
- **Undo** — Ctrl+Z to undo accidental changes or deletions
- **Named saves** — save your project as a JSON file and reload it later; videos are embedded for portability
- **Autosave** — state is automatically saved to IndexedDB so reloading the page restores your work

## Getting started

Requires Node.js (any modern version). No npm install needed.

```bash
node server.js
```

Then open:

| Window | URL |
|--------|-----|
| Editor | http://localhost:8765 |
| Output | http://localhost:8765/output.html |

Put the **Output** window on your projector or second display. The editor and output stay in sync automatically.

## Editor overview

### Layers panel (left)
- Click a layer to select it
- Click the eye icon to toggle visibility
- Double-click the name to rename it
- Drag layers to reorder (top = front)
- `+` button adds a new surface

### Canvas (center)
- Click a surface to select it
- Drag a surface to move it
- Drag a **corner handle** to warp that corner — snaps to nearby corners on other surfaces
- Drag an **edge** to move two corners together
- Click-drag on empty space to marquee-select multiple surfaces
- Click the canvas to toggle fullscreen in the output window

### Properties panel (right)
- **Transform** — shows normalized corner coordinates; Reset to Rectangle resets the quad
- **Content** — choose what the surface shows: Color, Gradient, Image, Video, or Effect
- **Opacity / Blend** — overall surface opacity and blend mode

### Toolbar
- **Add Surface** — adds a new quad
- **Duplicate** — copies the selected surface
- **Delete** — removes the selected surface (Ctrl+Z to undo)
- **Save** — saves the project to a named JSON file
- **Load** — loads a previously saved project file
- **Snap to Grid** — toggle grid snapping for corner positions

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Ctrl+Z | Undo |
| Escape | Exit fullscreen (output window) |

## Tips

- **Corner snapping** — drag a corner close to a corner on another surface and it locks on automatically, giving you a perfectly seamless edge between panels
- **Tunnel effect** — use Center X / Center Y to move the vanishing point off-center for a parallax look across multiple surfaces
- **Video** — videos are stored in the browser's IndexedDB so they load instantly on refresh; they're also embedded in saved project files for sharing
- **Output aspect ratio** — set the output resolution in the Output Settings panel to match your projector's native resolution; the output window letterboxes automatically
