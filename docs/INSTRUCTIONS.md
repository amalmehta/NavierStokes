# Instructions

## Setup

There's nothing to install. You need a browser with WebGL 2: any recent Chrome, Edge, Safari or Firefox with hardware acceleration on.

## Run

From the project folder:

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765>. You can also double-click `index.html`, since it uses no modules or fetches.

It's live at <https://amalmehta.github.io/NavierStokes/> through GitHub Pages, served from `main` at the repo root, so every push redeploys it. Any other static host works too, since there's no build step.

## Use

| Action | Mouse / touch | Keyboard |
|---|---|---|
| Switch example | Scene bar at the bottom | `1` – `5` |
| Stir the water / make ripples | Drag (multi-touch works) | |
| Pause / play | ⏸ button | `Space` |
| Restart the scene | ↺ button | `R` |
| Show or hide the equations | ∂ button | `E` |
| Cycle the view (water → speed → vorticity → pressure) | | `V` |
| Full screen | ⛶ button | `F` |
| Settings | ⚙ button | `⌘,` (Mac) / `Ctrl+,` |
| Close a panel | × | `Esc` |

Controls fade out after a few seconds without input. Move the mouse to bring them back.

### The five examples

1. **River & Rocks.** Inflow from the left, an open outlet on the right. Rocks shed eddies and foam.
2. **Vortex Street.** Flow past a cylinder sheds alternating vortices (von Kármán street). Turn on "Show stats" to see the nominal Reynolds number change as you move the viscosity slider.
3. **Faucet Plunge.** A jet enters a glass tank from the surface. Gravity pulls the bubbly stream down and it rolls up into vortices.
4. **Whirlpool Drain.** Water spirals into a plughole and spins faster as it converges.
5. **Ripple Pool.** Shallow-water equations with raindrops. Tap to drop, drag to push water.

## Settings

All settings are saved in this browser.

| Setting | What it does |
|---|---|
| Quality | Simulation grid size: Low 128 rows, Medium 192, High 256, Ultra 384. Lower it if the frame rate drops. |
| View | Water (the pretty one), Speed, Vorticity (spin: blue clockwise, orange counter-clockwise), Pressure (height for the pool). |
| Playback speed | Simulated seconds per real second. |
| Viscosity | Multiplies each scene's tuned viscosity. Higher values give thicker, smoother flow. |
| Swirl detail | Vorticity confinement strength. 0 turns it off. |
| Pressure solver cycles | Multigrid V-cycles per frame. 2 is plenty; more is only for the self-test. |
| Rain on the pool | Random raindrops in scene 5. |
| Show equations / Show stats / Hide controls when idle | Interface toggles. |

**Restore defaults** resets everything except the current scene.

## Feedback

The small **Feedback** tab on the right edge opens a notes box. Notes are kept in this browser only. Use **Copy all** or **Download** to pass them on.

## URL options

| Option | Effect |
|---|---|
| `?scene=3` | Start on scene 3 |
| `?quality=low` | Override quality for this visit |
| `?view=2` | Start in a given view (0–3) |
| `?bare` | Hide all controls (for recording or screenshots) |
| `?warm=600` | Simulate 600 frames before the first draw |
| `?paused` | Start paused |
| `?selftest` | Run the self-test and show the report |

## Test

Start the server, then:

```bash
node tests/browser.mjs selftest
```

This prints the report and exits non-zero on failure. It needs Node 22+ and Google Chrome. Set `CHROME=/path/to/chrome` if Chrome is somewhere unusual.

```bash
node tests/browser.mjs screenshots
```

This regenerates `docs/images/scene-*.png`. Use `SCENES=2,4` to redo only some scenes.

The same check runs in any browser at <http://localhost:8765/?selftest>.

## Troubleshooting

- **"The simulation could not start"**: the GPU lacks WebGL 2 or float render targets. Enable hardware acceleration, or try another browser.
- **Low frame rate**: set Quality to Medium or Low.
- **Resizing restarts the scene**: this is expected, because the grid is rebuilt for the new shape.
