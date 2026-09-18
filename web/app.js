const $ = (id) => document.getElementById(id);
const text = (id, value) => ($(id).textContent = value);
let bootstrap,
  styles,
  selected = 1,
  inspectSeat = 1,
  mode = "human",
  ws,
  playing = false,
  lastState = null,
  replayTimer = null,
  failedCompiles = 0;
const colors = {
  I: "#63bfc5",
  O: "#dbc76b",
  T: "#ae8acf",
  S: "#80b78c",
  Z: "#d57c7f",
  J: "#739acf",
  L: "#dba575",
  G: "#777f8b",
};
const labels = {
  perfectClear: "퍼펙트 클리어",
  sixThreeStacking: "6-3 스태킹",
  nineZeroStacking: "9-0 스태킹",
  tSpinDouble: "T-spin Double",
  tSpinTriple: "T-spin Triple",
  downstack: "다운스택",
  opener: "오프너",
  midgameSetup: "중반 빌드",
  freestyle: "프리스타일",
  forbidTSS: "T-spin Single 절대 금지",
  forbidMidgamePatterns: "중반 패턴 사용 금지",
  openerOnly: "오프너만 사용",
  pcOnlyWhenPossible: "가능한 즉시 PC만 선택",
  openerKnowledge: "오프너 지식",
  midgameKnowledge: "중반 빌드 지식",
  patternRecognition: "패턴 인식",
  lookahead: "앞 수 고려",
  selfPreservation: "생존 우선",
  greed: "위험 감수",
  spikePreference: "공격 집중",
  counterPreference: "카운터 선호",
  garbageTolerance: "가비지 감수",
  speed: "플레이 속도",
  hesitation: "망설임",
  consistency: "일관성",
  intentionalImperfection: "의도적 불완전함",
  enabled: "활성화",
  memeBuildPreference: "밈 빌드 선호",
  washingMachine: "Washing Machine",
  amongUs: "Among Us",
  weight: "상대 관찰 비중",
  patternRead: "상대 패턴 읽기",
  loopInterruption: "상대 루프 방해",
};
function announce(message, error = false) {
  text("match-status", message);
  $("match-status").className = error ? "error" : "";
}
function transmit(data) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  else announce("연결을 확인해 주세요.", true);
}
function drawBoard(id, state) {
  const canvas = $(id),
    dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(h * dpr)
  ) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const cell = w / 10;
  c.strokeStyle = "#1a2029";
  c.lineWidth = 0.5;
  for (let x = 1; x < 10; x++) {
    c.beginPath();
    c.moveTo(x * cell, 0);
    c.lineTo(x * cell, h);
    c.stroke();
  }
  for (let y = 1; y < 20; y++) {
    c.beginPath();
    c.moveTo(0, y * cell);
    c.lineTo(w, y * cell);
    c.stroke();
  }
  function paint(cells, ghost = false) {
    for (const [x, y, p] of cells ?? []) {
      if (y < 0 || y >= 20) continue;
      const px = x * cell,
        py = (19 - y) * cell;
      c.fillStyle = colors[p] || colors.G;
      if (ghost) {
        c.strokeStyle = colors[p] || "#9ba3ae";
        c.globalAlpha = 0.3;
        c.strokeRect(px + 3, py + 3, cell - 6, cell - 6);
        c.globalAlpha = 1;
      } else {
        c.fillRect(px + 1, py + 1, cell - 2, cell - 2);
        c.fillStyle = "#ffffff35";
        c.fillRect(px + 1, py + 1, cell - 2, 2);
      }
    }
  }
  if (state) {
    paint(state.ghost, true);
    paint(state.board);
    paint(state.active?.cells);
  }
}
function renderState(state, paused = false) {
  lastState = state;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? "a" : "b",
      s = state?.seats[i];
    drawBoard("board-" + side, s);
    if (s) {
      text("lines-" + side, `${s.lines} LINES`);
      text("hold-" + side, `HOLD ${s.hold ?? "·"}`);
      text("next-" + side, `NEXT ${s.next.slice(0, 5).join(" ")}`);
      text("garbage-" + side, s.garbage);
      const overlay = $("overlay-" + side);
      overlay.hidden = !s.gameOver && !paused;
      overlay.textContent = s.gameOver ? "GAME OVER" : paused ? "PAUSED" : "";
    }
  }
  const sec = Math.floor((state?.frame ?? 0) / 60);
  text(
    "match-clock",
    `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`,
  );
}
let inspectors = [null, null];
function showInspector() {
  const d = inspectors[inspectSeat];
  if (!d) {
    text("plan-name", "첫 선택을 기다리는 중");
    $("candidates").replaceChildren();
    return;
  }
  text("plan-name", d.plan.name);
  text(
    "plan-progress",
    `진행 ${d.plan.step} / ${d.plan.total} · 실행 대기 ${d.delayMs} ms`,
  );
  text(
    "decision-source",
    d.source === "jev"
      ? "Jev 결정"
      : d.source === "mock"
        ? "테스트 Mock"
        : "Fallback · 규칙 기반",
  );
  text("latency", `${d.latencyMs} ms`);
  text("candidate-count", `${d.candidateCount} 후보`);
  $("candidates").replaceChildren();
  for (const option of d.options) {
    const row = document.createElement("div");
    row.className = "candidate" + (option.id === d.choice ? " chosen" : "");
    const left = document.createElement("span");
    left.textContent = `${option.piece} · 열 ${option.x + 1} · ${option.rotation * 90}°${option.pc ? " · PC" : option.lines ? " · " + option.lines + "L" : ""}`;
    const right = document.createElement("span");
    right.className = "probability";
    right.textContent =
      option.probability === null
        ? "·"
        : `${(option.probability * 100).toFixed(1)}%`;
    row.append(left, right);
    $("candidates").append(row);
  }
  text(
    "decision-note",
    d.source === "jev"
      ? `실제 Jev 확률입니다.${d.styleEffects.tssFiltered ? " TSS 후보는 제거되었습니다." : ""}`
      : `${d.fallbackReason === "key_missing" ? "Jev 키가 아직 없습니다." : "Jev 응답을 사용할 수 없습니다."} 유효 후보 중 fallback으로 선택했습니다. 표시할 모델 확률은 없습니다.`,
  );
}
function control(group, key, value) {
  const wrapper = document.createElement("div"),
    id = `control-${group}-${key}`;
  if (typeof value === "boolean") {
    wrapper.className = "toggle";
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = labels[key] ?? key;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = value;
    input.addEventListener("change", () => {
      styles[selected][group][key] = input.checked;
      edited();
    });
    wrapper.append(label, input);
  } else {
    wrapper.className = "control";
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = labels[key] ?? key;
    const output = document.createElement("output");
    output.textContent = Math.round(value * 100);
    label.append(output);
    const input = document.createElement("input");
    input.type = "range";
    input.min = 0;
    input.max = 100;
    input.value = Math.round(value * 100);
    input.id = id;
    input.addEventListener("input", () => {
      styles[selected][group][key] = Number(input.value) / 100;
      output.textContent = input.value;
    });
    input.addEventListener("change", edited);
    wrapper.append(label, input);
  }
  if (
    ["washingMachine", "amongUs", "patternRead", "loopInterruption"].includes(
      key,
    )
  ) {
    wrapper.querySelector("input").disabled = true;
    wrapper.querySelector("label").append(" · 준비 중");
  }
  return wrapper;
}
function edited() {
  styles[selected].label = "Custom style";
  renderLabels();
  if (playing)
    transmit({ type: "style", seat: selected, style: styles[selected] });
}
function renderLabels() {
  text("style-label", styles[selected].label);
  text("label-b", styles[1].label);
  text("label-a", mode === "human" ? "직접 플레이" : styles[0].label);
  text("name-a", mode === "human" ? "YOU" : "JEV A");
  text("name-b", mode === "human" ? "JEV" : "JEV B");
  text("editing-seat", selected === 0 ? "봇 A" : "상대 B");
}
function renderControls() {
  renderLabels();
  $("controls").replaceChildren();
  const style = styles[selected];
  const primary = [
    ["strategyPreferences", "perfectClear"],
    ["strategyPreferences", "tSpinDouble"],
    ["strategyPreferences", "tSpinTriple"],
    ["execution", "speed"],
    ["risk", "selfPreservation"],
    ["hardConstraints", "forbidTSS"],
  ];
  for (const [g, k] of primary)
    $("controls").append(control(g, k, style[g][k]));
  for (const [g, title] of Object.entries({
    strategyPreferences: "전략 선호",
    hardConstraints: "절대 규칙",
    knowledge: "전략 지식",
    risk: "위험과 대응",
    execution: "실행과 망설임",
    showmanship: "쇼맨십",
    opponentAwareness: "상대 관찰",
  })) {
    const details = document.createElement("details");
    details.className = "controls-details";
    const summary = document.createElement("summary");
    summary.textContent = title;
    details.append(summary);
    for (const [k, v] of Object.entries(style[g]))
      if (!primary.some(([a, b]) => a === g && b === k))
        details.append(control(g, k, v));
    $("controls").append(details);
  }
  for (const button of document.querySelectorAll("[data-seat]"))
    button.classList.toggle(
      "selected",
      Number(button.dataset.seat) === selected,
    );
  text(
    "profile-notice",
    style.hardConstraints.openerOnly
      ? "진행 가능한 오프너가 없으면 이 스타일은 경기를 포기합니다."
      : "금지 규칙은 후보를 제거하고, 선호도는 선택에 반영합니다.",
  );
}
function setMode(next) {
  if (playing) return;
  mode = next;
  selected = 1;
  $("seat-tabs").hidden = mode === "human";
  for (const [id, type] of [
    ["human-mode", "human"],
    ["bot-mode", "bots"],
  ]) {
    $(id).classList.toggle("selected", next === type);
    $(id).setAttribute("aria-pressed", String(next === type));
  }
  renderControls();
}
function setPlaying(value) {
  playing = value;
  $("start").textContent = value ? "새 경기 시작 ↗" : "대전 시작 ↗";
  $("pause").disabled = !value;
  $("stop").disabled = !value;
  $("human-mode").disabled = value;
  $("bot-mode").disabled = value;
  $("save-replay").disabled = !lastState;
}
function openSocket() {
  ws = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/play`,
  );
  ws.addEventListener("open", () => {
    text("connection-state", "CONNECTED");
    $("start").disabled = false;
  });
  ws.addEventListener("close", () => {
    text("connection-state", "연결 끊김");
    setPlaying(false);
    $("start").disabled = true;
    announce("연결이 종료되었습니다. 새로고침해 주세요.", true);
  });
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (m.type === "state" || m.type === "ended") {
      inspectors = m.inspectors;
      renderState(m.state, m.paused);
      showInspector();
      text(
        "live-label",
        m.type === "ended" ? "종료" : m.paused ? "PAUSED" : "LIVE",
      );
      setPlaying(m.type !== "ended");
      if (m.type === "ended") {
        const messages = {
          top_out: "경기가 끝났습니다.",
          no_allowed_move:
            "스타일의 절대 규칙 안에서 가능한 수가 없어 경기를 마쳤습니다.",
          time_limit: "경기 시간 제한에 도달했습니다.",
          engine_error: "엔진 연결이 종료되었습니다.",
          decision_error: "결정 처리에 문제가 생겼습니다.",
          saved: "경기를 저장했습니다.",
          stopped: "경기를 종료했습니다.",
        };
        announce(messages[m.reason] ?? "경기가 종료되었습니다.");
      } else
        announce(
          m.paused
            ? "일시 정지 상태입니다."
            : mode === "human"
              ? "보드 밖 입력란에 포커스가 있으면 게임 키가 작동하지 않습니다."
              : "두 스타일의 선택을 관찰하고 있습니다.",
        );
    } else if (m.type === "replay") {
      const blob = new Blob([JSON.stringify(m.data)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `style-match-${m.data.seed}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      text("replay-status", "결정 로그와 경기 상태를 저장했습니다.");
    } else if (m.type === "error") announce(m.message, true);
  });
}
$("human-mode").onclick = () => setMode("human");
$("bot-mode").onclick = () => setMode("bots");
$("random-seed").onclick = () => {
  $("seed").value = crypto.getRandomValues(new Uint32Array(1))[0];
};
$("start").onclick = () => {
  clearInterval(replayTimer);
  const seed = Number($("seed").value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    announce("시드는 0~4294967295 정수로 입력해 주세요.", true);
    return;
  }
  inspectors = [null, null];
  transmit({ type: "start", seed, mode, styles });
  if (mode === "human") $("board-a").focus();
};
$("pause").onclick = () => transmit({ type: "pause" });
$("stop").onclick = () => transmit({ type: "stop" });
$("save-replay").onclick = () => transmit({ type: "replay" });
$("preset").onchange = () => {
  styles[selected] = structuredClone(
    bootstrap.presets[Number($("preset").value)],
  );
  renderControls();
  if (playing)
    transmit({ type: "style", seat: selected, style: styles[selected] });
};
for (const b of document.querySelectorAll("[data-seat]"))
  b.onclick = () => {
    selected = Number(b.dataset.seat);
    renderControls();
  };
