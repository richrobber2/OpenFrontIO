use openfront_core::{Defense, DefenseIndex, DefensePathAssessment, DefensePathPoint, DefensePoint};

const DEFENSE_RECORD_BYTES: usize = 24;
const DEFENSE_RANGE_OFFSET: usize = 12;
const DEFENSE_PATH_RECORD_WORDS: usize = 3;
const DEFENSE_PATH_RECORD_BYTES: usize = DEFENSE_PATH_RECORD_WORDS * 4;

fn read_defense_u32(record: &[u8], word: usize) -> u32 {
    let offset = word * 4;
    u32::from_le_bytes([
        record[offset],
        record[offset + 1],
        record[offset + 2],
        record[offset + 3],
    ])
}

fn read_defense_f64(record: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes([
        record[offset],
        record[offset + 1],
        record[offset + 2],
        record[offset + 3],
        record[offset + 4],
        record[offset + 5],
        record[offset + 6],
        record[offset + 7],
    ])
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_defense_index_create(cell_size: u32) -> u32 {
    begin_call();
    let Some(index) = DefenseIndex::new(cell_size) else {
        fail(ErrorCode::InvalidCellSize);
        return 0;
    };
    DEFENSE_INDICES.with(|indices| insert_slot(&mut indices.borrow_mut(), index))
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_defense_index_destroy(handle: u32) -> u32 {
    begin_call();
    let removed = DEFENSE_INDICES.with(|indices| {
        remove_slot(indices.borrow_mut().as_mut_slice(), handle)
    });
    if removed {
        1
    } else {
        fail(ErrorCode::InvalidHandle);
        0
    }
}

/// Replace all indexed defenses.
///
/// Upload records are little-endian fields:
/// `[id: u32, x: u32, y: u32, range: f64, available_interceptions: u32]`.
#[unsafe(no_mangle)]
pub extern "C" fn openfront_defense_index_replace(
    handle: u32,
    upload_handle: u32,
    count: u32,
) -> u32 {
    begin_call();

    let result = UPLOADS.with(|uploads| -> Result<Vec<Defense>, ErrorCode> {
        let uploads = uploads.borrow();
        let upload_index = slot_index(upload_handle).ok_or(ErrorCode::InvalidHandle)?;
        let upload = uploads
            .get(upload_index)
            .and_then(|slot| slot.as_ref())
            .ok_or(ErrorCode::InvalidHandle)?;
        let required = (count as usize)
            .checked_mul(DEFENSE_RECORD_BYTES)
            .ok_or(ErrorCode::DefenseRecordLengthMismatch)?;
        if upload.len() < required {
            return Err(ErrorCode::DefenseRecordLengthMismatch);
        }

        Ok(upload[..required]
            .chunks_exact(DEFENSE_RECORD_BYTES)
            .map(|record| {
                Defense::new(
                    read_defense_u32(record, 0),
                    read_defense_u32(record, 1),
                    read_defense_u32(record, 2),
                    read_defense_f64(record, DEFENSE_RANGE_OFFSET),
                    read_defense_u32(record, 5),
                )
            })
            .collect())
    });

    let defenses = match result {
        Ok(defenses) => defenses,
        Err(error) => {
            fail(error);
            return 0;
        }
    };

    let updated = DEFENSE_INDICES.with(|indices| {
        let mut indices = indices.borrow_mut();
        let index = slot_index(handle)?;
        let defense_index = indices.get_mut(index)?.as_mut()?;
        defense_index.replace(defenses);
        Some(())
    });

    if updated.is_some() {
        1
    } else {
        fail(ErrorCode::InvalidHandle);
        0
    }
}

/// Assess an engine-produced strategic path against the indexed defenses.
///
/// Path records are little-endian u32 words: `[x, y, blocked]`.
/// The reusable result buffer receives:
/// `[blocked, intercepting_defenses, interception_capacity]`.
#[unsafe(no_mangle)]
pub extern "C" fn openfront_defense_index_assess_path(
    handle: u32,
    upload_handle: u32,
    count: u32,
    source_x: u32,
    source_y: u32,
    destination_x: u32,
    destination_y: u32,
    targetable_range: f64,
) -> u32 {
    begin_call();

    let result = UPLOADS.with(|uploads| -> Result<DefensePathAssessment, ErrorCode> {
        let uploads = uploads.borrow();
        let upload_index = slot_index(upload_handle).ok_or(ErrorCode::InvalidHandle)?;
        let upload = uploads
            .get(upload_index)
            .and_then(|slot| slot.as_ref())
            .ok_or(ErrorCode::InvalidHandle)?;
        let required = (count as usize)
            .checked_mul(DEFENSE_PATH_RECORD_BYTES)
            .ok_or(ErrorCode::PathRecordLengthMismatch)?;
        if upload.len() < required {
            return Err(ErrorCode::PathRecordLengthMismatch);
        }

        DEFENSE_INDICES.with(|indices| -> Result<DefensePathAssessment, ErrorCode> {
            let indices = indices.borrow();
            let index = slot_index(handle).ok_or(ErrorCode::InvalidHandle)?;
            let defense_index = indices
                .get(index)
                .and_then(|slot| slot.as_ref())
                .ok_or(ErrorCode::InvalidHandle)?;
            let path = upload[..required]
                .chunks_exact(DEFENSE_PATH_RECORD_BYTES)
                .map(|record| {
                    DefensePathPoint::new(
                        read_defense_u32(record, 0),
                        read_defense_u32(record, 1),
                        read_defense_u32(record, 2) != 0,
                    )
                });
            Ok(defense_index.assess_path(
                path,
                DefensePoint::new(source_x, source_y),
                DefensePoint::new(destination_x, destination_y),
                targetable_range,
            ))
        })
    });

    match result {
        Ok(assessment) => {
            set_result([
                if assessment.blocked { 1 } else { 0 },
                assessment.intercepting_defenses,
                assessment.interception_capacity,
            ]);
            1
        }
        Err(error) => {
            fail(error);
            0
        }
    }
}
