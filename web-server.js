const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const dotenv = require('dotenv');
const {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionsBitField,
} = require('discord.js');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = Number(process.env.PORT || 3000);
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || process.env.TEST_CHANNEL_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES || 1000);
const MAX_STORED_MESSAGES = Number(process.env.MAX_STORED_MESSAGES || 5000);
const DEFAULT_PAGE_SIZE = 100;
const ALLOWED_PAGE_SIZES = new Set([100, 200, 500]);

let messagesData = [];
let connectedClients = 0;
let discordStatus = {
  ready: false,
  configuredChannelId: CHANNEL_ID || null,
  channelName: null,
  messageCount: 0,
  lastFetchAt: null,
  error: null,
};

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function isReadableMessageChannel(channel) {
  return Boolean(
    channel &&
      channel.isTextBased() &&
      channel.messages &&
      [
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread,
      ].includes(channel.type)
  );
}

function ensureChannelPermissions(channel) {
  if (!channel.guild) {
    throw new Error('The configured channel is not inside a guild');
  }

  const me = channel.guild.members.me;
  if (!me) {
    throw new Error('Could not resolve the bot member in the guild');
  }

  const permissions = channel.permissionsFor(me);
  if (!permissions?.has(PermissionsBitField.Flags.ViewChannel)) {
    throw new Error(`Missing "View Channel" permission for #${channel.name}`);
  }

  if (!permissions?.has(PermissionsBitField.Flags.ReadMessageHistory)) {
    throw new Error(`Missing "Read Message History" permission for #${channel.name}`);
  }
}

function normalizeMessage(message) {
  const author = message.author;
  const avatar = author?.displayAvatarURL({ extension: 'png', size: 64 }) || null;
  const displayName =
    message.member?.displayName ||
    author?.globalName ||
    author?.username ||
    'Unknown user';

  return {
    id: message.id,
    content: message.content || '',
    author: {
      id: author?.id || null,
      username: author?.username || 'unknown',
      displayName,
      tag: author?.tag || author?.username || 'unknown',
      avatar,
      bot: Boolean(author?.bot),
    },
    channelId: message.channelId,
    channelName: message.channel?.name || null,
    guildId: message.guildId,
    timestamp: message.createdTimestamp,
    createdAt: message.createdAt.toISOString(),
    attachments: [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      contentType: attachment.contentType,
      size: attachment.size,
    })),
    pinned: message.pinned,
    system: message.system,
  };
}

function shouldIncludeMessage(messageOrData) {
  if (!messageOrData) return false;
  if (messageOrData.author?.bot) return false;
  if (CHANNEL_ID && messageOrData.channelId !== CHANNEL_ID) return false;
  if (GUILD_ID && messageOrData.guildId !== GUILD_ID) return false;
  return true;
}

function upsertMessages(newMessages) {
  const byId = new Map(messagesData.map((message) => [message.id, message]));

  for (const message of newMessages) {
    if (shouldIncludeMessage(message)) {
      byId.set(message.id, message);
    }
  }

  messagesData = [...byId.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_STORED_MESSAGES);

  discordStatus.messageCount = messagesData.length;
}

async function resolveConfiguredChannel() {
  if (!CHANNEL_ID) {
    throw new Error('Set DISCORD_CHANNEL_ID or TEST_CHANNEL_ID in .env');
  }

  const channel = await discordClient.channels.fetch(CHANNEL_ID);
  if (!isReadableMessageChannel(channel)) {
    throw new Error(`Channel ${CHANNEL_ID} is not a readable guild text channel`);
  }

  if (GUILD_ID && channel.guildId !== GUILD_ID) {
    throw new Error(`Channel ${CHANNEL_ID} does not belong to guild ${GUILD_ID}`);
  }

  ensureChannelPermissions(channel);
  return channel;
}

