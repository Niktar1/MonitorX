// index.js
const express = require('express');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const { getDb, closeDb } = require('./core/db');
const { startScheduler, stopAllJobs } = require('./core/scheduler');
const apiRoutes = require('./web/routes');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api', apiRoutes);

// Serve frontend for any other route (SPA fallback)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful shutdown handler
process.on('SIGINT', async () => {
    logger.info('Received SIGINT. Shutting down gracefully...');
    stopAllJobs();
    await closeDb();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM. Shutting down gracefully...');
    stopAllJobs();
    await closeDb();
    process.exit(0);
});

// Start server
async function startServer() {
    try {
        await getDb(); // Initialize database
        await startScheduler(); // Start monitoring existing watches
        
        app.listen(config.port, () => {
            logger.info(`MonitorX Web UI running at http://localhost:${config.port}`);
            logger.info(`Press Ctrl+C to stop.`);
        });
    } catch (error) {
        logger.error(`Failed to start server: ${error.message}`);
        process.exit(1);
    }
}

startServer();