for (const b of document.querySelectorAll("[data-inspect]"))
  b.onclick = () => {
    inspectSeat = Number(b.dataset.inspect);
    for (const x of document.querySelectorAll("[data-inspect]"))
      x.classList.toggle("selected", x === b);
    showInspector();
  };
$("apply").onclick = async () => {
  const prompt = $("prompt").value.trim();
  if (!prompt) {
    text("compile-status", "원하는 플레이 스타일을 입력해 주세요.");
    return;
  }
  const target = selected;
  $("apply").disabled = true;
  text("compile-status", "스타일을 해석하고 있습니다…");
  try {
    const r = await fetch("/api/style", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": bootstrap.csrf,
      },
      body: JSON.stringify({ text: prompt }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    styles[target] = data.profile;
    if (target === selected) renderControls();
    if (playing) transmit({ type: "style", seat: target, style: data.profile });
    text(
      "compile-status",
      "스타일을 적용했습니다. 슬라이더로 더 조정할 수 있습니다.",
    );
    $("compile-status").className = "help success";
    failedCompiles = 0;
  } catch (e) {
    failedCompiles++;
    text(
      "compile-status",
      e.message + (failedCompiles > 1 ? " 프리셋으로 테스트해 보세요." : ""),
    );
    $("compile-status").className = "help error";
  } finally {
    $("apply").disabled = false;
  }
};
const keymap = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowDown: "soft",
  KeyS: "soft",
  Space: "drop",
  ArrowUp: "cw",
  KeyW: "cw",
  KeyZ: "ccw",
  ShiftLeft: "hold",
  ShiftRight: "hold",
};
const held = new Map();
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input,textarea,select,button") || !playing) return;
  if (e.code === "Escape") {
    transmit({ type: "pause" });
    return;
  }
  const action = keymap[e.code];
  if (action) {
    e.preventDefault();
    if (!held.has(e.code)) {
      held.set(e.code, {
        action,
        time: performance.now(),
        last: performance.now(),
      });
      transmit({ type: "input", action });
    }
  }
});
document.addEventListener("keyup", (e) => held.delete(e.code));
window.addEventListener("blur", () => held.clear());
setInterval(() => {
  if (!playing) return;
  const now = performance.now();
  for (const item of held.values()) {
    if (
      ["left", "right", "soft"].includes(item.action) &&
      now - item.time > 140 &&
      now - item.last > 45
    ) {
      transmit({ type: "input", action: item.action });
      item.last = now;
    }
  }
}, 16);
for (const b of document.querySelectorAll("[data-action]"))
  b.onclick = () => {
    if (playing) transmit({ type: "input", action: b.dataset.action });
  };
