// config.js
require('dotenv').config();

module.exports = {
    // Server
    port: process.env.PORT || 3000,
    
    // Environment
    isDev: process.env.NODE_ENV === 'development',
    logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),

    // Monitoring
    scanIntervalMs: 30 * 1000, // 60 seconds
    
    // Storage Paths
    dbPath: './storage/db.json',
    browserDataDir: './storage/browser-data',
    logsDir: './logs',

    // Playwright Settings
    browserOptions: {
        headless: process.env.HEADLESS === 'false' ? false : true, // Set HEADLESS=false in .env to see the browser
        args: [
            '--disable-blink-features=AutomationControlled', // Helps avoid detection
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    },

    // Default Discord Webhooks (can be overridden in UI/DB)
    defaultWebhooks: [
        { name: 'Alerts Channel', url: '' }, // Fill these in later or leave blank
        { name: 'Debug Channel', url: '' }
    ]
};