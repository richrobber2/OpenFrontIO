use openfront_core::{select_purchase_queue, PurchaseCandidate};

const AI_PURCHASE_RECORD_BYTES: usize = 40;

/// Purchase upload layout is `count` 40-byte little-endian records:
/// `[index:u32, group:u32, cost:f64, value:f64, return_ratio:f64, synergy:f64]`.
/// `RESULT` becomes the selected candidate indexes in execution order and
/// `RESULT_F64` becomes `[total_cost, total_score, remaining_budget]`.
#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_select_purchase_queue(
    spend_cap: f64,
    minimum_purchases: u32,
    maximum_purchases: u32,
    risk: f64,
    capital_pressure: f64,
    upload_handle: u32,
    count: u32,
) -> u32 {
    begin_call();

    let parsed = UPLOADS.with(|uploads| -> Result<Vec<PurchaseCandidate>, ErrorCode> {
        let uploads = uploads.borrow();
        let index = slot_index(upload_handle).ok_or(ErrorCode::InvalidHandle)?;
        let upload = uploads
            .get(index)
            .and_then(|slot| slot.as_ref())
            .ok_or(ErrorCode::InvalidHandle)?;
        let required = (count as usize)
            .checked_mul(AI_PURCHASE_RECORD_BYTES)
            .ok_or(ErrorCode::AiPurchaseRecordLengthMismatch)?;
        if upload.len() < required {
            return Err(ErrorCode::AiPurchaseRecordLengthMismatch);
        }

        Ok(upload[..required]
            .chunks_exact(AI_PURCHASE_RECORD_BYTES)
            .map(|record| PurchaseCandidate {
                index: read_u32_le(record, 0),
                group: read_u32_le(record, 4),
                cost: read_f64_le(record, 8),
                value: read_f64_le(record, 16),
                return_ratio: read_f64_le(record, 24),
                synergy: read_f64_le(record, 32),
            })
            .collect())
    });

    let candidates = match parsed {
        Ok(candidates) => candidates,
        Err(error) => {
            fail(error);
            return 0;
        }
    };

    let plan = select_purchase_queue(
        spend_cap,
        minimum_purchases,
        maximum_purchases,
        risk,
        capital_pressure,
        &candidates,
    );
    set_result(plan.selected_indices);
    set_f64_result([
        plan.total_cost,
        plan.total_score,
        plan.remaining_budget,
    ]);
    1
}
