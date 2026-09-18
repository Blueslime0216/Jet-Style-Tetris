import test from "node:test";
import assert from "node:assert/strict";
import { EngineHost } from "../src/adapters/engine.js";
import { StyleAgent, openerTemplates } from "../src/core/agent.js";
import { DEFAULT_STYLE, PRESETS } from "../src/core/style.js";
import { Match, verifyReplay } from "../src/server/match.js";
const offline = {
  choose: async () => {
    throw Error("offline");
  },
};
const coordinates = (c) =>
  c.map((p) => p.slice(0, 2)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);

test("queued movement is visible and arrives at the planned cells, including hold", async () => {
  const engine = new EngineHost();
  try {
    for (const useHold of [false, true]) {
      let s = await engine.send({ op: "init", seed: 3 });
      const candidates = await engine.send({ op: "candidates", seat: 0 });
      const c = candidates.find((c) => c.hold === useHold && c.rotation === 1);
      const prepared = await engine.send({
        op: "prepare",
        seat: 0,
        lock: 0,
        candidate: c.id,
      });
      assert.ok(prepared.state.executing[0].total > 2);
      assert.equal(prepared.state.locks[0], 0);
      let count = 0;
      do {
        const out = await engine.send({ op: "tick", inputs: [{}, {}] });
        s = out.state;
        assert.ok(!out.events.some((e) => e.type === "executionInvalidated"));
        count++;
      } while (s.executing[0] && count < 200);
      assert.ok(count > 2);
      assert.equal(s.locks[0], 1);
      assert.deepEqual(coordinates(s.seats[0].board), coordinates(c.after));
    }
  } finally {
    engine.close();
  }
});

test("two soft-drop pulses received together retain their order across frames", async () => {
  const match = new Match({
    seed: 42,
    mode: "human",
    styles: [DEFAULT_STYLE, DEFAULT_STYLE],
    provider: offline,
    onUpdate: () => {},
  });
  try {
    match.view = await match.engine.send({ op: "init", seed: 42 });
    match.pending = [true, true];
    const y = match.view.seats[0].active.y;
    match.setInput("soft");
    match.setInput("soft");
    await match.tick();
    await match.tick();
    assert.equal(match.view.seats[0].active.y, y - 2);
  } finally {
    match.end();
  }
});

test("opener route includes its real TSD activation, then play continues into midgame", async () => {
  const engine = new EngineHost();
  try {
    let view = await engine.send({ op: "init", seed: 3 });
    const plans = await engine.send({
      op: "plans",
      seat: 0,
      templates: openerTemplates,
    });
    const opener = plans.find((p) => p.id === "tki-diagram-0");
    assert.ok(opener.route.some((c) => c.spin === "full" && c.lines === 2));
    for (const c of opener.route)
      view = (
        await engine.send({
          op: "place",
          seat: 0,
          lock: view.locks[0],
          candidate: c.id,
        })
      ).state;
    assert.equal(view.seats[0].lines, 2);
    const style = structuredClone(
      PRESETS.find((s) => s.label === "TSD Grinder"),
    );
    style.hardConstraints.forbidTSS = true;
    const agent = new StyleAgent(style, 3, offline);
    let midgameTSD = 0;
    for (let i = 0; i < 65 && !view.seats[0].gameOver; i++) {
      const d = await agent.decide(engine, view, 0);
      assert.ok(d, "a failed plan must not stop the game");
      assert.ok(!(d.candidate.spin !== "none" && d.candidate.lines === 1));
      const out = await engine.send({
        op: "place",
        seat: 0,
        lock: view.locks[0],
        candidate: d.candidate.id,
      });
      if (
        out.events.some(
          (e) =>
            e.type === "score" && e.action === "TSpin { kind: Full, lines: 2 }",
        )
      )
        midgameTSD++;
      view = out.state;
      agent.committed();
    }
    assert.equal(view.seats[0].gameOver, false);
    assert.ok(
      midgameTSD > 0,
      "the real engine must recognize a midgame double, not just a diagram",
    );
    assert.ok(view.seats[0].lines >= 12);
  } finally {
    engine.close();
  }
});

