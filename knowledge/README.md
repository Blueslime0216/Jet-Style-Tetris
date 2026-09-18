# Offline knowledge research

Research snapshot: 2026-09-18. Runtime uses checked-in JSON only. No runtime scraping or network collection is included.

Files:

- `raw/catalog.json`: 23 terms and 21 strategy entries, including seven openers. Named concepts are separate from executable plans.
- `sources/index.json`: 32 sources with authorship and provenance scope. Original instructional work is distinguished from an inventor's original diagram.
- `sources/user-corrections.json`: the user's explicit correction from 4-3 to 6-3, preserving the reason current terminology changed.
- `raw/fumen-inputs.json`: 36 compact source Fumen encodings with exact page/component provenance.
- `raw/fumen-fixtures.json`: decoded 129 pages and 54 optional operations. Rows are bottom-up, `x=0` is left, `y=0` is the bottom, `_` is empty, `X` is an ordinary occupied cell. Rotations use tetris-fumen/SRS origins.
- `raw/stacking-targets.json`: separate 6-3 (`x=6`) and 9-0 (`x=9`) well profiles, deterministic feature definitions, and exact LST phase occupancy. Mathematical well masks are definitions, not claimed gameplay fixtures.
- `raw/ordered-routes.json`: first two bags from Hachispin creator's original diagram, with exact ordered operations and expected clear counts. Decoder support/collision and field continuity pass; the derived runtime stages are tested through real engine movement and TSS→TST clears (seed 107, reflected route).
- `catalog.schema.json`: versioned raw catalog contract. Its `executable` value is deliberately false. Engine-validated runtime plans belong in a separate derived artifact with their own verification evidence.
- `validate.cjs`: offline structural, reference and provenance checks.
- `decode-fumen.cjs`: optional offline regeneration using `tetris-fumen@1.1.3`.

Run structural validation with `node knowledge/validate.cjs`. To regenerate decoded data, install the pinned optional decoder outside the production dependency graph, then run `FUMEN_MODULE=/absolute/path/to/tetris-fumen node knowledge/decode-fumen.cjs`. The checked-in fixtures need no decoder at runtime.

`coloredPlacements` recovers exact four-cell piece groups from published field colors. These placements are **unordered**. Source colors can annotate a diagram, so do not assume every group denotes a historical placement. `operationCanLock` checks collision and support in the decoder; it does not check a legal path from spawn, qualifying final rotation, hold availability, bag order or survival. Pages may contain edited fields and alternate solutions. Do not concatenate all pages as a replay.

Runtime admission requires conversion to engine coordinates, reachable input-path generation, queue/hold validation, simulation of all line clears and spin recognition, and a matching ruleset. Current garbage or a changed board can invalidate an otherwise proven branch. Preserve the original raw data and write the resulting engine version, sequence, ruleset and pass/fail evidence separately.

No success percentages or attack tables were imported. The `successRate: null` value means unknown, not zero. On 2026-09-18 the user corrected the earlier `4-3` wording to `6-3`; the current catalog uses 6-3 for an interior well and 9-0 for a right-edge well. LST and four-wide are separate techniques. Mechanical Hearts requires a suitable non-T-spin/B2B ruleset. Washing Machine and Among Us remain documented but without verified executable geometry.

The original `lst-diagram-2` encoding is preserved but is now explicitly annotated as the source's ST comparison. It is excluded from LST target references. The new `lst-diagram-5` through `8` contain the actual overhang/clear/refill phases. Source colors sometimes mark regions; only the explicitly decoded occupancy and validated transitions may inform a runtime plan.

## Runtime build contracts

`runtime/builds.json` is the runtime registry, now loaded by the agent. It links the user's [Korean build reference](https://hse30.tistory.com/73), distinguishes preparation from activation, and supplies opener targets, reflected variants, explicit goals and recovery rules. A setup diagram does not count as a completed build: activation requires engine line-clear/spin events. Midgame decisions use reachable multi-piece continuations and their resulting terrain, including whether covered cells reopen within the searched continuation, rather than a named diagram alone. Raw catalog entries retain their research status; this registry does not claim every referenced technique has a bespoke solver.

`runtime/ordered-stages.json` derives Hachispin stages from the original ordered diagram, preserving the exact clearing T placement and the board remaining after the first clear. Both stages are excluded when TSS is forbidden. The active library contains 10 setup variants across TKI, PCO, DT Cannon, MKO and Albatross, plus 2 Hachispin stages; reflected variants are validated separately at runtime. Preparation branches may need newly revealed pieces before activation is reachable.
