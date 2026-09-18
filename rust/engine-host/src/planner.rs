use super::*;
use tetr_core::ai::eval::cc2::{Cc2Evaluator, Cc2Weights};
use tetr_core::ai::eval::{EvalContext, Evaluator};

fn weight(style: &Value, group: &str, key: &str, default: f32) -> f32 {
    style[group][key]
        .as_f64()
        .unwrap_or(default as f64)
        .clamp(0., 1.) as f32
}
fn legal(p: &Placement, state: &SearchState, style: &Value) -> bool {
    if style["hardConstraints"]["forbidTSS"] == true && spin(p, state) != "none" {
        let mut n = state.clone();
        if n.commit_placement(p).cleared_rows.len() == 1 {
            return false;
        }
    }
    true
}
#[derive(Clone)]
struct Node {
    state: SearchState,
    path: Vec<Value>,
    reward: f32,
    score: f32,
}

// Search each root separately: a narrow global beam otherwise silently starves
// different first moves. Every published score has the same known-queue horizon.
pub fn search(state: &SearchState, used: bool, style: &Value) -> Vec<Value> {
    let knowledge = weight(style, "knowledge", "lookahead", 0.6);
    let depth = if knowledge > 0.7 {
        4
    } else if knowledge > 0.1 {
        3
    } else {
        2
    };
    let preserve = weight(style, "risk", "selfPreservation", 0.75);
    let mut weights = Cc2Weights::DEFAULT;
    weights.holes = -2.5 - 2.0 * preserve;
    weights.cell_coveredness = -0.4 - 0.3 * preserve;
    weights.height_upper_half = -2.0 - 3.0 * preserve;
    weights.height_upper_quarter = -8.0;
    weights.perfect_clear = 12. + 24. * weight(style, "strategyPreferences", "perfectClear", 0.45);
    weights.spin_clears[2] = 3. + 9. * weight(style, "strategyPreferences", "tSpinDouble", 0.65);
    weights.spin_clears[3] = 4. + 13. * weight(style, "strategyPreferences", "tSpinTriple", 0.35);
    weights.attack = 0.3 + weight(style, "risk", "spikePreference", 0.5);
    let patterns = style["hardConstraints"]["forbidMidgamePatterns"] != true
        && weight(style, "knowledge", "midgameKnowledge", 0.6) > 0.2;
    if !patterns {
        weights.tslot = [0.; 4];
    } else {
        let recognition = weight(style, "knowledge", "patternRecognition", 0.7)
            * (0.5 + weight(style, "strategyPreferences", "midgameSetup", 0.55));
        weights.tslot = [0.1, 1., 4., 6.].map(|v| v * recognition);
    }
    let eval = Cc2Evaluator::new(weights);
    let six = weight(style, "strategyPreferences", "sixThreeStacking", 0.);
    let nine = weight(style, "strategyPreferences", "nineZeroStacking", 0.25);
    let well = if six > nine { 6 } else { 9 };
    let stacking = six.max(nine);
    let root_holes = state
        .board
        .columns()
        .iter()
        .map(|c| (64 - c.leading_zeros()) - c.count_ones())
        .sum::<u32>();
    let expand = |parent: &Node, p: &Placement| -> Option<Node> {
        if !legal(p, &parent.state, style) {
            return None;
        }
        let sp = classify_t_spin(&p.piece, &parent.state.board);
        let mut next = parent.state.clone();
        let lock = next.commit_placement(p);
        if next.dead {
            return None;
        }
        let (value, reward) = eval.evaluate_cols(
            &lock,
            next.board.view(),
            sp,
            EvalContext {
                combo: parent.state.combo,
                b2b: parent.state.b2b,
            },
        );
        let reward = parent.reward + reward.0 as f32 / 256.;
        let col = next.board.columns()[well];
        let well_cost = col.count_ones() as f32 * stacking * 0.8;
        let score = value.0 as f32 / 256. + reward - well_cost;
        let mut path = parent.path.clone();
        path.push(candidate(p, &parent.state));
        Some(Node {
            state: next,
            path,
            reward,
            score,
        })
    };
    let base = Node {
        state: state.clone(),
        path: vec![],
        reward: 0.,
        score: 0.,
    };
    let mut result = Vec::new();
    for root_path in motion::generate_exact(state, used) {
        let p = root_path.placement;
        let Some(root) = expand(&base, &p) else {
            continue;
        };
        let mut frontier = vec![root];
        for _ in 1..depth {
            let mut children = Vec::new();
            for node in &frontier {
                if node.state.queue.is_empty() {
                    continue;
                }
                for placement in placements(&node.state, false) {
                    if let Some(child) = expand(node, &placement) {
                        children.push(child);
                    }
                }
            }
            if children.is_empty() {
                break;
            }
            children.sort_by(|a, b| b.score.total_cmp(&a.score));
            // Keep different boards, not duplicate rotations of an identical result.
            let mut seen = std::collections::HashSet::new();
            frontier = children
                .into_iter()
                .filter(|n| {
                    seen.insert(format!(
                        "{:?}{:?}{:?}",
                        n.state.board.columns(),
                        n.state.hold,
                        n.state.active.piece_type()
                    ))
                })
                .take(2)
                .collect();
        }
        let Some(best) = frontier.first() else {
            continue;
        };
        let mut c = best.path[0].clone();
        let last = best.path.last().unwrap();
        c["holesBefore"] = json!(root_holes);
        c["future"] = json!({"score":best.score,"depth":best.path.len(),"holes":last["holes"],"height":last["height"],"lines":best.path.iter().map(|c|c["lines"].as_u64().unwrap_or(0)).sum::<u64>(),"attack":best.path.iter().map(|c|c["attack"].as_u64().unwrap_or(0)).sum::<u64>(),"tSpins":best.path.iter().filter(|c|c["spin"]!="none"&&c["lines"].as_u64().unwrap_or(0)>0).count(),"perfectClear":best.path.iter().any(|c|c["pc"]==true)});
        c["continuation"] = json!(best.path);
        result.push(c);
    }
    result.sort_by(|a, b| {
        b["future"]["score"]
            .as_f64()
            .unwrap()
            .total_cmp(&a["future"]["score"].as_f64().unwrap())
    });
    result
}
