// index.js
const cluster = require('cluster');
const express = require('express');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const { closePersistentContext } = require('./core/auth');
const { getDb, closeDb } = require('./core/db');
const { startScheduler, stopAllJobs } = require('./core/scheduler');
const apiRoutes = require('./web/routes');

const MAX_RESTARTS = 5;
const RESTART_DELAY = 5000;
let restartCount = 0;

if (cluster.isPrimary) {
    // Primary process: manage worker restarts
    console.log(`[MonitorX] Primary process started (PID: ${process.pid})`);

    function startWorker() {
        const worker = cluster.fork();
        console.log(`[MonitorX] Worker ${worker.process.pid} started.`);

        worker.on('exit', (code, signal) => {
            if (code === 0) {
                console.log('[MonitorX] Worker exited normally. Shutting down primary.');
                process.exit(0);
            } else {
                console.error(`[MonitorX] Worker crashed with code ${code}.`);
                if (restartCount < MAX_RESTARTS) {
                    restartCount++;
                    console.log(`[MonitorX] Restarting worker in ${RESTART_DELAY / 1000}s...`);
                    setTimeout(startWorker, RESTART_DELAY);
                } else {
                    console.error('[MonitorX] Max restarts reached. Exiting.');
                    process.exit(1);
                }
            }
        });
    }

    startWorker();

    // Handle shutdown signals in primary
    process.on('SIGINT', () => {
        console.log('[MonitorX] SIGINT received, shutting down...');
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        console.log('[MonitorX] SIGTERM received, shutting down...');
        process.exit(0);
    });

} else {
    // Worker process: runs the actual application
    const app = express();
    const isPkg = typeof process.pkg !== 'undefined';
    const staticPath = isPkg
        ? path.join(path.dirname(process.execPath), 'public')
        : path.join(__dirname, 'public');

    // Middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(staticPath));

    // API Routes
    app.use('/api', apiRoutes);

    // SPA fallback
    app.use((req, res) => {
        res.sendFile(path.join(staticPath, 'index.html'));
    });

    // Graceful shutdown handler for worker
    async function gracefulShutdown() {
        logger.info('Worker shutting down...');
        stopAllJobs();
        await closePersistentContext();
        await closeDb();
        process.exit(0);
    }

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);

    // Start server
    async function startServer() {
        try {
            await getDb();
            await startScheduler();

            // Pre-warm authentication check
            const { ensureLoggedIn } = require('./core/auth');
            await ensureLoggedIn().catch(err => {
                logger.warn('Could not verify Facebook login at startup. You may need to log in via the UI.');
            });

            const server = app.listen(config.port, () => {
                logger.info(`MonitorX Web UI running at http://localhost:${config.port}`);

                // Signal PM2 that the app is ready (if running under PM2)
                if (typeof process.send === 'function') {
                    process.send('ready');
                }

                // Auto-open browser (only in worker)
                const { exec } = require('child_process');
                setTimeout(() => {
                    const startCmd = process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
                    exec(`${startCmd} http://localhost:${config.port}`);
                }, 3000);
            });

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

    // Handle shutdown from UI (IPC with primary)
    process.on('message', (msg) => {
        if (msg === 'shutdown') {
            logger.info('Shutdown requested via UI.');
            gracefulShutdown();
        }
    });
}