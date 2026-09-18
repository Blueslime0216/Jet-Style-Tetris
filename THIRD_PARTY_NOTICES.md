# Third-party notices

## tetr_online

Game rules, SRS movement, candidate generation, and simulation use `tetr-core` from [xiyan128/tetr_online](https://github.com/xiyan128/tetr_online), revision `0811902a0682a2fef06eebc28ca4f96a22c5147b`.

The upstream source is an unmodified Git submodule. Its MIT license is preserved at [vendor/tetr_online/LICENSE](vendor/tetr_online/LICENSE). The demo does not distribute upstream audio or neural model assets.

## Knowledge references

Pattern names, factual annotations, and source-linked board encodings are documented in [knowledge/README.md](knowledge/README.md). Source material retains its original rights. Entries distinguish documented diagrams from engine-validated executable routes; an imported diagram is not treated as a verified move sequence by itself.

## Dependencies

Node dependencies and exact versions are recorded in `package-lock.json`; Rust dependencies are recorded in `rust/engine-host/Cargo.lock`. Each dependency retains its respective license.

Tetris is a trademark of its respective owner. This independent research demo is not affiliated with or endorsed by the trademark owner.
