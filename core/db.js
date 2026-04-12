const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

let db = null;

async function getDb() {
    if (!db) {
        const dbPath = path.resolve(config.dbPath);
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        await db.exec('PRAGMA foreign_keys = ON;');
        await db.exec('PRAGMA journal_mode = WAL;');
        await initializeTables();
        logger.info('Database connected and initialized.');
    }

    return db;
}

async function initializeTables() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS watches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE NOT NULL,
            last_post_id TEXT,
            active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_scan DATETIME
        );

        CREATE TABLE IF NOT EXISTS webhooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            url TEXT UNIQUE NOT NULL,
            enabled BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS scan_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            watch_id INTEGER,
            post_id TEXT,
            webhook_response TEXT,
            scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(watch_id) REFERENCES watches(id)
        );

        CREATE TABLE IF NOT EXISTS detected_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            watch_id INTEGER NOT NULL,
            post_key TEXT NOT NULL,
            post_id TEXT,
            canonical_url TEXT,
            fingerprint TEXT,
            author_name TEXT,
            snippet TEXT,
            published_label TEXT,
            first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            notified_at DATETIME,
            UNIQUE(watch_id, post_key),
            FOREIGN KEY(watch_id) REFERENCES watches(id) ON DELETE CASCADE
        );
    `);

    await ensureColumn('watches', 'last_seen_post_key', 'ALTER TABLE watches ADD COLUMN last_seen_post_key TEXT');
    await ensureColumn('watches', 'bootstrap_complete', 'ALTER TABLE watches ADD COLUMN bootstrap_complete INTEGER DEFAULT 0');
    await ensureColumn('watches', 'last_scan_status', "ALTER TABLE watches ADD COLUMN last_scan_status TEXT DEFAULT 'pending'");
    await ensureColumn('watches', 'last_error', 'ALTER TABLE watches ADD COLUMN last_error TEXT');
    await ensureColumn('watches', 'last_scan_count', 'ALTER TABLE watches ADD COLUMN last_scan_count INTEGER DEFAULT 0');
    await ensureColumn('watches', 'last_new_posts_count', 'ALTER TABLE watches ADD COLUMN last_new_posts_count INTEGER DEFAULT 0');

    await ensureColumn('scan_history', 'status', "ALTER TABLE scan_history ADD COLUMN status TEXT DEFAULT 'success'");
    await ensureColumn('scan_history', 'total_posts', 'ALTER TABLE scan_history ADD COLUMN total_posts INTEGER DEFAULT 0');
    await ensureColumn('scan_history', 'new_posts', 'ALTER TABLE scan_history ADD COLUMN new_posts INTEGER DEFAULT 0');
    await ensureColumn('scan_history', 'error_message', 'ALTER TABLE scan_history ADD COLUMN error_message TEXT');

    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_watches_active ON watches(active);
        CREATE INDEX IF NOT EXISTS idx_detected_posts_watch_key ON detected_posts(watch_id, post_key);
        CREATE INDEX IF NOT EXISTS idx_detected_posts_watch_seen ON detected_posts(watch_id, last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS idx_scan_history_watch_scanned ON scan_history(watch_id, scanned_at DESC);
    `);
}

async function ensureColumn(tableName, columnName, statement) {
    const columns = await db.all(`PRAGMA table_info(${tableName})`);
    const exists = columns.some(column => column.name === columnName);
    if (!exists) {
        await db.exec(statement);
    }
}

async function getActiveWatches() {
    const database = await getDb();
    return database.all('SELECT * FROM watches WHERE active = 1 ORDER BY created_at ASC');
}

async function getWatchById(id) {
    const database = await getDb();
    return database.get('SELECT * FROM watches WHERE id = ?', [id]);
}

async function findActiveWatchByUrl(url) {
    const database = await getDb();
    return database.get('SELECT * FROM watches WHERE url = ? AND active = 1', [url]);
}

async function createWatch(url) {
    const database = await getDb();
    const result = await database.run(
        `INSERT INTO watches (
            url,
            active,
            bootstrap_complete,
            last_scan_status,
            last_scan_count,
            last_new_posts_count
        ) VALUES (?, 1, 0, 'pending', 0, 0)`,
        [url]
    );

    return getWatchById(result.lastID);
}

