---
name: ux-review
description: Use when auditing or reviewing the UX/interaction quality of a mobile (iOS/Android) or web app — checking whether screens have distinct pressed/focus/disabled states, proper empty/loading/error states, accessible touch targets, platform-native conventions (Apple HIG / Material 3), WCAG 2.2 AA contrast, honest system status feedback, and clear copy. Provides a per-screen PASS/FAIL heuristic rubric (~55 criteria across 9 sections) grounded in Nielsen's 10 heuristics, Apple Human Interface Guidelines, Material Design 3, and WCAG 2.2. Triggers on "UX review", "design review", "audit the UI", "heuristic evaluation", "does this screen feel right", "accessibility pass", "review my app's UX", "why does this feel janky". Skip for pure visual/brand image generation (use a design-generation skill) or backend/logic review.
---

# ux-review

A per-screen, PASS/FAIL-scorable rubric for auditing the **interaction quality** of a mobile or web UI — the layer that unit tests and "does it compile" never catch and that a user discovers in the first five minutes: dead-feeling buttons, missing empty/error states, mis-sized touch targets, keyboard overlap, inconsistent platform behavior, low contrast, hype-y copy.

This rubric hunts *works-but-feels-wrong*. Pair it with a functional bug sweep (see the companion `app-bug-sweep` skill) which hunts *broken*.

## When to use

- Reviewing a screen, flow, or whole app for UX quality before or after shipping.
- A build "works" but "doesn't feel good" and you need to localize why.
- Running an accessibility / platform-conventions pass.
- Standing QA gate on a multi-platform app where iOS and Android drift apart.

## How to apply

Score **one screen × one state** at a time (idle / loading / empty / error / populated). Mark each applicable criterion **PASS / FAIL / N/A** with a one-line note; for a FAIL, name the specific element and the fix. A screen passes only when all applicable criteria pass.

Sections **1–3 carry the most weight** — a FAIL there is a defect, not a nice-to-have, because they cover the states that make an app feel alive, honest, and recoverable.

For a whole-app audit, fan out one reviewer per surface cluster (e.g. home / primary-loop / settings / discovery), each scoring every screen in its cluster on **both** platforms, and treat any **iOS-vs-Android inconsistency as its own finding** — divergence is where most defects hide.

## The rubric

### 1. Affordance & microinteraction states
1.1 Every tappable element (button, pill, card, row, icon button) has a **visibly distinct pressed/active state** (state-layer ripple on Android per M3; scale/opacity/tint on iOS; `:active` on web). Holding produces immediate visual change. FAIL if pressed looks identical to idle.
1.2 Every interactive element has a **distinct focus state** separate from pressed (keyboard / D-pad / switch-control on Android & web; `:focus-visible` ring — never `outline:none` with no replacement).
1.3 Pressed/active/focus states are *more* prominent than rest, not less. Hover (where a pointer exists) is lower-emphasis than pressed.
1.4 **Disabled state is de-emphasized** (reduced opacity / desaturated) AND inert (no ripple, no navigation). A control never silently no-ops while looking enabled.
1.5 Interactive elements *look* tappable; static text/labels are not styled to look tappable. Actions use real button semantics, not tap handlers on plain containers.
1.6 Press feedback is **immediate** — fires on touch-down/contact, not only after a network round-trip. Show optimistic state on tap; reconcile after.
1.7 Selected / active toggle states (selected tab, chosen item) are distinct from both idle and pressed, and persist after the finger lifts.
1.8 Animations are **interruptible** — a new tap mid-animation responds immediately; the UI never locks the user out waiting for a transition.

