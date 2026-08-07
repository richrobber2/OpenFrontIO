#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_abstract_graph(handle: u32, cluster_size: u32) -> u32 {
    begin_call();
    if cluster_size == 0 {
        fail(ErrorCode::InvalidDimensions);
        return 0;
    }

    let Some(result) = with_map(handle, |map| {
        openfront_core::AbstractGraphBuilder::new(cluster_size).build(map)
    }) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    let graph = match result {
        Ok(graph) => graph,
        Err(error) => {
            fail(map_error(error));
            return 0;
        }
    };

    let cluster_count = graph.clusters_x.saturating_mul(graph.clusters_y) as usize;
    let cluster_members = (0..graph.clusters_y)
        .flat_map(|cy| (0..graph.clusters_x).map(move |cx| (cx, cy)))
        .filter_map(|(cx, cy)| graph.cluster(cx, cy))
        .map(|cluster| cluster.node_ids.len())
        .sum::<usize>();

    let mut output = Vec::with_capacity(
        6 + graph.node_count() * 5 + cluster_count * 3 + cluster_members + graph.edge_count() * 6,
    );
    output.extend([
        graph.cluster_size,
        graph.clusters_x,
        graph.clusters_y,
        graph.node_count() as u32,
        graph.edge_count() as u32,
        cluster_count as u32,
    ]);

    for id in 0..graph.node_count() as u32 {
        let Some(node) = graph.node(id) else {
            fail(ErrorCode::InternalInvariant);
            return 0;
        };
        output.extend([node.id, node.x, node.y, node.tile, node.component_id]);
    }

    for cy in 0..graph.clusters_y {
        for cx in 0..graph.clusters_x {
            let Some(cluster) = graph.cluster(cx, cy) else {
                fail(ErrorCode::InternalInvariant);
                return 0;
            };
            output.extend([cluster.x, cluster.y, cluster.node_ids.len() as u32]);
            output.extend(cluster.node_ids.iter().copied());
        }
    }

    for id in 0..graph.edge_count() as u32 {
        let Some(edge) = graph.edge(id) else {
            fail(ErrorCode::InternalInvariant);
            return 0;
        };
        output.extend([
            edge.id,
            edge.node_a,
            edge.node_b,
            edge.cost.to_bits(),
            edge.cluster_x,
            edge.cluster_y,
        ]);
    }

    set_result(output);
    1
}
