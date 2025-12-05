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
  const [loading, setLoading] = useState(false);
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
      const map = L.map('map').setView([39.93048, 32.7347912], 10.5);
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
      setLoading(true);
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
      } finally {
        setLoading(false);
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
      <header style={{
        textAlign: 'center',
        margin: '0 0 10px 0',
        padding: '18px 0 8px 0',
        background: 'linear-gradient(90deg, #007bff 0%, #00c6ff 100%)',
        color: 'white',
        borderRadius: '0 0 18px 18px',
        boxShadow: '0 2px 12px rgba(0,123,255,0.08)',
      }}>
        <h1 style={{
          margin: 0,
          fontWeight: 600,
          fontSize: '2.0em',
          letterSpacing: '1px',
          textShadow: '0 2px 8px rgba(0,0,0,0.08)',
        }}>
          Shortest Path Route Finder
        </h1>
        <div style={{ fontSize: '1.05em', fontWeight: 400, marginTop: '6px', opacity: 0.85 }}>
          Compare Dijkstra and A* algorithms visually on the map
        </div>
      </header>
      <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setSelecting('start')}
          disabled={selecting === 'start'}
          style={{
            padding: '6px 13px',
            borderRadius: '6px',
            border: 'none',
            background: selecting === 'start' ? '#28a745' : '#f1f3f4',
            color: selecting === 'start' ? 'white' : '#333',
            fontWeight: 500,
            fontSize: '0.95em',
            boxShadow: selecting === 'start' ? '0 2px 8px rgba(40,167,69,0.12)' : 'none',
            cursor: selecting === 'start' ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
          }}
        >
          {selecting === 'start' ? 'Selecting Start' : 'Select Start'}
        </button>
        <button
          onClick={() => setSelecting('end')}
          disabled={selecting === 'end'}
          style={{
            padding: '6px 13px',
            borderRadius: '6px',
            border: 'none',
            background: selecting === 'end' ? '#dc3545' : '#f1f3f4',
            color: selecting === 'end' ? 'white' : '#333',
            fontWeight: 500,
            fontSize: '0.95em',
            boxShadow: selecting === 'end' ? '0 2px 8px rgba(220,53,69,0.12)' : 'none',
            cursor: selecting === 'end' ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
          }}
        >
          {selecting === 'end' ? 'Selecting End' : 'Select End'}
        </button>
        <button
          onClick={sendRouteRequest}
          disabled={!(start && end)}
          style={{
            padding: '6px 15px',
            borderRadius: '6px',
            border: 'none',
            background: !(start && end) ? '#b0c4de' : '#007bff',
            color: 'white',
            fontWeight: 600,
            fontSize: '0.95em',
            boxShadow: !(start && end) ? 'none' : '0 2px 8px rgba(0,123,255,0.12)',
            cursor: !(start && end) ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
          }}
        >
          🚀 Calculate Route
        </button>
        <button
          onClick={clearShortestPath}
          style={{
            padding: '6px 13px',
            borderRadius: '6px',
            border: 'none',
            background: '#f44336',
            color: 'white',
            fontWeight: 500,
            fontSize: '0.95em',
            boxShadow: '0 2px 8px rgba(244,67,54,0.12)',
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
        >
          🧹 Clear
        </button>
        <span style={{ marginLeft: '20px', fontSize: '0.95em', color: '#555', fontWeight: 500 }}>
          {start && `Start: ${start.lat.toFixed(5)}, ${start.lng.toFixed(5)}`}
          {end && ` | End: ${end.lat.toFixed(5)}, ${end.lng.toFixed(5)}`}
        </span>
      </div>
      <div style={{ position: 'relative', width: '100%', minHeight: '580px', marginTop: '10px', overflow: 'hidden' }}>
        <div id="map" style={{ height: '580px', width: '100%', borderRadius: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', position: 'relative' }}>
          {loading && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(255,255,255,0.6)',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '10px',
              pointerEvents: 'none',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div className="spinner" style={{
                  width: '48px', height: '48px', border: '6px solid #007bff', borderTop: '6px solid #e0e0e0', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto', marginBottom: '10px'
                }}></div>
                <div style={{ color: '#007bff', fontWeight: 500, fontSize: '1.1em' }}>Calculating route...</div>
              </div>
            </div>
          )}
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
          {(routeInfo.dijkstra || routeInfo.astar) && (
            <div style={{
              position: 'absolute',
              bottom: '64px',
              right: '32px',
              background: 'white',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              borderRadius: '12px',
              border: '1px solid #e0e0e0',
              width: '340px',
              minWidth: '260px',
              padding: '18px 22px',
              zIndex: 1100,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '1.3em', fontWeight: 600, color: '#007bff', marginRight: '8px' }}>🛣️</span>
                <span style={{ fontSize: '1.1em', fontWeight: 500 }}>Route Comparison</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontWeight: 600, color: '#555', marginBottom: '4px' }}>Dijkstra</div>
                  <div style={{ fontSize: '1.1em', marginBottom: '2px' }}>
                    <span style={{ color: '#8f8100ff', fontWeight: 600 }}>🟡</span> {routeInfo.dijkstra ? routeInfo.dijkstra.distance.toFixed(2) : '-'} km
                  </div>
                  <div style={{ fontSize: '0.95em', color: '#888' }}>Edge: <b>{routeInfo.dijkstra ? routeInfo.dijkstra.edgeCount : '-'}</b></div>
                </div>
                <div style={{ flex: 1, textAlign: 'center', borderLeft: '1px solid #eee' }}>
                  <div style={{ fontWeight: 600, color: '#555', marginBottom: '4px' }}>A*</div>
                  <div style={{ fontSize: '1.1em', marginBottom: '2px' }}>
                    <span style={{ color: '#dc3545', fontWeight: 600 }}>🔴</span> {routeInfo.astar ? routeInfo.astar.distance.toFixed(2) : '-'} km
                  </div>
                  <div style={{ fontSize: '0.95em', color: '#888' }}>Edge: <b>{routeInfo.astar ? routeInfo.astar.edgeCount : '-'}</b></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FrontendMap;