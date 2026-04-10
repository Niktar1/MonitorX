// web/routes.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../core/db');
const { scheduleWatch, unscheduleWatch } = require('../core/scheduler');
const { pauseAllJobs, resumeAllJobs } = require('../core/scheduler');
const { ensureLoggedIn } = require('../core/auth');
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
    if (!url) return res.status(400).json({ error: 'URL is required' });
    try {
        const db = await getDb();
        // Check only active watches
        const existing = await db.get('SELECT id FROM watches WHERE url = ? AND active = 1', [url]);
        if (existing) {
            return res.status(409).json({ error: 'This group is already being monitored.' });
        }
        // If there's an inactive one, delete it first
        await db.run('DELETE FROM watches WHERE url = ? AND active = 0', [url]);
        const result = await db.run(
            'INSERT INTO watches (url, active) VALUES (?, 1)',
            [url]
        );
        const newWatch = await db.get('SELECT * FROM watches WHERE id = ?', [result.lastID]);
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
        unscheduleWatch(parseInt(id));
        // Hard delete instead of soft delete
        await db.run('DELETE FROM watches WHERE id = ?', [id]);
        logger.info(`Watch ${id} deleted.`);
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
        // Check if exists (active or inactive)
        const existing = await db.get('SELECT * FROM webhooks WHERE url = ?', [url]);
        if (existing) {
            if (existing.enabled === 0) {
                // Re-enable it
                await db.run('UPDATE webhooks SET enabled = 1, name = ? WHERE id = ?', [name || existing.name, existing.id]);
                const updated = await db.get('SELECT * FROM webhooks WHERE id = ?', [existing.id]);
                return res.json(updated);
            }
            return res.status(409).json({ error: 'This webhook URL already exists and is active.' });
        }
        const result = await db.run(
            'INSERT INTO webhooks (name, url, enabled) VALUES (?, ?, 1)',
            [name || 'Unnamed', url]
        );
        const newWebhook = await db.get('SELECT * FROM webhooks WHERE id = ?', [result.lastID]);
        res.status(201).json(newWebhook);
    } catch (error) {
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
router.post('/scan/stop', (req, res) => {
    pauseAllJobs();
    res.json({ message: 'Monitoring paused.' });
});

router.post('/scan/start', (req, res) => {
    resumeAllJobs();
    res.json({ message: 'Monitoring resumed.' });
});

// ----- Authentication Trigger -----
router.post('/auth/login', async (req, res) => {
    try {
        // Force new login: clear session and open visible browser
        await ensureLoggedIn({ forceNewLogin: true });
        res.json({ message: 'Login completed. Session saved.' });
    } catch (error) {
        logger.error(`Auth login error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;