### 2. Feedback & system status
2.1 The user always knows whether the app is loading, waiting, succeeded, or errored. No state where a tap appears to do nothing.
2.2 A **streaming / "working" indicator is a single anchored affordance** that crossfades between phases — not a flashing stack of per-step rows, and it must not jump layout position.
2.3 Every committed action gives confirming feedback (a save / add / toggle produces a visible state change or toast; `aria-live="polite"` on web). FAIL if the UI claims success ("Saved", "Logged") but the underlying state didn't change — cross-check against data where possible.
2.4 Haptics accompany meaningful state changes (completion, threshold cross, destructive confirm) and are used sparingly — not on every scroll tick. Honor system "reduce" settings.
2.5 Async results are announced to assistive tech; status is not conveyed by color/icon alone.
2.6 Long operations (>~1s) show progress; near-instant ones (<300ms, high confidence) show *nothing* rather than a flash of loading chrome.

### 3. Empty / loading / error states
3.1 Every list/collection screen renders a **purpose-built empty state** (icon + copy + a clear CTA to populate it), never a blank screen or broken layout for an empty array.
3.2 Empty states are **distinct per context** (empty collection vs. first-run vs. filtered-to-zero), not one generic placeholder reused everywhere.
3.3 Loading uses **content-shaped skeletons** matching the real geometry (no layout shift on data arrival) for loads of meaningful duration — not a bare centered spinner.
3.4 Error states say **what went wrong AND the next step**, never bare "An error occurred." Inline errors sit next to the offending field/item.
3.5 Every failure has a **recovery path**: a failed mutation shows a failed state ("Failed — tap to retry"), and **retry preserves the user's input**.
3.6 On a form-submit error, focus moves to the **first errored field**, visible without scroll guesswork.
3.7 Offline is surfaced as a clear, non-blocking banner; the app degrades gracefully (queues or clearly disables actions) rather than failing silently mid-action.
3.8 Loading button labels show a working state ("Saving…") and the trigger stays interactive until the request actually starts.

### 4. Navigation & information architecture
4.1 The user always knows **where they are** — current screen/section labeled, active tab/section visually marked.
4.2 **Back/dismiss is always available and predictable** on every non-root screen (iOS edge-swipe + nav back; Android system back + predictive-back not broken). No dead-end screens.
4.3 Standard system gestures are **not overridden or blocked**. Any custom gesture has a discoverable affordance and a non-gesture fallback.
4.4 Primary actions are reachable in the **thumb zone**; the most common action isn't buried in a top corner only.
4.5 Information scent: labels and CTAs predict their destination/result. No mystery-meat icons without labels for primary actions.
4.6 Modality used correctly: sheets/modals are for focused tasks and are dismissible (swipe-down + explicit close); a modal never traps the user with no exit.
4.7 The same content type opens via the **same affordance everywhere** (a row of type X always opens X the same way).

### 5. Touch targets & gestures
5.1 Tappable targets meet platform minimums: **iOS ≥44×44pt, Android ≥48×48dp** (WCAG 2.2 AA floor is 24×24px with spacing; platform minimums are stricter and win). Small glyphs still carry a full hit area.
5.2 Adjacent targets have **≥~8dp spacing** — no mis-tap clusters (e.g. confirm vs. delete crammed together).
5.3 A control's **label and the control share one hit target** (tapping a toggle's label toggles it; no dead zone).
5.4 Destructive gestures (swipe-to-delete) require a confirm step or an undo window; a single swipe never irreversibly destroys data.
5.5 Gesture actions are **discoverable** (visible affordance or revealed on partial swipe) and **duplicated in a visible menu** — never gesture-only for an essential action.
5.6 Scroll and drag/swipe don't fight; on web, `touch-action: manipulation` removes the double-tap-zoom delay.

