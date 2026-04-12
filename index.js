// index.js
const express = require('express');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const { closePersistentContext } = require('./core/auth');
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
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful shutdown handler
process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    stopAllJobs();
    await closePersistentContext();
    await closeDb();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Shutting down...');
    stopAllJobs();
    await closePersistentContext();
    await closeDb();
    process.exit(0);
});

// Start server
async function startServer() {
    try {
        await getDb();
        await startScheduler();
        
        // Pre-warm authentication check (will open visible browser if not logged in)
        const { ensureLoggedIn } = require('./core/auth');
        await ensureLoggedIn().catch(err => {
            logger.warn('Could not verify Facebook login at startup. You may need to log in via the UI.');
        });
        
        const server = app.listen(config.port, () => {
            logger.info(`MonitorX Web UI running at http://localhost:${config.port}`);
            
            // Signal PM2 that the app is ready
            if (typeof process.send === 'function') {
                process.send('ready');
            }
        });

        // Handle server errors gracefully
        server.on('error', (err) => {
            logger.error(`Server error: ${err.message}`);
            process.exit(1);
        });

    } catch (error) {
        logger.error(`Failed to start: ${error.message}`);
        process.exit(1);
    }
}

startServer();