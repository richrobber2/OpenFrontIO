//! Deterministic pseudo-random generator matching `src/core/PseudoRandom.ts`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PseudoRandom {
    s0: u32,
    s1: u32,
    s2: u32,
    s3: u32,
}

impl PseudoRandom {
    #[must_use]
    pub fn new(seed: i32) -> Self {
        let mut h = seed as u32;
        let mut split = || {
            h = h.wrapping_add(0x9e37_79b9);
            let mut t = h ^ (h >> 16);
            t = t.wrapping_mul(0x21f0_aaad);
            t ^= t >> 15;
            t = t.wrapping_mul(0x735a_2d97);
            t ^ (t >> 15)
        };

        let mut random = Self {
            s0: split(),
            s1: split(),
            s2: split(),
            s3: split(),
        };
        for _ in 0..12 {
            random.next_u32();
        }
        random
    }

    #[must_use]
    pub fn next_u32(&mut self) -> u32 {
        let t = self.s0.wrapping_add(self.s1).wrapping_add(self.s3);
        self.s3 = self.s3.wrapping_add(1);
        self.s0 = self.s1 ^ (self.s1 >> 9);
        self.s1 = self.s2.wrapping_add(self.s2 << 3);
        self.s2 = self.s2.rotate_left(21);
        self.s2 = self.s2.wrapping_add(t);
        t
    }

    #[must_use]
    pub fn next_f64(&mut self) -> f64 {
        f64::from(self.next_u32()) / 4_294_967_296.0
    }

    #[must_use]
    pub fn next_int(&mut self, min: i32, max: i32) -> i32 {
        debug_assert!(max >= min);
        let span = f64::from(max - min);
        (self.next_f64() * span).floor() as i32 + min
    }

    #[must_use]
    pub fn chance(&mut self, odds: i32) -> bool {
        self.next_int(0, odds) == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_stream_is_stable() {
        let mut a = PseudoRandom::new(12345);
        let mut b = PseudoRandom::new(12345);
        for _ in 0..128 {
            assert_eq!(a.next_u32(), b.next_u32());
        }
    }

    #[test]
    fn congruent_i32_seeds_match() {
        let mut a = PseudoRandom::new(-1);
        let mut b = PseudoRandom::new(u32::MAX as i32);
        for _ in 0..32 {
            assert_eq!(a.next_u32(), b.next_u32());
        }
    }
}
