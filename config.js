// config.js
require('dotenv').config();
const path = require('path');

// Detect if running as packaged executable
const isPkg = !!(process.pkg || process.env.MONITORX_WRAPPER);

// Base directory for data files
const baseDir = isPkg
    ? path.dirname(process.execPath) // Folder containing MonitorX.exe
    : path.resolve(__dirname);

module.exports = {
    // Server
    port: process.env.PORT || 3000,
    
    // Environment
    isDev: process.env.NODE_ENV === 'development',
    logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),

    // Monitoring
    scanIntervalMs: 30 * 1000, // 30 seconds
    
    // Storage Paths
    dbPath: path.join(baseDir, 'storage', 'db.sqlite'),
    browserDataDir: path.join(baseDir, 'storage', 'browser-data'),
    logsDir: path.join(baseDir, 'logs'),

    // Playwright Settings
    retentionDays: {
        detectedPosts: 30,      // Keep seen posts for 30 days
        scanHistory: 14,        // Keep scan history for 14 days
    },
    // Default Discord Webhooks (can be overridden in UI/DB)
    defaultWebhooks: [
        { name: 'Alerts Channel', url: '' }, // Fill these in later or leave blank
        { name: 'Debug Channel', url: '' }
    ],
    
    browserOptions: {
        headless: process.env.HEADLESS === 'false' ? false : true,
        executablePath: isPkg
            ? path.join(
                  path.dirname(process.execPath),
                  'node_modules/playwright-core/.local-browsers/chromium/chrome-win/chrome.exe'
              )
            : undefined,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    },  
};