---
name: faithful-port
description: Use when porting or translating code from a cited reference into another language, framework, or engine (C++ → Rust, GLSL → WGSL, one renderer's/library's algorithm into yours) and faithfulness to the original is the goal. Builds on the one-item-per-file skill (data structures → signatures → implementations, one item per file) and adds reference-fidelity discipline: transcribe each reference function 1:1 into its own file (never paraphrase or fold several into one — that silently drops branches and edge-cases), resolve the types/functions the port needs against the EXISTING codebase (reuse what's there, declare what's missing), batch implementations by how the functions are COLLOCATED in the reference (shared context = fidelity, the speed/cost↔coherence dial), and verify each ported item against the reference with an INDEPENDENT oracle or critic — not the implementer's self-check, and not an aggregate metric that hides a localized defect. Triggers on "port X to Rust", "translate this C++/GLSL/shader", "faithful 1:1 port", "why isn't the port faithful", "port this algorithm/module from <reference>". Skip for greenfield code with no reference to be faithful to (use one-item-per-file instead).
---

# faithful-port

Porting is **one-item-per-file plus fidelity to a reference**. The reference is itself a set of data structures and functions; a faithful port mirrors that set 1:1 — same decomposition, each unit transcribed (not reworded) from the source, each verified against it. Start from the **one-item-per-file** skill (data structures → signatures → implementations, one file each); everything below is the porting-specific layer on top.

## When to use

- Translating a module/algorithm/shader from a cited reference into your stack.
- A port "looks done and compiles" but you suspect it isn't faithful — or someone caught a deviation.
- Any time "match the reference exactly" matters more than "write something that works".

## The cardinal rule: transcribe 1:1, never paraphrase or consolidate

**Each reference function becomes its own function, in its own file, transcribed line-for-line from the source.** Do not fold several reference functions into one "cleaner" function. Do not paraphrase a function from memory or from a summary.

This is the single most important rule, because **consolidation silently drops branches.** When you fold a reference function into a larger one and rewrite it in your own words, a conditional that only fires in a rare configuration — a `shadowFar > 0` branch, an early-out, a sign flip, a clamp — quietly disappears. It compiles. It passes the happy path. It is wrong in exactly the case the dropped branch handled. A 1:1 per-function port *cannot* drop a branch, because the branch is right there in the function you're transcribing. The decomposition is not bureaucracy — it is the mechanism that enforces fidelity.

Keep the reference open and transcribe from it. A digest or recollection loses the load-bearing details (the clamp, the early return, the dual-path `#if`).

## Phase 1 — resolve the data structures (reuse vs declare)

Determine which data structures the port needs. For each, **negotiate against the existing codebase**:
- It already exists → **reuse it** (reference the existing type; don't make a near-duplicate).
- It doesn't → **declare it** as a new one-item-per-file record, transcribed from the reference's type.

A useful naive framing: first translate as if the codebase were empty (define everything the port uses), then run a merge pass — "this type/function already exists, point at it; this one I can't find, mark it to implement." What's left after the merge is the genuinely-new set.

## Phase 2 — signatures, in reference terms

One function signature per file, expressed in the Phase-1 types, stubbed so the module compiles. Name and shape them after the reference's functions (so the 1:1 mapping is obvious) and add a **provenance header** to each file citing the exact source: `reference/path:line-range`, and the reference's version/commit. Every ported file should answer "where did this come from?".

## Phase 3 — implement, batched by reference collocation

Fill in bodies by transcribing each reference function. Choose the batch grouping from the **reference's** structure, not a flat fan-out:
- Functions that are **collocated in the reference** (same source file/region, sharing context and helpers) → generate **in the same batch**, one pass with the shared reference context in front of the model. They still land in separate files; the batch just preserves the context they actually depend on.
- Functions that are **independent** → implement in parallel.

This is the deliberate **speed/cost ↔ coherence** dial. Naive per-function parallelism is cheapest but throws away the shared context collocated source functions rely on, hurting fidelity. The dial knob is the grouping granularity (per reference file / per region / per token budget).

## Phase 4 — verify each item against the reference (independently)

The implementer's self-review is not verification. Check each ported unit against the reference with an **independent oracle**:
- **Ground-truth fixtures** — drive the reference tool/engine to emit known-correct outputs, assert the port matches (two-directional where applicable).
- **A strong-model critic** — feed the reference function + your port and ask for *every* deviation, ranked.
- **The reference's own tests** — port them too; upstream tests are ground truth, not self-authored ones that can be self-referential.

Beware **aggregate metrics that hide localized defects.** A full-frame mean or a low percentile can pass while a real, high-contrast defect sits in <1% of the output (a few pixels, one edge case). Use a metric sensitive to the *kind* of error you can make — a max/worst-case bound, a count of large deviations, a region-focused check — not just an average.

## Red flags (the port is drifting from faithful)

- "I'll simplify/clean up this function while porting it" → no. Transcribe it as-is; clean up later, separately, with the oracle still green.
- One big ported function where the reference had five → you've consolidated; split it back to 1:1.
- Porting from memory / a summary instead of the open source file.
- A ported file with no provenance header.
- "The mean diff is tiny, ship it" → check the worst case; the bug you introduced is probably localized.
- Declaring a new type/function that already exists in the target codebase → reuse it.

## Related

- **one-item-per-file** — the base methodology this extends. Use it for greenfield code (no reference).
