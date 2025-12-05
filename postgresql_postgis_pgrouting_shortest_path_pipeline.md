# PostgreSQL + PostGIS + pgRouting – Network Analysis & Shortest Path Pipeline

This document describes an **end-to-end SQL workflow** for building a routable road network and calculating shortest paths using **PostgreSQL**, **PostGIS**, and **pgRouting**.

---

## 1. Verify Installed Extensions

```sql
SELECT
    extname,
    extversion,
    extowner,
    extnamespace::regnamespace::text AS schema_name
FROM pg_extension
ORDER BY extname;
```

✅ Confirms that required extensions such as **postgis** and **pgrouting** are installed.

---

## 2. Create Road Geometry Table

```sql
CREATE TABLE grid_lines (
    id SERIAL PRIMARY KEY,
    geom geometry(LINESTRING, 4326)
);
```

Stores road geometries as **WGS84 LineStrings**.

---

## 3. Populate Roads

```sql
INSERT INTO grid_lines (geom)
SELECT geom FROM roads;
```

Copies road data from an existing `roads` table.

---

## 4. Index Road Geometry

```sql
CREATE INDEX grid_lines_idx
ON grid_lines
USING GIST (geom);
```

🚀 Speeds up spatial operations.

---

## 5. Create Network Nodes Table

```sql
CREATE TABLE network_nodes (
    id SERIAL PRIMARY KEY,
    geom geometry(Point, 4326)
);
```

Stores all network nodes (**endpoints & intersections**).

---

## 6. Extract Line Vertices as Nodes

```sql
INSERT INTO network_nodes (geom)
SELECT (dp).geom::geometry(Point,4326)
FROM grid_lines,
LATERAL ST_DumpPoints(geom) AS dp;
```

Creates nodes at every road vertex.

---

## 7. Create Intersection Nodes

```sql
INSERT INTO network_nodes (geom)
SELECT DISTINCT
    ST_Intersection(a.geom, b.geom)::geometry(Point,4326)
FROM grid_lines a
JOIN grid_lines b
ON ST_Intersects(a.geom, b.geom)
WHERE ST_GeometryType(ST_Intersection(a.geom,b.geom)) = 'ST_Point';
```

Adds nodes where roads intersect.

---

## 8. Remove Duplicate Nodes

```sql
CREATE TABLE temp AS
SELECT DISTINCT ON (geom) * FROM network_nodes;

DROP TABLE network_nodes;
ALTER TABLE temp RENAME TO network_nodes;
```

✅ Ensures node uniqueness.

---

## 9. Index Network Nodes

```sql
CREATE INDEX network_nodes_geom_idx
ON network_nodes
USING GIST (geom);
```

Optimizes nearest-node lookups.

---

## 10. Create Network Edges Table

```sql
CREATE TABLE network_edges (
    id SERIAL PRIMARY KEY,
    source INTEGER,
    target INTEGER,
    cost DOUBLE PRECISION,
    geom geometry(LineString, 4326)
);
```

Defines graph edges between nodes.

---

## 11. Locate Nodes on Each Road

```sql
ST_LineLocatePoint(line.geom, node.geom)
```

Calculates the relative position (**0–1**) of a node along a road line for correct ordering.

---

## 12. Create Edge Segments & Costs

```sql
WITH node_on_line AS (
    SELECT
        l.id AS line_id,
        n.id AS node_id,
        n.geom AS node_geom,
        ST_LineLocatePoint(l.geom, n.geom) AS fraction
    FROM grid_lines AS l
    JOIN network_nodes AS n
        ON ST_DWithin(l.geom, n.geom, 0.0001)
    WHERE ST_Equals(
        n.geom,
        ST_ClosestPoint(l.geom, n.geom)
    )
),

ordered_nodes AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY line_id
            ORDER BY fraction
        ) AS rn
    FROM node_on_line
),

node_pairs AS (
    SELECT
        n1.line_id,
        n1.node_id AS source,
        n1.node_geom AS source_geom,
        n2.node_id AS target,
        n2.node_geom AS target_geom
    FROM ordered_nodes n1
    JOIN ordered_nodes n2
        ON n1.line_id = n2.line_id
       AND n2.rn = n1.rn + 1
)

INSERT INTO network_edges (
    source,
    target,
    cost,
    geom
)
SELECT
    source,
    target,
    ROUND(
        ST_DistanceSphere(source_geom, target_geom)::NUMERIC / 1000,
        2
    ) AS cost,
    ST_MakeLine(source_geom, target_geom) AS geom
FROM node_pairs;
```