async function fetchHistoricalMessages(channel, maxMessages = MAX_HISTORY_MESSAGES) {
  const allMessages = [];
  let before;

  while (allMessages.length < maxMessages) {
    const limit = Math.min(100, maxMessages - allMessages.length);
    const batch = await channel.messages.fetch(before ? { limit, before } : { limit });

    if (batch.size === 0) break;

    allMessages.push(...batch.values());
    before = batch.last().id;

    if (batch.size < limit) break;
  }

  return allMessages.map(normalizeMessage).filter(shouldIncludeMessage);
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function filterAndSortMessages({ search = '', sortBy = 'date' }) {
  const term = search.trim().toLowerCase();
  let filteredMessages = [...messagesData];

  if (term) {
    filteredMessages = filteredMessages.filter((message) => {
      const authorText = `${message.author.displayName} ${message.author.username} ${message.author.tag}`;
      return (
        message.content.toLowerCase().includes(term) ||
        authorText.toLowerCase().includes(term)
      );
    });
  }

  if (sortBy === 'author' || sortBy === 'name') {
    filteredMessages.sort((a, b) =>
      compareText(a.author.displayName || a.author.username, b.author.displayName || b.author.username)
    );
  } else if (sortBy === 'content') {
    filteredMessages.sort((a, b) => compareText(a.content, b.content));
  } else {
    filteredMessages.sort((a, b) => b.timestamp - a.timestamp);
  }

  return filteredMessages;
}

function paginateMessages(messages, { limit = DEFAULT_PAGE_SIZE, page = 1 } = {}) {
  const rawLimit = String(limit || DEFAULT_PAGE_SIZE).toLowerCase();
  const isAll = rawLimit === 'all' || rawLimit === 'todos';
  const total = messages.length;
  const requestedPageSize = Number(rawLimit);
  const pageSize = isAll
    ? total
    : ALLOWED_PAGE_SIZES.has(requestedPageSize)
      ? requestedPageSize
      : DEFAULT_PAGE_SIZE;
  const totalPages = isAll ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const currentPage = isAll
    ? 1
    : Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = isAll ? 0 : (currentPage - 1) * pageSize;
  const items = isAll ? messages : messages.slice(start, start + pageSize);

  return {
    items,
    pagination: {
      page: currentPage,
      pageSize: isAll ? 'all' : pageSize,
      total,
      totalPages,
      hasPreviousPage: currentPage > 1,
      hasNextPage: currentPage < totalPages,
    },
  };
}

discordClient.once('ready', async () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
  discordStatus.ready = true;

  try {
    const channel = await resolveConfiguredChannel();
    discordStatus.channelName = channel.name;
    discordStatus.error = null;

    console.log(`Fetching up to ${MAX_HISTORY_MESSAGES} messages from #${channel.name} (${channel.id})`);
    const historicalMessages = await fetchHistoricalMessages(channel);
    upsertMessages(historicalMessages);

    discordStatus.lastFetchAt = new Date().toISOString();
    io.emit('initialMessages', messagesData);
    console.log(`Loaded ${messagesData.length} messages from Discord`);
  } catch (error) {
    discordStatus.error = error.message;
    console.error('Could not load Discord messages:', error);
  }
});

discordClient.on('messageCreate', (message) => {
  const messageData = normalizeMessage(message);
  if (!shouldIncludeMessage(messageData)) return;

  upsertMessages([messageData]);
  io.emit('messageUpdate', messageData);
});

discordClient.on('messageUpdate', (_oldMessage, newMessage) => {
  if (newMessage.partial || !newMessage.author) return;

  const messageData = normalizeMessage(newMessage);
  if (!shouldIncludeMessage(messageData)) return;

  upsertMessages([messageData]);
  io.emit('messageUpdate', messageData);
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/status', (_req, res) => {
  res.json(discordStatus);
});

app.get('/api/messages', async (req, res) => {
  try {
    const filteredMessages = filterAndSortMessages({
      search: String(req.query.search || ''),
      sortBy: String(req.query.sortBy || 'date'),
    });
    const { items, pagination } = paginateMessages(filteredMessages, {
      limit: req.query.limit,
      page: req.query.page,
    });

    if (req.query.includeMeta === '1' || req.query.includeMeta === 'true') {
      res.json({ messages: items, pagination });
      return;
    }

    res.json(items);
  } catch (error) {
    console.error('Error returning messages:', error);
    res.status(500).json({ error: 'Could not return messages' });
  }
});

app.post('/api/refresh', async (_req, res) => {
  try {
    const channel = await resolveConfiguredChannel();
    const historicalMessages = await fetchHistoricalMessages(channel);
    upsertMessages(historicalMessages);

    discordStatus.channelName = channel.name;
    discordStatus.lastFetchAt = new Date().toISOString();
    discordStatus.error = null;

    io.emit('initialMessages', messagesData);
    res.json({ ok: true, count: messagesData.length });
  } catch (error) {
    discordStatus.error = error.message;
    console.error('Error refreshing Discord messages:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

io.on('connection', (socket) => {
  connectedClients += 1;
  console.log(`Client connected. Total clients: ${connectedClients}`);
  socket.emit('initialMessages', messagesData);
  socket.emit('statusUpdate', discordStatus);

  socket.on('disconnect', () => {
    connectedClients -= 1;
    console.log(`Client disconnected. Total clients: ${connectedClients}`);
  });
});

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN environment variable is required');
  process.exit(1);
}

discordClient.login(process.env.DISCORD_TOKEN).catch((error) => {
  discordStatus.error = `Discord login failed: ${error.message}`;
  console.error('Discord login failed:', error);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
