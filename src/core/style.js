export const DEFAULT_STYLE = {
  version: 1,
  label: "Balanced",
  hardConstraints: {
    forbidTSS: false,
    forbidMidgamePatterns: false,
    openerOnly: false,
    pcOnlyWhenPossible: false,
  },
  strategyPreferences: {
    perfectClear: 0.45,
    sixThreeStacking: 0,
    nineZeroStacking: 0.25,
    tSpinDouble: 0.65,
    tSpinTriple: 0.35,
    downstack: 0.65,
    opener: 0.55,
    midgameSetup: 0.55,
    freestyle: 0.6,
  },
  knowledge: {
    openerKnowledge: 0.7,
    midgameKnowledge: 0.65,
    patternRecognition: 0.7,
    lookahead: 0.6,
  },
  risk: {
    selfPreservation: 0.75,
    greed: 0.35,
    spikePreference: 0.5,
    counterPreference: 0.5,
    garbageTolerance: 0.4,
  },
  execution: {
    speed: 0.55,
    hesitation: 0.2,
    consistency: 0.95,
    intentionalImperfection: 0,
  },
  showmanship: {
    enabled: false,
    memeBuildPreference: 0.1,
    washingMachine: 0.1,
    amongUs: 0.1,
  },
  opponentAwareness: {
    enabled: true,
    weight: 0.6,
    patternRead: 0.4,
    loopInterruption: 0.3,
  },
};
export function validateStyle(value) {
  function walk(v, template, path) {
    if (typeof template === "object") {
      if (!v || typeof v !== "object" || Array.isArray(v))
        throw new Error(`Invalid ${path}`);
      if (Object.keys(v).some((k) => !Object.hasOwn(template, k)))
        throw new Error(`Unknown field ${path}`);
      return Object.fromEntries(
        Object.entries(template).map(([k, t]) => [
          k,
          walk(v[k], t, `${path}.${k}`),
        ]),
      );
    }
    if (typeof v !== typeof template) throw new Error(`Invalid ${path}`);
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error(`Invalid ${path}`);
      if (path === "style.version") {
        if (v !== 1) throw new Error("Unsupported version");
        return 1;
      }
      return Math.min(1, Math.max(0, v));
    }
    if (typeof v === "string") {
      if (!v.trim() || v.length > 60) throw new Error(`Invalid ${path}`);
      return v.trim();
    }
    return v;
  }
  return walk(value, DEFAULT_STYLE, "style");
}
function schemaOf(value, key) {
  if (typeof value === "object")
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, schemaOf(v, k)]),
      ),
      required: Object.keys(value),
    };
  if (typeof value === "number")
    return key === "version"
      ? { type: "integer", enum: [1] }
      : { type: "number", minimum: 0, maximum: 1 };
  return typeof value === "string"
    ? { type: "string", minLength: 1, maxLength: 60 }
    : { type: "boolean" };
}
export const STYLE_SCHEMA = schemaOf(DEFAULT_STYLE);
function preset(label, changes) {
  const p = structuredClone(DEFAULT_STYLE);
  p.label = label;
  for (const [key, value] of Object.entries(changes))
    Object.assign(p[key], value);
  return validateStyle(p);
}
export const PRESETS = [
  preset("Balanced", {}),
  preset("PC Addict", {
    strategyPreferences: { perfectClear: 1, downstack: 0.2 },
    risk: { greed: 0.95, selfPreservation: 0.25 },
  }),
  preset("6-3 Stacker", {
    strategyPreferences: { sixThreeStacking: 1, nineZeroStacking: 0 },
  }),
  preset("9-0 Stacker", {
    strategyPreferences: { sixThreeStacking: 0, nineZeroStacking: 1 },
  }),
  preset("TST Maniac", {
    strategyPreferences: { tSpinTriple: 1, tSpinDouble: 0.15 },
    risk: { greed: 0.9, selfPreservation: 0.35 },
  }),
  preset("TSD Grinder", {
    strategyPreferences: { tSpinDouble: 1, tSpinTriple: 0.1 },
  }),
  preset("No TSS", {
    hardConstraints: { forbidTSS: true },
    strategyPreferences: { tSpinDouble: 1 },
  }),
  preset("Opener Bot", {
    strategyPreferences: { opener: 1, midgameSetup: 0.1 },
    knowledge: { openerKnowledge: 1, midgameKnowledge: 0.1 },
  }),
  preset("Opener Loop Bot", {
    hardConstraints: { openerOnly: true },
    strategyPreferences: { opener: 1, perfectClear: 0.9 },
    knowledge: { openerKnowledge: 1 },
  }),
  preset("Midgame Builder", {
    strategyPreferences: { midgameSetup: 1, opener: 0.2 },
    knowledge: { midgameKnowledge: 1 },
  }),
  preset("No Midgame Knowledge", {
    hardConstraints: { forbidMidgamePatterns: true },
    knowledge: { midgameKnowledge: 0 },
  }),
  preset("Sprint-minded", {
    strategyPreferences: { freestyle: 1, midgameSetup: 0.1, opener: 0.1 },
    execution: { speed: 1, hesitation: 0 },
  }),
  preset("Safe Player", {
    risk: { selfPreservation: 1, greed: 0 },
    strategyPreferences: { downstack: 1 },
  }),
  preset("Greedy Spike Player", {
    risk: { greed: 1, spikePreference: 1, selfPreservation: 0.2 },
  }),
  preset("Troll / Showman", {
    showmanship: {
      enabled: true,
      memeBuildPreference: 1,
      washingMachine: 1,
      amongUs: 1,
    },
    knowledge: { midgameKnowledge: 1 },
    risk: { selfPreservation: 0.4 },
  }),
  preset("Beginner", {
    knowledge: {
      openerKnowledge: 0,
      midgameKnowledge: 0,
      patternRecognition: 0,
      lookahead: 0,
    },
    execution: {
      speed: 0.3,
      hesitation: 0.6,
      consistency: 0.4,
      intentionalImperfection: 0.2,
    },
  }),
  preset("Slow Expert", {
    knowledge: {
      openerKnowledge: 1,
      midgameKnowledge: 1,
      patternRecognition: 1,
      lookahead: 1,
    },
    execution: { speed: 0.1, hesitation: 0.5, consistency: 1 },
  }),
];
export function publicOpponent(seat, style) {
  if (!style.opponentAwareness.enabled) return null;
  return {
    board: seat.board,
    stackHeight: Math.max(0, ...seat.board.map((c) => c[1] + 1)),
    visibleGarbage: seat.garbage,
    combo: seat.combo,
    b2b: seat.b2b,
  };
}
export function allowedCandidates(candidates, style) {
  let list = candidates.filter(
    (c) =>
      !(style.hardConstraints.forbidTSS && c.spin !== "none" && c.lines === 1),
  );
  const live = list.filter((c) => !c.dead);
  if (live.length) list = live;
  if (style.hardConstraints.pcOnlyWhenPossible && list.some((c) => c.pc))
    list = list.filter((c) => c.pc);
  return list;
}
export function seededRandom(seed) {
  let x = seed >>> 0;
  return () => {
    x += 0x6d2b79f5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function humanDelay(style, random, difficulty = 0) {
  return Math.round(
    100 +
      (1 - style.execution.speed) * 1000 +
      style.execution.hesitation * (150 + random() * 500) * (1 + difficulty) +
      (1 - style.execution.consistency) * random() * 300,
  );
}