test("unavailable opener recovers without relaxing TSS prohibition", async () => {
  const engine = new EngineHost();
  try {
    const style = structuredClone(
      PRESETS.find((s) => s.label === "Opener Loop Bot"),
    );
    style.hardConstraints.forbidTSS = true;
    let view = await engine.send({ op: "init", seed: 42 });
    const agent = new StyleAgent(style, 42, offline);
    for (let i = 0; i < 15; i++) {
      const d = await agent.decide(engine, view, 0);
      assert.ok(d);
      assert.ok(!(d.candidate.spin !== "none" && d.candidate.lines === 1));
      view = (
        await engine.send({
          op: "place",
          seat: 0,
          lock: view.locks[0],
          candidate: d.candidate.id,
        })
      ).state;
      agent.committed();
    }
    assert.equal(view.seats[0].gameOver, false);
  } finally {
    engine.close();
  }
});

test("Hachispin executes a single and the source-backed second-bag triple", async () => {
  const engine = new EngineHost();
  try {
    let view = await engine.send({ op: "init", seed: 107 });
    const templates = openerTemplates.filter((t) => t.id.includes("hachispin"));
    const actions = [];
    for (const goal of ["tss", "tst"]) {
      const plans = await engine.send({ op: "plans", seat: 0, templates });
      const plan = plans.find(
        (p) => p.goal === goal && p.phase === "activation",
      );
      assert.ok(plan, goal);
      for (const c of plan.route) {
        const out = await engine.send({
          op: "place",
          seat: 0,
          lock: view.locks[0],
          candidate: c.id,
        });
        actions.push(
          ...out.events.filter((e) => e.type === "score").map((e) => e.action),
        );
        view = out.state;
      }
    }
    assert.ok(actions.includes("TSpin { kind: Full, lines: 1 }"));
    assert.ok(actions.includes("TSpin { kind: Full, lines: 3 }"));
    assert.equal(view.seats[0].lines, 4);
  } finally {
    engine.close();
  }
});

test("animated commands replay to the exact final state and recorded clear stats", async () => {
  const match = new Match({
    seed: 3,
    mode: "bots",
    styles: [DEFAULT_STYLE, DEFAULT_STYLE],
    provider: offline,
    onUpdate: () => {},
  });
  try {
    match.view = await match.engine.send({ op: "init", seed: 3 });
    match.pending = [true, true];
    const plan = (
      await match.engine.send({
        op: "plans",
        seat: 0,
        templates: openerTemplates,
      })
    ).find((p) => p.id === "tki-diagram-0");
    for (const c of plan.route) {
      const cmd = {
        op: "prepare",
        seat: 0,
        lock: match.view.locks[0],
        candidate: c.id,
      };
      match.view = (await match.engine.send(cmd)).state;
      match.record.commands.push(cmd);
      do {
        await match.tick();
      } while (match.view.executing[0]);
    }
    assert.equal(match.stats[0].tsd, 1);
    assert.equal(match.stats[0].tss, 0);
    match.end();
    assert.equal((await verifyReplay(match.replay())).matches, true);
  } finally {
    match.end();
  }
});

test("build follow-up goals advance only after the corresponding clear is executed", async () => {
  const engine = new EngineHost();
  try {
    let view = await engine.send({ op: "init", seed: 107 });
    const provider = {
      choose: async (state, candidates, layer) => {
        const chosen =
          layer === "strategy"
            ? candidates.find((c) => c.id === "opener")
            : layer === "plan"
              ? candidates.find((c) => c.id.includes("hachispin"))
              : null;
        if (!chosen) throw Error("offline");
        return {
          choice: chosen.id,
          source: "fixture",
          probabilities: {},
          latencyMs: 0,
        };
      },
    };
    const agent = new StyleAgent(DEFAULT_STYLE, 107, provider);
    const goals = [];
    for (let i = 0; i < 14; i++) {
      const d = await agent.decide(engine, view, 0);
      const out = await engine.send({
        op: "place",
        seat: 0,
        lock: view.locks[0],
        candidate: d.candidate.id,
      });
      view = out.state;
      agent.committed();
      if (
        out.events.some(
          (e) => e.type === "score" && /^TSpin.*lines: [123]/.test(e.action),
        )
      )
        goals.push(agent.followupGoal);
    }
    assert.deepEqual(goals, ["tst", "pc"]);
    assert.equal(view.seats[0].lines, 4);
  } finally {
    engine.close();
  }
});
