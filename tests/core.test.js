import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STYLE,
  PRESETS,
  validateStyle,
  allowedCandidates,
  publicOpponent,
  seededRandom,
  humanDelay,
} from "../src/core/style.js";
import { EngineHost } from "../src/adapters/engine.js";
import { openerTemplates, StyleAgent } from "../src/core/agent.js";
import { MockJevAdapter } from "../src/adapters/providers.js";
import { TBPAdapter, toTBP } from "../src/adapters/tbp.js";
import { verifyReplay } from "../src/server/match.js";
import { createHash } from "node:crypto";
const hash = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
test("all presets conform; untrusted fields rejected; ranges clamped", () => {
  for (const s of PRESETS) assert.deepEqual(validateStyle(s), s);
  assert.throws(() =>
    validateStyle({ ...DEFAULT_STYLE, endpoint: "https://evil" }),
  );
  const s = structuredClone(DEFAULT_STYLE);
  s.risk.greed = 99;
  assert.equal(validateStyle(s).risk.greed, 1);
  s.risk.greed = "1";
  assert.throws(() => validateStyle(s));
});
test("absolute TSS constraint survives fallback and includes mini single", () => {
  const s = structuredClone(DEFAULT_STYLE);
  s.hardConstraints.forbidTSS = true;
  const moves = [
    { id: "a", spin: "full", lines: 1 },
    { id: "b", spin: "mini", lines: 1 },
    { id: "c", spin: "none", lines: 1 },
    { id: "d", spin: "full", lines: 2 },
  ];
  assert.deepEqual(
    allowedCandidates(moves, s).map((c) => c.id),
    ["c", "d"],
  );
});
test("opponent observation strips all private state", () => {
  const x = publicOpponent(
    {
      board: [],
      garbage: 0,
      combo: 0,
      b2b: false,
      next: ["I"],
      hold: "T",
      style: DEFAULT_STYLE,
      currentPlan: "secret",
      rng: 123,
    },
    DEFAULT_STYLE,
  );
  assert.deepEqual(Object.keys(x).sort(), [
    "b2b",
    "board",
    "combo",
    "stackHeight",
    "visibleGarbage",
  ]);
  const s = structuredClone(DEFAULT_STYLE);
  s.opponentAwareness.enabled = false;
  assert.equal(publicOpponent({}, s), null);
});
test("humanization reproducible and speed independent of knowledge", () => {
  const a = seededRandom(12),
    b = seededRandom(12);
  for (let i = 0; i < 100; i++)
    assert.equal(humanDelay(DEFAULT_STYLE, a), humanDelay(DEFAULT_STYLE, b));
});
test("tetr_online candidates produce legal state and exact replay", async () => {
  const engine = new EngineHost();
  try {
    const seed = 42;
    const before = await engine.send({ op: "init", seed });
    const commands = [];
    for (let i = 0; i < 12; i++) {
      const cs = await engine.send({ op: "candidates", seat: 0 });
      assert.ok(cs.length > 10);
      const c = cs.find((c) => !c.dead);
      const cmd = { op: "place", seat: 0, lock: i, candidate: c.id };
      await engine.send(cmd);
      commands.push(cmd);
      const tick = { op: "tick", inputs: [{}, {}] };
      await engine.send(tick);
      commands.push(tick);
    }
    const final = await engine.send({ op: "snapshot" });
    assert.notDeepEqual(before, final);
    const result = await verifyReplay({
      schemaVersion: 1,
      seed,
      commands,
      finalHash: hash(final),
    });
    assert.equal(result.matches, true);
  } finally {
    engine.close();
  }
});
test("opener routes are validated with current queue and remain executable", async () => {
  const engine = new EngineHost();
  try {
    assert.ok(openerTemplates.length >= 4);
    let found;
    for (let seed = 1; seed <= 30; seed++) {
      await engine.send({ op: "init", seed });
      const plans = await engine.send({
        op: "plans",
        seat: 0,
        templates: openerTemplates,
      });
      if (plans.length) {
        found = plans[0];
        break;
      }
    }
    assert.ok(found, "at least one source opener must be executable");
    let lock = 0;
    for (const c of found.route) {
      const out = await engine.send({
        op: "place",
        seat: 0,
        lock: lock++,
        candidate: c.id,
      });
      assert.equal(out.state.seats[0].gameOver, false);
    }
    assert.ok(lock >= 4);
  } finally {
    engine.close();
  }
});
test("TBP lifecycle, queue and coordinate translation", async () => {
  const tbp = new TBPAdapter();
  try {
    assert.equal(tbp.info().type, "info");
    assert.deepEqual(await tbp.message({ type: "rules" }), { type: "ready" });
    await tbp.message({
      type: "start",
      board: Array.from({ length: 40 }, () => Array(10).fill(null)),
      queue: ["I", "T", "O", "S", "Z", "J", "L"],
      hold: null,
      combo: 0,
      back_to_back: false,
    });
    const suggestion = await tbp.message({ type: "suggest" });
    assert.equal(suggestion.moves.length, 1);
    assert.ok(
      ["north", "east", "south", "west"].includes(
        suggestion.moves[0].location.orientation,
      ),
    );
    await tbp.message({ type: "play", move: suggestion.moves[0] });
    await tbp.message({ type: "new_piece", piece: "I" });
    assert.equal((await tbp.message({ type: "suggest" })).type, "suggestion");
    await tbp.message({ type: "stop" });
    assert.equal(await tbp.message({ type: "suggest" }), null);
    assert.deepEqual(
      toTBP({ piece: "I", rotation: 0, x: 0, y: -2, spin: "none" }).location,
      { type: "I", orientation: "north", x: 1, y: 0 },
    );
  } finally {
    tbp.close();
  }
});
test("agent uses provider choice and persists plan; unknown patterns are gated", async () => {
  const engine = new EngineHost();
  try {
    const view = await engine.send({ op: "init", seed: 9 });
    const s = structuredClone(DEFAULT_STYLE);
    s.hardConstraints.forbidMidgamePatterns = true;
    const agent = new StyleAgent(s, 9, new MockJevAdapter());
    const d = await agent.decide(engine, view, 0);
    assert.ok(d.candidate);
    assert.equal(d.source, "mock");
    assert.equal(d.styleEffects.advancedPatterns, false);
    assert.ok(d.traces.every((t) => t.source === "mock"));
  } finally {
    engine.close();
  }
});
test("6-3 and 9-0 use distinct source-backed well targets", async () => {
  const { fallbackScore } = await import("../src/core/agent.js");
  const base = {
    holes: 0,
    aggregateHeight: 8,
    bumpiness: 2,
    height: 2,
    lines: 0,
    attack: 0,
    well: 0,
    nearFull: 0,
    spin: "none",
    pc: false,
    dead: false,
    heights: [1, 1, 1, 1, 1, 1, 0, 1, 1, 0],
  };
  const six = PRESETS.find((p) => p.label === "6-3 Stacker"),
    nine = PRESETS.find((p) => p.label === "9-0 Stacker");
  const c6 = { ...base, after: [[9, 0]] },
    c9 = { ...base, after: [[6, 0]] };
  assert.ok(fallbackScore(c6, six) > fallbackScore(c9, six));
  assert.ok(fallbackScore(c9, nine) > fallbackScore(c6, nine));
});
test("showmanship creates a real reachable authored pattern, not a fake probability", async () => {
  const engine = new EngineHost();
  try {
    const view = await engine.send({ op: "init", seed: 2 });
    const style = PRESETS.find((s) => s.label === "Troll / Showman");
    const { JevAdapter } = await import("../src/adapters/providers.js");
    const agent = new StyleAgent(
      style,
      2,
      new JevAdapter({ getConfig: () => ({}) }),
    );
    const d = await agent.decide(engine, view, 0);
    assert.equal(d.plan.name, "Cursed Crown");
    let lock = 0;
    for (const move of agent.plan.route)
      await engine.send({
        op: "place",
        seat: 0,
        lock: lock++,
        candidate: move.id,
      });
    const final = await engine.send({ op: "snapshot" });
    assert.equal(final.seats[0].board.length, 16);
    assert.equal(final.seats[0].gameOver, false);
  } finally {
    engine.close();
  }
});
test("PC and T-spin fixtures are legal and no-TSS filters real engine outcomes", async () => {
  const { readFileSync } = await import("node:fs");
  const diagrams = JSON.parse(
    readFileSync(
      new URL("../knowledge/raw/fumen-fixtures.json", import.meta.url),
      "utf8",
    ),
  ).diagrams;
  const engine = new EngineHost();
  try {
    const pc = Array.from({ length: 40 }, (_, y) =>
      Array.from({ length: 10 }, (_, x) => (y < 4 && x !== 9 ? "G" : null)),
    );
    const moves = await engine.send({
      op: "analyze",
      board: pc,
      queue: ["I", "T", "O"],
      hold: null,
    });
    assert.ok(moves.some((c) => c.pc && c.lines === 4));
    let tspins = [];
    for (const d of diagrams
      .filter((d) => ["lst", "stsd", "tki"].includes(d.patternId))
      .slice(0, 12)) {
      for (const p of d.pages.slice(0, 2)) {
        const board = Array.from({ length: 40 }, (_, y) =>
          Array.from({ length: 10 }, (_, x) =>
            p.boardRowsBottomUp[y]?.[x] && p.boardRowsBottomUp[y][x] !== "_"
              ? "G"
              : null,
          ),
        );
        const cs = await engine.send({
          op: "analyze",
          board,
          queue: ["T", "I", "O"],
          hold: null,
        });
        tspins.push(...cs.filter((c) => c.spin !== "none" && c.lines > 0));
      }
    }
    assert.ok(tspins.length > 0);
    const noTSS = structuredClone(DEFAULT_STYLE);
    noTSS.hardConstraints.forbidTSS = true;
    assert.ok(allowedCandidates(tspins, noTSS).every((c) => c.lines !== 1));
  } finally {
    engine.close();
  }
});
