import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { EngineHost } from "../adapters/engine.js";
import { StyleAgent } from "../core/agent.js";
import { validateStyle } from "../core/style.js";
const hash = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
let knowledgeHash = "unavailable";
try {
  knowledgeHash = hash(
    [
      "raw/fumen-fixtures.json",
      "runtime/builds.json",
      "runtime/ordered-stages.json",
    ].map((path) =>
      JSON.parse(
        readFileSync(
          new URL("../../knowledge/" + path, import.meta.url),
          "utf8",
        ),
      ),
    ),
  );
} catch {}
export function publicDecision(d) {
  if (!d) return null;
  return {
    plan: d.plan,
    source: d.source,
    fallbackReason: d.fallbackReason,
    latencyMs: d.latencyMs,
    delayMs: d.delayMs,
    candidateCount: d.candidateCount,
    shortlistCount: d.traces.at(-1).candidates.length,
    styleEffects: d.styleEffects,
    unresolved: d.unresolved,
    choice: d.candidate.id,
    options: d.traces
      .at(-1)
      .candidates.map((c) => ({
        id: c.id,
        piece: c.piece,
        x: c.x,
        column: c.cells?.length
          ? Math.min(...c.cells.map(([x]) => x)) + 1
          : c.x + 1,
        rotation: c.rotation,
        lines: c.lines,
        spin: c.spin,
        pc: c.pc,
        probability: d.traces.at(-1).probabilities[c.id] ?? null,
      }))
      .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))
      .slice(0, 6),
    strategies: d.traces.find((t) => t.layer === "strategy")?.candidates ?? [],
  };
}
export class Match {
  constructor({
    seed,
    mode,
    styles,
    provider,
    onUpdate,
    onEnd,
    maxSeconds = 240,
  }) {
    this.seed = seed;
    this.mode = mode;
    this.styles = styles.map(validateStyle);
    this.engine = new EngineHost();
    this.agents = this.styles.map(
      (s, i) =>
        new StyleAgent(s, (seed ^ ((i + 1) * 0x9e3779b9)) >>> 0, provider),
    );
    this.onUpdate = onUpdate;
    this.onEnd = onEnd;
    this.maxFrames = maxSeconds * 60;
    this.pending = [false, false];
    this.ready = [null, null];
    this.inspector = [null, null];
    this.inputs = [];
    this.eventHistory = [];
    this.stats = [0, 1].map(() => ({
      spins: 0,
      tss: 0,
      tsd: 0,
      tst: 0,
      attacks: 0,
      lastClear: null,
    }));
    this.paused = false;
    this.stopped = false;
    this.record = {
      schemaVersion: 1,
      seed,
      mode,
      styles: structuredClone(this.styles),
      styleHashes: this.styles.map(hash),
      ruleset: "guideline-v1",
      engineRevision: "0811902a0682a2fef06eebc28ca4f96a22c5147b",
      appVersion: "0.2.0",
      knowledgeHash,
      commands: [],
      decisions: [],
      snapshots: [],
      events: [],
    };
    this.serial = Promise.resolve();
  }
  async start() {
    this.view = await this.engine.send({ op: "init", seed: this.seed });
    if (this.stopped) return;
    this.record.snapshots.push(this.view);
    this.onUpdate(this.message());
    this.timer = setInterval(() => {
      if (!this.stopped && !this.paused && !this.ticking) {
        this.ticking = true;
        this.tick()
          .catch(() => this.end("engine_error"))
          .finally(() => (this.ticking = false));
      }
    }, 1000 / 60);
  }
  setInput(action) {
    if (this.mode !== "human") return;
    if (this.inputs.length < 256) this.inputs.push(action);
  }
  async tick() {
    const action = this.mode === "human" ? this.inputs.shift() : null;
    const inputs = [action ? { [action]: true } : {}, {}];
    const cmd = { op: "tick", inputs };
    const out = await this.engine.send(cmd);
    if (this.stopped) return;
    this.record.commands.push(cmd);
    this.view = out.state;
    this.lastEvents = [...(this.lastEvents ?? []), ...out.events];
    for (const event of out.events) {
      if (event.type === "executionComplete")
        this.agents[event.seat].committed();
      if (event.type === "executionInvalidated")
        this.agents[event.seat].plan = null;
      if (event.type === "attack")
        this.stats[event.seat].attacks += event.lines;
      if (
        event.type === "score" &&
        !/^(HardDrop|SoftDrop|NoClear)/.test(event.action)
      ) {
        const stats = this.stats[event.seat];
        stats.lastClear = event.action;
        const spin = event.action.match(/TSpin.*lines: ([123])/);
        if (spin) {
          stats.spins++;
          stats[[null, "tss", "tsd", "tst"][Number(spin[1])]]++;
        }
      }
      if (
        ["lock", "attack", "executionInvalidated"].includes(event.type) ||
        (event.type === "score" &&
          !/^(HardDrop|SoftDrop|NoClear)/.test(event.action))
      )
        this.eventHistory.push({ ...event, frame: this.view.frame });
    }
    this.record.events.push(
      ...this.eventHistory.filter((e) => e.frame === this.view.frame),
    );
    this.eventHistory = this.eventHistory.slice(-80);
    for (const seat of this.mode === "human" ? [1] : [0, 1]) {
      const ready = this.ready[seat];
      if (ready && this.view.frame >= ready.executeFrame) {
        this.ready[seat] = null;
        // Never execute a decision on a replacement piece.
        if (ready.lock === this.view.locks[seat]) {
          const cmd = {
            op: "prepare",
            seat,
            lock: ready.lock,
            candidate: ready.decision.candidate.id,
          };
          try {
            const result = await this.engine.send(cmd);
            if (this.stopped) return;
            this.record.commands.push(cmd);
            this.view = result.state;
            this.lastEvents.push(...result.events);
          } catch (error) {
            this.eventHistory.push({
              type: "replan",
              seat,
              frame: this.view.frame,
              reason: error.message,
            });
            this.agents[seat].plan = null;
          }
        }
      }
      if (
        !this.pending[seat] &&
        !this.ready[seat] &&
        !this.view.executing?.[seat] &&
        this.view.frame >= (this.retryAfter?.[seat] ?? 0) &&
        !this.view.seats[seat].gameOver
      ) {
        this.pending[seat] = true;
        const lock = this.view.locks[seat];
        const version = this.styleVersion ?? 0;
        const observation = this.view;
        this.agents[seat]
          .decide(this.engine, observation, seat)
          .then((d) => {
            if (
              this.stopped ||
              version !== (this.styleVersion ?? 0) ||
              lock !== this.view.locks[seat]
            )
              return;
            if (!d) {
              this.retryAfter ??= [0, 0];
              this.retryAfter[seat] = this.view.frame + 12;
              this.eventHistory.push({
                type: "replan",
                seat,
                frame: this.view.frame,
                reason: "제약을 유지하며 새 배치를 찾는 중",
              });
              return;
            }
            this.inspector[seat] = publicDecision(d);
            this.record.decisions.push({
              seat,
              frame: this.view.frame,
              lock,
              plan: d.plan,
              source: d.source,
              delayMs: d.delayMs,
              selected: d.candidate.id,
              traces: d.traces.map((t) => ({
                layer: t.layer,
                source: t.source,
                choice: t.choice,
                probabilities: t.probabilities,
                fallbackReason: t.fallbackReason,
                latencyMs: t.latencyMs,
                usage: t.usage,
                request: t.request
                  ? {
                      model: t.request.model,
                      state: t.request.state,
                      candidateIds: t.candidates.map((c) => c.id),
                    }
                  : null,
                response: t.response ?? null,
              })),
            });
            this.ready[seat] = {
              decision: d,
              lock,
              executeFrame:
                this.view.frame + Math.ceil((d.delayMs / 1000) * 60),
            };
          })
          .catch((error) => {
            if (this.stopped) return;
            this.agents[seat].plan = null;
            this.retryAfter ??= [0, 0];
            this.retryAfter[seat] = this.view.frame + 12;
            this.eventHistory.push({
              type: "replan",
              seat,
              frame: this.view.frame,
              reason: error.message,
            });
          })
          .finally(() => {
            this.pending[seat] = false;
          });
      }
    }
    if (this.view.frame % 2 === 0) {
      if (this.view.frame % 6 === 0) this.record.snapshots.push(this.view);
      this.onUpdate(this.message());
      this.lastEvents = [];
    }
    if (this.view.seats.some((s) => s.gameOver)) this.end("top_out");
    else if (this.view.frame >= this.maxFrames) this.end("time_limit");
  }
  message() {
    return {
      type: "state",
      state: this.view,
      inspectors: this.inspector,
      paused: this.paused,
      events: this.lastEvents ?? [],
      eventHistory: this.eventHistory,
      stats: this.stats,
      mode: this.mode,
      seed: this.seed,
    };
  }
  applyStyle(seat, style) {
    this.styles[seat] = validateStyle(style);
    this.agents[seat].setStyle(this.styles[seat]);
    this.ready[seat] = null;
    this.styleVersion = (this.styleVersion ?? 0) + 1;
    this.record.decisions.push({
      type: "style",
      frame: this.view.frame,
      seat,
      style: this.styles[seat],
    });
  }
  end(reason = "stopped") {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    if (this.view) this.record.snapshots.push(this.view);
    this.record.finalState = this.view ?? null;
    this.record.finalHash = this.view ? hash(this.view) : null;
    this.record.reason = reason;
    if (this.view) this.onUpdate({ ...this.message(), type: "ended", reason });
    this.engine.close();
    this.onEnd?.(this);
  }
  replay() {
    return this.record;
  }
}
export async function verifyReplay(record) {
  if (record.schemaVersion !== 1 || record.commands.length > 50000)
    throw new Error("Invalid replay");
  const engine = new EngineHost();
  try {
    let state = await engine.send({ op: "init", seed: record.seed });
    for (const cmd of record.commands) {
      if (!["tick", "place", "prepare"].includes(cmd.op))
        throw new Error("Invalid replay command");
      const out = await engine.send(cmd);
      state = out.state;
    }
    return {
      matches:
        hash(state) === record.finalHash ||
        (record.appVersion === "0.1.0" &&
          hash(
            Object.fromEntries(
              Object.entries(state).filter(([k]) => k !== "executing"),
            ),
          ) === record.finalHash),
      state,
      hash: hash(state),
    };
  } finally {
    engine.close();
  }
}
