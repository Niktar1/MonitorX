// web/routes.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../core/db');
const { scheduleWatch, unscheduleWatch } = require('../core/scheduler');
const { getAuthenticatedContext, closeContext } = require('../core/auth');
const logger = require('../logger');

// ----- Status -----
router.get('/status', (req, res) => {
    res.json({
        status: 'running',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// ----- Watches -----
router.get('/watches', async (req, res) => {
    try {
        const db = await getDb();
        const watches = await db.all('SELECT * FROM watches ORDER BY created_at DESC');
        res.json(watches);
    } catch (error) {
        logger.error(`GET /watches error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

router.post('/watches', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    try {
        const db = await getDb();
        // Check if already exists
        const existing = await db.get('SELECT id FROM watches WHERE url = ?', [url]);
        if (existing) {
            return res.status(409).json({ error: 'This group is already being monitored.' });
        }
        const result = await db.run(
            'INSERT INTO watches (url, active) VALUES (?, 1)',
            [url]
        );
        const newWatch = await db.get('SELECT * FROM watches WHERE id = ?', [result.lastID]);
        // Schedule the new watch
        scheduleWatch(newWatch);
        logger.info(`Added new watch: ${url}`);
        res.status(201).json(newWatch);
    } catch (error) {
        logger.error(`POST /watches error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/watches/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const db = await getDb();
        // Unschedule first
        unscheduleWatch(parseInt(id));
        await db.run('UPDATE watches SET active = 0 WHERE id = ?', [id]);
        // Soft delete - keep record but mark inactive
        res.json({ message: 'Watch removed successfully' });
    } catch (error) {
        logger.error(`DELETE /watches/${id} error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// ----- Webhooks -----
router.get('/webhooks', async (req, res) => {
    try {
        const db = await getDb();
        const webhooks = await db.all('SELECT * FROM webhooks ORDER BY created_at DESC');
        res.json(webhooks);
    } catch (error) {
        logger.error(`GET /webhooks error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

router.post('/webhooks', async (req, res) => {
    const { name, url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'Webhook URL is required' });
    }
    try {
        const db = await getDb();
        const result = await db.run(
            'INSERT INTO webhooks (name, url) VALUES (?, ?)',
            [name || 'Unnamed', url]
        );
        const newWebhook = await db.get('SELECT * FROM webhooks WHERE id = ?', [result.lastID]);
        res.status(201).json(newWebhook);
    } catch (error) {
        // Handle duplicate URL error
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'This webhook URL already exists.' });
        }
        logger.error(`POST /webhooks error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/webhooks/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const db = await getDb();
        await db.run('UPDATE webhooks SET enabled = 0 WHERE id = ?', [id]);
        res.json({ message: 'Webhook disabled' });
    } catch (error) {
        logger.error(`DELETE /webhooks/${id} error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// ----- Control -----
router.post('/scan/start', (req, res) => {
    // Scheduler starts automatically on server start; this is a placeholder for manual restart
    // We can implement stop/start later if needed
    res.json({ message: 'Monitor is running.' });
});

router.post('/scan/stop', (req, res) => {
    // Could implement pause functionality
    res.json({ message: 'Stop not implemented yet.' });
});

// ----- Authentication Trigger -----
router.post('/auth/login', async (req, res) => {
    try {
        // Force visible browser for login
        const { context, page } = await getAuthenticatedContext(true);
        // We don't actually need to wait here; the browser stays open until user closes it
        res.json({ message: 'Browser opened. Please log in to Facebook. The window will remain open for 60 seconds.' });
        // Keep the context open for 60 seconds to allow login
        setTimeout(async () => {
            await closeContext(context);
            logger.info('Login browser window closed.');
        }, 60000);
    } catch (error) {
        logger.error(`Auth login error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;