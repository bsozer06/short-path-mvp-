import React, { useRef, useEffect, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const GEOSERVER_URL = "http://localhost:8080/geoserver/network/wms?";
const GRID_LAYER = "network:grid_lines";
const PATH_LAYERS = {
  dijkstra: "network:mv_short_path",
  astar: "network:mv_astar_path"
};

function FrontendMap() {
  const [routeInfo, setRouteInfo] = useState({ dijkstra: null, astar: null });
  const mapRef = useRef(null);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [selecting, setSelecting] = useState(null); // 'start' or 'end' or null

  const selectingRef = useRef(selecting);

  useEffect(() => {
    selectingRef.current = selecting;
  }, [selecting]);

  const startMarkerRef = useRef(null);
  const endMarkerRef = useRef(null);

  // Keep references to WMS layers for switching
  const wmsLayersRef = useRef({});

  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map('map').setView([39.954748, 32.7347912], 10);
      mapRef.current = map;

      // Basemap: OpenStreetMap
      const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      });

      // WMS Layers
      const roadNetwork = L.tileLayer.wms(GEOSERVER_URL, {
        layers: GRID_LAYER,
        format: 'image/png',
        transparent: true,
      });
      // Both path layers
      const dijkstraPath = L.tileLayer.wms(GEOSERVER_URL, {
        layers: PATH_LAYERS.dijkstra,
        format: 'image/png',
        transparent: true,
      });
      const astarPath = L.tileLayer.wms(GEOSERVER_URL, {
        layers: PATH_LAYERS.astar,
        format: 'image/png',
        transparent: true,
      });
      wmsLayersRef.current = { dijkstra: dijkstraPath, astar: astarPath };

      // Layer control
      const baseLayers = {
        'OpenStreetMap': osm,
      };
      const overlays = {
        'Road Network': roadNetwork,
        'Dijkstra Path': dijkstraPath,
        'A* Path': astarPath,
      };
      L.control.layers(baseLayers, overlays).addTo(map);

      osm.addTo(map);
      roadNetwork.addTo(map);
      // Add both path layers as visible by default
      dijkstraPath.addTo(map);
      astarPath.addTo(map);

      map.on('click', function (e) {
        const currentSelecting = selectingRef.current;

        if (currentSelecting === 'start') {
          setStart(e.latlng);
          setSelecting(null);
        } else if (currentSelecting === 'end') {
          setEnd(e.latlng);
          setSelecting(null);
        }
      });
    }
  }, []);

  // On first mount, reset backend (clear points and refresh views)
  useEffect(() => {
    fetch('http://localhost:3001/reset-all', { method: 'POST' });
  }, []);

  // Show start/end markers as colored circles with labels
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove previous markers
    if (startMarkerRef.current) {
      map.removeLayer(startMarkerRef.current);
      startMarkerRef.current = null;
    }
    if (endMarkerRef.current) {
      map.removeLayer(endMarkerRef.current);
      endMarkerRef.current = null;
    }

    // Add new markers as circleMarker
    if (start) {
      startMarkerRef.current = L.circleMarker([start.lat, start.lng], {
        radius: 10,
        color: 'green',
        fillColor: 'green',
        fillOpacity: 0.8,
      }).addTo(map).bindTooltip('Start', { permanent: true, direction: 'top' }).openTooltip();
    }
    if (end) {
      endMarkerRef.current = L.circleMarker([end.lat, end.lng], {
        radius: 10,
        color: 'red',
        fillColor: 'red',
        fillOpacity: 0.8,
      }).addTo(map).bindTooltip('End', { permanent: true, direction: 'top' }).openTooltip();
    }
  }, [start, end]);

  // Manual request function
  const sendRouteRequest = async () => {
    if (start && end) {
      try {
        // Run both algorithms in parallel
        const endpoints = {
          dijkstra: 'http://localhost:3001/update-route',
          astar: 'http://localhost:3001/astar-route',
        };
        const body = JSON.stringify({ start, end });
        const [dijkstraRes, astarRes] = await Promise.all([
          fetch(endpoints.dijkstra, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
          fetch(endpoints.astar, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
        ]);
        const dijkstraData = await dijkstraRes.json();
        const astarData = await astarRes.json();
        const info = {
          dijkstra: (dijkstraData && typeof dijkstraData.edgeCount !== 'undefined' && typeof dijkstraData.totalDistance !== 'undefined') ? {
            distance: dijkstraData.totalDistance,
            edgeCount: dijkstraData.edgeCount,
          } : null,
          astar: (astarData && typeof astarData.edgeCount !== 'undefined' && typeof astarData.totalDistance !== 'undefined') ? {
            distance: astarData.totalDistance,
            edgeCount: astarData.edgeCount,
          } : null,
        };
        setRouteInfo(info);

        // Reload both WMS layers
        const map = mapRef.current;
        if (map) {
          map.eachLayer(layer => {
            if (layer instanceof L.TileLayer.WMS && (layer.options.layers === PATH_LAYERS.dijkstra || layer.options.layers === PATH_LAYERS.astar)) {
              layer.setParams({ _: Date.now() });
            }
          });
        }
        if (!dijkstraRes.ok || !astarRes.ok) throw new Error('Network response was not ok');
      } catch (err) {
        alert('Error sending route: ' + err.message);
      }
    }
  };

  // Function to clear shortest path data
  const clearShortestPath = async () => {
    setRouteInfo({ dijkstra: null, astar: null });
    try {
      // Clear both algorithms' data
      await Promise.all([
        fetch('http://localhost:3001/clear-shortest-path', { method: 'POST', headers: { 'Content-Type': 'application/json' } }),
        fetch('http://localhost:3001/clear-astar-path', { method: 'POST', headers: { 'Content-Type': 'application/json' } }),
      ]);
      // Optionally force WMS layer reload
      const map = mapRef.current;
      if (map) {
        map.eachLayer(layer => {
          if (layer instanceof L.TileLayer.WMS && (layer.options.layers === PATH_LAYERS.dijkstra || layer.options.layers === PATH_LAYERS.astar)) {
            layer.setParams({ _: Date.now() });
          }
        });
      }
    } catch (err) {
      alert('Error clearing shortest path: ' + err.message);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '10px' }}>
        <button onClick={() => setSelecting('start')} disabled={selecting === 'start'}>
          {selecting === 'start' ? 'Select Start (Active)' : 'Select Start'}
        </button>
        <button onClick={() => setSelecting('end')} disabled={selecting === 'end'} style={{ marginLeft: '10px' }}>
          {selecting === 'end' ? 'Select End (Active)' : 'Select End'}
        </button>
        <button onClick={sendRouteRequest} disabled={!(start && end)} style={{ marginLeft: '10px', background: '#007bff', color: 'white' }}>
          Send (Route Request)
        </button>
        <button onClick={clearShortestPath} style={{ marginLeft: '10px', background: '#dc3545', color: 'white' }}>
          Clear Shortest Path
        </button>
        <span style={{ marginLeft: '20px' }}>
          {start && `Start: ${start.lat.toFixed(5)}, ${start.lng.toFixed(5)}`}
          {end && ` | End: ${end.lat.toFixed(5)}, ${end.lng.toFixed(5)}`}
        </span>
      </div>
      <div id="map" style={{ height: '500px', width: '100%' }}></div>
      {(routeInfo.dijkstra || routeInfo.astar) && (
        <div style={{ marginTop: '10px', background: '#f8f9fa', padding: '10px', borderRadius: '5px', border: '1px solid #ddd' }}>
          <b>Route Comparison:</b><br />
          <table style={{ width: '100%', marginTop: '8px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#e9ecef' }}>
                <th style={{ padding: '4px', border: '1px solid #ccc' }}></th>
                <th style={{ padding: '4px', border: '1px solid #ccc' }}>Dijkstra</th>
                <th style={{ padding: '4px', border: '1px solid #ccc' }}>A*</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '4px', border: '1px solid #ccc' }}>Total Distance (km)</td>
                <td style={{ padding: '4px', border: '1px solid #ccc' }}>{routeInfo.dijkstra ? routeInfo.dijkstra.distance.toFixed(2) : '-'}</td>
                <td style={{ padding: '4px', border: '1px solid #ccc' }}>{routeInfo.astar ? routeInfo.astar.distance.toFixed(2) : '-'}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px', border: '1px solid #ccc' }}>Edge Count</td>
                <td style={{ padding: '4px', border: '1px solid #ccc' }}>{routeInfo.dijkstra ? routeInfo.dijkstra.edgeCount : '-'}</td>
                <td style={{ padding: '4px', border: '1px solid #ccc' }}>{routeInfo.astar ? routeInfo.astar.edgeCount : '-'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div>
        <p>
          Click the relevant button to select start and end points from the map. Selected points are shown on the map with different colored markers and labels. You can send them to the server with the "Send" button. <b>To exit selection mode, click anywhere on the map.</b>
        </p>
      </div>
    </div>
  );
}

export default FrontendMap;