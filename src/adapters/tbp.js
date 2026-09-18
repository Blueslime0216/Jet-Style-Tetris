import { EngineHost } from "./engine.js";
import { DEFAULT_STYLE, allowedCandidates } from "../core/style.js";
import { fallbackScore } from "../core/agent.js";
export function toTBP(c) {
  const offset =
    c.piece === "I"
      ? [
          [1, 2],
          [2, 2],
          [2, 1],
          [1, 1],
        ][c.rotation]
      : [1, 1];
  return {
    location: {
      type: c.piece,
      orientation: ["north", "east", "south", "west"][c.rotation],
      x: c.x + offset[0],
      y: c.y + offset[1],
    },
    spin: c.spin,
  };
}
function sameMove(a, b) {
  return (
    b &&
    a.spin === b.spin &&
    ["type", "orientation", "x", "y"].every(
      (k) => a.location[k] === b.location?.[k],
    )
  );
}
export class TBPAdapter {
  constructor(provider = null, style = DEFAULT_STYLE) {
    this.engine = new EngineHost();
    this.provider = provider;
    this.style = structuredClone(style);
    this.state = null;
    this.lastCandidates = [];
  }
  info() {
    return {
      type: "info",
      name: "Style Agent",
      version: "0.1.0",
      author: "Style Agent contributors",
      features: [],
    };
  }
  async message(message) {
    switch (message.type) {
      case "rules":
        return { type: "ready" };
      case "start": {
        if (
          !Array.isArray(message.board) ||
          message.board.length !== 40 ||
          message.board.some(
            (r) =>
              !Array.isArray(r) ||
              r.length !== 10 ||
              r.some(
                (c) =>
                  c !== null &&
                  !["I", "O", "T", "S", "Z", "J", "L", "G"].includes(c),
              ),
          ) ||
          !Array.isArray(message.queue) ||
          !message.queue.length ||
          message.queue.length > 32 ||
          message.queue.some(
            (p) => !["I", "O", "T", "S", "Z", "J", "L"].includes(p),
          )
        )
          throw new Error("Invalid TBP start");
        if (
          (message.hold !== null &&
            !["I", "O", "T", "S", "Z", "J", "L"].includes(message.hold)) ||
          !Number.isInteger(message.combo) ||
          message.combo < 0 ||
          message.combo > 100000 ||
          typeof message.back_to_back !== "boolean"
        )
          throw new Error("Invalid TBP state");
        this.state = structuredClone(message);
        this.lastCandidates = [];
        return null;
      }
      case "suggest": {
        if (!this.state) return null;
        const s = this.state;
        const candidates = allowedCandidates(
          await this.engine.send({
            op: "analyze",
            board: s.board,
            hold: s.hold,
            queue: s.queue,
            b2b: s.back_to_back,
            combo: s.combo,
          }),
          this.style,
        );
        this.lastCandidates = candidates;
        if (!candidates.length) return { type: "suggestion", moves: [] };
        let choice;
        if (this.provider)
          try {
            const r = await this.provider.choose(
              { self: s, style: this.style },
              candidates.slice(0, 255).map(({ after, ...c }) => c),
              "placement",
            );
            choice = candidates.find((c) => c.id === r.choice);
          } catch {}
        choice ??= [...candidates].sort(
          (a, b) => fallbackScore(b, this.style) - fallbackScore(a, this.style),
        )[0];
        return { type: "suggestion", moves: [toTBP(choice)] };
      }
      case "play": {
        if (!this.state) return null;
        let c = this.lastCandidates.find((c) =>
          sameMove(toTBP(c), message.move),
        );
        if (!c) {
          await this.message({ type: "suggest" });
          c = this.lastCandidates.find((c) => sameMove(toTBP(c), message.move));
        }
        if (!c) throw new Error("Unreachable TBP move");
        const s = this.state;
        const active = s.queue.shift();
        if (c.hold) {
          if (s.hold === null) s.queue.shift();
          s.hold = active;
        }
        s.board = Array.from({ length: 40 }, () => Array(10).fill(null));
        for (const [x, y] of c.after) if (y >= 0 && y < 40) s.board[y][x] = "G";
        s.combo = c.lines ? s.combo + 1 : 0;
        if (c.lines) s.back_to_back = c.lines === 4 || c.spin !== "none";
        this.lastCandidates = [];
        return null;
      }
      case "new_piece":
        if (
          this.state &&
          ["I", "O", "T", "S", "Z", "J", "L"].includes(message.piece) &&
          this.state.queue.length < 32
        )
          this.state.queue.push(message.piece);
        return null;
      case "stop":
        this.state = null;
        this.lastCandidates = [];
        return null;
      case "quit":
        this.close();
        return null;
      default:
        return null;
    }
  }
  close() {
    this.engine.close();
  }
}
