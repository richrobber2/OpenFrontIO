//! Abstract graph storage and A* routing for hierarchical water pathfinding.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AbstractNode {
    pub id: u32,
    pub x: u32,
    pub y: u32,
    pub tile: u32,
    pub component_id: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AbstractEdge {
    pub id: u32,
    pub node_a: u32,
    pub node_b: u32,
    pub cost: f32,
    pub cluster_x: u32,
    pub cluster_y: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cluster {
    pub x: u32,
    pub y: u32,
    pub node_ids: Vec<u32>,
}

#[derive(Debug, Clone)]
pub struct AbstractGraph {
    pub cluster_size: u32,
    pub clusters_x: u32,
    pub clusters_y: u32,
    nodes: Vec<Option<AbstractNode>>,
    edges: Vec<Option<AbstractEdge>>,
    node_edge_ids: Vec<Vec<u32>>,
    clusters: Vec<Option<Cluster>>,
}

impl AbstractGraph {
    #[must_use]
    pub fn new(cluster_size: u32, clusters_x: u32, clusters_y: u32) -> Self {
        let cluster_count = clusters_x.saturating_mul(clusters_y) as usize;
        Self {
            cluster_size,
            clusters_x,
            clusters_y,
            nodes: Vec::new(),
            edges: Vec::new(),
            node_edge_ids: Vec::new(),
            clusters: vec![None; cluster_count],
        }
    }

    pub fn add_node(&mut self, node: AbstractNode) {
        let index = node.id as usize;
        if self.nodes.len() <= index {
            self.nodes.resize(index + 1, None);
            self.node_edge_ids.resize_with(index + 1, Vec::new);
        }
        self.nodes[index] = Some(node);
    }

    pub fn add_edge(&mut self, edge: AbstractEdge) {
        let index = edge.id as usize;
        if self.edges.len() <= index {
            self.edges.resize(index + 1, None);
        }
        let a = edge.node_a as usize;
        let b = edge.node_b as usize;
        if self.node_edge_ids.len() <= a.max(b) {
            self.node_edge_ids.resize_with(a.max(b) + 1, Vec::new);
        }
        self.edges[index] = Some(edge);
        self.node_edge_ids[a].push(edge.id);
        self.node_edge_ids[b].push(edge.id);
    }

    pub fn set_cluster(&mut self, cluster: Cluster) {
        let key = self.cluster_key(cluster.x, cluster.y);
        if key < self.clusters.len() {
            self.clusters[key] = Some(cluster);
        }
    }

    #[must_use]
    pub fn cluster_key(&self, x: u32, y: u32) -> usize {
        y.saturating_mul(self.clusters_x).saturating_add(x) as usize
    }

    #[must_use]
    pub fn node(&self, id: u32) -> Option<AbstractNode> {
        self.nodes.get(id as usize).and_then(|node| *node)
    }

    #[must_use]
    pub fn edge(&self, id: u32) -> Option<AbstractEdge> {
        self.edges.get(id as usize).and_then(|edge| *edge)
    }

    #[must_use]
    pub fn cluster(&self, x: u32, y: u32) -> Option<&Cluster> {
        self.clusters.get(self.cluster_key(x, y))?.as_ref()
    }

    #[must_use]
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    #[must_use]
    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    pub fn node_edges(&self, node_id: u32) -> impl Iterator<Item = AbstractEdge> + '_ {
        self.node_edge_ids
            .get(node_id as usize)
            .into_iter()
            .flatten()
            .filter_map(|edge_id| self.edge(*edge_id))
    }

    #[must_use]
    pub fn edge_between(&self, node_a: u32, node_b: u32) -> Option<AbstractEdge> {
        self.node_edges(node_a)
            .find(|edge| edge.node_a == node_b || edge.node_b == node_b)
    }

    #[must_use]
    pub const fn other_node(edge: AbstractEdge, node_id: u32) -> u32 {
        if edge.node_a == node_id {
            edge.node_b
        } else {
            edge.node_a
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct HeapEntry {
    node: u32,
    priority: f32,
}

#[derive(Debug, Default)]
struct MinHeap {
    entries: Vec<HeapEntry>,
}

impl MinHeap {
    fn clear(&mut self) {
        self.entries.clear();
    }

    fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    fn push(&mut self, node: u32, priority: f32) {
        let mut index = self.entries.len();
        self.entries.push(HeapEntry { node, priority });
        while index > 0 {
            let parent = (index - 1) >> 1;
            if self.entries[parent].priority <= self.entries[index].priority {
                break;
            }
            self.entries.swap(parent, index);
            index = parent;
        }
    }

    fn pop(&mut self) -> Option<u32> {
        if self.entries.is_empty() {
            return None;
        }
        let result = self.entries[0].node;
        let last = self.entries.pop().expect("heap was non-empty");
        if !self.entries.is_empty() {
            self.entries[0] = last;
            let mut index = 0;
            loop {
                let left = (index << 1) + 1;
                let right = left + 1;
                let mut smallest = index;
                if left < self.entries.len()
                    && self.entries[left].priority < self.entries[smallest].priority
                {
                    smallest = left;
                }
                if right < self.entries.len()
                    && self.entries[right].priority < self.entries[smallest].priority
                {
                    smallest = right;
                }
                if smallest == index {
                    break;
                }
                self.entries.swap(smallest, index);
                index = smallest;
            }
        }
        Some(result)
    }
}

#[derive(Debug)]
pub struct AbstractGraphAStar {
    stamp: u32,
    closed_stamp: Vec<u32>,
    g_score_stamp: Vec<u32>,
    g_score: Vec<f32>,
    came_from: Vec<i32>,
    start_node: Vec<i32>,
    heap: MinHeap,
    heuristic_weight: f32,
    max_iterations: usize,
}

impl AbstractGraphAStar {
    #[must_use]
    pub fn new(graph: &AbstractGraph) -> Self {
        let count = graph.node_count();
        Self {
            stamp: 1,
            closed_stamp: vec![0; count],
            g_score_stamp: vec![0; count],
            g_score: vec![0.0; count],
            came_from: vec![-1; count],
            start_node: vec![-1; count],
            heap: MinHeap::default(),
            heuristic_weight: 1.0,
            max_iterations: 100_000,
        }
    }

    pub fn find_path(
        &mut self,
        graph: &AbstractGraph,
        starts: &[u32],
        goal: u32,
    ) -> Option<Vec<u32>> {
        if starts.is_empty() || graph.node(goal).is_none() {
            return None;
        }
        if starts.len() == 1 && graph.node(starts[0]).is_none() {
            return None;
        }

        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.closed_stamp.fill(0);
            self.g_score_stamp.fill(0);
            self.stamp = 1;
        }
        let stamp = self.stamp;
        self.heap.clear();
        let goal_node = graph.node(goal)?;

        for &start in starts {
            let Some(node) = graph.node(start) else {
                continue;
            };
            let index = start as usize;
            self.g_score[index] = 0.0;
            self.g_score_stamp[index] = stamp;
            self.came_from[index] = -1;
            self.start_node[index] = start as i32;
            let h = self.heuristic_weight
                * (node.x.abs_diff(goal_node.x) + node.y.abs_diff(goal_node.y)) as f32;
            self.heap.push(start, h);
        }

        let mut iterations = self.max_iterations;
        while !self.heap.is_empty() {
            iterations = iterations.saturating_sub(1);
            if iterations == 0 {
                return None;
            }

            let current = self.heap.pop()?;
            let current_index = current as usize;
            if self.closed_stamp[current_index] == stamp {
                continue;
            }
            self.closed_stamp[current_index] = stamp;
            if current == goal {
                return self.build_path(goal);
            }

            let current_g = self.g_score[current_index];
            let current_start = self.start_node[current_index];
            for edge in graph.node_edges(current) {
                let neighbor = AbstractGraph::other_node(edge, current);
                let neighbor_index = neighbor as usize;
                if self.closed_stamp[neighbor_index] == stamp {
                    continue;
                }
                let tentative = current_g + edge.cost;
                if self.g_score_stamp[neighbor_index] != stamp
                    || tentative < self.g_score[neighbor_index]
                {
                    self.came_from[neighbor_index] = current as i32;
                    self.g_score[neighbor_index] = tentative;
                    self.g_score_stamp[neighbor_index] = stamp;
                    self.start_node[neighbor_index] = current_start;
                    if let Some(node) = graph.node(neighbor) {
                        let h = self.heuristic_weight
                            * (node.x.abs_diff(goal_node.x) + node.y.abs_diff(goal_node.y)) as f32;
                        self.heap.push(neighbor, tentative + h);
                    }
                }
            }
        }
        None
    }

    fn build_path(&self, goal: u32) -> Option<Vec<u32>> {
        let mut path = Vec::new();
        let mut current = goal as i32;
        let max_len = self.came_from.len();
        while current != -1 {
            let index = usize::try_from(current).ok()?;
            if index >= max_len || path.len() > max_len {
                return None;
            }
            path.push(current as u32);
            current = self.came_from[index];
        }
        path.reverse();
        Some(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph() -> AbstractGraph {
        let mut graph = AbstractGraph::new(32, 2, 1);
        for (id, x) in [0_u32, 10, 20, 30] .into_iter().enumerate() {
            graph.add_node(AbstractNode {
                id: id as u32,
                x,
                y: 0,
                tile: x,
                component_id: 1,
            });
        }
        graph.add_edge(AbstractEdge { id: 0, node_a: 0, node_b: 1, cost: 10.0, cluster_x: 0, cluster_y: 0 });
        graph.add_edge(AbstractEdge { id: 1, node_a: 1, node_b: 2, cost: 10.0, cluster_x: 0, cluster_y: 0 });
        graph.add_edge(AbstractEdge { id: 2, node_a: 2, node_b: 3, cost: 10.0, cluster_x: 1, cluster_y: 0 });
        graph.add_edge(AbstractEdge { id: 3, node_a: 0, node_b: 3, cost: 100.0, cluster_x: 0, cluster_y: 0 });
        graph
    }

    #[test]
    fn routes_weighted_graph_and_reuses_scratch() {
        let graph = graph();
        let mut astar = AbstractGraphAStar::new(&graph);
        let first = astar.find_path(&graph, &[0], 3).unwrap();
        let second = astar.find_path(&graph, &[0], 3).unwrap();
        assert_eq!(first, vec![0, 1, 2, 3]);
        assert_eq!(second, first);
    }

    #[test]
    fn multi_source_returns_winning_origin_path() {
        let graph = graph();
        let mut astar = AbstractGraphAStar::new(&graph);
        assert_eq!(astar.find_path(&graph, &[0, 2], 3), Some(vec![2, 3]));
    }
}