$("replay-file").onchange = async () => {
  const file = $("replay-file").files[0];
  if (!file) return;
  try {
    if (file.size > 30_000_000) throw new Error("파일이 너무 큽니다.");
    const r = JSON.parse(await file.text());
    if (
      r.schemaVersion !== 1 ||
      !Array.isArray(r.snapshots) ||
      !r.snapshots.length ||
      r.snapshots.length > 5000
    )
      throw new Error("지원하지 않는 리플레이입니다.");
    for (const s of r.snapshots) {
      if (
        !Number.isInteger(s.frame) ||
        !Array.isArray(s.seats) ||
        s.seats.length !== 2
      )
        throw new Error("잘못된 경기 상태입니다.");
      for (const seat of s.seats) {
        if (
          !Array.isArray(seat.board) ||
          seat.board.length > 400 ||
          !Array.isArray(seat.next) ||
          !Array.isArray(seat.ghost)
        )
          throw new Error("잘못된 보드입니다.");
      }
    }
    if (playing) transmit({ type: "stop" });
    clearInterval(replayTimer);
    let i = 0;
    setPlaying(false);
    text("replay-status", "로컬 재생 · 외부 API 호출 없음");
    text("live-label", "REPLAY");
    replayTimer = setInterval(() => {
      if (i >= r.snapshots.length) {
        clearInterval(replayTimer);
        text("replay-status", "리플레이 재생 완료");
        return;
      }
      renderState(r.snapshots[i++]);
    }, 100);
  } catch (e) {
    text("replay-status", e.message);
  }
};
window.addEventListener("resize", () => renderState(lastState));
try {
  bootstrap = await (await fetch("/api/bootstrap")).json();
  styles = [
    structuredClone(bootstrap.presets[0]),
    structuredClone(bootstrap.presets[0]),
  ];
  text("brand", bootstrap.branding.name);
  document.title = bootstrap.branding.title;
  text("footer-text", bootstrap.branding.footer);
  document.querySelector("meta[name=description]").content =
    bootstrap.branding.description;
  document.querySelector('meta[property="og:title"]').content =
    bootstrap.branding.title;
  document.querySelector("link[rel=icon]").href = bootstrap.branding.logo;
  text(
    "provider-state",
    bootstrap.providers.jev ? "Jev 연결 준비" : "Fallback 모드",
  );
  bootstrap.presets.forEach((p, i) => {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = p.label;
    $("preset").append(option);
  });
  renderControls();
  renderState(null);
  openSocket();
} catch {
  announce("서버에 연결하지 못했습니다. 새로고침해 주세요.", true);
}
