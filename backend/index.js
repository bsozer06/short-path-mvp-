const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = 3001;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

// Middleware
app.use(bodyParser.json());

// PostgreSQL config
const pool = new Pool({
    host: 'localhost',
    port: 5435,
    database: 'postgres',
    user: 'postgres',
    password: 'mysecretpassword'
});

// API Endpoint
app.post('/update-route', async (req, res) => {
    const data = req.body;
    console.log(data);

    // Validate input
    if (data.start == null || data.end == null) {
        return res.status(400).json({ error: 'Start and end points must be arrays of two numbers [longitude, latitude]' });
    }

    const start = Object.values(data.start); // [longitude, latitude]
    const end = Object.values(data.end); // [longitude, latitude]

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Clear existing points
        await client.query('DELETE FROM public.points');

        // Insert new start and end points
        const insertSQL = 'INSERT INTO public.points (geom) VALUES (ST_SetSRID(ST_MakePoint($2, $1), 4326))';
        await client.query(insertSQL, [start[0], start[1]]);
        await client.query(insertSQL, [end[0], end[1]]);
        console.log('First Insert SQL:', insertSQL, [start[0], start[1]]);
        console.log('Second Insert SQL:', insertSQL, [end[0], end[1]]);
        
        // Refresh materialized view
        try {
            await client.query('REFRESH MATERIALIZED VIEW public.mv_short_path');
        } catch (mvErr) {
            console.error('Error refreshing materialized view:', mvErr);
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'Failed to refresh materialized view' });
        }

        await client.query('COMMIT');

        const result = await client.query('SELECT COUNT(*) as edge_count, COALESCE(SUM(cost),0) as total_distance FROM public.mv_short_path');
        const { edge_count, total_distance } = result.rows[0];
        res.json({
            status: 'Success',
            message: 'Route has been successfully updated',
            edgeCount: Number(edge_count),
            totalDistance: Number(total_distance)
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Transaction error:', err);
        res.status(500).json({ error: 'Failed to update route' });
    } finally {
        client.release();
    }
});

// API Endpoint
app.post('/astar-route', async (req, res) => {
    const data = req.body;
    console.log(data);

    // Validate input
    if (data.start == null || data.end == null) {
        return res.status(400).json({ error: 'Start and end points must be arrays of two numbers [longitude, latitude]' });
    }

    const start = Object.values(data.start); // [longitude, latitude]
    const end = Object.values(data.end); // [longitude, latitude]

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Clear existing points
        await client.query('DELETE FROM public.points');

        // Insert new start and end points
        const insertSQL = 'INSERT INTO public.points (geom) VALUES (ST_SetSRID(ST_MakePoint($2, $1), 4326))';
        await client.query(insertSQL, [start[0], start[1]]);
        await client.query(insertSQL, [end[0], end[1]]);
        console.log('First Insert SQL:', insertSQL, [start[0], start[1]]);
        console.log('Second Insert SQL:', insertSQL, [end[0], end[1]]);
        
        // Refresh materialized view for A*
        try {
            await client.query('REFRESH MATERIALIZED VIEW public.mv_astar_path');
        } catch (mvErr) {
            console.error('Error refreshing mv_astar_path:', mvErr);
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'Failed to refresh mv_astar_path' });
        }

        await client.query('COMMIT');

        const result = await client.query('SELECT COUNT(*) as edge_count, COALESCE(SUM(cost),0) as total_distance FROM public.mv_astar_path');
        const { edge_count, total_distance } = result.rows[0];
        res.json({
            status: 'Success',
            message: 'Route has been successfully updated',
            edgeCount: Number(edge_count),
            totalDistance: Number(total_distance)
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Transaction error:', err);
        res.status(500).json({ error: 'Failed to update A* route' });
    } finally {
        client.release();
    }
});

// Clear A* shortest path data endpoint
app.post('/clear-astar-path', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Clear points table
        await client.query('DELETE FROM public.points');
        // Optionally refresh materialized view for A*
        try {
            await client.query('REFRESH MATERIALIZED VIEW public.mv_astar_path');
        } catch (mvErr) {
            console.error('Error refreshing mv_astar_path:', mvErr);
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'Failed to refresh mv_astar_path' });
        }
        await client.query('COMMIT');
        res.json({ status: 'Success', message: 'A* shortest path data cleared' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Transaction error:', err);
        res.status(500).json({ error: 'Failed to clear A* shortest path data' });
    } finally {
        client.release();
    }
});

// Clear shortest path data endpoint
app.post('/clear-shortest-path', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Clear points table
        await client.query('DELETE FROM public.points');
        // Optionally refresh materialized view
        try {
            await client.query('REFRESH MATERIALIZED VIEW public.mv_short_path');
        } catch (mvErr) {
            console.error('Error refreshing materialized view:', mvErr);
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'Failed to refresh materialized view' });
        }
        await client.query('COMMIT');
        res.json({ status: 'Success', message: 'Shortest path data cleared' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Transaction error:', err);
        res.status(500).json({ error: 'Failed to clear shortest path data' });
    } finally {
        client.release();
    }
});

// Reset all: clear points and refresh both materialized views
app.post('/reset-all', async (req, res) => {
    try {
        await clearPointsAndRefreshViews();
        res.json({ status: 'Success', message: 'Points cleared and materialized views refreshed.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset all.' });
    }
});

// Clear points and refresh materialized views
async function clearPointsAndRefreshViews() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM public.points');
        await client.query('REFRESH MATERIALIZED VIEW public.mv_short_path');
        await client.query('REFRESH MATERIALIZED VIEW public.mv_astar_path');
        await client.query('COMMIT');
        console.log('Points table cleared and materialized views refreshed.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error clearing points or refreshing views:', err);
    } finally {
        client.release();
    }
}

// Start server
app.listen(port, async () => {
    console.log(`Server running at http://localhost:${port}`);
    await clearPointsAndRefreshViews();
});