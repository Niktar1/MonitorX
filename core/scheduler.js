const logger = require('../logger');
const config = require('../config');
const { getAuthenticatedPage } = require('./auth');
const { extractGroupPosts } = require('./scraper');
const {
    getActiveWatches,
    getWatchById,
    getEnabledWebhookUrls,
    upsertDetectedPosts,
    markPostsNotified,
    updateWatchScanState
} = require('./db');
const { sendNotifications } = require('./notifier');

const activeJobs = new Map(); // watchId -> { interval, lock, url }
const pausedJobs = new Map();
let isPaused = false;

async function startScheduler() {
    const watches = await getActiveWatches();

    for (const watch of watches) {
        scheduleWatch(watch);
    }

    logger.info(`Scheduler started with ${watches.length} active watches.`);
}

function scheduleWatch(watch) {
    const watchId = Number(watch.id);
    if (activeJobs.has(watchId)) {
        return;
    }

    const job = {
        lock: false,
        url: watch.url,
        interval: setInterval(() => runScheduledWatch(job, watchId), config.scanIntervalMs)
    };

    activeJobs.set(watchId, job);

    // Prime the watch immediately so newly added groups bootstrap without waiting a full interval.
    void runScheduledWatch(job, watchId);

    logger.info(`Scheduled watch for ${watch.url} every ${config.scanIntervalMs / 1000}s`);
}

function unscheduleWatch(watchId) {
    const numericWatchId = Number(watchId);
    const job = activeJobs.get(numericWatchId) || pausedJobs.get(numericWatchId);
    if (!job) {
        return;
    }

    clearInterval(job.interval);
    activeJobs.delete(numericWatchId);
    pausedJobs.delete(numericWatchId);
    logger.info(`Unscheduled watch ID ${numericWatchId}`);
}

function stopAllJobs() {
    for (const [, job] of activeJobs) {
        clearInterval(job.interval);
    }

    for (const [, job] of pausedJobs) {
        clearInterval(job.interval);
    }

    activeJobs.clear();
    pausedJobs.clear();
    logger.info('All monitoring jobs stopped.');
}

async function runScheduledWatch(job, watchId) {
    if (job.lock) {
        logger.debug(`Skipping scan for watch ${watchId} because the previous scan is still running.`);
        return;
    }

    job.lock = true;
    try {
        const watch = await getWatchById(watchId);
        if (!watch || !watch.active) {
            unscheduleWatch(watchId);
            return;
        }

        await runWatchJob(watch);
    } catch (error) {
        logger.error(`Error in watch job ${watchId}: ${error.message}`);
    } finally {
        job.lock = false;
    }
}

async function runWatchJob(watch) {
    const { id, url } = watch;
    logger.debug(`Scanning ${url}`);

    let page;

    try {
        ({ page } = await getAuthenticatedPage());

        const posts = await extractGroupPosts(page, url);
        const newestPost = posts[0] || null;

        if (!posts.length) {
            await updateWatchScanState({
                watchId: id,
                status: 'empty',
                totalPosts: 0,
                newPosts: 0,
                lastPostId: watch.last_post_id,
                lastSeenPostKey: watch.last_seen_post_key,
                lastError: null,
                bootstrapComplete: watch.bootstrap_complete
            });
            return;
        }

        const insertedPosts = await upsertDetectedPosts(id, posts);

        if (!watch.bootstrap_complete) {
            await updateWatchScanState({
                watchId: id,
                status: 'initialized',
                totalPosts: posts.length,
                newPosts: 0,
                lastPostId: newestPost?.postId || watch.last_post_id,
                lastSeenPostKey: newestPost?.postKey || watch.last_seen_post_key,
                lastError: null,
                bootstrapComplete: 1
            });

            logger.info(`Initialized watch ${url} with ${posts.length} baseline posts.`);
            return;
        }

        const webhooks = await getEnabledWebhookUrls();
        const notifiablePosts = insertedPosts.filter(post => post.postId || post.canonicalUrl);

        if (notifiablePosts.length) {
            logger.info(`Found ${notifiablePosts.length} new posts for ${url}`);
            await sendNotifications(url, notifiablePosts, webhooks);
            await markPostsNotified(id, notifiablePosts.map(post => post.postKey));
        }

        await updateWatchScanState({
            watchId: id,
            status: 'success',
            totalPosts: posts.length,
            newPosts: notifiablePosts.length,
            lastPostId: newestPost?.postId || watch.last_post_id,
            lastSeenPostKey: newestPost?.postKey || watch.last_seen_post_key,
            lastError: null,
            bootstrapComplete: 1
        });
    } catch (error) {
        await updateWatchScanState({
            watchId: id,
            status: 'error',
            totalPosts: 0,
            newPosts: 0,
            lastPostId: watch.last_post_id,
            lastSeenPostKey: watch.last_seen_post_key,
            lastError: error.message,
            bootstrapComplete: watch.bootstrap_complete
        }).catch(dbError => {
            logger.error(`Failed to persist scan error for watch ${id}: ${dbError.message}`);
        });

        logger.error(`Error scanning ${url}: ${error.message}`);
    } finally {
        if (page) {
            await page.close().catch(() => {});
        }
    }
}

function pauseAllJobs() {
    if (isPaused) {
        return;
    }

    isPaused = true;
    for (const [id, job] of activeJobs) {
        clearInterval(job.interval);
        pausedJobs.set(id, job);
    }

    activeJobs.clear();
    logger.info('All monitoring jobs paused.');
}

function resumeAllJobs() {
    if (!isPaused) {
        return;
    }

    isPaused = false;

    for (const [id, job] of pausedJobs) {
        job.interval = setInterval(() => runScheduledWatch(job, id), config.scanIntervalMs);
        activeJobs.set(id, job);
        void runScheduledWatch(job, id);
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
