//! Full abstract water graph builder matching the static-build path of `AbstractGraphBuilder`.

use crate::{
    AbstractEdge, AbstractGraph, AbstractNode, BfsGrid, BfsVisit, Cluster,
    ConnectedWaterComponents, GameMapError, GameMapStore, TileRef,
};
use std::collections::HashMap;

pub const DEFAULT_CLUSTER_SIZE: u32 = 32;

pub struct AbstractGraphBuilder {
    cluster_size: u32,
}

impl AbstractGraphBuilder {
    #[must_use]
    pub const fn new(cluster_size: u32) -> Self {
        Self { cluster_size }
    }

    pub fn build(&self, map: &GameMapStore) -> Result<AbstractGraph, GameMapError> {
        let width = map.width();
        let height = map.height();
        let clusters_x = width.div_ceil(self.cluster_size);
        let clusters_y = height.div_ceil(self.cluster_size);
        let components = ConnectedWaterComponents::build(map)?;
        let mut graph = AbstractGraph::new(self.cluster_size, clusters_x, clusters_y);
        let mut tile_to_node: HashMap<u32, AbstractNode> = HashMap::new();
        let mut cluster_nodes = vec![Vec::<u32>::new(); (clusters_x * clusters_y) as usize];
        let mut next_node_id = 0_u32;

        let mut get_or_create = |x: u32, y: u32| -> AbstractNode {
            let tile = y * width + x;
            if let Some(node) = tile_to_node.get(&tile) {
                return *node;
            }
            let node = AbstractNode {
                id: next_node_id,
                x,
                y,
                tile,
                component_id: u32::from(components.component_id(TileRef::new(tile)).unwrap_or(0)),
            };
            next_node_id += 1;
            tile_to_node.insert(tile, node);
            node
        };

        for cy in 0..clusters_y {
            for cx in 0..clusters_x {
                let base_x = cx * self.cluster_size;
                let base_y = cy * self.cluster_size;

                if cx + 1 < clusters_x {
                    let edge_x = (base_x + self.cluster_size - 1).min(width - 1);
                    let max_y = (base_y + self.cluster_size).min(height);
                    let mut span_start: Option<u32> = None;
                    let finish_span = |span: &mut Option<u32>,
                                       end_y: u32,
                                       cluster_nodes: &mut Vec<Vec<u32>>,
                                       get_or_create: &mut dyn FnMut(u32, u32) -> AbstractNode| {
                        let Some(start_y) = span.take() else { return; };
                        let mid_y = start_y + (end_y - start_y) / 2;
                        let node = get_or_create(edge_x, mid_y);
                        let left = (cy * clusters_x + cx) as usize;
                        let right = (cy * clusters_x + cx + 1) as usize;
                        if !cluster_nodes[left].contains(&node.id) {
                            cluster_nodes[left].push(node.id);
                        }
                        if !cluster_nodes[right].contains(&node.id) {
                            cluster_nodes[right].push(node.id);
                        }
                    };

                    for y in base_y..max_y {
                        let tile = y * width + edge_x;
                        let next = tile + 1;
                        let is_entrance = map.terrain_buffer()[tile as usize].is_water()
                            && edge_x + 1 < width
                            && map.terrain_buffer()[next as usize].is_water();
                        if is_entrance {
                            if span_start.is_none() {
                                span_start = Some(y);
                            }
                        } else {
                            finish_span(&mut span_start, y, &mut cluster_nodes, &mut get_or_create);
                        }
                    }
                    finish_span(
                        &mut span_start,
                        max_y,
                        &mut cluster_nodes,
                        &mut get_or_create,
                    );
                }

                if cy + 1 < clusters_y {
                    let edge_y = (base_y + self.cluster_size - 1).min(height - 1);
                    let max_x = (base_x + self.cluster_size).min(width);
                    let mut span_start: Option<u32> = None;
                    let finish_span = |span: &mut Option<u32>,
                                       end_x: u32,
                                       cluster_nodes: &mut Vec<Vec<u32>>,
                                       get_or_create: &mut dyn FnMut(u32, u32) -> AbstractNode| {
                        let Some(start_x) = span.take() else { return; };
                        let mid_x = start_x + (end_x - start_x) / 2;
                        let node = get_or_create(mid_x, edge_y);
                        let top = (cy * clusters_x + cx) as usize;
                        let bottom = ((cy + 1) * clusters_x + cx) as usize;
                        if !cluster_nodes[top].contains(&node.id) {
                            cluster_nodes[top].push(node.id);
                        }
                        if !cluster_nodes[bottom].contains(&node.id) {
                            cluster_nodes[bottom].push(node.id);
                        }
                    };

                    for x in base_x..max_x {
                        let tile = edge_y * width + x;
                        let next = tile + width;
                        let is_entrance = map.terrain_buffer()[tile as usize].is_water()
                            && edge_y + 1 < height
                            && map.terrain_buffer()[next as usize].is_water();
                        if is_entrance {
                            if span_start.is_none() {
                                span_start = Some(x);
                            }
                        } else {
                            finish_span(&mut span_start, x, &mut cluster_nodes, &mut get_or_create);
                        }
                    }
                    finish_span(
                        &mut span_start,
                        max_x,
                        &mut cluster_nodes,
                        &mut get_or_create,
                    );
                }
            }
        }

        let mut nodes = tile_to_node.values().copied().collect::<Vec<_>>();
        nodes.sort_by_key(|node| node.id);
        for node in nodes {
            graph.add_node(node);
        }
        for cy in 0..clusters_y {
            for cx in 0..clusters_x {
                let key = (cy * clusters_x + cx) as usize;
                graph.set_cluster(Cluster {
                    x: cx,
                    y: cy,
                    node_ids: cluster_nodes[key].clone(),
                });
            }
        }

        let mut bfs = BfsGrid::new(map.tile_count() as usize);
        let mut edges: HashMap<(u32, u32), AbstractEdge> = HashMap::new();
        let mut next_edge_id = 0_u32;
        let terrain = map.terrain_buffer();

        for cy in 0..clusters_y {
            for cx in 0..clusters_x {
                let Some(cluster) = graph.cluster(cx, cy) else {
                    continue;
                };
                let node_ids = cluster.node_ids.clone();
                if node_ids.is_empty() {
                    continue;
                }
                let min_x = cx * self.cluster_size;
                let min_y = cy * self.cluster_size;
                let max_x = (min_x + self.cluster_size - 1).min(width - 1);
                let max_y = (min_y + self.cluster_size - 1).min(height - 1);

                for i in 0..node_ids.len() {
                    let from = graph.node(node_ids[i]).expect("cluster node exists");
                    let targets = node_ids[i + 1..]
                        .iter()
                        .filter_map(|id| graph.node(*id))
                        .filter(|node| node.component_id == from.component_id)
                        .collect::<Vec<_>>();
                    if targets.is_empty() {
                        continue;
                    }

                    let mut target_by_tile = HashMap::<u32, u32>::new();
                    let mut max_manhattan = 0_u32;
                    for target in &targets {
                        target_by_tile.insert(target.tile, target.id);
                        max_manhattan = max_manhattan
                            .max(from.x.abs_diff(target.x) + from.y.abs_diff(target.y));
                    }
                    let max_distance = max_manhattan.saturating_mul(4).min(u16::MAX as u32) as u16;
                    let mut reachable = Vec::<(u32, u16)>::new();
                    let mut found = 0usize;
                    let target_count = targets.len();

                    let _ = bfs.search(
                        width,
                        height,
                        &[from.tile],
                        max_distance,
                        |tile| terrain[tile as usize].is_water(),
                        |tile, dist| {
                            let x = tile % width;
                            let y = tile / width;
                            let is_start_or_target =
                                tile == from.tile || target_by_tile.contains_key(&tile);
                            if !is_start_or_target
                                && (x < min_x || x > max_x || y < min_y || y > max_y)
                            {
                                return BfsVisit::Reject;
                            }
                            if let Some(&node_id) = target_by_tile.get(&tile) {
                                reachable.push((node_id, dist));
                                found += 1;
                                if found == target_count {
                                    return BfsVisit::Found(());
                                }
                            }
                            BfsVisit::Continue
                        },
                    );

                    for (target_id, cost) in reachable {
                        let (lo, hi) = if from.id < target_id {
                            (from.id, target_id)
                        } else {
                            (target_id, from.id)
                        };
                        match edges.get_mut(&(lo, hi)) {
                            Some(edge) if f32::from(cost) < edge.cost => {
                                edge.cost = f32::from(cost);
                                edge.cluster_x = cx;
                                edge.cluster_y = cy;
                            }
                            Some(_) => {}
                            None => {
                                edges.insert(
                                    (lo, hi),
                                    AbstractEdge {
                                        id: next_edge_id,
                                        node_a: lo,
                                        node_b: hi,
                                        cost: f32::from(cost),
                                        cluster_x: cx,
                                        cluster_y: cy,
                                    },
                                );
                                next_edge_id += 1;
                            }
                        }
                    }
                }
            }
        }

        let mut edge_list = edges.into_values().collect::<Vec<_>>();
        edge_list.sort_by_key(|edge| edge.id);
        for edge in edge_list {
            graph.add_edge(edge);
        }

        Ok(graph)
    }
}

impl Default for AbstractGraphBuilder {
    fn default() -> Self {
        Self::new(DEFAULT_CLUSTER_SIZE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TERRAIN_LAND_MASK;

    #[test]
    fn builds_gateway_nodes_and_cluster_edges() {
        let width = 8;
        let height = 4;
        let mut terrain = vec![5_u8; width * height];
        terrain[1 * width + 3] = TERRAIN_LAND_MASK | 1;
        terrain[2 * width + 4] = TERRAIN_LAND_MASK | 1;
        let map = GameMapStore::new(width as u32, height as u32, terrain).unwrap();
        let graph = AbstractGraphBuilder::new(4).build(&map).unwrap();
        assert!(graph.node_count() > 0);
        assert!(graph.edge_count() > 0);
        assert!(graph.cluster(0, 0).is_some());
        assert!(graph.cluster(1, 0).is_some());
    }
}
