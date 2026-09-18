mod motion;
mod planner;
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
use tetr_core::ai::eval::features::BoardFeatures;
use tetr_core::ai::{Placement, SearchState, generate, generate_with_hold};
use tetr_core::engine::*;

fn kind(p: PieceType) -> String {
    format!("{p:?}")
}
fn spin(p: &Placement, state: &SearchState) -> &'static str {
    match classify_t_spin(&p.piece, &state.board) {
        Some(TSpinKind::Full) => "full",
        Some(TSpinKind::Mini) => "mini",
        None => "none",
    }
}
fn placements(state: &SearchState, hold_used: bool) -> Vec<Placement> {
    if hold_used {
        generate(&state.board, &state.active)
    } else {
        generate_with_hold(
            &state.board,
            &state.active,
            state.hold,
            state.queue.first().copied(),
            |p| {
                let piece = Piece::from(p);
                ActivePiece::new(p, piece.spawn_coords(10, 20))
            },
        )
    }
}
fn id(p: &Placement, state: &SearchState) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}",
        kind(p.piece_type()),
        p.rotation() as u8,
        p.origin().0,
        p.origin().1,
        p.used_hold,
        spin(p, state)
    )
}
fn candidate(p: &Placement, state: &SearchState) -> Value {
    let mut next = state.clone();
    let outcome = next.commit_placement(p);
    let feat = BoardFeatures::extract_cols(next.board.columns(), &outcome);
    let heights: Vec<u32> = next
        .board
        .columns()
        .iter()
        .map(|x| 64 - x.leading_zeros())
        .collect();
    let lines = outcome.cleared_rows.len();
    let sp = classify_t_spin(&p.piece, &state.board);
    let action = match sp {
        Some(k) => EngineScoreAction::TSpin { kind: k, lines },
        None => match lines {
            1 => EngineScoreAction::Single,
            2 => EngineScoreAction::Double,
            3 => EngineScoreAction::Triple,
            4 => EngineScoreAction::Tetris,
            _ => EngineScoreAction::NoClear,
        },
    };
    let attack = attack_lines(
        action,
        state.b2b && qualifies_for_back_to_back(sp, lines),
        state.combo,
        next.board.is_empty(),
    );
    json!({"id":id(p,state),"piece":kind(p.piece_type()),"rotation":p.rotation() as u8,"x":p.origin().0,"y":p.origin().1,"hold":p.used_hold,"spin":spin(p,state),"lines":lines,"attack":attack,"pc":next.board.is_empty(),"dead":next.dead,"holes":feat.holes,"height":heights.iter().max().copied().unwrap_or(0),"heights":heights,"bumpiness":heights.windows(2).map(|w|w[0].abs_diff(w[1])).sum::<u32>(),"aggregateHeight":heights.iter().sum::<u32>(),"well":feat.tetris_well,"nearFull":feat.near_full_rows,"cells":p.piece.piece().cells().map(|(x,y)|[x+p.origin().0,y+p.origin().1]),"after":next.board.cell_coords().iter().map(|(x,y)|[*x,*y]).collect::<Vec<_>>()})
}
fn cells(c: &[SnapshotCell]) -> Value {
    json!(
        c.iter()
            .map(|c| json!([
                c.x,
                c.y,
                if c.garbage {
                    "G".into()
                } else {
                    kind(c.piece_type)
                }
            ]))
            .collect::<Vec<_>>()
    )
}
fn snapshot(s: &EngineSnapshot) -> Value {
    json!({"board":cells(&s.board_cells),"active":s.active.as_ref().map(|a|json!({"piece":kind(a.piece_type),"rotation":a.rotation as u8,"x":a.origin.0,"y":a.origin.1,"cells":cells(&a.cells),"holdUsed":a.hold_used})),"ghost":cells(&s.ghost_cells),"hold":s.hold.map(kind),"next":s.next_queue.iter().map(|p|kind(*p)).collect::<Vec<_>>(),"score":s.score,"lines":s.lines,"combo":s.combo,"b2b":s.back_to_back_active,"garbage":s.pending_garbage_total(),"gameOver":s.game_over.is_some()})
}
fn parse_piece(v: &Value) -> Result<PieceType, String> {
    match v.as_str() {
        Some("I") => Ok(PieceType::I),
        Some("O") => Ok(PieceType::O),
        Some("T") => Ok(PieceType::T),
        Some("S") => Ok(PieceType::S),
        Some("Z") => Ok(PieceType::Z),
        Some("J") => Ok(PieceType::J),
        Some("L") => Ok(PieceType::L),
        _ => Err("invalid piece".into()),
    }
}
fn input(v: &Value) -> InputFrame {
    InputFrame {
        dt_seconds: 1.0 / 60.0,
        left: v["left"] == true,
        right: v["right"] == true,
        soft_drop: v["soft"] == true,
        hard_drop: v["drop"] == true,
        rotate_clockwise: v["cw"] == true,
        rotate_counterclockwise: v["ccw"] == true,
        hold: v["hold"] == true,
        ..Default::default()
    }
}
fn meets_goal(c: &Value, goal: &str) -> bool {
    match goal {
        "pc" => c["pc"] == true,
        "tss" => c["spin"] != "none" && c["lines"] == 1,
        "tsd" => c["spin"] == "full" && c["lines"] == 2,
        "tst" => c["spin"] == "full" && c["lines"] == 3,
        _ => false,
    }
}
fn template_route(
    state: &SearchState,
    used: bool,
    targets: &[(PieceType, Vec<(isize, isize)>)],
    budget: &mut usize,
    goal: &str,
) -> Option<Vec<Value>> {
    if targets.is_empty() {
        let goals = goal_routes(state, used, 3);
        return goals
            .iter()
            .find(|p| p["strategy"] == goal)
            .and_then(|p| p["route"].as_array().cloned())
            .or(Some(vec![]));
    }
    if *budget == 0 || state.dead {
        return None;
    }
    *budget -= 1;
    for p in placements(state, used) {
        let cells: Vec<_> = p
            .piece
            .piece()
            .cells()
            .iter()
            .map(|(x, y)| (x + p.origin().0, y + p.origin().1))
            .collect();
        if let Some(index) = targets.iter().position(|(kind, wanted)| {
            *kind == p.piece_type() && wanted.len() == 4 && cells.iter().all(|c| wanted.contains(c))
        }) {
            let mut next = state.clone();
            let out = next.commit_placement(&p);
            let mut remaining = targets.to_vec();
            remaining.remove(index);
            let c = candidate(&p, state);
            if remaining.is_empty() {
                if meets_goal(&c, goal) {
                    return Some(vec![c]);
                }
                if state.queue.len() < 1 + usize::from(p.used_hold && state.hold.is_none()) {
                    // The next active piece is unknown, but the held piece is
                    // still public and can finish the opener immediately.
                    if next.hold.is_some() {
                        for finish in placements(&next, false).into_iter().filter(|p| p.used_hold) {
                            let end = candidate(&finish, &next);
                            if meets_goal(&end, goal) {
                                return Some(vec![c, end]);
                            }
                        }
                    }
                    return Some(vec![c]);
                }
            }
            if !remaining.is_empty()
                && (!out.cleared_rows.is_empty()
                    || state.queue.len() < 1 + usize::from(p.used_hold && state.hold.is_none()))
            {
                continue;
            }
            if let Some(mut route) = template_route(&next, false, &remaining, budget, goal) {
                route.insert(0, candidate(&p, state));
                return Some(route);
            }
        }
    }
    None
}
fn goal_routes(state: &SearchState, hold_used: bool, depth: usize) -> Vec<Value> {
    let mut frontier = vec![(state.clone(), Vec::<Value>::new(), hold_used)];
    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for _ in 0..depth.min(3) {
        let mut nexts = Vec::new();
        for (node, route, used) in frontier {
            for p in placements(&node, used) {
                let c = candidate(&p, &node);
                if c["dead"] == true {
                    continue;
                }
                let mut path = route.clone();
                path.push(c.clone());
                let goal = if c["pc"] == true {
                    Some("pc")
                } else if c["spin"] != "none" && c["lines"] == 1 {
                    Some("tss")
                } else if c["spin"] != "none" && c["lines"] == 2 {
                    Some("tsd")
                } else if c["spin"] != "none" && c["lines"] == 3 {
                    Some("tst")
                } else {
                    None
                };
                if let Some(g) = goal
                    && seen.insert(g.to_string())
                {
                    found.push(json!({"id":format!("{}-{}",g,found.len()),"name":match g {"pc"=>"Perfect clear route","tsd"=>"T-spin double route","tss"=>"T-spin single route",_=>"T-spin triple route"},"strategy":g,"route":path}));
                }
                if node.queue.len() < 1 + usize::from(p.used_hold && node.hold.is_none()) {
                    continue;
                }
                let score = c["holes"].as_f64().unwrap_or(0.) * 15.
                    + c["aggregateHeight"].as_f64().unwrap_or(0.) * 0.4
                    + c["bumpiness"].as_f64().unwrap_or(0.) * 0.5
                    - c["lines"].as_f64().unwrap_or(0.) * 8.;
                let mut child = node.clone();
                child.commit_placement(&p);
                nexts.push((score, child, path, false));
            }
        }
        nexts.sort_by(|a, b| a.0.total_cmp(&b.0));
        frontier = nexts
            .into_iter()
            .take(14)
            .map(|(_, s, p, u)| (s, p, u))
            .collect();
    }
    found
}
fn mask_route(
    state: &SearchState,
    used: bool,
    mask: &[(isize, isize)],
    budget: &mut usize,
    seen: &mut std::collections::HashSet<String>,
) -> Option<Vec<Value>> {
    if state.board.cell_coords().len() == mask.len() {
        return Some(vec![]);
    }
    if *budget == 0 || state.dead {
        return None;
    }
    *budget -= 1;
    let key = format!(
        "{:?}{:?}{:?}{:?}",
        state.board.columns(),
        state.active.piece_type(),
        state.hold,
        state.queue
    );
    if !seen.insert(key) {
        return None;
    }
    for p in placements(state, used) {
        if !p
            .piece
            .piece()
            .cells()
            .iter()
            .all(|(x, y)| mask.contains(&(x + p.origin().0, y + p.origin().1)))
        {
            continue;
        }
        let mut next = state.clone();
        let out = next.commit_placement(&p);
        if !out.cleared_rows.is_empty() {
            continue;
        }
        if next.board.cell_coords().len() < mask.len()
            && state.queue.len() < 1 + usize::from(p.used_hold && state.hold.is_none())
        {
            continue;
        }
        if let Some(mut path) = mask_route(&next, false, mask, budget, seen) {
            path.insert(0, candidate(&p, state));
            return Some(path);
        }
    }
    None
}
struct Maneuver {
    frames: std::collections::VecDeque<InputFrame>,
    target: Vec<(isize, isize)>,
    total: usize,
}
struct Host {
    games: Vec<Engine>,
    locks: [u32; 2],
    frame: u64,
    maneuvers: [Option<Maneuver>; 2],
}
impl Host {
    fn new(seed: u64) -> Self {
        let mut games = Vec::new();
        for _ in 0..2 {
            let mut e = Engine::new(
                EngineConfig {
                    goal_system: GoalSystem::None,
                    preview_count: 6,
                    ..Default::default()
                },
                seed,
            );
            e.step(InputFrame::default());
            games.push(e);
        }
        Self {
            games,
            locks: [0; 2],
            frame: 0,
            maneuvers: [None, None],
        }
    }
    fn route(&mut self, seat: usize, events: Vec<EngineEvent>) -> Vec<Value> {
        let mut result = Vec::new();
        for event in events {
            match event {
                EngineEvent::Locked { lines_cleared, .. } => {
                    self.locks[seat] += 1;
                    result.push(json!({"type":"lock","seat":seat,"lines":lines_cleared}));
                }
                EngineEvent::AttackSent { lines } => {
                    self.games[1 - seat].queue_garbage(lines);
                    result.push(json!({"type":"attack","seat":seat,"lines":lines}));
                }
                EngineEvent::ScoreAwarded { action, .. } => {
                    result.push(json!({"type":"score","seat":seat,"action":format!("{action:?}")}))
                }
                EngineEvent::GarbageInserted { lines } => {
                    result.push(json!({"type":"garbage","seat":seat,"lines":lines}))
                }
                EngineEvent::GameOver { .. } => result.push(json!({"type":"gameOver","seat":seat})),
                _ => {}
            }
        }
        result
    }
    fn view(&self) -> Value {
        json!({"frame":self.frame,"locks":self.locks,"executing":self.maneuvers.iter().map(|m|m.as_ref().map(|m|json!({"remaining":m.frames.len(),"total":m.total,"target":m.target}))).collect::<Vec<_>>(),"seats":self.games.iter().map(|g|snapshot(&g.snapshot())).collect::<Vec<_>>()})
    }
    fn command(&mut self, v: &Value) -> Result<Value, String> {
        let seat = v["seat"].as_u64().unwrap_or(0) as usize;
        if seat > 1 {
            return Err("invalid seat".into());
        }
        match v["op"].as_str().unwrap_or("") {
            "init" => {
                *self = Self::new(v["seed"].as_u64().unwrap_or(1));
                Ok(self.view())
            }
            "snapshot" => Ok(self.view()),
            "tick" => {
                let mut events = Vec::new();
                for s in 0..2 {
                    let maneuver = self.maneuvers[s]
                        .as_mut()
                        .and_then(|m| m.frames.pop_front());
                    let f = maneuver.unwrap_or_else(|| input(&v["inputs"][s]));
                    if f.hard_drop && self.maneuvers[s].is_some() {
                        let snap = self.games[s].snapshot();
                        let mut actual: Vec<_> =
                            snap.ghost_cells.iter().map(|c| (c.x, c.y)).collect();
                        let mut target = self.maneuvers[s].as_ref().unwrap().target.clone();
                        actual.sort();
                        target.sort();
                        if actual != target {
                            self.maneuvers[s] = None;
                            events.push(json!({"type":"executionInvalidated","seat":s}));
                            continue;
                        }
                    }
                    let ev = self.games[s].step(f);
                    events.extend(self.route(s, ev));
                    if self.maneuvers[s]
                        .as_ref()
                        .is_some_and(|m| m.frames.is_empty())
                    {
                        self.maneuvers[s] = None;
                        events.push(json!({"type":"executionComplete","seat":s}));
                    }
                }
                self.frame += 1;
                Ok(json!({"state":self.view(),"events":events}))
            }
            "mask_plan" => {
                let snap = self.games[seat].snapshot();
                let Some(state) = SearchState::from_snapshot(&snap) else {
                    return Ok(json!(null));
                };
                let cs = v["cells"].as_array().ok_or("mask required")?;
                if cs.len() > 32 {
                    return Err("mask too large".into());
                }
                let mask: Vec<_> = cs
                    .iter()
                    .filter_map(|c| Some((c[0].as_i64()? as isize, c[1].as_i64()? as isize)))
                    .collect();
                if mask
                    .iter()
                    .any(|(x, y)| *x < 0 || *x > 9 || *y < 0 || *y > 12)
                    || state.board.cell_coords().iter().any(|c| !mask.contains(c))
                {
                    return Ok(json!(null));
                }
                let mut budget = 2500;
                let mut seen = std::collections::HashSet::new();
                Ok(json!(mask_route(
                    &state,
                    snap.active.as_ref().is_some_and(|a| a.hold_used),
                    &mask,
                    &mut budget,
                    &mut seen
                )))
            }
            "goals" => {
                let snap = self.games[seat].snapshot();
                let Some(state) = SearchState::from_snapshot(&snap) else {
                    return Ok(json!([]));
                };
                Ok(json!(goal_routes(
                    &state,
                    snap.active.as_ref().is_some_and(|a| a.hold_used),
                    v["depth"].as_u64().unwrap_or(2) as usize
                )))
            }
            "plans" => {
                let snap = self.games[seat].snapshot();
                let Some(state) = SearchState::from_snapshot(&snap) else {
                    return Ok(json!([]));
                };
                let mut plans = Vec::new();
                if let Some(templates) = v["templates"].as_array() {
                    for template in templates.iter().take(48) {
                        let Some(pieces) = template["pieces"].as_array() else {
                            continue;
                        };
                        let base: Vec<(isize, isize)> = template["base"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(|c| {
                                Some((c[0].as_i64()? as isize, c[1].as_i64()? as isize))
                            })
                            .collect();
                        if base.iter().any(|(x, y)| !state.board.occupied(*x, *y)) {
                            continue;
                        }
                        let mut targets = Vec::new();
                        let mut valid = true;
                        for piece in pieces.iter().take(8) {
                            let p = parse_piece(&piece["type"])?;
                            let Some(cs) = piece["cells"].as_array() else {
                                valid = false;
                                break;
                            };
                            let coords: Vec<_> = cs
                                .iter()
                                .filter_map(|c| {
                                    Some((c[0].as_i64()? as isize, c[1].as_i64()? as isize))
                                })
                                .collect();
                            if coords.len() != 4 {
                                valid = false;
                                break;
                            }
                            let filled = coords
                                .iter()
                                .filter(|(x, y)| state.board.occupied(*x, *y))
                                .count();
                            if filled == 0 {
                                targets.push((p, coords));
                            } else if filled != 4 {
                                valid = false;
                                break;
                            }
                        }
                        let all: Vec<_> = pieces
                            .iter()
                            .flat_map(|p| p["cells"].as_array().into_iter().flatten())
                            .filter_map(|c| {
                                Some((c[0].as_i64()? as isize, c[1].as_i64()? as isize))
                            })
                            .collect();
                        if state
                            .board
                            .cell_coords()
                            .iter()
                            .any(|c| !all.contains(c) && !base.contains(c))
                        {
                            valid = false;
                        }
                        if !valid {
                            continue;
                        }
                        let mut budget = 1500;
                        if let Some(route) = template_route(
                            &state,
                            snap.active.as_ref().is_some_and(|a| a.hold_used),
                            &targets,
                            &mut budget,
                            template["goal"].as_str().unwrap_or("tsd"),
                        ) {
                            if route.is_empty() {
                                continue;
                            }
                            plans.push(json!({"id":template["id"],"name":template["name"],"strategy":template["strategy"],"source":template["source"],"goal":template["goal"],"followups":template["followups"],"phase":if route.iter().any(|c|meets_goal(c,template["goal"].as_str().unwrap_or("tsd"))){"activation"}else{"preparation"},"route":route}));
                        }
                    }
                }
                Ok(json!(plans))
            }
            "search" => {
                let snap = self.games[seat].snapshot();
                let Some(state) = SearchState::from_snapshot(&snap) else {
                    return Ok(json!([]));
                };
                Ok(json!(planner::search(
                    &state,
                    snap.active.as_ref().is_some_and(|a| a.hold_used),
                    &v["style"]
                )))
            }
            "candidates" => {
                let snap = self.games[seat].snapshot();
                let Some(state) = SearchState::from_snapshot(&snap) else {
                    return Ok(json!([]));
                };
                Ok(json!(
                    motion::generate_exact(
                        &state,
                        snap.active.as_ref().is_some_and(|a| a.hold_used)
                    )
                    .iter()
                    .map(|p| candidate(&p.placement, &state))
                    .collect::<Vec<_>>()
                ))
            }
            "prepare" => {
                if v["lock"].as_u64() != Some(self.locks[seat] as u64) {
                    return Err("stale piece".into());
                }
                let snap = self.games[seat].snapshot();
                let state = SearchState::from_snapshot(&snap).ok_or("no active piece")?;
                let path = motion::generate_exact(
                    &state,
                    snap.active.as_ref().is_some_and(|a| a.hold_used),
                )
                .into_iter()
                .find(|p| Some(id(&p.placement, &state).as_str()) == v["candidate"].as_str())
                .ok_or("placement no longer reachable")?;
                let p = path.placement;
                let frames = path.frames;
                let target = p
                    .piece
                    .piece()
                    .cells()
                    .iter()
                    .map(|(x, y)| (x + p.origin().0, y + p.origin().1))
                    .collect();
                let total = frames.len();
                self.maneuvers[seat] = Some(Maneuver {
                    frames: frames.into(),
                    target,
                    total,
                });
                Ok(json!({"state":self.view(),"events":[]}))
            }
            "place" => {
                if v["lock"].as_u64() != Some(self.locks[seat] as u64) {
                    return Err("stale piece".into());
                }
                let snap = self.games[seat].snapshot();
                let state = SearchState::from_snapshot(&snap).ok_or("no active piece")?;
                let path = motion::generate_exact(
                    &state,
                    snap.active.as_ref().is_some_and(|a| a.hold_used),
                )
                .into_iter()
                .find(|p| Some(id(&p.placement, &state).as_str()) == v["candidate"].as_str())
                .ok_or("placement no longer reachable")?;
                let expected = candidate(&path.placement, &state);
                let frames = path.frames;
                let mut events = Vec::new();
                for f in frames {
                    let ev = self.games[seat].step(f);
                    events.extend(self.route(seat, ev));
                }
                // Spawn after lock, with zero elapsed time, so decisions can start immediately.
                let ev = self.games[seat].step(InputFrame::default());
                events.extend(self.route(seat, ev));
                Ok(json!({"state":self.view(),"events":events,"candidate":expected}))
            }
            // Local protocol harness only; never exposed as an HTTP/WS action.
            "analyze" => {
                let config = EngineConfig {
                    goal_system: GoalSystem::None,
                    ..Default::default()
                };
                let mut e = Engine::new(config, 1);
                e.step(InputFrame::default());
                if let Some(board) = v["board"].as_array() {
                    if board.len() > 40 {
                        return Err("board too tall".into());
                    }
                    for (y, row) in board.iter().enumerate() {
                        let row = row.as_array().ok_or("invalid row")?;
                        if row.len() != 10 {
                            return Err("invalid width".into());
                        }
                        for (x, c) in row.iter().enumerate() {
                            if !c.is_null() {
                                e.set_cell(x as isize, y as isize, CellKind::Garbage);
                            }
                        }
                    }
                }
                let mut s = e.snapshot();
                let queue = v["queue"].as_array().ok_or("queue required")?;
                if queue.is_empty() || queue.len() > 32 {
                    return Err("queue length".into());
                }
                let p = parse_piece(&queue[0])?;
                let ap = ActivePiece::new(p, Piece::from(p).spawn_coords(10, 20));
                e.set_active(ap);
                s.active = e.snapshot().active;
                s.next_queue = queue
                    .iter()
                    .skip(1)
                    .map(parse_piece)
                    .collect::<Result<_, _>>()?;
                s.hold = if v["hold"].is_null() {
                    None
                } else {
                    Some(parse_piece(&v["hold"])?)
                };
                s.back_to_back_active = v["b2b"] == true;
                s.combo = v["combo"].as_u64().unwrap_or(0).min(999) as u32;
                let state = SearchState::from_snapshot(&s).ok_or("no state")?;
                Ok(json!(
                    placements(&state, false)
                        .iter()
                        .map(|p| candidate(p, &state))
                        .collect::<Vec<_>>()
                ))
            }
            _ => Err("unknown operation".into()),
        }
    }
}
fn main() {
    let mut host = Host::new(1);
    let stdin = io::stdin();
    let mut out = io::BufWriter::new(io::stdout());
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.len() > 1_000_000 {
            break;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(v) => match host.command(&v) {
                Ok(data) => json!({"ok":true,"data":data}),
                Err(e) => json!({"ok":false,"error":e}),
            },
            Err(_) => json!({"ok":false,"error":"invalid JSON"}),
        };
        if writeln!(out, "{response}")
            .and_then(|_| out.flush())
            .is_err()
        {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn candidates_execute_exactly() {
        for seed in [1, 17, 82719451] {
            let base = Host::new(seed);
            let snap = base.games[0].snapshot();
            let state = SearchState::from_snapshot(&snap).unwrap();
            for path in motion::generate_exact(&state, false) {
                let p = path.placement;
                let mut h = Host::new(seed);
                let expected = candidate(&p, &state);
                let out = h
                    .command(&json!({"op":"place","seat":0,"lock":0,"candidate":expected["id"]}))
                    .unwrap();
                let actual = out["state"]["seats"][0]["board"].as_array().unwrap();
                let mut coords: Vec<(i64, i64)> = actual
                    .iter()
                    .map(|c| (c[0].as_i64().unwrap(), c[1].as_i64().unwrap()))
                    .collect();
                let mut wanted: Vec<(i64, i64)> = expected["after"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|c| (c[0].as_i64().unwrap(), c[1].as_i64().unwrap()))
                    .collect();
                coords.sort();
                wanted.sort();
                assert_eq!(coords, wanted, "{}", expected["id"]);
            }
        }
    }
    #[test]
    fn tucked_spin_paths_execute_on_an_occupied_board() {
        let fixture = ["XX_XXXXXXX", "X___XXXXXX", "X__XX_XXXX", "_______X__"];
        let make = || {
            let mut h = Host::new(3);
            for (y, row) in fixture.iter().enumerate() {
                for (x, c) in row.chars().enumerate() {
                    if c == 'X' {
                        h.games[0].set_cell(x as isize, y as isize, CellKind::Garbage);
                    }
                }
            }
            let piece = Piece::from(PieceType::T);
            h.games[0].set_active(ActivePiece::new(PieceType::T, piece.spawn_coords(10, 20)));
            h
        };
        let base = make();
        let state = SearchState::from_snapshot(&base.games[0].snapshot()).unwrap();
        let paths = motion::generate_exact(&state, false);
        assert!(paths.iter().any(|p| spin(&p.placement, &state) != "none"));
        for path in paths {
            let expected = candidate(&path.placement, &state);
            let mut h = make();
            h.command(&json!({"op":"prepare","seat":0,"lock":0,"candidate":expected["id"]}))
                .unwrap();
            let mut events = vec![];
            while h.maneuvers[0].is_some() {
                let result = h.command(&json!({"op":"tick","inputs":[{},{}]})).unwrap();
                events.extend(result["events"].as_array().unwrap().iter().cloned());
            }
            assert!(
                !events.iter().any(|e| e["type"] == "executionInvalidated"),
                "{}",
                expected["id"]
            );
            let mut actual = h.games[0]
                .snapshot()
                .board_cells
                .iter()
                .map(|c| (c.x, c.y))
                .collect::<Vec<_>>();
            let mut wanted = expected["after"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| {
                    (
                        c[0].as_i64().unwrap() as isize,
                        c[1].as_i64().unwrap() as isize,
                    )
                })
                .collect::<Vec<_>>();
            actual.sort();
            wanted.sort();
            assert_eq!(actual, wanted, "{}", expected["id"]);
            if expected["spin"] != "none" && expected["lines"].as_u64().unwrap() > 0 {
                assert!(
                    events.iter().any(|e| e["type"] == "score"
                        && e["action"].as_str().is_some_and(|a| a.starts_with("TSpin"))),
                    "{}",
                    expected["id"]
                );
            }
        }
    }
    #[test]
    fn stale_piece_is_rejected() {
        let mut h = Host::new(1);
        assert!(
            h.command(&json!({"op":"place","lock":99,"candidate":"bad"}))
                .is_err()
        );
    }
    #[test]
    fn deterministic_frames() {
        let mut a = Host::new(123);
        let mut b = Host::new(123);
        for f in 0..300 {
            let v = json!({"op":"tick","inputs":[{"left":f%3==0,"drop":f%31==0},{}]});
            assert_eq!(a.command(&v).unwrap(), b.command(&v).unwrap());
        }
    }
}
