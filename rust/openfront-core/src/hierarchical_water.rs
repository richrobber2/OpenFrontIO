//! Hierarchical water pathfinding matching `AStar.WaterHierarchical.ts`.

use crate::{
    AbstractGraph, AbstractGraphAStar, AbstractGraphBuilder, AbstractNode, BfsGrid, BfsVisit,
    BoundedWaterPathFinder, GameMapError, GameMapStore, SearchBounds, TileRef,
};
use std::collections::HashMap;

const SHORT_PATH_THRESHOLD: u32 = 120;
const SHORT_PATH_PADDING: u32 = 10;

#[derive(Debug)]
pub struct HierarchicalWaterPathFinder {
    graph: AbstractGraph,
    tile_bfs: BfsGrid,
    abstract_astar: AbstractGraphAStar,
    local_astar: BoundedWaterPathFinder,
    local_astar_multi_cluster: BoundedWaterPathFinder,
    local_astar_short_path: BoundedWaterPathFinder,
}

impl HierarchicalWaterPathFinder {
    pub fn build(map: &GameMapStore, cluster_size: u32) -> Result<Self, GameMapError> {
        let graph = AbstractGraphBuilder::new(cluster_size).build(map)?;
        let abstract_astar = AbstractGraphAStar::new(&graph);
        let tile_count = map.tile_count() as usize;
        let local_nodes = (cluster_size as usize).saturating_mul(cluster_size as usize);
        let multi_size = (cluster_size as usize).saturating_mul(3);
        let multi_nodes = multi_size.saturating_mul(multi_size);
        let short_size = (SHORT_PATH_THRESHOLD as usize + SHORT_PATH_PADDING as usize) * 2;
        let short_nodes = short_size.saturating_mul(short_size);

        Ok(Self {
            graph,
            tile_bfs: BfsGrid::new(tile_count),
            abstract_astar,
            local_astar: BoundedWaterPathFinder::new(local_nodes),
            local_astar_multi_cluster: BoundedWaterPathFinder::new(multi_nodes),
            local_astar_short_path: BoundedWaterPathFinder::new(short_nodes),
        })
    }

    #[must_use]
    pub fn node_count(&self) -> usize {
        self.graph.node_count()
    }

    pub fn find_path(
        &mut self,
        map: &GameMapStore,
        starts: &[TileRef],
        target: TileRef,
    ) -> Result<Option<Vec<TileRef>>, GameMapError> {
        if starts.is_empty() {
            return Ok(None);
        }
        if starts.len() == 1 {
            return self.find_path_single(map, starts[0], target);
        }
        self.find_path_multi_source(map, starts, target)
    }

    fn find_path_multi_source(
        &mut self,
        map: &GameMapStore,
        sources: &[TileRef],
        target: TileRef,
    ) -> Result<Option<Vec<TileRef>>, GameMapError> {
        if let Some(path) = self.try_short_path_multi_source(map, sources, target)? {
            return Ok(Some(path));
        }

        let Some(target_node) = self.cluster_node_nearest(map, target) else {
            return Ok(None);
        };

        let mut node_to_source = HashMap::<u32, TileRef>::new();
        let mut node_to_dist = HashMap::<u32, u32>::new();
        for &source in sources {
            let Some(node) = self.cluster_node_nearest(map, source) else {
                continue;
            };
            let sx = source.get() % map.width();
            let sy = source.get() / map.width();
            let dist = node.x.abs_diff(sx) + node.y.abs_diff(sy);
            let replace = node_to_dist.get(&node.id).is_none_or(|prev| dist < *prev);
            if replace {
                node_to_source.insert(node.id, source);
                node_to_dist.insert(node.id, dist);
            }
        }
        if node_to_source.is_empty() {
            return Ok(None);
        }

        let mut node_ids = node_to_source.keys().copied().collect::<Vec<_>>();
        node_ids.sort_unstable();
        let Some(node_path) = self
            .abstract_astar
            .find_path(&self.graph, &node_ids, target_node.id)
        else {
            return Ok(None);
        };
        let Some(winning_source) = node_path
            .first()
            .and_then(|id| node_to_source.get(id))
            .copied()
        else {
            return Ok(None);
        };
        self.find_path_single(map, winning_source, target)
    }

