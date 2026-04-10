// core/scheduler.js
const logger = require('../logger');
const config = require('../config');
const { getAuthenticatedPage } = require('./auth');
const { extractPostIds, getNewPostIds } = require('./scraper');
const { getDb } = require('./db'); // We'll create db.js next
const { sendNotifications } = require('./notifier');

// Store active job intervals and locks
const activeJobs = new Map(); // watchId -> { interval, lock: boolean }

/**
 * Starts the monitoring scheduler.
 * Loads all active watches from DB and sets intervals.
 */
async function startScheduler() {
    const db = await getDb();
    const watches = await db.all('SELECT * FROM watches WHERE active = 1');
    
    for (const watch of watches) {
        scheduleWatch(watch);
    }
    logger.info(`Scheduler started with ${watches.length} active watches.`);
}

/**
 * Schedules a single watch job.
 */
function scheduleWatch(watch) {
    const { id, url } = watch;
    
    if (activeJobs.has(id)) {
        // Already scheduled, skip
        return;
    }

    const job = {
        lock: false,
        interval: setInterval(async () => {
            if (job.lock) {
                logger.debug(`Skipping scan for ${url} - previous scan still running.`);
                return;
            }
            job.lock = true;
            try {
                await runWatchJob(watch);
            } catch (error) {
                logger.error(`Error in watch job ${url}: ${error.message}`);
            } finally {
                job.lock = false;
            }
        }, config.scanIntervalMs)
    };

    activeJobs.set(id, job);
    logger.info(`Scheduled watch for ${url} every ${config.scanIntervalMs/1000}s`);
}

/**
 * Stops and removes a watch job.
 */
function unscheduleWatch(watchId) {
    const job = activeJobs.get(watchId);
    if (job) {
        clearInterval(job.interval);
        activeJobs.delete(watchId);
        logger.info(`Unscheduled watch ID ${watchId}`);
    }
}

/**
 * Stops all scheduled jobs (for graceful shutdown).
 */
function stopAllJobs() {
    for (const [id, job] of activeJobs) {
        clearInterval(job.interval);
    }
    activeJobs.clear();
    logger.info('All monitoring jobs stopped.');
}

/**
 * Core logic executed for each watch.
 */
async function runWatchJob(watch) {
    const db = await getDb();
    const { id, url, last_post_id } = watch;
    
    logger.debug(`Scanning ${url}`);

    // Get authenticated context (reuses session)
    let context, page;
    try {
        ({ context, page } = await getAuthenticatedPage());
        
        // Extract current post IDs
        const currentIds = await extractPostIds(page, url);
        
        // Determine new posts
        const newPostIds = getNewPostIds(currentIds, last_post_id);
        
        if (newPostIds.length > 0) {
            logger.info(`Found ${newPostIds.length} new posts for ${url}`);
            
            // Get webhooks for this watch (or global defaults)
            const webhooks = await db.all('SELECT url FROM webhooks WHERE enabled = 1');
            const webhookUrls = webhooks.map(w => w.url);
            
            // Send notifications
            await sendNotifications(url, newPostIds, webhookUrls);
            
            // Update last_post_id to the newest (first) post ID
            const newestId = currentIds[0] || last_post_id;
            await db.run(
                'UPDATE watches SET last_post_id = ?, last_scan = CURRENT_TIMESTAMP WHERE id = ?',
                [newestId, id]
            );
        } else {
            await db.run('UPDATE watches SET last_scan = CURRENT_TIMESTAMP WHERE id = ?', [id]);
        }
    } catch (error) {
        logger.error(`Error scanning ${url}: ${error.message}`);
    } finally {
        // Close only the page, NOT the context
        if (page) await page.close().catch(() => {});
    }
}

let isPaused = false;
const pausedJobs = new Map(); // Store intervals when paused

function pauseAllJobs() {
    if (isPaused) return;
    isPaused = true;
    for (const [id, job] of activeJobs) {
        clearInterval(job.interval);
        pausedJobs.set(id, job);
    }
    activeJobs.clear();
    logger.info('All monitoring jobs paused.');
}

function resumeAllJobs() {
    if (!isPaused) return;
    isPaused = false;
    for (const [id, job] of pausedJobs) {
        const newInterval = setInterval(async () => {
            if (job.lock) return;
            job.lock = true;
            try {
                const db = await getDb();
                const watch = await db.get('SELECT * FROM watches WHERE id = ?', [id]);
                if (watch && watch.active) {
                    await runWatchJob(watch);
                }
            } catch (error) {
                logger.error(`Error in resumed job: ${error.message}`);
            } finally {
                job.lock = false;
            }
        }, config.scanIntervalMs);
        job.interval = newInterval;
        activeJobs.set(id, job);
    }
    pausedJobs.clear();
    logger.info('All monitoring jobs resumed.');
}

module.exports = {
    startScheduler,
    scheduleWatch,
    unscheduleWatch,
    stopAllJobs,
    pauseAllJobs,
    resumeAllJobs
};