# Shortest Path Route Finder MVP

This project is a modern MVP web application for visualizing and comparing shortest routes on a road network using React, Leaflet, GeoServer, and a Node.js backend powered by PostgreSQL/PostGIS/pgRouting.

![App Screenshot](./images/shortest-route-finder-gif.gif)

## Features

- Interactive map with OpenStreetMap basemap
- Road network and shortest path layers from GeoServer (WMS)
- Select start and end points on the map
- Calculate shortest route using both Dijkstra and A* algorithms
- Visual comparison of Dijkstra and A* results (distance, edge count)
- Modern UI with responsive design, loading spinner, and route details panel

## Setup

1. **Backend**: Start the Node.js backend in `backend/` (`node index.js`).
2. **Frontend**: Start the React app in `frontend/` (`npm start`).
3. **GeoServer**: Ensure GeoServer is running and WMS layers (`network:grid_lines`, `network:mv_short_path`, `network:mv_astar_path`) are published.
4. **Database**: PostgreSQL with PostGIS and pgRouting must be set up for network data.

## Usage

- Click "Select Start" and choose a start point on the map.
- Click "Select End" and choose an end point.
- Click "Calculate Route" to compute and display shortest paths using both algorithms.
- View route details and comparison in the panel on the map.

## Requirements

- Node.js, npm
- GeoServer with published WMS layers
- PostgreSQL/PostGIS/pgRouting
- React and Leaflet for frontend mapping
- Express for backend API

## Advanced Routing Pipeline

For details on shortest path calculation using PostgreSQL, PostGIS, and pgRouting, see [`postgresql_postgis_pgrouting_shortest_path_pipeline.md`](./postgresql_postgis_pgrouting_shortest_path_pipeline.md).

## Notes

- Ensure CORS is handled properly between frontend and backend.
- Adjust GeoServer WMS URLs as needed for your setup.
- This MVP can be extended with more algorithms, advanced UI, and error handling.