Splits roads into routable segments and computes distance in **kilometers**.

---

## 13. Index Network Edges

```sql
CREATE INDEX network_edges_geom_idx
ON network_edges
USING GIST (geom);
```

Improves routing query performance.

---

## 14. Add Reverse Cost (Mandatory)

```sql
ALTER TABLE network_edges
ADD COLUMN reverse_cost DOUBLE PRECISION;

UPDATE network_edges
SET reverse_cost = cost;
```

### Why is `reverse_cost` required?

- pgRouting always expects **forward & reverse costs**
- Equal costs mean **bi-directional roads**
- Required even when `directed := false`

---

## 15. Verify pgRouting Installation

```sql
SELECT * FROM pg_extension WHERE extname = 'pgrouting';
```

---

## 16. Compute Shortest Path (Static Node IDs)

```sql
SELECT e.*
FROM pgr_dijkstra(
    'SELECT id, source, target, cost, reverse_cost FROM network_edges',
    981,
    1096,
    directed := FALSE
) AS path
JOIN network_edges e
ON path.edge = e.id;
```

Returns shortest path geometry between two nodes.

---

## 17. Create Points Table for Dynamic Routing

```sql
CREATE TABLE points (
    id SERIAL PRIMARY KEY,
    geom geometry(Point, 4326)
);
```

Stores user-defined **start & end points**.

---

## 18. Materialized View for Dynamic Shortest Path

```sql
CREATE MATERIALIZED VIEW mv_short_path AS
WITH source_node AS (
    SELECT id FROM network_nodes
    ORDER BY geom <-> (SELECT geom FROM points ORDER BY id LIMIT 1)
    LIMIT 1
),
target_node AS (
    SELECT id FROM network_nodes
    ORDER BY geom <-> (SELECT geom FROM points ORDER BY id DESC LIMIT 1)
    LIMIT 1
),
shortest_path_edges AS (
    SELECT e.*, path.seq, path.path_seq
    FROM pgr_dijkstra(
        'SELECT id, source, target, cost, reverse_cost FROM network_edges',
        (SELECT id FROM source_node),
        (SELECT id FROM target_node),
        directed := FALSE
    ) AS path
    JOIN network_edges e ON path.edge = e.id
)
SELECT * FROM shortest_path_edges;
```

```sql
CREATE MATERIALIZED VIEW mv_astar_path AS
WITH source_node AS (
    SELECT id
    FROM public.network_nodes
    ORDER BY geom <-> (SELECT geom FROM public.points ORDER BY id LIMIT 1)
    LIMIT 1
),
target_node AS (
    SELECT id
    FROM public.network_nodes
    ORDER BY geom <-> (SELECT geom FROM public.points ORDER BY id DESC LIMIT 1)
    LIMIT 1
),
shortest_path_edges AS ( 
    SELECT
        e.*,
        path.seq, 
        path.path_seq
    FROM
        pgr_aStar(
            'SELECT
			    ne.id,
			    ne.source,
			    ne.target,
			    ne.cost,
			    ne.reverse_cost,
			    st_x(ns.geom) AS x1,
			    st_y(ns.geom) AS y1,
			    st_x(nt.geom) AS x2,
			    st_y(nt.geom) AS y2
			  FROM
			    network_edges ne
			  JOIN
			    network_nodes ns ON ne.source = ns.id
			  JOIN
			    network_nodes nt ON ne.target = nt.id',
            (SELECT id FROM source_node),
            (SELECT id FROM target_node),
            directed := FALSE
        ) AS path
    JOIN
        network_edges e ON path.edge = e.id
)
SELECT
    *
FROM
    shortest_path_edges;
```

📌 Automatically finds nearest nodes and computes the shortest route.

---

## 19. Query & Refresh Path

```sql
SELECT * FROM mv_short_path;

REFRESH MATERIALIZED VIEW mv_short_path;
```

⚠️ Always refresh after updating points or network data.

---

## ✅ Summary

- Converts road geometries into a routable graph
- Supports **bi-directional routing**
- Uses **true geographic distance**
- Scales well for **GIS & Web mapping applications**

---

## 🔧 Requirements

- PostgreSQL
- PostGIS
- pgRouting

---

## 🌍 Use Cases

- WebGIS routing services
- Logistics & fleet routing
- Urban network analysis
- GeoServer / API-based routing

---
