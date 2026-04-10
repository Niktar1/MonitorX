// core/db.js
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
    `);
}

async function closeDb() {
    if (db) {
        await db.close();
        db = null;
    }
}

module.exports = { getDb, closeDb };