//! Packed terrain and tile-state values matching `src/core/game/GameMap.ts`.
//!
//! Terrain occupies one byte. Mutable ownership and effect state occupies one
//! unsigned 16-bit value. Network updates combine them into the low 24 bits of
//! a 32-bit integer.

pub const TERRAIN_LAND_MASK: u8 = 1 << 7;
pub const TERRAIN_SHORELINE_MASK: u8 = 1 << 6;
pub const TERRAIN_OCEAN_MASK: u8 = 1 << 5;
pub const TERRAIN_MAGNITUDE_MASK: u8 = 0x1f;
pub const IMPASSABLE_MAGNITUDE: u8 = 31;

pub const OWNER_ID_MASK: u16 = 0x0fff;
pub const FALLOUT_MASK: u16 = 1 << 13;
pub const DEFENSE_BONUS_MASK: u16 = 1 << 14;

/// Terrain categories in the same order as the TypeScript `TerrainType` enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum TerrainType {
    Plains = 0,
    Highland = 1,
    Mountain = 2,
    Ocean = 3,
    Impassable = 4,
}

/// One packed terrain byte.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct Terrain(u8);

impl Terrain {
    #[must_use]
    pub const fn from_byte(byte: u8) -> Self {
        Self(byte)
    }

    #[must_use]
    pub const fn byte(self) -> u8 {
        self.0
    }

    #[must_use]
    pub const fn is_land(self) -> bool {
        self.0 & TERRAIN_LAND_MASK != 0
    }

    #[must_use]
    pub const fn is_water(self) -> bool {
        !self.is_land()
    }

    #[must_use]
    pub const fn is_ocean(self) -> bool {
        self.0 & TERRAIN_OCEAN_MASK != 0
    }

    #[must_use]
    pub const fn is_shoreline(self) -> bool {
        self.0 & TERRAIN_SHORELINE_MASK != 0
    }

    #[must_use]
    pub const fn is_shore(self) -> bool {
        self.is_land() && self.is_shoreline()
    }

    #[must_use]
    pub const fn magnitude(self) -> u8 {
        self.0 & TERRAIN_MAGNITUDE_MASK
    }

    #[must_use]
    pub const fn is_impassable(self) -> bool {
        self.is_land() && self.magnitude() == IMPASSABLE_MAGNITUDE
    }

    #[must_use]
    pub const fn cost(self) -> u8 {
        if self.magnitude() < 10 {
            2
        } else {
            1
        }
    }

    #[must_use]
    pub const fn terrain_type(self) -> TerrainType {
        if !self.is_land() {
            TerrainType::Ocean
        } else if self.magnitude() >= IMPASSABLE_MAGNITUDE {
            TerrainType::Impassable
        } else if self.magnitude() < 10 {
            TerrainType::Plains
        } else if self.magnitude() < 20 {
            TerrainType::Highland
        } else {
            TerrainType::Mountain
        }
    }

    /// Converts passable land to lake water, matching `GameMapImpl.setWater`.
    ///
    /// Returns `true` only when the byte changed. Water and impassable land are
    /// intentionally left untouched.
    pub fn set_water(&mut self) -> bool {
        if !self.is_land() || self.is_impassable() {
            return false;
        }
        self.0 = 0;
        true
    }

    pub fn set_shoreline(&mut self, value: bool) {
        if value {
            self.0 |= TERRAIN_SHORELINE_MASK;
        } else {
            self.0 &= !TERRAIN_SHORELINE_MASK;
        }
    }

    pub fn set_ocean(&mut self) {
        self.0 |= TERRAIN_OCEAN_MASK;
    }

    /// Stores only the low five bits, matching the TypeScript bit mask.
    pub fn set_magnitude(&mut self, value: u8) {
        self.0 = (self.0 & !TERRAIN_MAGNITUDE_MASK) | (value & TERRAIN_MAGNITUDE_MASK);
    }
}

/// Errors produced while changing packed tile state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TileStateError {
    OwnerIdOutOfRange { owner_id: u32 },
}

/// One packed unsigned 16-bit mutable tile-state value.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct TileState(u16);

impl TileState {
    #[must_use]
    pub const fn from_bits(bits: u16) -> Self {
        Self(bits)
    }

    #[must_use]
    pub const fn bits(self) -> u16 {
        self.0
    }

    #[must_use]
    pub const fn owner_id(self) -> u16 {
        self.0 & OWNER_ID_MASK
    }