    fn try_short_path_multi_source(
        &mut self,
        map: &GameMapStore,
        sources: &[TileRef],
        target: TileRef,
    ) -> Result<Option<Vec<TileRef>>, GameMapError> {
        let tx = target.get() % map.width();
        let ty = target.get() / map.width();
        let mut candidates = Vec::new();
        let mut min_x = tx;
        let mut max_x = tx;
        let mut min_y = ty;
        let mut max_y = ty;

        for &source in sources {
            let sx = source.get() % map.width();
            let sy = source.get() / map.width();
            if sx.abs_diff(tx) + sy.abs_diff(ty) > SHORT_PATH_THRESHOLD {
                continue;
            }
            candidates.push(source);
            min_x = min_x.min(sx);
            max_x = max_x.max(sx);
            min_y = min_y.min(sy);
            max_y = max_y.max(sy);
        }
        if candidates.is_empty() {
            return Ok(None);
        }

        let bounds = SearchBounds {
            min_x: min_x.saturating_sub(SHORT_PATH_PADDING),
            max_x: max_x
                .saturating_add(SHORT_PATH_PADDING)
                .min(map.width().saturating_sub(1)),
            min_y: min_y.saturating_sub(SHORT_PATH_PADDING),
            max_y: max_y
                .saturating_add(SHORT_PATH_PADDING)
                .min(map.height().saturating_sub(1)),
        };
        self.local_astar_short_path
            .search_bounded(map, &candidates, target, bounds)
    }

    fn find_path_single(
        &mut self,
        map: &GameMapStore,
        from: TileRef,
        to: TileRef,
    ) -> Result<Option<Vec<TileRef>>, GameMapError> {
        let fx = from.get() % map.width();
        let fy = from.get() / map.width();
        let tx = to.get() % map.width();
        let ty = to.get() / map.width();
        let dist = fx.abs_diff(tx) + fy.abs_diff(ty);
        let cluster_size = self.graph.cluster_size;

        if dist <= cluster_size {
            let cluster_x = fx / cluster_size;
            let cluster_y = fy / cluster_size;
            if let Some(path) = self.find_local_path(map, from, to, cluster_x, cluster_y, true)? {
                return Ok(Some(path));
            }
        }

        let Some(start_node) = self.find_nearest_node(map, from) else {
            return Ok(None);
        };
        let Some(end_node) = self.find_nearest_node(map, to) else {
            return Ok(None);
        };

        if start_node.id == end_node.id {
            return self.find_local_path(
                map,
                from,
                to,
                start_node.x / cluster_size,
                start_node.y / cluster_size,
                true,
            );
        }

        let Some(node_path) =
            self.abstract_astar
                .find_path(&self.graph, &[start_node.id], end_node.id)
        else {
            return Ok(None);
        };
        if node_path.is_empty() {
            return Ok(None);
        }

        let first_node = self.graph.node(node_path[0]).expect("abstract node exists");
        let Some(mut path) = self.find_local_path(
            map,
            from,
            TileRef::new(first_node.tile),
            fx / cluster_size,
            fy / cluster_size,
            false,
        )?
        else {
            return Ok(None);
        };

        for pair in node_path.windows(2) {
            let Some(edge) = self.graph.edge_between(pair[0], pair[1]) else {
                return Ok(None);
            };
            let from_node = self.graph.node(pair[0]).expect("abstract node exists");
            let to_node = self.graph.node(pair[1]).expect("abstract node exists");
            let Some(segment) = self.find_local_path(
                map,
                TileRef::new(from_node.tile),
                TileRef::new(to_node.tile),
                edge.cluster_x,
                edge.cluster_y,
                false,
            )?
            else {
                return Ok(None);
            };
            path.extend(segment.into_iter().skip(1));
        }

        let last_node = self
            .graph
            .node(*node_path.last().expect("non-empty node path"))
            .expect("abstract node exists");
        let Some(end_segment) = self.find_local_path(
            map,
            TileRef::new(last_node.tile),
            to,
            tx / cluster_size,
            ty / cluster_size,
            false,
        )?
        else {
            return Ok(None);
        };
        path.extend(end_segment.into_iter().skip(1));
        Ok(Some(path))
    }

