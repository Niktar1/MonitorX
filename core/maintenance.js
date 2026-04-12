// core/maintenance.js
const cron = require('node-cron');
const logger = require('../logger');
const config = require('../config');
const { getDb } = require('./db');

/**
 * Delete old records from detected_posts and scan_history.
 */
async function cleanupOldData() {
    const db = await getDb();
    const { detectedPosts, scanHistory } = config.retentionDays;

    try {
        // Delete old detected_posts (only those that have been notified and are old)
        const resultPosts = await db.run(
            `DELETE FROM detected_posts 
             WHERE notified_at IS NOT NULL 
             AND last_seen_at < datetime('now', '-' || ? || ' days')`,
            [detectedPosts]
        );
        logger.info(`Cleaned up ${resultPosts.changes} old detected_posts records.`);

        // Delete old scan_history
        const resultHistory = await db.run(
            `DELETE FROM scan_history 
             WHERE scanned_at < datetime('now', '-' || ? || ' days')`,
            [scanHistory]
        );
        logger.info(`Cleaned up ${resultHistory.changes} old scan_history records.`);

        // Optional: VACUUM to reclaim space (runs occasionally)
        if (Math.random() < 0.1) { // 10% chance each cleanup
            await db.run('VACUUM');
            logger.debug('Database vacuumed.');
        }
    } catch (error) {
        logger.error(`Database cleanup failed: ${error.message}`);
    }
}

/**
 * Start scheduled maintenance tasks.
 */
function startMaintenance() {
    // Run cleanup daily at 3:00 AM
    cron.schedule('0 3 * * *', () => {
        logger.debug('Running scheduled database cleanup...');
        cleanupOldData().catch(err => logger.error(`Cleanup error: ${err.message}`));
    });

    logger.info('Maintenance scheduler started (daily cleanup at 3:00 AM).');
}

module.exports = { startMaintenance, cleanupOldData };