const axios = require('axios');
const logger = require('../logger');

async function sendNotifications(groupUrl, postsOrIds, webhookUrls) {
    if (!webhookUrls || webhookUrls.length === 0) {
        logger.warn('No webhooks configured. Skipping notifications.');
        return;
    }

    const normalizedPosts = postsOrIds.map(post => normalizePost(groupUrl, post)).filter(Boolean);

    for (const post of normalizedPosts) {
        const message = {
            content: null,
            embeds: [{
                title: 'New Post Detected',
                description: post.postUrl ? `[Click to view post](${post.postUrl})` : 'A new Facebook group post was detected.',
                color: 0x4267B2,
                fields: [
                    { name: 'Group', value: groupUrl, inline: false },
                    { name: 'Post ID', value: post.postId || 'Unavailable', inline: true }
                ],
                timestamp: new Date().toISOString(),
                footer: { text: 'MonitorX' }
            }]
        };

        for (const webhookUrl of webhookUrls) {
            try {
                await axios.post(webhookUrl, message);
                logger.debug(`Notification sent for post ${post.postId || post.postUrl} to webhook.`);
            } catch (error) {
                logger.error(`Failed to send webhook to ${webhookUrl}: ${error.response?.status} ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
}

function normalizePost(groupUrl, postOrId) {
    if (!postOrId) {
        return null;
    }

    if (typeof postOrId === 'string') {
        return {
            postId: postOrId,
            postUrl: `https://www.facebook.com/groups/${extractGroupId(groupUrl)}/posts/${postOrId}`
        };
    }

    return {
        postId: postOrId.postId || null,
        postUrl: postOrId.canonicalUrl || (postOrId.postId
            ? `https://www.facebook.com/groups/${extractGroupId(groupUrl)}/posts/${postOrId.postId}`
            : null)
    };
}

function extractGroupId(groupUrl) {
    const match = groupUrl.match(/\/groups\/([^/?]+)/);
    return match ? match[1] : 'unknown';
}

module.exports = { sendNotifications };