    fn find_nearest_node(&mut self, map: &GameMapStore, tile: TileRef) -> Option<AbstractNode> {
        let x = tile.get() % map.width();
        let y = tile.get() / map.width();
        let cluster_size = self.graph.cluster_size;
        let cluster_x = x / cluster_size;
        let cluster_y = y / cluster_size;
        let min_x = cluster_x * cluster_size;
        let min_y = cluster_y * cluster_size;
        let max_x = (min_x + cluster_size - 1).min(map.width() - 1);
        let max_y = (min_y + cluster_size - 1).min(map.height() - 1);
        let candidates = self.graph.cluster(cluster_x, cluster_y)?.node_ids.clone();
        if candidates.is_empty() {
            return None;
        }
        let max_distance = cluster_size
            .saturating_mul(cluster_size)
            .min(u16::MAX as u32) as u16;
        let width = map.width();
        let height = map.height();
        let terrain = map.terrain_buffer();
        let graph = &self.graph;

        self.tile_bfs.search(
            width,
            height,
            &[tile.get()],
            max_distance,
            |candidate| terrain[candidate as usize].is_water(),
            |candidate, _| {
                let cx = candidate % width;
                let cy = candidate / width;
                if let Some(node) = candidates
                    .iter()
                    .filter_map(|id| graph.node(*id))
                    .find(|node| node.x == cx && node.y == cy)
                {
                    return BfsVisit::Found(node);
                }
                if cx < min_x || cx > max_x || cy < min_y || cy > max_y {
                    BfsVisit::Reject
                } else {
                    BfsVisit::Continue
                }
            },
        )
    }

    fn cluster_node_nearest(&self, map: &GameMapStore, tile: TileRef) -> Option<AbstractNode> {
        let x = tile.get() % map.width();
        let y = tile.get() / map.width();
        let cluster_x = x / self.graph.cluster_size;
        let cluster_y = y / self.graph.cluster_size;
        let cluster = self.graph.cluster(cluster_x, cluster_y)?;
        cluster
            .node_ids
            .iter()
            .filter_map(|id| self.graph.node(*id))
            .min_by_key(|node| node.x.abs_diff(x) + node.y.abs_diff(y))
    }

    fn find_local_path(
        &mut self,
        map: &GameMapStore,
        from: TileRef,
        to: TileRef,
        cluster_x: u32,
        cluster_y: u32,
        multi_cluster: bool,
    ) -> Result<Option<Vec<TileRef>>, GameMapError> {
        let cluster_size = self.graph.cluster_size;
        let bounds = if multi_cluster {
            SearchBounds {
                min_x: cluster_x.saturating_sub(1).saturating_mul(cluster_size),
                min_y: cluster_y.saturating_sub(1).saturating_mul(cluster_size),
                max_x: cluster_x
                    .saturating_add(2)
                    .saturating_mul(cluster_size)
                    .saturating_sub(1)
                    .min(map.width() - 1),
                max_y: cluster_y
                    .saturating_add(2)
                    .saturating_mul(cluster_size)
                    .saturating_sub(1)
                    .min(map.height() - 1),
            }
        } else {
            let min_x = cluster_x * cluster_size;
            let min_y = cluster_y * cluster_size;
            SearchBounds {
                min_x,
                min_y,
                max_x: (min_x + cluster_size - 1).min(map.width() - 1),
                max_y: (min_y + cluster_size - 1).min(map.height() - 1),
            }
        };

        let finder = if multi_cluster {
            &mut self.local_astar_multi_cluster
        } else {
            &mut self.local_astar
        };
        let Some(mut path) = finder.search_bounded(map, &[from], to, bounds)? else {
            return Ok(None);
        };
        if path.first() != Some(&from) {
            path.insert(0, from);
        }
        if path.last() != Some(&to) {
            path.push(to);
        }
        Ok(Some(path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TERRAIN_LAND_MASK;

    #[test]
    fn routes_across_multiple_clusters() {
        let width = 24_u32;
        let height = 12_u32;
        let mut terrain = vec![5_u8; (width * height) as usize];
        for y in 0..height - 1 {
            terrain[(y * width + 11) as usize] = TERRAIN_LAND_MASK | 1;
        }
        let map = GameMapStore::new(width, height, terrain).unwrap();
        let start = TileRef::new(2 * width + 2);
        let goal = TileRef::new(2 * width + 21);
        let mut finder = HierarchicalWaterPathFinder::build(&map, 8).unwrap();
        let path = finder.find_path(&map, &[start], goal).unwrap().unwrap();
        assert_eq!(path.first(), Some(&start));
        assert_eq!(path.last(), Some(&goal));
        assert!(path
            .iter()
            .all(|tile| *tile == goal || !map.terrain(*tile).unwrap().is_land()));
    }

    #[test]
    fn supports_multi_source_queries() {
        let map = GameMapStore::new(16, 8, vec![5_u8; 128]).unwrap();
        let starts = [TileRef::new(0), TileRef::new(7 * 16)];
        let goal = TileRef::new(7 * 16 + 15);
        let mut finder = HierarchicalWaterPathFinder::build(&map, 4).unwrap();
        let path = finder.find_path(&map, &starts, goal).unwrap().unwrap();
        assert!(starts.contains(path.first().unwrap()));
        assert_eq!(path.last(), Some(&goal));
    }
}
