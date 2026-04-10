// core/auth.js
const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../logger');

let persistentContext = null;
let contextPromise = null;

/**
 * Returns the singleton persistent context.
 */
async function getPersistentContext() {
    if (persistentContext) return persistentContext;
    if (contextPromise) return contextPromise;
    
    contextPromise = (async () => {
        const userDataDir = path.resolve(config.browserDataDir);
        logger.debug(`Launching persistent context (userDataDir: ${userDataDir})`);
        const context = await chromium.launchPersistentContext(userDataDir, {
            headless: config.browserOptions.headless,
            args: config.browserOptions.args,
            viewport: { width: 1280, height: 720 }
        });
        persistentContext = context;
        logger.info('Persistent browser context launched.');
        return context;
    })();
    
    return contextPromise;
}

/**
 * More robust login detection.
 * Checks for presence of feed, user cookie, and absence of login button.
 */
async function isLoggedIn(page) {
    try {
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        const result = await page.evaluate(() => {
            // Check for the news feed (most reliable logged-in indicator)
            const hasFeed = !!document.querySelector('div[role="feed"]');
            // Check for c_user cookie (contains user ID)
            const hasUserCookie = document.cookie.split(';').some(c => c.trim().startsWith('c_user='));
            // Check for login form (if present, definitely not logged in)
            const loginForm = document.querySelector('form[action*="login"]');
            const hasLoginForm = !!loginForm;
            
            return {
                hasFeed,
                hasUserCookie,
                hasLoginForm,
                loggedIn: (hasFeed || hasUserCookie) && !hasLoginForm
            };
        });
        
        logger.debug(`Login check: feed=${result.hasFeed}, cookie=${result.hasUserCookie}, loginForm=${result.hasLoginForm}`);
        return result.loggedIn;
    } catch (error) {
        logger.warn(`Login check error: ${error.message}`);
        return false;
    }
}

/**
 * Clear saved browser session (cookies, localStorage, etc.)
 */
async function clearSession() {
    const userDataDir = path.resolve(config.browserDataDir);
    try {
        await fs.rm(userDataDir, { recursive: true, force: true });
        logger.info('Cleared saved Facebook session.');
    } catch (error) {
        logger.warn(`Could not clear session: ${error.message}`);
    }
    // Close existing context so it's recreated fresh
    if (persistentContext) {
        await persistentContext.close().catch(() => {});
        persistentContext = null;
        contextPromise = null;
    }
}

/**
 * Ensures the user is logged in.
 * @param {Object} options - { forceNewLogin: false }
 * If forceNewLogin is true, clears session and opens visible browser for manual login.
 */
async function ensureLoggedIn(options = {}) {
    const { forceNewLogin = false } = options;
    
    if (forceNewLogin) {
        await clearSession();
    }
    
    const context = await getPersistentContext();
    const page = await context.newPage();
    
    try {
        const loggedIn = await isLoggedIn(page);
        
        if (loggedIn && !forceNewLogin) {
            logger.debug('Facebook session is valid.');
            return context;
        }
        
        // Need to login
        logger.info('Opening visible browser for Facebook login...');
        
        // If we're in headless mode, close and reopen visible
        if (config.browserOptions.headless) {
            await context.close();
            persistentContext = null;
            contextPromise = null;
        }
        
        // Launch visible context
        const visibleContext = await chromium.launchPersistentContext(
            path.resolve(config.browserDataDir),
            {
                headless: false,
                args: config.browserOptions.args,
                viewport: { width: 1280, height: 720 }
            }
        );
        
        const visiblePage = await visibleContext.newPage();
        await visiblePage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
        
        logger.info('👆 Please log in to Facebook in the opened window.');
        logger.info('⏳ Waiting for you to complete login...');
        
        // Wait for the user to manually log in
        // We wait for navigation to home page AND presence of feed
        await visiblePage.waitForURL('https://www.facebook.com/', { timeout: 0 });
        await visiblePage.waitForSelector('div[role="feed"]', { timeout: 0 });
        
        // Additional wait for session persistence
        await visiblePage.waitForTimeout(3000);
        
        logger.info('✅ Login successful! Session saved.');
        await visibleContext.close();
        
        // Relaunch headless context if needed
        if (config.browserOptions.headless) {
            persistentContext = await chromium.launchPersistentContext(
                path.resolve(config.browserDataDir),
                {
                    headless: true,
                    args: config.browserOptions.args,
                    viewport: { width: 1280, height: 720 }
                }
            );
            logger.info('Headless monitoring context resumed.');
        } else {
            persistentContext = visibleContext;
        }
        return persistentContext;
    } finally {
        await page.close().catch(() => {});
    }
}

/**
 * Provides a fresh page from the persistent context.
 */
async function getAuthenticatedPage() {
    await ensureLoggedIn(); // Ensures session is valid
    const context = await getPersistentContext();
    const page = await context.newPage();
    return { context, page };
}

/**
 * Gracefully shuts down the persistent context.
 */
async function closePersistentContext() {
    if (persistentContext) {
        await persistentContext.close().catch(() => {});
        persistentContext = null;
        contextPromise = null;
        logger.info('Persistent browser context closed.');
    }
}

module.exports = {
    getAuthenticatedPage,
    ensureLoggedIn,
    closePersistentContext,
    clearSession
};