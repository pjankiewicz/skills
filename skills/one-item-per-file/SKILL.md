---
name: one-item-per-file
description: Use when writing or restructuring a non-trivial chunk of code (a module, a subsystem, an algorithm) and you want it precise, parallelizable, and maintainable — treat code as data. Enforces a three-phase authoring workflow — (1) define the data structures, (2) define the function signatures in terms of those structures so the skeleton compiles, (3) implement the functions — with strict one-item-per-file decomposition: every data structure in its own file, every free function in its own file, a module is a directory of those files. Because each item is isolated, implementations parallelize cleanly and related ones can be batched. Triggers on "scaffold this module", "write this subsystem", "one function per file", "split this big file", "types then functions", "make this parallelizable / maintainable", planning a feature with many functions. Skip for a one-line fix or a single cohesive 50-line function.
---

# one-item-per-file

Treat code as **data**: a codebase is a set of typed records — data structures and functions — and a module is just a directory of those records, **one item per file**. Writing code is then three precise phases over that data, not one big free-form dump. This makes the work parallelizable (isolated items), maintainable (find/reuse/refactor by item, not grep), and hard to get subtly wrong (no giant multi-concern file where a detail hides).

## When to use

- Authoring a new module, subsystem, or algorithm with more than a couple of functions.
- Restructuring a file that has grown into many functions / mixed concerns.
- Any time you want the work to fan out cleanly to parallel workers (subagents, batched LLM calls) — isolated items are the unit of parallelism.

Skip it for a one-line fix or a single self-contained function.

## The rule: one item per file

- **Every data structure** (struct / enum / type alias) → its own file.
- **Every free function** → its own file.
- A **module** is a directory whose `mod.rs` / `index` / `__init__` just declares and re-exports the items.
- The only grouping allowed: a type and its tightly-coupled methods / trait impl can share the type's file. Two unrelated free functions never share a file.

Why: one isolated item = minimal context to read, write, review, or hand to a worker. LLMs and humans are most reliable on a single, isolated task. Grouping functions inflates the context per unit and kills clean parallelization. Many small files are zero-cost; one big file with ten concerns is the expensive thing.

## The three phases (with a compile gate between each)

**Phase 1 — Data structures.** Define every data structure the work needs, one per file. Just the shape (fields, variants) + derives. Make it compile. This is the vocabulary everything else is written in.

**Phase 2 — Signatures.** Define every function's signature, in terms of the Phase-1 structures, one per file, body = a stub (`todo!()` / `throw` / `pass`). The whole module must **compile with stubs**. Now the API and the dependency graph are real and checked — before any logic exists.

**Phase 3 — Implementations.** Fill in the bodies. Because each function is isolated in its own file with a known signature and known types:
- **Independent functions implement in parallel** — they don't touch each other's files.
- **Related functions can be batched** — a set that shares context (the same sub-area, the same handful of types) is cheaper and more coherent generated together in one pass than as N blind isolated calls. Batch by shared context; parallelize across batches. This is a deliberate speed/cost ↔ coherence dial, not a flat fan-out.

Compile (and test) after Phase 3. The gates mean a mistake surfaces at the phase it was made in, not three layers later.

## Reuse, don't duplicate

Before declaring a new type or function in Phase 1/2, check whether one already exists — reuse it (reference the existing item) rather than create a near-duplicate. The registry-of-items view makes this natural: you're adding records to a known set, not writing in a vacuum.

## Maintenance is the same model

Because items are addressable records with explicit dependencies, maintenance is precise: "find the type, every function that uses it, every caller of this function" is a graph query over the files, not a fuzzy text search. Refactors move/rename records; the one-item-per-file layout keeps each change localized to its file.

## Red flags (you're drifting)

- Writing a 400-line file with eight functions "to save files" — split it; files are free.
- Implementing bodies before the signatures + types compile — you've skipped the gate; do Phase 1→2 first.
- Fanning out every function as an isolated worker when ten of them are tightly related — batch the related set instead.
- Re-declaring a type/function that already exists — reuse it.

## Related

For porting/translating code from a cited reference (one language/engine to another), use the **faithful-port** skill — it is this workflow plus reference-fidelity discipline (1:1 transcription, reuse-vs-declare against the existing codebase, batching by *reference* collocation, and an independent oracle per item).
