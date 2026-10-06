PROJECT NAME: navier_stokes

META-INSTRUCTIONS:

<Read it all before acting. Ask about anything unclear, contradictory or
 underspecified — before starting and mid-build. Ask in the question widget
 (AskUserQuestion): related questions batched, concrete options, your
 recommendation first. Plain text only if the widget isn't available.>

<Don't expand scope. Anything not listed here is a proposal, including changes
 to this file — propose it, don't do it.>

<Prefer doing over describing: run the code, write the files, test it.>

<Always in scope, no proposal needed: when it goes on GitHub, a README that is
 easy to read at a glance — a line on what it is, then clear visuals
 (screenshots, a diagram or a chart), then links. Everything else goes in
 linked files: docs/INSTRUCTIONS.md (setup, run, use),
 docs/SYSTEM-DESIGN.md (see below) and docs/FILE-STRUCTURE.md (what's where). If what you're
 building is an application rather than a script, also a small unobtrusive feedback tab, and a settings
 button or tab (⌘, on the Mac) that gathers its preferences in one place.>

<If what you're building is an application, build it as a Mac app first; the
 website comes after, as its own step.>

<Name things the way a person would say them — "Goal Tracker", not
 goal_tracker — for the app, its windows, titles, files people open, repo
 descriptions and README headings. When you create the GitHub repo, name it
 with no "_" or "-": one word or joined words, e.g. GoalTracker.>

<Always in scope: a system design doc in the codebase, docs/SYSTEM-DESIGN.md,
 kept current as the build changes. Cover the architecture (with a Mermaid
 diagram), each component's job, the main flows, where data lives, the key
 design decisions and their trade-offs, how it's tested, and known limits.>

<Finish by listing every deliverable: path, what it is, how to check it works.>

<Git rules (no Claude attribution, never commit .claude/) are in
 ~/.claude/CLAUDE.md and apply on their own — nothing to repeat here.>

<Keep the changelog at the bottom current.>

CONTEXT:

give a fullscreen demo of the navier stokes equations with graphics (like of a water flow etc) . try 5 different examples

DELIVERABLES:

website

OPEN QUESTIONS / ASSUMPTIONS:

Asked and answered (2026-10-06):
- Platform: website only. DELIVERABLES says website, so no Mac app.
- The five examples are water-focused: River & Rocks, Vortex Street, Faucet Plunge,
  Whirlpool Drain, Ripple Pool.
- Kept local: git init with README and docs, no GitHub repo created or pushed.
  If it goes on GitHub later, the repo name would be NavierStokes.
- Engine: GPU WebGL 2, plain HTML/JS, no build step.

Decided without asking:
- Treated the site as an application, so it has a settings panel (⌘, / Ctrl+,) and a
  small feedback tab. Feedback is stored in the browser and copied or downloaded by hand.
  There's no backend to send it to.
- Ripple Pool uses the shallow-water equations (Navier–Stokes averaged over depth),
  because 2D incompressible flow has no free surface and can't make ripples.
- Faucet Plunge is a side view through tank glass. The air above the surface and the
  falling stream are drawn, not simulated.
- Solver upgrades over the usual "stable fluids" demo, made because the self-test
  showed them to be necessary:
  - a staggered (MAC) grid
  - a multigrid pressure solver
  - 32-bit floats for velocity, pressure and pool height
- Added a ?selftest page and tests/browser.mjs (headless Chrome) for testing and
  README screenshots.
- No licence file. Proposed, not added.

CHANGELOG:

- 2026-10-06 — created
- 2026-09-15 — added meta-instruction: built-out applications include a small feedback tab
- 2026-09-15 — added meta-instruction: no "Claude" attribution in commits, PRs, or branches
- 2026-09-16 — added meta-instruction: always include a README when adding to GitHub
- 2026-09-16 — changed meta-instruction: ask clarifying questions in the question widget
- 2026-09-17 — added meta-instructions: Claude never a contributor; never commit .claude/
- 2026-09-26 — compressed the meta-instructions and every field prompt; git rules moved to the global instruction file
- 2026-09-27 — added meta-instruction: applications are built as a Mac app first, then a website
- 2026-09-28 — folded inputs, instructions, constraints, deliverables and done criteria into one free-form CONTEXT
- 2026-09-28 — changed meta-instruction: a README on GitHub always includes a visual
- 2026-09-28 — added meta-instruction: name things like a person would, never snake_case
- 2026-09-28 — changed meta-instruction: README leads with visuals; instructions live in a linked guide
- 2026-09-28 — changed meta-instruction: README is visuals and links; details in docs/INSTRUCTIONS.md and docs/FILE-STRUCTURE.md
- 2026-09-29 — changed meta-instruction: GitHub repo names have no "_" or "-"
- 2026-10-02 — added a DELIVERABLES field after CONTEXT
- 2026-10-02 — added meta-instruction: every project has a system design doc at docs/SYSTEM-DESIGN.md
- 2026-10-05 — added meta-instruction: applications include a settings button or tab
- 2026-10-06 — built: five-scene WebGL site, docs, self-test; open questions answered above
