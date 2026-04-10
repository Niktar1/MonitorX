// core/scraper.js
const logger = require('../logger');

/**
 * Extracts unique post IDs from a Facebook group page.
 * @param {import('playwright').Page} page - Authenticated page object.
 * @param {string} groupUrl - Full URL of the Facebook group.
 * @returns {Promise<string[]>} Array of unique post IDs (the numeric/string part after /posts/).
 */
async function extractPostIds(page, groupUrl) {
    try {
        await page.goto(groupUrl, { waitUntil: 'networkidle', timeout: 30000 });
        
        // Wait for the feed to load - Facebook uses role="feed" or similar containers
        await page.waitForSelector('div[role="feed"]', { timeout: 15000 }).catch(() => {
            logger.warn('Could not find feed container, proceeding anyway.');
        });

        // Scroll a bit to load more posts (optional but helpful)
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(2000);

        // Extract all links that contain "/posts/"
        const postLinks = await page.$$eval('a[href*="/posts/"]', anchors => 
            anchors.map(a => a.href).filter(href => href.includes('/posts/'))
        );

        // Extract unique post IDs using regex
        const postIdRegex = /\/posts\/([^/?]+)/;
        const postIds = [...new Set(
            postLinks
                .map(link => {
                    const match = link.match(postIdRegex);
                    return match ? match[1] : null;
                })
                .filter(id => id !== null)
        )];

        logger.debug(`Found ${postIds.length} unique post IDs on page.`);
        return postIds;
    } catch (error) {
        logger.error(`Error scraping group ${groupUrl}: ${error.message}`);
        return [];
    }
}

/**
 * Determines new posts by comparing current IDs with last known ID.
 * @param {string[]} currentIds - Freshly scraped IDs.
 * @param {string|null} lastId - Last seen post ID from database.
 * @returns {string[]} New post IDs (in order from oldest to newest as they appear on page? 
 *                     Facebook feed is roughly reverse chronological, but we'll assume first ID in list is newest.)
 */
function getNewPostIds(currentIds, lastId) {
    if (!lastId) {
        // First run, all are considered new
        return currentIds;
    }
    const lastIndex = currentIds.indexOf(lastId);
    if (lastIndex === -1) {
        // Last ID not found, might have been pushed out of view; return all as precaution
        return currentIds;
    }
    // Newer posts are those before the lastIndex (assuming array order matches feed order: newest first)
    return currentIds.slice(0, lastIndex);
}

module.exports = { extractPostIds, getNewPostIds };