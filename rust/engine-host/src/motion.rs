//! Per-cell reachability for the live piece. Intermediate descent heights are
//! searched; SRS kicks and collision are still supplied by the unmodified core.
use super::*;
use std::collections::{HashSet, VecDeque};
pub struct MovePath {
    pub placement: Placement,
    pub frames: Vec<InputFrame>,
}
struct Node {
    piece: ActivePiece,
    parent: Option<usize>,
    input: InputFrame,
}
fn key(p: &ActivePiece) -> (isize, isize, u8, u8) {
    let rank = if p.piece_type() != PieceType::T {
        0
    } else if p.used_kick_5_into_t_slot() {
        2
    } else if p.last_successful_action() == PieceAction::Rotate {
        if p.last_rotation_kick_number() == Some(5) {
            2
        } else {
            1
        }
    } else {
        0
    };
    (p.origin().0, p.origin().1, p.rotation() as u8, rank)
}
pub fn generate_exact(state: &SearchState, hold_used: bool) -> Vec<MovePath> {
    let mut starts = vec![(
        ActivePiece::at_pose(
            state.active.piece_type(),
            state.active.origin(),
            state.active.rotation(),
        ),
        false,
    )];
    if !hold_used && let Some(p) = state.hold.or(state.queue.first().copied()) {
        let piece = Piece::from(p);
        let spawn = piece.spawn_coords(10, 20);
        if !piece.collide_with(&state.board, spawn) {
            let origin = piece
                .try_move(&state.board, spawn, MoveDirection::Down)
                .unwrap_or(spawn);
            starts.push((ActivePiece::new(p, origin), true));
        }
    }
    let mut result = vec![];
    for (start, held) in starts {
        if start.piece().cells().iter().any(|(x, y)| {
            state
                .board
                .occupied(x + start.origin().0, y + start.origin().1)
        }) {
            continue;
        }
        let mut visited = HashSet::new();
        visited.insert(key(&start));
        let mut nodes = vec![Node {
            piece: start,
            parent: None,
            input: InputFrame::default(),
        }];
        let mut todo = VecDeque::from([0]);
        let mut emitted = HashSet::new();
        while let Some(index) = todo.pop_front() {
            let p = nodes[index].piece.clone();
            if p.piece()
                .try_move(&state.board, p.origin(), MoveDirection::Down)
                .is_none()
            {
                let placement = Placement {
                    piece: p.clone(),
                    path: Default::default(),
                    used_hold: held,
                };
                if emitted.insert(id(&placement, state)) {
                    let mut frames = vec![];
                    let mut i = index;
                    while let Some(parent) = nodes[i].parent {
                        frames.push(nodes[i].input.clone());
                        i = parent;
                    }
                    if held {
                        frames.push(InputFrame {
                            hold: true,
                            ..Default::default()
                        });
                    }
                    frames.reverse();
                    frames.push(InputFrame {
                        hard_drop: true,
                        ..Default::default()
                    });
                    result.push(MovePath { placement, frames });
                }
            }
            for action in 0..5 {
                let mut q = p.clone();
                let mut f = InputFrame::default();
                if action < 3 {
                    let dir = match action {
                        0 => MoveDirection::Left,
                        1 => MoveDirection::Right,
                        _ => MoveDirection::Down,
                    };
                    let Some(origin) = p.piece().try_move(&state.board, p.origin(), dir) else {
                        continue;
                    };
                    q.move_to(
                        origin,
                        if action == 2 {
                            PieceAction::SoftDrop
                        } else {
                            PieceAction::Move
                        },
                    );
                    match action {
                        0 => f.left = true,
                        1 => f.right = true,
                        _ => f.soft_drop = true,
                    };
                } else {
                    let dir = if action == 3 {
                        RotationDirection::Clockwise
                    } else {
                        RotationDirection::Counterclockwise
                    };
                    let target = p.rotation()
                        + if action == 3 {
                            PieceRotation::R90
                        } else {
                            PieceRotation::R270
                        };
                    let Some((rotation, origin, kick)) =
                        p.piece()
                            .try_rotate_with_kicks(&state.board, p.origin(), target)
                    else {
                        continue;
                    };
                    if kick == 0 {
                        continue;
                    }
                    q.rotate_to(rotation, origin, dir, kick, false);
                    let sticky =
                        kick == 5 && p.piece_type() == PieceType::T && is_t_slot(&q, &state.board);
                    q = p.clone();
                    q.rotate_to(rotation, origin, dir, kick, sticky);
                    if action == 3 {
                        f.rotate_clockwise = true;
                    } else {
                        f.rotate_counterclockwise = true;
                    }
                }
                if visited.insert(key(&q)) {
                    let child = nodes.len();
                    nodes.push(Node {
                        piece: q,
                        parent: Some(index),
                        input: f,
                    });
                    todo.push_back(child);
                }
            }
        }
    }
    result.sort_by_key(|p| id(&p.placement, state));
    result
}
