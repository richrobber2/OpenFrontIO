#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PurchaseCandidate {
    pub index: u32,
    pub group: u32,
    pub cost: f64,
    pub value: f64,
    pub return_ratio: f64,
    pub synergy: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PurchaseQueuePlan {
    pub selected_indices: Vec<u32>,
    pub total_cost: f64,
    pub total_score: f64,
    pub remaining_budget: f64,
}

fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum)
}

fn normalize(value: f64, minimum: f64, maximum: f64) -> f64 {
    if maximum <= minimum {
        1.0
    } else {
        clamp((value - minimum) / (maximum - minimum), 0.0, 1.0)
    }
}

pub fn select_purchase_queue(
    spend_cap: f64,
    minimum_purchases: u32,
    maximum_purchases: u32,
    risk: f64,
    capital_pressure: f64,
    candidates: &[PurchaseCandidate],
) -> PurchaseQueuePlan {
    let spend_cap = spend_cap.max(0.0);
    if spend_cap <= 0.0 || maximum_purchases == 0 || candidates.is_empty() {
        return PurchaseQueuePlan {
            selected_indices: Vec::new(),
            total_cost: 0.0,
            total_score: 0.0,
            remaining_budget: spend_cap,
        };
    }

    let risk = clamp(risk, 0.0, 1.0);
    let capital_pressure = clamp(capital_pressure, 0.0, 1.0);
    let valid: Vec<PurchaseCandidate> = candidates
        .iter()
        .copied()
        .filter(|candidate| {
            candidate.cost.is_finite()
                && candidate.cost > 0.0
                && candidate.value.is_finite()
                && candidate.return_ratio.is_finite()
                && candidate.synergy.is_finite()
                && candidate.cost <= spend_cap
        })
        .collect();
    if valid.is_empty() {
        return PurchaseQueuePlan {
            selected_indices: Vec::new(),
            total_cost: 0.0,
            total_score: 0.0,
            remaining_budget: spend_cap,
        };
    }

    let minimum_value = valid
        .iter()
        .map(|candidate| candidate.value)
        .fold(f64::INFINITY, f64::min);
    let maximum_value = valid
        .iter()
        .map(|candidate| candidate.value)
        .fold(f64::NEG_INFINITY, f64::max);

    let risk_limited_maximum = if risk >= 0.8 {
        1
    } else if risk >= 0.6 {
        maximum_purchases.min(2)
    } else if risk >= 0.4 {
        maximum_purchases.min(4)
    } else {
        maximum_purchases
    };
    let baseline_target = minimum_purchases.max(1).min(risk_limited_maximum);
    let target = if capital_pressure >= 0.85 {
        risk_limited_maximum
    } else if capital_pressure >= 0.65 {
        (baseline_target + 2).min(risk_limited_maximum)
    } else if capital_pressure >= 0.45 {
        (baseline_target + 1).min(risk_limited_maximum)
    } else {
        baseline_target
    } as usize;

    let mut ranked: Vec<(PurchaseCandidate, f64)> = valid
        .into_iter()
        .map(|candidate| {
            let quality = normalize(candidate.value, minimum_value, maximum_value);
            let return_quality = clamp(candidate.return_ratio / 0.75, 0.0, 1.0);
            let synergy = clamp(candidate.synergy, 0.0, 1.0);
            let cost_share = clamp(candidate.cost / spend_cap.max(1.0), 0.0, 1.0);
            let capital_efficiency = 1.0 - cost_share;
            let score = quality * 0.48
                + return_quality * 0.24
                + synergy * 0.14
                + capital_efficiency * 0.08
                + capital_pressure * 0.06
                - risk * cost_share * 0.22;
            (candidate, score)
        })
        .collect();
    ranked.sort_by(|(left_candidate, left_score), (right_candidate, right_score)| {
        right_score
            .total_cmp(left_score)
            .then_with(|| {
                right_candidate
                    .return_ratio
                    .total_cmp(&left_candidate.return_ratio)
            })
            .then_with(|| left_candidate.cost.total_cmp(&right_candidate.cost))
            .then_with(|| left_candidate.index.cmp(&right_candidate.index))
    });

    let mut selected_indices = Vec::with_capacity(target);
    let mut used_groups = std::collections::BTreeSet::new();
    let mut total_cost = 0.0;
    let mut total_score = 0.0;

    for (candidate, score) in ranked {
        if selected_indices.len() >= target {
            break;
        }
        if candidate.group != 0 && used_groups.contains(&candidate.group) {
            continue;
        }
        if total_cost + candidate.cost > spend_cap + f64::EPSILON {
            continue;
        }
        total_cost += candidate.cost;
        total_score += score;
        selected_indices.push(candidate.index);
        if candidate.group != 0 {
            used_groups.insert(candidate.group);
        }
    }

    PurchaseQueuePlan {
        selected_indices,
        total_cost,
        total_score,
        remaining_budget: (spend_cap - total_cost).max(0.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(index: u32, group: u32, cost: f64, value: f64, return_ratio: f64) -> PurchaseCandidate {
        PurchaseCandidate {
            index,
            group,
            cost,
            value,
            return_ratio,
            synergy: 0.8,
        }
    }

    #[test]
    fn surplus_batches_multiple_profitable_purchases() {
        let candidates = [
            candidate(0, 0, 100.0, 10.0, 0.5),
            candidate(1, 0, 100.0, 9.0, 0.45),
            candidate(2, 0, 100.0, 8.0, 0.4),
            candidate(3, 0, 100.0, 7.0, 0.35),
        ];
        let plan = select_purchase_queue(500.0, 2, 4, 0.1, 0.9, &candidates);
        assert_eq!(plan.selected_indices.len(), 4);
        assert_eq!(plan.total_cost, 400.0);
    }

    #[test]
    fn high_risk_caps_the_queue_to_one() {
        let candidates = [
            candidate(0, 0, 100.0, 10.0, 0.5),
            candidate(1, 0, 100.0, 9.0, 0.45),
            candidate(2, 0, 100.0, 8.0, 0.4),
        ];
        let plan = select_purchase_queue(500.0, 3, 3, 0.85, 1.0, &candidates);
        assert_eq!(plan.selected_indices.len(), 1);
    }

    #[test]
    fn diversification_groups_prevent_duplicate_targets() {
        let candidates = [
            candidate(0, 1, 100.0, 10.0, 0.5),
            candidate(1, 1, 90.0, 9.5, 0.48),
            candidate(2, 2, 100.0, 9.0, 0.45),
        ];
        let plan = select_purchase_queue(500.0, 3, 3, 0.0, 1.0, &candidates);
        assert_eq!(plan.selected_indices, vec![0, 2]);
    }

    #[test]
    fn queue_respects_the_budget() {
        let candidates = [
            candidate(0, 0, 180.0, 10.0, 0.5),
            candidate(1, 0, 180.0, 9.0, 0.45),
            candidate(2, 0, 120.0, 8.0, 0.4),
        ];
        let plan = select_purchase_queue(300.0, 3, 3, 0.0, 1.0, &candidates);
        assert!(plan.total_cost <= 300.0);
        assert_eq!(plan.selected_indices.len(), 2);
    }
}
