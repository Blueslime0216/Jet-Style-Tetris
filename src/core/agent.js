import { readFileSync } from "node:fs";
import {
  allowedCandidates,
  publicOpponent,
  seededRandom,
  humanDelay,
} from "./style.js";
let templates = [];
const memeRegistry = JSON.parse(
  readFileSync(new URL("../../config/memes.json", import.meta.url), "utf8"),
);
const wellProfiles = JSON.parse(
  readFileSync(
    new URL("../../knowledge/raw/stacking-targets.json", import.meta.url),
    "utf8",
  ),
).wellProfiles;
try {
  const fixtures = JSON.parse(
    readFileSync(
      new URL("../../knowledge/raw/fumen-fixtures.json", import.meta.url),
      "utf8",
    ),
  );
  const selected = [
    "tki-diagram-0",
    "pco-diagram-0",
    "dt-cannon-diagram-3",
    "dt-cannon-diagram-4",
    "mko-diagram-0",
    "albatross-diagram-0",
  ];
  for (const diagram of fixtures.diagrams) {
    if (!selected.includes(diagram.id)) continue;
    const pieces = diagram.pages[0]?.coloredPlacements;
    if (!pieces?.length) continue;
    templates.push({
      id: diagram.id,
      name: diagram.patternId.toUpperCase(),
      strategy: "opener",
      source: diagram.sourceUrl,
      pieces: pieces.map((p) => ({
        type: p.type,
        cells: p.cells.map((c) => [c.x, c.y]),
      })),
    });
  }
} catch {}
export const openerTemplates = templates;
export function fallbackScore(c, style, plan) {
  const p = style.strategyPreferences,
    r = style.risk;
  let score =
    -c.holes * (6 + 9 * r.selfPreservation) -
    c.aggregateHeight * (0.18 + 0.35 * r.selfPreservation) -
    c.bumpiness * 0.3 -
    c.height * c.height * 0.025 * r.selfPreservation;
  score +=
    c.lines * (1 + 3 * p.downstack) +
    c.attack * (0.5 + 2 * r.spikePreference) +
    c.well * 0.5 +
    c.nearFull * 0.3;
  if (c.pc) score += 30 + 120 * p.perfectClear;
  if (c.spin !== "none")
    score +=
      c.lines === 3
        ? p.tSpinTriple * 75
        : c.lines === 2
          ? p.tSpinDouble * 50
          : 8;
  if (plan?.route?.[plan.step]?.id === c.id) score += 100;
  if (plan?.strategy === "pc") score -= Math.max(...c.heights) * p.perfectClear;
  if (plan?.strategy === "tst")
    score += c.spin !== "none" && c.lines === 3 ? 80 : 0;
  if (plan?.strategy === "tsd")
    score += c.spin !== "none" && c.lines === 2 ? 60 : 0;
  if (
    style.strategyPreferences.sixThreeStacking > 0 ||
    style.strategyPreferences.nineZeroStacking > 0
  ) {
    const useSix =
      style.strategyPreferences.sixThreeStacking >
      style.strategyPreferences.nineZeroStacking;
    const well = wellProfiles.find(
      (p) => p.id === (useSix ? "six-three" : "nine-zero"),
    ).wellColumn;
    const obstruction = c.after
      ? c.after.filter(([x]) => x === well).length
      : c.heights[well];
    let rough = 0;
    for (let i = 0; i < 9; i++)
      if (i !== well && i + 1 !== well)
        rough += Math.abs(c.heights[i] - c.heights[i + 1]);
    score +=
      Math.max(
        style.strategyPreferences.sixThreeStacking,
        style.strategyPreferences.nineZeroStacking,
      ) *
      (-obstruction * 8 - rough * 0.6 + c.well * 2);
  }
  if (c.dead) score -= 100000;
  return score;
}
export class StyleAgent {
  constructor(style, seed, provider) {
    this.style = style;
    this.random = seededRandom(seed);
    this.provider = provider;
    this.plan = null;
    this.lastGarbage = 0;
    this.decisions = 0;
  }
  setStyle(style) {
    this.style = style;
    this.plan = null;
  }
  async select(state, candidates, layer, rank) {
    try {
      return await this.provider.choose(state, candidates, layer);
    } catch (e) {
      const sorted = [...candidates].sort(
        (a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id),
      );
      return {
        choice: sorted[0].id,
        probabilities: {},
        source: "fallback",
        fallbackReason: e.code ?? "provider_error",
        latencyMs: 0,
      };
    }
  }
  async decide(engine, view, seat) {
    const self = view.seats[seat],
      style = this.style;
    let candidates = allowedCandidates(
      await engine.send({ op: "candidates", seat }),
      style,
    );
    if (!candidates.length) return null;
    const observation = {
      self: {
        board: self.board,
        current: self.active?.piece,
        hold: self.hold,
        next: self.next,
        garbage: self.garbage,
        combo: self.combo,
        b2b: self.b2b,
      },
      opponent: publicOpponent(view.seats[1 - seat], style),
      match: { ruleset: "guideline-v1", elapsedFrames: view.frame },
      style,
    };
    const traces = [];
    const next = this.plan?.route?.[this.plan.step];
    let reason = !this.plan ? "initial" : null;
    if (next && !candidates.some((c) => c.id === next.id))
      reason = "plan_unreachable";
    if (this.plan && this.plan.step >= this.plan.horizon)
      reason = "plan_complete";
    if (self.garbage > this.lastGarbage + 3) reason = "garbage_spike";
    this.lastGarbage = self.garbage;
    if (reason) {
      let plans = [];
      if (
        style.knowledge.openerKnowledge > 0.2 &&
        self.lines === 0 &&
        view.locks[seat] < 8
      ) {
        plans = await engine.send({ op: "plans", seat, templates });
      }
      if (
        style.showmanship.enabled &&
        style.showmanship.memeBuildPreference > 0.2 &&
        self.board.length < 16
      ) {
        for (const template of memeRegistry.patterns) {
          const cells = template.rowsBottomUp.flatMap((row, y) =>
            [...row].flatMap((c, x) =>
              c === "X" ? [[x + template.offsetX, y]] : [],
            ),
          );
          const route = await engine.send({ op: "mask_plan", seat, cells });
          if (route?.length)
            plans.push({
              id: template.id,
              name: template.name,
              strategy: "meme",
              source: template.source,
              route,
            });
        }
      }
      const goalPlans =
        style.knowledge.lookahead > 0.1
          ? await engine.send({
              op: "goals",
              seat,
              depth: style.knowledge.lookahead > 0.7 ? 3 : 2,
            })
          : [];
      plans.push(
        ...goalPlans.filter(
          (p) =>
            p.strategy === "pc" ||
            (!style.hardConstraints.forbidMidgamePatterns &&
              style.knowledge.midgameKnowledge > 0.2),
        ),
      );
      plans = plans.filter((p) =>
        p.route.every(
          (c) =>
            !(
              style.hardConstraints.forbidTSS &&
              c.spin !== "none" &&
              c.lines === 1
            ),
        ),
      );
      const strategies = [
        {
          id: "freestyle",
          name: "Clean stacking",
          weight: style.strategyPreferences.freestyle,
        },
        {
          id: "downstack",
          name: "Downstack",
          weight:
            style.strategyPreferences.downstack + Math.min(1, self.garbage / 8),
        },
      ];
      if (
        candidates.some((c) => c.pc) ||
        plans.some((p) => p.strategy === "pc")
      )
        strategies.push({
          id: "pc",
          name: "Perfect clear",
          weight: style.strategyPreferences.perfectClear + 1,
        });
      if (
        !style.hardConstraints.forbidMidgamePatterns &&
        style.knowledge.midgameKnowledge > 0.2
      ) {
        if (
          candidates.some((c) => c.spin !== "none" && c.lines === 2) ||
          plans.some((p) => p.strategy === "tsd")
        )
          strategies.push({
            id: "tsd",
            name: "T-spin double",
            weight: style.strategyPreferences.tSpinDouble + 1,
          });
        if (
          candidates.some((c) => c.spin !== "none" && c.lines === 3) ||
          plans.some((p) => p.strategy === "tst")
        )
          strategies.push({
            id: "tst",
            name: "T-spin triple",
            weight: style.strategyPreferences.tSpinTriple + 1,
          });
      }
      if (plans.some((p) => p.strategy === "opener"))
        strategies.push({
          id: "opener",
          name: "Verified opener route",
          weight: style.strategyPreferences.opener + 1,
        });
      if (style.strategyPreferences.sixThreeStacking > 0.1)
        strategies.push({
          id: "six-three",
          name: "6-3 stacking",
          weight: style.strategyPreferences.sixThreeStacking + 1,
        });
      if (style.strategyPreferences.nineZeroStacking > 0.1)
        strategies.push({
          id: "nine-zero",
          name: "9-0 stacking",
          weight: style.strategyPreferences.nineZeroStacking + 0.5,
        });
      if (plans.some((p) => p.strategy === "meme"))
        strategies.push({
          id: "meme",
          name: "Showpiece build",
          weight: 1.5 + style.showmanship.memeBuildPreference,
        });
      // Opener-only is a real restriction. If no route exists, concede rather than invent an opener.
      const options = style.hardConstraints.openerOnly
        ? strategies.filter((s) => s.id === "opener")
        : strategies;
      if (!options.length) return null;
      const decision = await this.select(
        observation,
        options,
        "strategy",
        (c) => c.weight,
      );
      traces.push({
        ...decision,
        layer: "strategy",
        candidates: options,
        replanReason: reason,
      });
      const selected = options.find((c) => c.id === decision.choice);
      this.plan = {
        id: selected.id,
        name: selected.name,
        strategy: selected.id,
        step: 0,
        horizon:
          selected.id === "freestyle" || selected.id === "downstack" ? 4 : 1,
        route: null,
      };
      const matchingPlans = plans.filter((p) => p.strategy === selected.id);
      if (matchingPlans.length) {
        const pd = await this.select(
          observation,
          matchingPlans.map((p) => ({
            id: p.id,
            name: p.name,
            steps: p.route.length,
            source: p.source,
          })),
          "plan",
          () => 0,
        );
        traces.push({
          ...pd,
          layer: "plan",
          candidates: matchingPlans.map((p) => ({ id: p.id, name: p.name })),
        });
        const found = matchingPlans.find((p) => p.id === pd.choice);
        this.plan = { ...found, step: 0, horizon: found.route.length };
      }
    }
    if (this.plan?.route) {
      const target = this.plan.route[this.plan.step];
      candidates = candidates.filter((c) => c.id === target.id);
      if (!candidates.length) {
        this.plan = null;
        return null;
      }
    }
    const total = candidates.length;
    // Choice has a 255 limit. Keep deterministically ranked candidates only when required.
    if (candidates.length > 255)
      candidates = [...candidates]
        .sort(
          (a, b) =>
            fallbackScore(b, style, this.plan) -
            fallbackScore(a, style, this.plan),
        )
        .slice(0, 255);
    const compact = candidates.map(({ after, ...c }) => c);
    const decision = await this.select(
      {
        ...observation,
        currentPlan: {
          id: this.plan.id,
          name: this.plan.name,
          step: this.plan.step,
        },
      },
      compact,
      "placement",
      (c) => fallbackScore(c, style, this.plan),
    );
    const chosen = candidates.find((c) => c.id === decision.choice);
    traces.push({ ...decision, layer: "placement", candidates: compact });
    this.decisions++;
    const probs = Object.values(decision.probabilities);
    const uncertainty = probs.length ? 1 - Math.max(...probs) : 0;
    return {
      candidate: chosen,
      plan: {
        id: this.plan.id,
        name: this.plan.name,
        step: this.plan.step + 1,
        total: this.plan.horizon,
      },
      traces,
      source: decision.source,
      fallbackReason: decision.fallbackReason,
      latencyMs: traces.reduce((s, t) => s + t.latencyMs, 0),
      delayMs: humanDelay(style, this.random, uncertainty),
      candidateCount: total,
      styleEffects: {
        tssFiltered: style.hardConstraints.forbidTSS,
        advancedPatterns:
          style.knowledge.midgameKnowledge > 0.2 &&
          !style.hardConstraints.forbidMidgamePatterns,
      },
      unresolved: null,
    };
  }
  committed() {
    if (this.plan) this.plan.step++;
  }
}