### 6. Consistency & platform conventions
6.1 **iOS uses native controls** (`NavigationStack`, `.toolbar`, `TabView`, `.sheet`, `Menu`, `.searchable`, system alerts) so platform materials and behaviors come for free; custom material is centralized, not hand-rolled per screen.
6.2 A single design implementation is **not forked by OS version** — newer-OS affordances degrade to an equivalent layout on older OS, same components and actions.
6.3 **Android uses native Material 3** (M3 components, tonal surfaces, state-layer ripples, M3 motion) — not a clone of iOS. Edge-to-edge content respects system-bar insets (no content under status/nav bars, inputs not hidden behind the keyboard).
6.4 Destructive actions in menus/sheets are **visually marked** (destructive tint + icon) and separated from neutral actions; delete is never styled identically to a safe action.
6.5 Iconography is consistent and platform-appropriate (SF Symbols on iOS, M3 icons on Android) and adapts to text scaling and dark mode.
6.6 Safe areas / notch / home indicator / status bar respected; nothing clipped or tappable hidden under system chrome at any device size.
6.7 Dark mode supported via semantic colors that adapt automatically; no hardcoded light-only colors leak into dark mode.
6.8 One coherent visual system across splash / auth / primary surfaces on both platforms, using platform-native materials.

### 7. Accessibility
7.1 Every interactive/informative element has an **accessible label** (VoiceOver/TalkBack/`aria-label`). No control that announces as "button, button" with no name.
7.2 Text contrast meets **WCAG AA**: ≥4.5:1 normal, ≥3:1 large (≥18pt / 14pt-bold). FAIL on low-contrast gray captions/placeholders.
7.3 Non-text UI (icons, control borders, focus rings, chart strokes) meets ≥3:1 against adjacent colors (WCAG 1.4.11).
7.4 **Dynamic Type / font scaling honored** (Dynamic Type on iOS, `sp` on Android, relative units on web); layout doesn't clip/truncate/overlap at the largest accessibility text size.
7.5 **Reduce Motion honored**; nothing relies solely on motion to convey meaning.
7.6 Information is **never conveyed by color alone** (status also uses icon/text/shape).
7.7 Focus order is logical and follows reading order; assistive-tech users can reach and operate every action a sighted touch user can.
7.8 Structure semantics present (web: hierarchical headings + skip link; native: correct accessibility traits and grouping).

### 8. Content & voice
8.1 System/UI copy matches the product's defined voice and stays **consistent**. If the product voice is restrained, flag hype words and exclamation-heavy tone; if it's energetic, flag flatness. Pick a voice and hold it.
8.2 Microcopy is **specific and actionable**, not generic ("No items yet — add one to get started." not "Nothing here").
8.3 Error/empty/confirmation copy tells the user what to do next, in plain language — no jargon or raw error codes surfaced to users.
8.4 Terminology is **consistent app-wide** (one concept = one word, matching the rest of the product).
8.5 No AI-attribution text ("Generated by…", "Made with…") anywhere in UI copy, share assets, or generated content.

### 9. Performance & perceived speed
9.1 First meaningful paint is fast; the screen shows skeleton/structure quickly rather than a blank frame.
9.2 No layout shift when real data replaces skeletons/placeholders.
9.3 Animations are compositor-friendly (transform/opacity; never `transition: all`); scrolling stays at 60fps on long lists.
9.4 Optimistic UI for common mutations: the UI updates instantly and reconciles/reverts on the server response rather than blocking on the round-trip.
9.5 No spinner for sub-300ms operations; no indefinite spinner with no timeout/fallback for operations that can fail (streaming responses must have a bounded fallback, never spin forever).
9.6 Repeat navigation to an already-loaded screen is instant (cached) — no full loading state for data already fetched this session.

## Scoring & output

Per screen × per state, mark each applicable criterion PASS / FAIL / N/A with a one-line note and, for FAIL, the specific element. Report FAILs grouped by section, sorted by severity (blocker / major / minor), each with a file:line if reviewing code, the platform, and the recommended fix. End with severity counts and the top-5 highest-leverage fixes.

## Sources

Nielsen's 10 usability heuristics (mobile interpretation); Apple Human Interface Guidelines (touch target 44pt, Dynamic Type, gestures, haptics, dark mode, modality); Material Design 3 (interaction states, 48dp targets, edge-to-edge insets, motion); WCAG 2.2 AA (contrast 1.4.3 / 1.4.11, target size, focus). Adapt the platform-specific minimums to your stack.
