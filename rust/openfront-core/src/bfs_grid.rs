//! Four-direction grid BFS matching `BFS.Grid.ts`.

#[derive(Debug)]
pub struct BfsGrid {
    stamp: u32,
    visited_stamp: Vec<u32>,
    queue: Vec<i32>,
    dist: Vec<u16>,
}

impl BfsGrid {
    #[must_use]
    pub fn new(num_nodes: usize) -> Self {
        Self {
            stamp: 1,
            visited_stamp: vec![0; num_nodes],
            queue: vec![0; num_nodes],
            dist: vec![0; num_nodes],
        }
    }

    pub fn search<R>(
        &mut self,
        width: u32,
        height: u32,
        starts: &[u32],
        max_distance: u16,
        mut is_valid_node: impl FnMut(u32) -> bool,
        mut visitor: impl FnMut(u32, u16) -> BfsVisit<R>,
    ) -> Option<R> {
        let stamp = self.next_stamp();
        let last_row_start = height.saturating_sub(1).saturating_mul(width);
        let mut head = 0usize;
        let mut tail = 0usize;

        for &start in starts {
            let index = start as usize;
            if index >= self.visited_stamp.len() {
                continue;
            }
            self.visited_stamp[index] = stamp;
            self.dist[index] = 0;
            self.queue[tail] = start as i32;
            tail += 1;
        }

        while head < tail {
            let node = self.queue[head] as u32;
            head += 1;
            let node_index = node as usize;
            let dist = self.dist[node_index];

            match visitor(node, dist) {
                BfsVisit::Found(value) => return Some(value),
                BfsVisit::Reject => continue,
                BfsVisit::Continue => {}
            }

            let next_dist = dist.saturating_add(1);
            if next_dist > max_distance {
                continue;
            }
            let x = node % width;

            let mut enqueue = |neighbor: u32, this: &mut Self| {
                let index = neighbor as usize;
                if this.visited_stamp[index] != stamp && is_valid_node(neighbor) {
                    this.visited_stamp[index] = stamp;
                    this.dist[index] = next_dist;
                    this.queue[tail] = neighbor as i32;
                    tail += 1;
                }
            };

            if node >= width {
                enqueue(node - width, self);
            }
            if node < last_row_start {
                enqueue(node + width, self);
            }
            if x != 0 {
                enqueue(node - 1, self);
            }
            if x + 1 < width {
                enqueue(node + 1, self);
            }
        }

        None
    }

    fn next_stamp(&mut self) -> u32 {
        let stamp = self.stamp;
        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.visited_stamp.fill(0);
            self.stamp = 1;
        }
        stamp
    }
}

pub enum BfsVisit<R> {
    Found(R),
    Reject,
    Continue,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visits_in_typescript_cardinal_fifo_order_and_reuses_stamps() {
        let mut bfs = BfsGrid::new(9);
        let mut seen = Vec::new();
        let result = bfs.search(
            3,
            3,
            &[4],
            2,
            |_| true,
            |node, dist| {
                seen.push((node, dist));
                if node == 0 {
                    BfsVisit::Found(node)
                } else {
                    BfsVisit::Continue
                }
            },
        );
        assert_eq!(result, Some(0));
        assert_eq!(seen[..5], [(4, 0), (1, 1), (7, 1), (3, 1), (5, 1)]);

        let second = bfs.search(
            3,
            3,
            &[8],
            1,
            |_| true,
            |node, _| if node == 5 { BfsVisit::Found(node) } else { BfsVisit::Continue },
        );
        assert_eq!(second, Some(5));
    }

    #[test]
    fn reject_stops_expansion_from_that_node() {
        let mut bfs = BfsGrid::new(9);
        let mut seen = Vec::new();
        let _ = bfs.search(
            3,
            3,
            &[4],
            3,
            |_| true,
            |node, _| {
                seen.push(node);
                if node == 1 { BfsVisit::<u32>::Reject } else { BfsVisit::Continue }
            },
        );
        assert!(seen.contains(&4));
        assert!(seen.contains(&1));
    }
}
