use openfront_core::{write_spiral_segment_samples, SpiralTrailError, SPIRAL_SAMPLES_PER_TILE};

const MAX_SPIRAL_SEGMENT_SAMPLES: usize = 4096;

#[unsafe(no_mangle)]
pub extern "C" fn openfront_spiral_segment_build(
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    segment_length: f64,
    previous_dir_x: f64,
    previous_dir_y: f64,
    has_previous_dir: u32,
    include_start: u32,
    head_distance: f64,
) -> u32 {
    begin_call();

    if ![
        x0,
        y0,
        x1,
        y1,
        segment_length,
        previous_dir_x,
        previous_dir_y,
        head_distance,
    ]
    .into_iter()
    .all(f64::is_finite)
        || segment_length <= 0.0
    {
        fail(ErrorCode::InvalidSpiralSegment);
        return 0;
    }

    let steps = (segment_length * SPIRAL_SAMPLES_PER_TILE).ceil();
    let sample_count = steps + f64::from(include_start != 0);
    if !sample_count.is_finite()
        || sample_count < 1.0
        || sample_count > MAX_SPIRAL_SEGMENT_SAMPLES as f64
    {
        fail(ErrorCode::InvalidSpiralSegment);
        return 0;
    }

    let result = RESULT_F32.with(|result| {
        let mut result = result.borrow_mut();
        write_spiral_segment_samples(
            x0,
            y0,
            x1,
            y1,
            segment_length,
            previous_dir_x,
            previous_dir_y,
            has_previous_dir != 0,
            include_start != 0,
            head_distance,
            &mut result,
        )
    });

    match result {
        Ok(samples) if samples <= MAX_SPIRAL_SEGMENT_SAMPLES => 1,
        Ok(_) | Err(SpiralTrailError::InvalidSegmentLength | SpiralTrailError::SizeOverflow) => {
            fail(ErrorCode::InvalidSpiralSegment);
            0
        }
    }
}
