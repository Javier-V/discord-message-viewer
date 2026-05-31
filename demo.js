// Demo script showing how to properly use the Discord Message Viewer
// This demonstrates the correct way to set up a Discord bot with proper permissions

const { Client, GatewayIntentBits } = require('discord.js');

console.log('=== Discord Message Viewer Demo ===');
console.log('');
console.log('To use this application, follow these steps:');

console.log('');
console.log('1. Create a Discord bot:');
console.log('   - Go to https://discord.com/developers/applications');
console.log('   - Create a new application');
console.log('   - Go to "Bot" section');
console.log('   - Enable "MESSAGE_CONTENT" intent');
console.log('   - Copy the bot token');

console.log('');
console.log('2. Set up permissions:');
console.log('   - Add your bot to your server');
console.log('   - Ensure bot has permissions:');
console.log('     * View Channel');
console.log('     * Read Message History');

console.log('');
console.log('3. Configure your environment:');
console.log('   - Create a .env file with:');
console.log('     DISCORD_TOKEN=your_bot_token_here');
console.log('     TEST_CHANNEL_ID=channel_id_for_demo');

console.log('');
console.log('4. Run the application:');
console.log('   - npm install');
console.log('   - npm start');

console.log('');
console.log('5. Access the web interface:');
console.log('   - Open http://localhost:3000 in your browser');

console.log('');
console.log('=== Important Notes ===');
console.log('- The MESSAGE_CONTENT intent allows access to message content');
console.log('- Historical messages require Read Message History permissions');
console.log('- Use pagination to fetch messages older than 100 messages');
console.log('- No application verification is required for a bot in fewer than 100 servers');

console.log('');
console.log('The implementation handles:');
console.log('- Real-time message updates via WebSocket');
console.log('- Search by author or content');
console.log('- Sort by date or author');
console.log('- Proper pagination of historical messages');
console.log('- Filtering and display of avatars, dates, and content');