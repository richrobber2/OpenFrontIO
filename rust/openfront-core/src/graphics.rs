//! Deterministic CPU-side graphics preparation shared with the browser renderer.
//!
//! This module deliberately stops at byte-buffer generation. WebGL state,
//! textures, shaders, and browser APIs remain in TypeScript.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerrainPalette {
    pub ocean: [u8; 3],
    pub sand: [u8; 3],
    pub plains: [u8; 3],
    pub highland: [u8; 3],
    pub mountain: [u8; 3],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerrainGraphicsError {
    SizeOverflow,
    TerrainLengthMismatch { expected: usize, actual: usize },
}

const LAND_MASK: u8 = 0x80;
const SHORELINE_MASK: u8 = 0x40;
const MAGNITUDE_MASK: u8 = 0x1f;
const IMPASSABLE_MAGNITUDE: u8 = 31;
const SHORE_WATER_WHITE_BLEND_TENTHS: u16 = 765;
const BACKGROUND: [u8; 3] = [60, 60, 60];

#[inline]
fn add_clamped(base: u8, amount: u8) -> u8 {
    (u16::from(base) + u16::from(amount)).min(255) as u8
}

#[inline]
fn shoreline_water_channel(base: u8) -> u8 {
    // Matches JS Math.round(0.7 * base + 76.5) exactly for positive values.
    ((7 * u16::from(base) + SHORE_WATER_WHITE_BLEND_TENTHS + 5) / 10) as u8
}

/// Encode one OpenFront terrain byte to the exact RGBA8 value used by the
/// TypeScript WebGL renderer.
#[inline]
pub fn encode_terrain_rgba(terrain: u8, palette: TerrainPalette) -> [u8; 4] {
    let is_land = terrain & LAND_MASK != 0;
    let is_shoreline = terrain & SHORELINE_MASK != 0;
    let magnitude = terrain & MAGNITUDE_MASK;

    let rgb = if is_land && magnitude == IMPASSABLE_MAGNITUDE {
        BACKGROUND
    } else if is_land && is_shoreline {
        palette.sand
    } else if is_land {
        if magnitude < 10 {
            [
                palette.plains[0],
                // Uint8Array assignment in JS wraps negative values rather
                // than saturating. Keep that behaviour for arbitrary custom
                // palettes, even though the stock palette never underflows.
                palette.plains[1].wrapping_sub(magnitude.wrapping_mul(2)),
                palette.plains[2],
            ]
        } else if magnitude < 20 {
            let offset = (magnitude - 10) * 2;
            [
                add_clamped(palette.highland[0], offset),
                add_clamped(palette.highland[1], offset),
                add_clamped(palette.highland[2], offset),
            ]
        } else {
            let offset = magnitude / 2;
            [
                add_clamped(palette.mountain[0], offset),
                add_clamped(palette.mountain[1], offset),
                add_clamped(palette.mountain[2], offset),
            ]
        }
    } else if is_shoreline {
        [
            shoreline_water_channel(palette.ocean[0]),
            shoreline_water_channel(palette.ocean[1]),
            shoreline_water_channel(palette.ocean[2]),
        ]
    } else {
        let depth = magnitude.min(10);
        [
            palette.ocean[0].saturating_sub(depth),
            palette.ocean[1].saturating_sub(depth),
            palette.ocean[2].saturating_sub(depth),
        ]
    };

    [rgb[0], rgb[1], rgb[2], 255]
}

/// Expand a terrain-byte vector into RGBA in place. The loop runs backwards so
/// each one-byte source tile is consumed before its four-byte destination can
/// overwrite it. This is the Wasm-friendly path: one allocation grows from
/// `w*h` bytes to `w*h*4` instead of retaining input + cloned input + output.
pub fn build_terrain_rgba_in_place(
    terrain: &mut Vec<u8>,
    width: u32,
    height: u32,
    palette: TerrainPalette,
) -> Result<(), TerrainGraphicsError> {
    let pixel_count = (width as usize)
        .checked_mul(height as usize)
        .ok_or(TerrainGraphicsError::SizeOverflow)?;
    if terrain.len() != pixel_count {
        return Err(TerrainGraphicsError::TerrainLengthMismatch {
            expected: pixel_count,
            actual: terrain.len(),
        });
    }
    let byte_count = pixel_count
        .checked_mul(4)
        .ok_or(TerrainGraphicsError::SizeOverflow)?;
    terrain.resize(byte_count, 0);

    for index in (0..pixel_count).rev() {
        let rgba = encode_terrain_rgba(terrain[index], palette);
        let offset = index * 4;
        terrain[offset..offset + 4].copy_from_slice(&rgba);
    }
    Ok(())
}

/// Convert a map-sized terrain-byte slice into the RGBA8 texture uploaded by
/// TerrainPass. The owned Wasm upload path uses `build_terrain_rgba_in_place`
/// directly to avoid the copy performed here.
pub fn build_terrain_rgba(
    terrain: &[u8],
    width: u32,
    height: u32,
    palette: TerrainPalette,
) -> Result<Vec<u8>, TerrainGraphicsError> {
    let mut rgba = terrain.to_vec();
    build_terrain_rgba_in_place(&mut rgba, width, height, palette)?;
    Ok(rgba)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PALETTE: TerrainPalette = TerrainPalette {
        ocean: [71, 133, 181],
        sand: [204, 203, 158],
        plains: [190, 220, 138],
        highland: [220, 203, 158],
        mountain: [230, 230, 230],
    };

    #[test]
    fn matches_renderer_terrain_branches() {
        assert_eq!(encode_terrain_rgba(0, PALETTE), [71, 133, 181, 255]);
        assert_eq!(encode_terrain_rgba(10, PALETTE), [61, 123, 171, 255]);
        assert_eq!(encode_terrain_rgba(SHORELINE_MASK, PALETTE), [126, 170, 203, 255]);
        assert_eq!(
            encode_terrain_rgba(LAND_MASK | SHORELINE_MASK, PALETTE),
            [204, 203, 158, 255]
        );
        assert_eq!(encode_terrain_rgba(LAND_MASK | 5, PALETTE), [190, 210, 138, 255]);
        assert_eq!(encode_terrain_rgba(LAND_MASK | 15, PALETTE), [230, 213, 168, 255]);
        assert_eq!(encode_terrain_rgba(LAND_MASK | 20, PALETTE), [240, 240, 240, 255]);
        assert_eq!(
            encode_terrain_rgba(LAND_MASK | IMPASSABLE_MAGNITUDE, PALETTE),
            [60, 60, 60, 255]
        );
    }

    #[test]
    fn preserves_uint8_wrapping_for_dark_plains_overrides() {
        let palette = TerrainPalette {
            plains: [0, 0, 0],
            ..PALETTE
        };
        assert_eq!(encode_terrain_rgba(LAND_MASK | 9, palette), [0, 238, 0, 255]);
    }

    #[test]
    fn expands_texture_in_place_without_corrupting_unread_tiles() {
        let source = vec![0, LAND_MASK | 5, SHORELINE_MASK, LAND_MASK | 20];
        let expected = build_terrain_rgba(&source, 2, 2, PALETTE).unwrap();
        let mut in_place = source;
        build_terrain_rgba_in_place(&mut in_place, 2, 2, PALETTE).unwrap();
        assert_eq!(in_place, expected);
    }

    #[test]
    fn rejects_mismatched_texture_dimensions() {
        assert_eq!(
            build_terrain_rgba(&[0, 1, 2], 2, 2, PALETTE),
            Err(TerrainGraphicsError::TerrainLengthMismatch {
                expected: 4,
                actual: 3,
            })
        );
    }
}
