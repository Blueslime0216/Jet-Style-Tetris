# Architecture

```text
Browser: styles · boards · inspector · replay viewer
    │ HTTP + WebSocket
Node server: sessions · provider proxy · quotas · match lifecycle
    ├── Gemini → strict StyleProfile
    ├── StyleAgent → Jev strategy / plan / placement choices
    └── EngineHost → tetr-core (Rust)
                     movement · candidates · simulation · scoring
```

## Boundaries

- `rust/engine-host` wraps the unmodified `tetr_online` core with a bounded JSON-lines protocol. It validates reachable placements, executes actual inputs, routes garbage, and exposes only visible queue information.
- `src/core` owns style validation, hard constraints, static pattern plans, public-opponent observations, and seeded execution delays. It does not use browser or TBP types.
- `src/adapters` contains engine transport, Jev/Gemini clients, and a standalone TBP adapter. TBP translates engine coordinates to SRS rotation centers and uses stdin/stdout.
- `src/server` owns sessions, per-match engines, cost limits, and replay recording. The web client cannot select executables, file paths, provider endpoints, or models.
- `knowledge` is a source-linked, static research library. Runtime requests never scrape external strategy sites. Diagrams only produce plans after current-board, queue, and reachability validation.

## Decisions

Jev chooses from finite engine-validated options. A plan persists until completion, invalidation, or a garbage spike. Hard constraints are applied before selection. Source-backed opener templates include activation goals and staged continuations. Every live placement uses per-cell descent/SRS reachability; per-root beam search evaluates 2–4 known pieces before Jev receives a bounded shortlist. Future search remains approximate. PC/TSD/TST continuations create concrete routes; 6-3 and 9-0 stacking use separate well targets. Showmanship includes two authored, executable masks. Reserved advanced pattern-reading and named meme controls are disabled.

Missing or invalidated opener routes recover with legal stacking instead of ending the match. Bot paths execute one input per frame and verify the final landing cells. Human key pulses are queued in order.

Fallback evaluates legal candidates only and is visibly labeled. It does not fabricate model probabilities. Model latency and seeded execution delays are separate; speed does not increase strategic knowledge. The current short search is not an exhaustive solver.

## Replay and privacy

A replay records the seed, engine revision, styles, decisions, engine commands, visual snapshots, actual clear events, and final-state hash. `verifyReplay()` reruns commands without provider calls and compares the final hash. The browser viewer plays saved snapshots; it does not invoke the engine verifier itself.

Opponent observations omit hidden queues, RNG state, styles, plans, and pending decisions. Replays can contain style text and API decision data; they are downloaded deliberately and are not publicly stored. Keys are never recorded. Operator logs contain startup/errors, not full prompts.

## Validation

Tests cover actual reachable placements, exact replay, spin/PC fixtures, source opener execution, a complete showpiece, TBP state transitions, strict style schemas, provider failures, signed sessions, and fail-closed shared budgets. Local browser checks cover human controls, pause, real Jev decisions, replay viewing, and mobile overflow. See the README for commands.
