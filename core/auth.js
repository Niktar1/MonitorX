// core/auth.js
const { chromium } = require('playwright');
const config = require('../config');
const path = require('path');
const logger = require('../logger'); // We'll create logger later

/**
 * Launches a persistent browser context for Facebook.
 * If user is not logged in, opens a visible window for manual login.
 * @param {boolean} forceVisible - If true, forces headless=false for login UI.
 * @returns {Promise<Object>} { browser, context, page }
 */
async function getAuthenticatedContext(forceVisible = false) {
    const userDataDir = path.resolve(config.browserDataDir);
    
    // Launch persistent context (saves cookies/localStorage to disk)
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: forceVisible ? false : config.browserOptions.headless,
        args: config.browserOptions.args,
        // Optional: Set viewport to look like a normal user
        viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();
    
    // Check if already logged in
    await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });
    
    const isLoggedIn = await page.evaluate(() => {
        // Check for presence of elements that indicate logged-in state
        return !!document.querySelector('[aria-label="Your profile"]') || 
               !!document.querySelector('[aria-label="Home"]');
    });

    if (!isLoggedIn || forceVisible) {
        logger.info('Facebook login required. Opening browser for manual login...');
        // If headless mode was on, we need to restart with headless:false
        if (config.browserOptions.headless && !forceVisible) {
            await context.close();
            return getAuthenticatedContext(true);
        }
        
        // Wait for user to log in manually
        logger.info('Please log in to Facebook in the opened browser window.');
        await page.waitForURL('https://www.facebook.com/', { timeout: 0 }); // Wait indefinitely for redirect to home
        // Additional wait to ensure session is fully saved
        await page.waitForTimeout(5000);
        logger.info('Login successful! Session saved.');
    } else {
        logger.debug('Already logged in to Facebook.');
    }

    const browser = context.browser(); // Actually returns null for persistent context, but we have context
    return { context, page };
}

/**
 * Closes the browser context cleanly.
 */
async function closeContext(context) {
    if (context) {
        await context.close();
    }
}

module.exports = { getAuthenticatedContext, closeContext };