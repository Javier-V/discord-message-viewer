# Discord Message Viewer

A web-based viewer for Discord messages with search and sorting capabilities.

## Features

- View messages from Discord channels
- Search by author name or message content
- Sort by date (newest first), author/name, or content
- Dashboard activity metrics for configured text and voice channels
- Real-time updates via WebSocket
- Responsive web interface

## Requirements

- Node.js 16 or higher
- A Discord bot with proper permissions
- Discord server with the bot added

## Setup Instructions

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```

3. Create a Discord bot at https://discord.com/developers/applications

4. Configure the bot with required permissions:
   - Enable "MESSAGE_CONTENT" intent in the bot settings
   - Add the bot to your Discord server
   - Ensure bot has "View Channel" and "Read Message History" permissions

5. Set up your environment:
   ```
   cp .env.example .env
   # Edit .env to add your DISCORD_TOKEN and other settings
   ```

6. Start the server:
   ```
   npm start
   ```

7. Visit `http://localhost:3000` to view messages

## Environment Variables

The application requires the following environment variables to be set in `.env`:

```
# Discord Bot Token (required)
DISCORD_TOKEN=your_bot_token_here

# Discord channel to read (required)
DISCORD_CHANNEL_ID=123456789012345678

# Discord guild/server ID (optional)
DISCORD_GUILD_ID=123456789012345678

# Historical messages to load on startup/refresh (optional)
MAX_HISTORY_MESSAGES=1000

# Dashboard text channels, separated by commas (optional)
DASHBOARD_TEXT_CHANNEL_IDS=123456789012345678,234567890123456789

# Dashboard voice channels, separated by commas (optional)
DASHBOARD_VOICE_CHANNEL_IDS=345678901234567890,456789012345678901

# Historical messages per dashboard text channel (optional)
DASHBOARD_MAX_HISTORY_MESSAGES_PER_CHANNEL=1000

# Server Port 
PORT=3000
```

To get these values:
1. **DISCORD_TOKEN**: Copy from Discord Developer Portal -> Your App -> Bot -> Token
2. **DISCORD_CHANNEL_ID**: Enable Developer Mode in Discord, right-click the channel, and copy ID
3. **DISCORD_GUILD_ID**: Right-click the server and copy ID if you want to restrict the bot to one guild

## Important Notes

- `MESSAGE_CONTENT` intent allows access to message content, but does NOT require application verification
- Historical messages must be fetched using the Discord REST API with "Read Message History" permission
- The implementation properly handles pagination to fetch messages older than 100 messages
- No application verification required for bots in fewer than 100 servers

## Usage

- Search bar: Filter messages by author name or content
- Sort dropdown: Change sorting between date, author/name, and content
- Refresh button: Reload messages from Discord
- Dashboard: Open the Dashboard section to review text and voice activity for configured channels

## API Endpoints

- `GET /api/messages` - Get filtered messages (supports search, sortBy, and limit)
- `POST /api/refresh` - Reload messages from Discord
- `GET /api/status` - Get Discord connection and channel status
- `GET /api/dashboard/summary` - Get dashboard summary metrics
- `GET /api/dashboard/text` - Get text-channel activity metrics
- `GET /api/dashboard/voice` - Get voice-channel activity metrics
- `GET /api/dashboard/channels` - Get configured dashboard channels

## Files

- `web-server.js` - Main web server with Express and Socket.IO
- `bot.js` - Discord bot functionality
- `public/` - Web interface files (HTML, CSS, JavaScript)
- `.env.example` - Environment variable template
- `.gitignore` - Excludes .env files

## License

MIT