async function deleteWatch(id) {
    const database = await getDb();

    await database.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
        await database.run('DELETE FROM detected_posts WHERE watch_id = ?', [id]);
        await database.run('DELETE FROM scan_history WHERE watch_id = ?', [id]);
        await database.run('DELETE FROM watches WHERE id = ?', [id]);
        await database.exec('COMMIT');
    } catch (error) {
        await database.exec('ROLLBACK');
        throw error;
    }
}

async function getEnabledWebhookUrls() {
    const database = await getDb();
    const webhooks = await database.all('SELECT url FROM webhooks WHERE enabled = 1');
    return webhooks.map(webhook => webhook.url);
}

async function upsertDetectedPosts(watchId, posts) {
    if (!posts.length) {
        return [];
    }

    const database = await getDb();
    const insertedPosts = [];

    await database.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
        for (const post of posts) {
            const insertResult = await database.run(
                `INSERT OR IGNORE INTO detected_posts (
                    watch_id,
                    post_key,
                    post_id,
                    canonical_url,
                    fingerprint,
                    author_name,
                    snippet,
                    published_label
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    watchId,
                    post.postKey,
                    post.postId,
                    post.canonicalUrl,
                    post.fingerprint,
                    post.authorName,
                    post.snippet,
                    post.publishedLabel
                ]
            );

            await database.run(
                `UPDATE detected_posts
                 SET
                    last_seen_at = CURRENT_TIMESTAMP,
                    post_id = COALESCE(post_id, ?),
                    canonical_url = COALESCE(canonical_url, ?),
                    fingerprint = COALESCE(fingerprint, ?),
                    author_name = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE author_name END,
                    snippet = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE snippet END,
                    published_label = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE published_label END
                 WHERE watch_id = ? AND post_key = ?`,
                [
                    post.postId,
                    post.canonicalUrl,
                    post.fingerprint,
                    post.authorName,
                    post.authorName,
                    post.authorName,
                    post.snippet,
                    post.snippet,
                    post.snippet,
                    post.publishedLabel,
                    post.publishedLabel,
                    post.publishedLabel,
                    watchId,
                    post.postKey
                ]
            );

            if (insertResult.changes > 0) {
                insertedPosts.push(post);
            }
        }

        await database.exec('COMMIT');
    } catch (error) {
        await database.exec('ROLLBACK');
        throw error;
    }

    return insertedPosts;
}

async function markPostsNotified(watchId, postKeys) {
    if (!postKeys.length) {
        return;
    }

    const database = await getDb();
    const placeholders = postKeys.map(() => '?').join(', ');

    await database.run(
        `UPDATE detected_posts
         SET notified_at = CURRENT_TIMESTAMP
         WHERE watch_id = ? AND post_key IN (${placeholders})`,
        [watchId, ...postKeys]
    );
}

async function updateWatchScanState({
    watchId,
    status,
    totalPosts = 0,
    newPosts = 0,
    lastPostId = null,
    lastSeenPostKey = null,
    lastError = null,
    bootstrapComplete
}) {
    const database = await getDb();

    const current = await getWatchById(watchId);
    const nextBootstrapComplete = bootstrapComplete === undefined || bootstrapComplete === null
        ? (current?.bootstrap_complete ? 1 : 0)
        : (Number(bootstrapComplete) ? 1 : 0);

    await database.run(
        `UPDATE watches
         SET
            last_post_id = ?,
            last_seen_post_key = ?,
            bootstrap_complete = ?,
            last_scan = CURRENT_TIMESTAMP,
            last_scan_status = ?,
            last_error = ?,
            last_scan_count = ?,
            last_new_posts_count = ?
         WHERE id = ?`,
        [
            lastPostId || current?.last_post_id || null,
            lastSeenPostKey || current?.last_seen_post_key || null,
            Number.isInteger(nextBootstrapComplete) ? nextBootstrapComplete : (current?.bootstrap_complete ? 1 : 0),
            status,
            lastError,
            totalPosts,
            newPosts,
            watchId
        ]
    );

    await database.run(
        `INSERT INTO scan_history (
            watch_id,
            status,
            total_posts,
            new_posts,
            error_message
        ) VALUES (?, ?, ?, ?, ?)`,
        [watchId, status, totalPosts, newPosts, lastError]
    );
}

async function closeDb() {
    if (db) {
        await db.close();
        db = null;
    }
}

module.exports = {
    getDb,
    closeDb,
    getActiveWatches,
    getWatchById,
    findActiveWatchByUrl,
    createWatch,
    deleteWatch,
    getEnabledWebhookUrls,
    upsertDetectedPosts,
    markPostsNotified,
    updateWatchScanState
};
