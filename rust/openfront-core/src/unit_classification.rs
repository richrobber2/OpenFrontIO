//! Stable unit-kind classification shared by browser/Wasm hot paths.
//!
//! Numeric unit-kind indices intentionally mirror the client's canonical
//! `ALL_UNIT_TYPES` order. The browser serializes only the small integer kind;
//! Rust owns category membership so the same decision can feed several hot
//! renderer/game-view subsets without repeatedly walking every building.

pub const UNIT_CLASS_MOBILE: u32 = 1 << 0;
pub const UNIT_CLASS_STRUCTURE: u32 = 1 << 1;
pub const UNIT_CLASS_TRAIL: u32 = 1 << 2;
pub const UNIT_CLASS_NUKE_ACTIVE: u32 = 1 << 3;
pub const UNIT_CLASS_NUKE_TELEGRAPH: u32 = 1 << 4;
pub const UNIT_CLASS_ATTACK_RING: u32 = 1 << 5;
pub const UNIT_CLASS_LIGHT: u32 = 1 << 6;

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnitKind {
    Transport = 0,
    TradeShip = 1,
    Warship = 2,
    AtomBomb = 3,
    HydrogenBomb = 4,
    Mirv = 5,
    SamMissile = 6,
    Shell = 7,
    MirvWarhead = 8,
    City = 9,
    Port = 10,
    Factory = 11,
    DefensePost = 12,
    SamLauncher = 13,
    MissileSilo = 14,
    Train = 15,
}

impl UnitKind {
    pub const COUNT: u32 = 16;

    pub const fn from_index(index: u32) -> Option<Self> {
        match index {
            0 => Some(Self::Transport),
            1 => Some(Self::TradeShip),
            2 => Some(Self::Warship),
            3 => Some(Self::AtomBomb),
            4 => Some(Self::HydrogenBomb),
            5 => Some(Self::Mirv),
            6 => Some(Self::SamMissile),
            7 => Some(Self::Shell),
            8 => Some(Self::MirvWarhead),
            9 => Some(Self::City),
            10 => Some(Self::Port),
            11 => Some(Self::Factory),
            12 => Some(Self::DefensePost),
            13 => Some(Self::SamLauncher),
            14 => Some(Self::MissileSilo),
            15 => Some(Self::Train),
            _ => None,
        }
    }
}

/// Return the renderer/game-view category bitset for one canonical unit kind.
/// Inactive and unknown units classify to zero so stale subset membership is
/// removed and newer upstream unit kinds fail closed until explicitly mapped.
pub fn classify_unit_kind(kind_index: u32, is_active: bool) -> u32 {
    if !is_active {
        return 0;
    }

    let Some(kind) = UnitKind::from_index(kind_index) else {
        return 0;
    };

    match kind {
        UnitKind::Transport => {
            UNIT_CLASS_MOBILE | UNIT_CLASS_TRAIL | UNIT_CLASS_ATTACK_RING | UNIT_CLASS_LIGHT
        }
        UnitKind::TradeShip | UnitKind::Warship | UnitKind::Train => {
            UNIT_CLASS_MOBILE | UNIT_CLASS_LIGHT
        }
        UnitKind::AtomBomb | UnitKind::HydrogenBomb | UnitKind::MirvWarhead => {
            UNIT_CLASS_MOBILE
                | UNIT_CLASS_TRAIL
                | UNIT_CLASS_NUKE_ACTIVE
                | UNIT_CLASS_NUKE_TELEGRAPH
                | UNIT_CLASS_LIGHT
        }
        UnitKind::Mirv => {
            UNIT_CLASS_MOBILE | UNIT_CLASS_TRAIL | UNIT_CLASS_NUKE_ACTIVE | UNIT_CLASS_LIGHT
        }
        UnitKind::SamMissile | UnitKind::Shell => UNIT_CLASS_MOBILE,
        UnitKind::City
        | UnitKind::Port
        | UnitKind::Factory
        | UnitKind::DefensePost
        | UnitKind::SamLauncher
        | UnitKind::MissileSilo => UNIT_CLASS_STRUCTURE | UNIT_CLASS_LIGHT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_kinds_cover_all_expected_indices() {
        for index in 0..UnitKind::COUNT {
            assert!(UnitKind::from_index(index).is_some());
        }
        assert_eq!(UnitKind::from_index(UnitKind::COUNT), None);
    }

    #[test]
    fn structures_never_enter_mobile_hot_paths() {
        for kind in 9..=14 {
            let flags = classify_unit_kind(kind, true);
            assert_ne!(flags & UNIT_CLASS_STRUCTURE, 0);
            assert_eq!(flags & UNIT_CLASS_MOBILE, 0);
        }
    }

    #[test]
    fn nuke_and_trail_subsets_match_client_semantics() {
        let atom = classify_unit_kind(UnitKind::AtomBomb as u32, true);
        assert_ne!(atom & UNIT_CLASS_NUKE_ACTIVE, 0);
        assert_ne!(atom & UNIT_CLASS_NUKE_TELEGRAPH, 0);
        assert_ne!(atom & UNIT_CLASS_TRAIL, 0);

        let mirv = classify_unit_kind(UnitKind::Mirv as u32, true);
        assert_ne!(mirv & UNIT_CLASS_NUKE_ACTIVE, 0);
        assert_eq!(mirv & UNIT_CLASS_NUKE_TELEGRAPH, 0);
        assert_ne!(mirv & UNIT_CLASS_TRAIL, 0);

        let transport = classify_unit_kind(UnitKind::Transport as u32, true);
        assert_ne!(transport & UNIT_CLASS_ATTACK_RING, 0);
        assert_ne!(transport & UNIT_CLASS_TRAIL, 0);
    }

    #[test]
    fn inactive_and_unknown_kinds_classify_to_zero() {
        assert_eq!(classify_unit_kind(UnitKind::City as u32, false), 0);
        assert_eq!(classify_unit_kind(999, true), 0);
    }
}
