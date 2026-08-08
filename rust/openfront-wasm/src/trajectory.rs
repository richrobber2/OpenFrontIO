use openfront_core::{
    build_nuke_trajectory, sam_range, write_nuke_strip_vertices, NukeControlPoints,
    NukeStripError, SamInfo,
};

const SAM_RECORD_BYTES: usize = 24;
const TRAJECTORY_RESULT_VALUES: usize = 11;
const MAX_TRAJECTORY_STRIP_SEGMENTS: u32 = 4096;

fn read_trajectory_f64(record: &[u8], offset: usize) -> f64 {
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
pub extern "C" fn openfront_nuke_sam_range(level: f64) -> f64 {
    begin_call();
    sam_range(level)
}

/// Build renderer-facing nuke trajectory data using the deterministic Rust core.
///
/// SAM upload records are three little-endian f64 values:
/// `[x, y, range_squared]`.
/// The reusable f64 result buffer receives the eight cubic Bezier control-point
/// values followed by `[t_untargetable_start, t_untargetable_end, t_sam_intercept]`.
#[unsafe(no_mangle)]
pub extern "C" fn openfront_nuke_trajectory_build(
    src_x: f64,
    src_y: f64,
    dst_x: f64,
    dst_y: f64,
    map_height: f64,
    direction_up: u32,
    sam_upload_handle: u32,
    sam_count: u32,
) -> u32 {
    begin_call();

    let sams = if sam_count == 0 {
        Vec::new()
    } else {
        let result = UPLOADS.with(|uploads| -> Result<Vec<SamInfo>, ErrorCode> {
            let uploads = uploads.borrow();
            let upload_index = slot_index(sam_upload_handle).ok_or(ErrorCode::InvalidHandle)?;
            let upload = uploads
                .get(upload_index)
                .and_then(|slot| slot.as_ref())
                .ok_or(ErrorCode::InvalidHandle)?;
            let required = (sam_count as usize)
                .checked_mul(SAM_RECORD_BYTES)
                .ok_or(ErrorCode::TrajectoryRecordLengthMismatch)?;
            if upload.len() < required {
                return Err(ErrorCode::TrajectoryRecordLengthMismatch);
            }

            Ok(upload[..required]
                .chunks_exact(SAM_RECORD_BYTES)
                .map(|record| {
                    SamInfo::new(
                        read_trajectory_f64(record, 0),
                        read_trajectory_f64(record, 8),
                        read_trajectory_f64(record, 16),
                    )
                })
                .collect())
        });

        match result {
            Ok(sams) => sams,
            Err(error) => {
                fail(error);
                return 0;
            }
        }
    };

    let trajectory = build_nuke_trajectory(
        src_x,
        src_y,
        dst_x,
        dst_y,
        map_height,
        direction_up != 0,
        &sams,
    );
    let cp = trajectory.control_points;
    let thresholds = trajectory.thresholds;
    set_f64_result([
        cp.p0x,
        cp.p0y,
        cp.p1x,
        cp.p1y,
        cp.p2x,
        cp.p2y,
        cp.p3x,
        cp.p3y,
        thresholds.t_untargetable_start,
        thresholds.t_untargetable_end,
        thresholds.t_sam_intercept,
    ]);
    debug_assert_eq!(
        RESULT_F64.with(|result| result.borrow().len()),
        TRAJECTORY_RESULT_VALUES
    );
    1
}

/// Build the renderer's `[t, side, cumulative_distance]` triangle-strip data.
///
/// The result is retained in a reusable f32 buffer so pointer-move previews do
/// not allocate a fresh Rust vector after the first capacity growth.
#[unsafe(no_mangle)]
pub extern "C" fn openfront_nuke_trajectory_strip_build(
    p0x: f64,
    p0y: f64,
    p1x: f64,
    p1y: f64,
    p2x: f64,
    p2y: f64,
    p3x: f64,
    p3y: f64,
    segments: u32,
) -> u32 {
    begin_call();
    if segments == 0 || segments > MAX_TRAJECTORY_STRIP_SEGMENTS {
        fail(ErrorCode::InvalidTrajectorySegmentCount);
        return 0;
    }

    let control_points = NukeControlPoints {
        p0x,
        p0y,
        p1x,
        p1y,
        p2x,
        p2y,
        p3x,
        p3y,
    };
    let result = RESULT_F32.with(|result| {
        let mut result = result.borrow_mut();
        write_nuke_strip_vertices(control_points, segments as usize, &mut result)
    });

    match result {
        Ok(()) => 1,
        Err(NukeStripError::ZeroSegments | NukeStripError::SizeOverflow) => {
            fail(ErrorCode::InvalidTrajectorySegmentCount);
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_result_f32_ptr() -> u32 {
    RESULT_F32.with(|result| {
        let result = result.borrow();
        if result.is_empty() {
            0
        } else {
            result.as_ptr() as usize as u32
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_result_f32_len() -> u32 {
    RESULT_F32.with(|result| result.borrow().len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_result_f64_ptr() -> u32 {
    RESULT_F64.with(|result| {
        let result = result.borrow();
        if result.is_empty() {
            0
        } else {
            result.as_ptr() as usize as u32
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_result_f64_len() -> u32 {
    RESULT_F64.with(|result| result.borrow().len() as u32)
}
