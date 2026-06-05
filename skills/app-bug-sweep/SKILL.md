---
name: app-bug-sweep
description: "Use when reviewing a built or shipped app (especially multi-platform — iOS + Android + web) for the class of latent defects that compile fine, pass unit tests, and only surface when a real user touches the UI — dead/no-op buttons, capability built on the backend but never wired to a screen, gestures declared but inert, silent data-loss footguns, and settings/data that are written-but-never-read or decoded on one platform but not another. Provides a fan-out methodology: parallel read-only scans, one per failure class, across the whole codebase, with a suppression list so each reports only net-new findings. Triggers on \"find more bugs\", \"audit the app\", \"QA pass before release\", \"why did we miss this\", \"scan for broken things\", \"check platform parity\", \"what else is broken\". Skip for greenfield design or single-file logic debugging (use a debugging skill)."
---

# app-bug-sweep

A methodology for finding the defects that *ship*. The bugs a compiler and a unit-test suite never catch are not logic errors — they're **integration gaps**: a button wired to an empty closure, a backend endpoint with no UI path, a `.swipeActions` that does nothing because it's in the wrong container, a PATCH that silently deletes siblings, a toggle that's saved but never read. They look done in code review and in a demo. A user finds them in five minutes.

This skill turns "find more bugs" into a structured fan-out instead of an ad-hoc poke-around. It pairs with the `ux-review` skill: this one hunts *broken*, that one hunts *feels-wrong*.

## When to use

- A build "works" but a quick hands-on test surfaced a pile of issues and you suspect there are more of the same kind.
- Pre- or post-release QA on a multi-platform app where iOS/Android/web have drifted.
- After catching one dead control, to find every other instance of that failure class.
- Any "why did we miss this?" moment — the answer is usually a whole class, not one bug.

## The five failure classes

Each is a known way "done" code silently isn't. Hunt each across the entire app, on every platform, confirming hits by **reading the code** — not just matching a grep marker.

### 1. Dead / no-op controls
Buttons, rows, and menu items wired to nothing or faking their work.
- Empty handlers: `{}`, `onClick = {}`, no-op lambdas, `return nil`/`emptyList()` from an action.
- Markers: `TODO`, `FIXME`, `stub`, `not supported`, `coming soon`, `placeholder`, "for now".
- Actions that log/print or dispatch a *message* instead of performing the action (e.g. a "Sign in" button that sends "Sign in." as chat text).
- Navigation that goes nowhere; a CTA whose label promises X but whose action does Y (or just dismisses).

### 2. Orphaned capability (built but disconnected)
Working capability that no UI path reaches.
- **Unused API methods**: enumerate every client API/SDK method; grep for callers; report the ones with zero.
- **Backend endpoints with no client caller** (skip admin/internal).
- **Built-but-unpresented screens/components**: a View/composable/screen defined but never instantiated or navigated to.
- **State/props set but never read.**
This class is where whole features hide — a deep-link handler with no presentation, a dashboard with its nav entry removed, a migration/import endpoint with no button.

### 3. Inert gestures & layout/keyboard traps
Interaction declared but non-functional, or functional but trapped.
- Framework gesture used in the wrong container (e.g. SwiftUI `.swipeActions`/`.onDelete` outside a `List`; a drag with no cancel/cleanup so it sticks; two long-press recognizers fighting on one view).
- Keyboard overlap: bottom-anchored inputs with no keyboard-avoidance (medium-detent sheets with text fields; edge-to-edge layouts that neutralize `adjustResize`; inputs with no `imePadding`/scroll-to-field).
- Decorative elements that look tappable but aren't (and tappable areas with no affordance).
- Scroll vs. drag/swipe gestures that fight.

### 4. Data-loss & state footguns
The scariest class — silent destruction of user data.
- **Full-replacement / delete-then-insert** mutations callable with a *partial* collection (sending one changed item deletes the rest).
- **Non-atomic multi-step** mutations (add-then-delete "move", create-then-update) with no rollback, that drop ids/state on partial failure.
- **Optimistic updates** that don't reconcile with the server and silently drop fields.
- **Swallowed errors**: `catch {}`, `try?`, `.catch { [] }`, a success toast set *before* the network confirms.
- **Handlers that ignore their id param** and operate on the wrong record.
- **Bulk/regenerate operations with no guard** for already-entered/logged data.

### 5. Dead settings, fake data & decode parity
Things that look live but aren't.
- **Dead settings**: a value written (PATCH/persist) that nothing ever reads back to change behavior. (Trace each toggle: who consumes the stored value?)
- **Wire-key mismatches**: the key written ≠ the key the backend/other clients read.
- **Fake/hardcoded data shown as real**: literal stats, "—", zeros, sample values dressed as live.
- **Null/empty with no fallback**: image loaders with no placeholder/error branch; lists that render blank instead of an empty state.
- **Decode-parity gaps**: a field the backend sends and one client uses, but another client's model silently drops (different wrong render per platform). Diff model field-sets across platforms.

## How to run it

1. **Inventory the suppression list first.** Write down every issue already known/being fixed. Each scan reports only **net-new** findings, or you drown in duplicates.
2. **Fan out one read-only agent per failure class** (not per file) across the *whole* app — they should be blind to each other so coverage doesn't collapse onto the obvious surfaces. Tell each: read-only, confirm by reading (not just grepping markers), suppress the known list, treat any **cross-platform divergence as its own finding**, and use the backend/another platform/web as the oracle for "is this supposed to work?"
3. **Scope each scan to surfaces beyond the ones already tested** — the point is to find the instances the five-minute manual test didn't reach.
4. **Synthesize**: dedupe across scans, sort by blast radius × severity, separate "fix now" from "follow-up", and call out anything that can destroy user data loudly.

## Output

Per finding: `file:line`, platform, failure class, what it claims vs. does, the exact user-visible (or data-loss) scenario, severity, and confidence. End each scan with a net-new count. The synthesis ranks everything and names the highest-leverage fixes.

## Why it works

Manual testing finds *one* instance of a class. This finds the *class*. The recurring lesson behind every "how did we miss this?" is that the app was shipped on build-success, not use-success — and the misses cluster into these five shapes. Sweeping by shape, in parallel, with a confirm-by-reading discipline, converts a vague "look for more bugs" into exhaustive, deduplicated coverage.