    #[must_use]
    pub const fn has_owner(self) -> bool {
        self.owner_id() != 0
    }

    pub fn set_owner_id(&mut self, owner_id: u32) -> Result<(), TileStateError> {
        if owner_id > u32::from(OWNER_ID_MASK) {
            return Err(TileStateError::OwnerIdOutOfRange { owner_id });
        }
        self.0 = (self.0 & !OWNER_ID_MASK) | owner_id as u16;
        Ok(())
    }

    #[must_use]
    pub const fn has_fallout(self) -> bool {
        self.0 & FALLOUT_MASK != 0
    }

    /// Sets fallout and returns whether the value changed.
    pub fn set_fallout(&mut self, value: bool) -> bool {
        let previous = self.has_fallout();
        if value {
            self.0 |= FALLOUT_MASK;
        } else {
            self.0 &= !FALLOUT_MASK;
        }
        previous != value
    }

    #[must_use]
    pub const fn has_defense_bonus(self) -> bool {
        self.0 & DEFENSE_BONUS_MASK != 0
    }

    pub fn set_defense_bonus(&mut self, value: bool) {
        if value {
            self.0 |= DEFENSE_BONUS_MASK;
        } else {
            self.0 &= !DEFENSE_BONUS_MASK;
        }
    }
}

/// A network/update value containing state in bits 0-15 and terrain in 16-23.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct PackedTile(u32);

impl PackedTile {
    #[must_use]
    pub const fn from_raw(raw: u32) -> Self {
        Self(raw)
    }

    #[must_use]
    pub const fn from_parts(terrain: Terrain, state: TileState) -> Self {
        Self(((terrain.byte() as u32) << 16) | state.bits() as u32)
    }

    #[must_use]
    pub const fn raw(self) -> u32 {
        self.0
    }

    #[must_use]
    pub const fn state(self) -> TileState {
        TileState::from_bits((self.0 & 0xffff) as u16)
    }

    #[must_use]
    pub const fn terrain(self) -> Terrain {
        Terrain::from_byte(((self.0 >> 16) & 0xff) as u8)
    }
}

/// Counter changes caused by applying one packed update.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct TileTransition {
    pub terrain_changed: bool,
    /// `-1`, `0`, or `1`, suitable for updating the map's land-tile count.
    pub land_delta: i8,
    /// `-1`, `0`, or `1`, suitable for updating the map's fallout count.
    pub fallout_delta: i8,
}

