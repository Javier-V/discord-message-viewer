# Discord Platform Limitations

## MESSAGE_CONTENT Intent

The MESSAGE_CONTENT intent has important platform restrictions:

### Test Mode (Default)
- Only provides access to future messages sent **after** the bot connects
- Cannot access historical messages from the channel
- This is the default behavior for applications in Test Mode

### Verified Applications (100+ Servers Required)
- Can access historical messages via Discord's REST API
- Requires verification through Discord Developer Portal
- Full access to channel history as long as bot has proper permissions

## Historical Message Access

### Why You're Not Seeing All Messages

1. **Test Mode Limitation**: Your bot is in Test Mode, so it can only see messages sent after connecting
2. **Permissions**: The bot must have proper permissions in the server and channel
3. **Rate Limits**: Discord has rate limits on API calls

### How to Access Historical Messages

1. Verify your Discord application (100+ servers required)
2. Enable all required intents in the Developer Portal
3. Add bot to server with proper role permissions
4. The application code already includes REST API calls for fetching recent messages

## Workaround for Test Mode

While in Test Mode, you can fetch recent messages using Discord's REST GET /channels/{channel.id}/messages endpoint. This will get the last 100 messages from the channel when the bot connects.

The code is already implemented to fetch recent messages, but in Test Mode you'll only see messages sent after connection.