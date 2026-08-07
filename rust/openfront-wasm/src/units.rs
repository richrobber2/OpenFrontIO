use openfront_core::classify_unit_kind;

const UNIT_RECORD_BYTES: usize = 12;

/// Classify canonical unit records in place.
///
/// Upload layout is `count` little-endian u32 triples:
/// `[unit_id, canonical_kind_index, is_active]`.
/// The first two words are preserved and the third is replaced with the Rust
/// category bitset. The upload may be larger than `count * 12` bytes so the
/// browser can retain and reuse a capacity-sized buffer across ticks.
#[unsafe(no_mangle)]
pub extern "C" fn openfront_units_classify(upload_handle: u32, count: u32) -> u32 {
    begin_call();

    let classified = UPLOADS.with(|uploads| -> Result<(), ErrorCode> {
        let mut uploads = uploads.borrow_mut();
        let index = slot_index(upload_handle).ok_or(ErrorCode::InvalidHandle)?;
        let upload = uploads
            .get_mut(index)
            .and_then(|slot| slot.as_mut())
            .ok_or(ErrorCode::InvalidHandle)?;
        let required = (count as usize)
            .checked_mul(UNIT_RECORD_BYTES)
            .ok_or(ErrorCode::UnitRecordLengthMismatch)?;
        if upload.len() < required {
            return Err(ErrorCode::UnitRecordLengthMismatch);
        }

        for record in upload[..required].chunks_exact_mut(UNIT_RECORD_BYTES) {
            let kind = u32::from_le_bytes([record[4], record[5], record[6], record[7]]);
            let is_active =
                u32::from_le_bytes([record[8], record[9], record[10], record[11]]) != 0;
            let flags = classify_unit_kind(kind, is_active).to_le_bytes();
            record[8..12].copy_from_slice(&flags);
        }
        Ok(())
    });

    match classified {
        Ok(()) => 1,
        Err(error) => {
            fail(error);
            0
        }
    }
}