/// Applies the same state/terrain replacement semantics as `updateTile`.
#[must_use]
pub fn apply_packed_update(
    terrain: &mut Terrain,
    state: &mut TileState,
    packed: PackedTile,
) -> TileTransition {
    let previous_terrain = *terrain;
    let previous_fallout = state.has_fallout();
    let next_terrain = packed.terrain();
    let next_state = packed.state();

    *terrain = next_terrain;
    *state = next_state;

    let land_delta = match (previous_terrain.is_land(), next_terrain.is_land()) {
        (true, false) => -1,
        (false, true) => 1,
        _ => 0,
    };
    let fallout_delta = match (previous_fallout, next_state.has_fallout()) {
        (true, false) => -1,
        (false, true) => 1,
        _ => 0,
    };

    TileTransition {
        terrain_changed: previous_terrain != next_terrain,
        land_delta,
        fallout_delta,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn land(magnitude: u8) -> Terrain {
        Terrain::from_byte(TERRAIN_LAND_MASK | magnitude)
    }

    #[test]
    fn terrain_decodes_flags_and_type_thresholds() {
        let shore =
            Terrain::from_byte(TERRAIN_LAND_MASK | TERRAIN_SHORELINE_MASK | TERRAIN_OCEAN_MASK | 9);

        assert!(shore.is_land());
        assert!(!shore.is_water());
        assert!(shore.is_ocean());
        assert!(shore.is_shoreline());
        assert!(shore.is_shore());
        assert_eq!(shore.magnitude(), 9);
        assert_eq!(shore.cost(), 2);
        assert_eq!(shore.terrain_type(), TerrainType::Plains);
        assert_eq!(land(10).terrain_type(), TerrainType::Highland);
        assert_eq!(land(20).terrain_type(), TerrainType::Mountain);
        assert_eq!(land(31).terrain_type(), TerrainType::Impassable);
        assert_eq!(
            Terrain::from_byte(TERRAIN_OCEAN_MASK).terrain_type(),
            TerrainType::Ocean
        );
    }

    #[test]
    fn set_water_matches_game_map_guards() {
        let mut passable_land = land(12);
        let mut impassable_land = land(IMPASSABLE_MAGNITUDE);
        let mut water = Terrain::from_byte(TERRAIN_OCEAN_MASK);

        assert!(passable_land.set_water());
        assert_eq!(passable_land.byte(), 0);
        assert!(!impassable_land.set_water());
        assert_eq!(impassable_land, land(IMPASSABLE_MAGNITUDE));
        assert!(!water.set_water());
        assert_eq!(water.byte(), TERRAIN_OCEAN_MASK);
    }

    #[test]
    fn terrain_mutations_preserve_unrelated_bits() {
        let mut terrain = Terrain::from_byte(TERRAIN_LAND_MASK | TERRAIN_OCEAN_MASK | 7);

        terrain.set_shoreline(true);
        terrain.set_magnitude(0b1010_0110);
        assert_eq!(terrain.magnitude(), 6);
        assert!(terrain.is_land());
        assert!(terrain.is_ocean());
        assert!(terrain.is_shoreline());

        terrain.set_shoreline(false);
        assert!(!terrain.is_shoreline());
    }

    #[test]
    fn owner_updates_preserve_non_owner_bits() {
        const RESERVED_BITS: u16 = (1 << 12) | (1 << 15);
        let mut state = TileState::from_bits(RESERVED_BITS | FALLOUT_MASK);

        state.set_owner_id(0x0abc).unwrap();

        assert_eq!(state.owner_id(), 0x0abc);
        assert!(state.has_owner());
        assert!(state.has_fallout());
        assert_eq!(state.bits() & RESERVED_BITS, RESERVED_BITS);
    }

    #[test]
    fn rejects_owner_ids_that_do_not_fit_twelve_bits() {
        let mut state = TileState::default();
        let owner_id = u32::from(OWNER_ID_MASK) + 1;

        assert_eq!(
            state.set_owner_id(owner_id),
            Err(TileStateError::OwnerIdOutOfRange { owner_id })
        );
        assert_eq!(state, TileState::default());
    }

    #[test]
    fn fallout_and_defense_bits_toggle_independently() {
        let mut state = TileState::default();

        assert!(state.set_fallout(true));
        assert!(!state.set_fallout(true));
        state.set_defense_bonus(true);
        assert!(state.has_fallout());
        assert!(state.has_defense_bonus());

        assert!(state.set_fallout(false));
        assert!(!state.has_fallout());
        assert!(state.has_defense_bonus());
    }

    #[test]
    fn packed_tiles_round_trip_the_low_twenty_four_bits() {
        let terrain = Terrain::from_byte(0xe5);
        let state = TileState::from_bits(0x6123);
        let packed = PackedTile::from_parts(terrain, state);

        assert_eq!(packed.raw(), 0x00e5_6123);
        assert_eq!(packed.terrain(), terrain);
        assert_eq!(packed.state(), state);

        let with_ignored_high_bits = PackedTile::from_raw(0xffe5_6123);
        assert_eq!(with_ignored_high_bits.terrain(), terrain);
        assert_eq!(with_ignored_high_bits.state(), state);
    }

    #[test]
    fn packed_updates_report_land_and_fallout_counter_deltas() {
        let mut terrain = land(5);
        let mut state = TileState::default();
        let mut next_state = TileState::default();
        next_state.set_owner_id(7).unwrap();
        next_state.set_fallout(true);
        let ocean = Terrain::from_byte(TERRAIN_OCEAN_MASK);
        let packed = PackedTile::from_parts(ocean, next_state);

        assert_eq!(
            apply_packed_update(&mut terrain, &mut state, packed),
            TileTransition {
                terrain_changed: true,
                land_delta: -1,
                fallout_delta: 1,
            }
        );
        assert_eq!(terrain, ocean);
        assert_eq!(state, next_state);

        assert_eq!(
            apply_packed_update(&mut terrain, &mut state, packed),
            TileTransition::default()
        );

        let cleared = PackedTile::from_parts(land(20), TileState::default());
        assert_eq!(
            apply_packed_update(&mut terrain, &mut state, cleared),
            TileTransition {
                terrain_changed: true,
                land_delta: 1,
                fallout_delta: -1,
            }
        );
    }
}
