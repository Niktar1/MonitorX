// core/notifier.js
const axios = require('axios');
const logger = require('../logger');

/**
 * Sends a Discord notification for new posts.
 * @param {string} groupUrl - The Facebook group URL.
 * @param {string[]} postIds - Array of new post IDs.
 * @param {string[]} webhookUrls - List of Discord webhook URLs.
 */
async function sendNotifications(groupUrl, postIds, webhookUrls) {
    if (!webhookUrls || webhookUrls.length === 0) {
        logger.warn('No webhooks configured. Skipping notifications.');
        return;
    }

    for (const postId of postIds) {
        const postUrl = `https://www.facebook.com/groups/${extractGroupId(groupUrl)}/posts/${postId}`;
        const message = {
            content: null,
            embeds: [{
                title: '🆕 New Post Detected',
                description: `[Click to view post](${postUrl})`,
                color: 0x4267B2, // Facebook blue
                fields: [
                    { name: 'Group', value: groupUrl, inline: false },
                    { name: 'Post ID', value: postId, inline: true }
                ],
                timestamp: new Date().toISOString(),
                footer: { text: 'MonitorX' }
            }]
        };

        // Send to each webhook with small delay to avoid rate limits
        for (const url of webhookUrls) {
            try {
                await axios.post(url, message);
                logger.debug(`Notification sent for post ${postId} to webhook.`);
            } catch (error) {
                logger.error(`Failed to send webhook to ${url}: ${error.response?.status} ${error.message}`);
            }
            // Respect Discord rate limit (5 requests per 2 seconds per webhook)
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
}

function extractGroupId(groupUrl) {
    const match = groupUrl.match(/\/groups\/([^/?]+)/);
    return match ? match[1] : 'unknown';
}

module.exports = { sendNotifications };