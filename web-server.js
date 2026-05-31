const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const socketIo = require('socket.io');
const dotenv = require('dotenv');
const {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionsBitField,
} = require('discord.js');
const {
  ActivityStore,
  createChannelSnapshot,
  createUserSnapshot,
} = require('./activity-store');

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
const DASHBOARD_TEXT_CHANNEL_IDS = parseDashboardIdList('DASHBOARD_TEXT_CHANNEL_IDS');
const DASHBOARD_VOICE_CHANNEL_IDS = parseDashboardIdList('DASHBOARD_VOICE_CHANNEL_IDS');
const DASHBOARD_MAX_HISTORY_MESSAGES_PER_CHANNEL = Number(process.env.DASHBOARD_MAX_HISTORY_MESSAGES_PER_CHANNEL || 1000);
const IMAGES_DIR = path.join(__dirname, 'images');
const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);

let messagesData = [];
let dashboardTextMessages = [];
let connectedClients = 0;
let dashboardChannels = {
  text: [],
  voice: [],
};
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
    GatewayIntentBits.GuildVoiceStates,
  ],
});
const activityStore = new ActivityStore({ dataDir: path.join(__dirname, 'data') });

app.use('/images', express.static(IMAGES_DIR));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function parseIdList(value = '') {
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDashboardIdList(key) {
  const processValue = parseIdList(process.env[key]);
  if (processValue.length > 0) return processValue;

  return parseIdList(readEnvBlockValue(key));
}

function readEnvBlockValue(key) {
  const envPath = path.join(__dirname, '.env');

  if (!fs.existsSync(envPath)) return '';

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const keyPattern = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`);
  const nextKeyPattern = /^\s*[A-Z][A-Z0-9_]*\s*=/;
  const values = [];
  let collecting = false;

  for (const line of lines) {
    if (!collecting) {
      const match = line.match(keyPattern);
      if (!match) continue;

      values.push(match[1]);
      collecting = true;
      continue;
    }

    if (nextKeyPattern.test(line)) break;
    if (line.trim().startsWith('#')) continue;

    values.push(line);
  }

  return values.join(' ');
}

function listImageFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

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

function shouldIncludeDashboardTextMessage(messageOrData) {
  if (!messageOrData) return false;
  if (messageOrData.author?.bot) return false;
  if (DASHBOARD_TEXT_CHANNEL_IDS.length === 0) return false;
  if (!DASHBOARD_TEXT_CHANNEL_IDS.includes(messageOrData.channelId)) return false;
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

function upsertDashboardMessages(newMessages) {
  const byId = new Map(dashboardTextMessages.map((message) => [message.id, message]));

  for (const message of newMessages) {
    if (shouldIncludeDashboardTextMessage(message)) {
      byId.set(message.id, message);
    }
  }

  dashboardTextMessages = [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
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

async function fetchHistoricalMessages(channel, maxMessages = MAX_HISTORY_MESSAGES, predicate = shouldIncludeMessage) {
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

  return allMessages.map(normalizeMessage).filter(predicate);
}

async function resolveDashboardChannels() {
  const warnings = [];
  const text = [];
  const voice = [];

  if (DASHBOARD_TEXT_CHANNEL_IDS.length === 0) {
    warnings.push('DASHBOARD_TEXT_CHANNEL_IDS is not configured');
  }

  if (DASHBOARD_VOICE_CHANNEL_IDS.length === 0) {
    warnings.push('DASHBOARD_VOICE_CHANNEL_IDS is not configured');
  }

  for (const channelId of DASHBOARD_TEXT_CHANNEL_IDS) {
    try {
      const channel = await discordClient.channels.fetch(channelId);

      if (!isReadableMessageChannel(channel)) {
        warnings.push(`Dashboard text channel ${channelId} is not a readable text channel`);
        continue;
      }

      text.push(createChannelSnapshot(channel, channelId));
    } catch (error) {
      warnings.push(`Could not fetch dashboard text channel ${channelId}: ${error.message}`);
    }
  }

  for (const channelId of DASHBOARD_VOICE_CHANNEL_IDS) {
    try {
      const channel = await discordClient.channels.fetch(channelId);

      if (!channel || channel.type !== ChannelType.GuildVoice) {
        warnings.push(`Dashboard voice channel ${channelId} is not a voice channel`);
        continue;
      }

      voice.push(createChannelSnapshot(channel, channelId));
    } catch (error) {
      warnings.push(`Could not fetch dashboard voice channel ${channelId}: ${error.message}`);
    }
  }

  dashboardChannels = { text, voice };
  return warnings;
}

async function fetchDashboardHistoricalMessages() {
  const warnings = [];
  const fetched = [];

  for (const channelInfo of dashboardChannels.text) {
    try {
      const channel = await discordClient.channels.fetch(channelInfo.id);
      ensureChannelPermissions(channel);
      const messages = await fetchHistoricalMessages(channel, DASHBOARD_MAX_HISTORY_MESSAGES_PER_CHANNEL, shouldIncludeDashboardTextMessage);
      fetched.push(...messages.map((message) => ({ ...message, channelName: channel.name })));
    } catch (error) {
      warnings.push(`Could not load dashboard messages for ${channelInfo.id}: ${error.message}`);
    }
  }

  upsertDashboardMessages(fetched);
  return warnings;
}

async function collectDashboardVoiceStates() {
  const states = [];

  for (const channelInfo of dashboardChannels.voice) {
    const channel = await discordClient.channels.fetch(channelInfo.id);
    if (!channel?.members) continue;

    for (const member of channel.members.values()) {
      states.push({
        userId: member.id,
        user: createUserSnapshot(member, member.id),
        channel: createChannelSnapshot(channel, channel.id),
      });
    }
  }

  return states;
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

function getDashboardWarnings() {
  const warnings = [];

  if (DASHBOARD_TEXT_CHANNEL_IDS.length === 0) {
    warnings.push('DASHBOARD_TEXT_CHANNEL_IDS is not configured');
  }

  if (DASHBOARD_VOICE_CHANNEL_IDS.length === 0) {
    warnings.push('DASHBOARD_VOICE_CHANNEL_IDS is not configured');
  }

  return warnings;
}

function getRangeWindow(range = '7d', now = new Date()) {
  const end = now.getTime();
  const rangeKey = ['24h', '7d', '30d', 'all'].includes(range) ? range : '7d';
  const durations = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };

  return {
    range: rangeKey,
    start: rangeKey === 'all' ? null : end - durations[rangeKey],
    end,
    bucket: rangeKey === '24h' ? 'hour' : rangeKey === 'all' ? 'week' : 'day',
  };
}

function isWithinRange(timestamp, window) {
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return false;
  if (window.start && time < window.start) return false;
  return time <= window.end;
}

function getBucketKey(timestamp, bucket) {
  const date = new Date(timestamp);

  if (bucket === 'hour') {
    date.setMinutes(0, 0, 0);
    return date.toISOString();
  }

  if (bucket === 'week') {
    const day = date.getUTCDay();
    const diff = date.getUTCDate() - day;
    date.setUTCDate(diff);
  }

  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function filterDashboardMessages({ range = '7d', channelId, userId } = {}) {
  const window = getRangeWindow(range);

  return dashboardTextMessages.filter((message) => {
    if (!isWithinRange(message.createdAt || message.timestamp, window)) return false;
    if (channelId && !DASHBOARD_TEXT_CHANNEL_IDS.includes(channelId)) return true;
    if (channelId && message.channelId !== channelId) return false;
    if (userId && message.author.id !== userId) return false;
    return true;
  });
}

function filterVoiceSessions({ range = '7d', channelId, userId } = {}) {
  const window = getRangeWindow(range);
  const now = new Date(window.end).toISOString();

  return activityStore.getSessions().filter((session) => {
    const leftAt = session.leftAt || now;
    const overlapsRange = (!window.start || new Date(leftAt).getTime() >= window.start) &&
      new Date(session.joinedAt).getTime() <= window.end;

    if (!overlapsRange) return false;
    if (channelId && !DASHBOARD_VOICE_CHANNEL_IDS.includes(channelId)) return true;
    if (channelId && session.channelId !== channelId) return false;
    if (userId && session.userId !== userId) return false;
    return true;
  });
}

function buildTextMetrics({ range = '7d', channelId, userId } = {}) {
  const window = getRangeWindow(range);
  const messages = filterDashboardMessages({ range, channelId, userId });
  const users = new Map();
  const channels = new Map();
  const buckets = new Map();
  const words = new Map();
  const hours = new Map();

  for (const message of messages) {
    users.set(message.author.id, incrementAggregate(users.get(message.author.id), message.author));
    channels.set(message.channelId, incrementAggregate(channels.get(message.channelId), {
      id: message.channelId,
      name: message.channelName || message.channelId,
    }));

    const bucketKey = getBucketKey(message.createdAt, window.bucket);
    buckets.set(bucketKey, (buckets.get(bucketKey) || 0) + 1);

    const hour = new Date(message.createdAt).getHours();
    hours.set(hour, (hours.get(hour) || 0) + 1);

    for (const word of extractWords(message.content)) {
      words.set(word, (words.get(word) || 0) + 1);
    }
  }

  const days = range === '24h' ? 1 : range === '30d' ? 30 : range === '7d' ? 7 : Math.max(1, countDistinctDays(messages));

  return {
    range: window.range,
    generatedAt: new Date().toISOString(),
    warnings: getDashboardWarnings(),
    totalMessages: messages.length,
    activeTextUsers: users.size,
    avgMessagesPerDay: messages.length / days,
    mostActiveTextChannel: firstRank(channels),
    peakTextHour: firstHour(hours),
    messageSeries: mapToSeries(buckets, 'messages'),
    topTextUsers: rankMap(users),
    topTextChannels: rankMap(channels),
    frequentWords: rankWords(words),
    excludedBotMessages: 0,
  };
}

function buildVoiceMetrics({ range = '7d', channelId, userId } = {}) {
  const window = getRangeWindow(range);
  const sessions = filterVoiceSessions({ range, channelId, userId });
  const users = new Map();
  const channels = new Map();
  const userChannelDurations = new Map();
  const buckets = new Map();
  const recentSessions = [];
  let totalDurationMs = 0;

  for (const session of sessions) {
    const durationMs = getClampedDuration(session, window);
    totalDurationMs += durationMs;
    addDuration(users, session.userId, session.user, durationMs);
    addDuration(channels, session.channelId, session.channel, durationMs);
    addDuration(userChannelDurations, `${session.userId}:${session.channelId}`, {
      user: session.user,
      channel: session.channel,
    }, durationMs);

    const bucketKey = getBucketKey(session.joinedAt, window.bucket);
    buckets.set(bucketKey, (buckets.get(bucketKey) || 0) + Math.round(durationMs / 60000));
    recentSessions.push({ ...session, durationMs });
  }

  return {
    range: window.range,
    generatedAt: new Date().toISOString(),
    warnings: getDashboardWarnings(),
    totalVoiceDurationMs: totalDurationMs,
    activeVoiceUsers: users.size,
    mostUsedVoiceChannel: firstDurationRank(channels),
    avgVoiceUsers: calculateAverageVoiceUsers(sessions, window),
    voiceMinutesSeries: mapToSeries(buckets, 'voiceMinutes'),
    topVoiceUsers: rankDurationMap(users),
    topVoiceChannels: rankDurationMap(channels),
    topUserByChannel: rankDurationMap(userChannelDurations),
    recentVoiceSessions: recentSessions
      .sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())
      .slice(0, 10),
  };
}

function buildDashboardSummary({ range = '7d', channelId, userId } = {}) {
  const text = buildTextMetrics({ range, channelId, userId });
  const voice = buildVoiceMetrics({ range, channelId, userId });
  const combined = new Map();

  for (const user of text.topTextUsers) {
    const existing = combined.get(user.id) || { ...user, messages: 0, voiceDurationMs: 0, score: 0 };
    existing.messages += user.count;
    existing.score += user.count;
    combined.set(user.id, existing);
  }

  for (const user of voice.topVoiceUsers) {
    const existing = combined.get(user.id) || { id: user.id, label: user.label, item: user.item, messages: 0, voiceDurationMs: 0, score: 0 };
    existing.voiceDurationMs += user.durationMs;
    existing.score += Math.floor(user.durationMs / (5 * 60 * 1000));
    combined.set(user.id, existing);
  }

  const activitySeries = mergeSeries(text.messageSeries, voice.voiceMinutesSeries);

  return {
    range: text.range,
    generatedAt: new Date().toISOString(),
    warnings: [...new Set([...text.warnings, ...voice.warnings])],
    kpis: {
      totalMessages: text.totalMessages,
      activeTextUsers: text.activeTextUsers,
      mostActiveTextChannel: text.mostActiveTextChannel,
      peakTextHour: text.peakTextHour,
      avgMessagesPerDay: text.avgMessagesPerDay,
      totalVoiceDurationMs: voice.totalVoiceDurationMs,
      activeVoiceUsers: voice.activeVoiceUsers,
      mostUsedVoiceChannel: voice.mostUsedVoiceChannel,
      avgVoiceUsers: voice.avgVoiceUsers,
    },
    topCombinedUsers: [...combined.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10),
    activitySeries,
  };
}

function incrementAggregate(existing, item) {
  return {
    id: item.id,
    label: item.displayName || item.name || item.username || item.id,
    item,
    count: (existing?.count || 0) + 1,
  };
}

function addDuration(map, id, item, durationMs) {
  const existing = map.get(id) || {
    id,
    label: item.displayName || item.name || item.username || id,
    item,
    durationMs: 0,
  };
  existing.durationMs += durationMs;
  map.set(id, existing);
}

function rankMap(map) {
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 10);
}

function rankDurationMap(map) {
  return [...map.values()].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
}

function firstRank(map) {
  return rankMap(map)[0] || null;
}

function firstDurationRank(map) {
  return rankDurationMap(map)[0] || null;
}

function firstHour(map) {
  const [hour, count] = [...map.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return hour === undefined ? null : { hour, count };
}

function mapToSeries(map, key) {
  return [...map.entries()]
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([bucket, value]) => ({ bucket, [key]: value }));
}

function mergeSeries(messageSeries, voiceSeries) {
  const byBucket = new Map();

  for (const item of messageSeries) {
    byBucket.set(item.bucket, { bucket: item.bucket, messages: item.messages || 0, voiceMinutes: 0 });
  }

  for (const item of voiceSeries) {
    const existing = byBucket.get(item.bucket) || { bucket: item.bucket, messages: 0, voiceMinutes: 0 };
    existing.voiceMinutes = item.voiceMinutes || 0;
    byBucket.set(item.bucket, existing);
  }

  return [...byBucket.values()].sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime());
}

function extractWords(content) {
  const stopwords = new Set(['que', 'para', 'por', 'con', 'los', 'las', 'una', 'uno', 'del', 'the', 'and', 'you', 'http', 'https']);
  return String(content || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .match(/[a-záéíóúñ0-9]{3,}/gi)
    ?.filter((word) => !stopwords.has(word)) || [];
}

function rankWords(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));
}

function countDistinctDays(messages) {
  return new Set(messages.map((message) => getBucketKey(message.createdAt, 'day'))).size;
}

function getClampedDuration(session, window) {
  const start = Math.max(new Date(session.joinedAt).getTime(), window.start || 0);
  const end = Math.min(new Date(session.leftAt || window.end).getTime(), window.end);
  return Math.max(0, end - start);
}

function calculateAverageVoiceUsers(sessions, window) {
  if (!window.start) return 0;

  const totalUserMs = sessions.reduce((sum, session) => sum + getClampedDuration(session, window), 0);
  return totalUserMs / (window.end - window.start);
}

discordClient.once('ready', async () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
  discordStatus.ready = true;

  try {
    await activityStore.init();

    const channel = await resolveConfiguredChannel();
    discordStatus.channelName = channel.name;
    discordStatus.error = null;

    console.log(`Fetching up to ${MAX_HISTORY_MESSAGES} messages from #${channel.name} (${channel.id})`);
    const historicalMessages = await fetchHistoricalMessages(channel);
    upsertMessages(historicalMessages);

    discordStatus.lastFetchAt = new Date().toISOString();
    io.emit('initialMessages', messagesData);
    console.log(`Loaded ${messagesData.length} messages from Discord`);

    const dashboardWarnings = await resolveDashboardChannels();
    const dashboardFetchWarnings = await fetchDashboardHistoricalMessages();
    const activeVoiceStates = await collectDashboardVoiceStates();
    await activityStore.reconcileActiveVoiceStates(activeVoiceStates);

    for (const warning of [...dashboardWarnings, ...dashboardFetchWarnings]) {
      console.warn(`[dashboard] ${warning}`);
    }

    io.emit('dashboardUpdate', buildDashboardSummary({ range: '7d' }));
  } catch (error) {
    discordStatus.error = error.message;
    console.error('Could not load Discord messages:', error);
  }
});

discordClient.on('messageCreate', (message) => {
  const messageData = normalizeMessage(message);

  if (shouldIncludeMessage(messageData)) {
    upsertMessages([messageData]);
    io.emit('messageUpdate', messageData);
  }

  if (shouldIncludeDashboardTextMessage(messageData)) {
    upsertDashboardMessages([messageData]);
    io.emit('dashboardUpdate', buildDashboardSummary({ range: '7d' }));
  }
});

discordClient.on('messageUpdate', (_oldMessage, newMessage) => {
  if (newMessage.partial || !newMessage.author) return;

  const messageData = normalizeMessage(newMessage);

  if (shouldIncludeMessage(messageData)) {
    upsertMessages([messageData]);
    io.emit('messageUpdate', messageData);
  }

  if (shouldIncludeDashboardTextMessage(messageData)) {
    upsertDashboardMessages([messageData]);
    io.emit('dashboardUpdate', buildDashboardSummary({ range: '7d' }));
  }
});

discordClient.on('voiceStateUpdate', async (oldState, newState) => {
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;
  const relevant = DASHBOARD_VOICE_CHANNEL_IDS.includes(oldChannelId) ||
    DASHBOARD_VOICE_CHANNEL_IDS.includes(newChannelId);

  if (!relevant) return;

  try {
    await activityStore.recordVoiceTransition({ oldState, newState });
    io.emit('dashboardUpdate', buildDashboardSummary({ range: '7d' }));
  } catch (error) {
    console.error('Error recording voice activity:', error);
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/status', (_req, res) => {
  res.json(discordStatus);
});

app.get('/api/otaku/backgrounds', (_req, res) => {
  const images = listImageFiles(IMAGES_DIR).map((fileName) => ({
    fileName,
    url: `/images/${encodeURIComponent(fileName)}`,
  }));

  res.json({ images });
});

app.get('/api/dashboard/channels', (_req, res) => {
  res.json({
    text: dashboardChannels.text,
    voice: dashboardChannels.voice,
    warnings: getDashboardWarnings(),
  });
});

app.get('/api/dashboard/summary', (req, res) => {
  res.json(buildDashboardSummary({
    range: String(req.query.range || '7d'),
    channelId: String(req.query.channelId || ''),
    userId: String(req.query.userId || ''),
  }));
});

app.get('/api/dashboard/text', (req, res) => {
  res.json(buildTextMetrics({
    range: String(req.query.range || '7d'),
    channelId: String(req.query.channelId || ''),
    userId: String(req.query.userId || ''),
  }));
});

app.get('/api/dashboard/voice', (req, res) => {
  res.json(buildVoiceMetrics({
    range: String(req.query.range || '7d'),
    channelId: String(req.query.channelId || ''),
    userId: String(req.query.userId || ''),
  }));
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

    await resolveDashboardChannels();
    await fetchDashboardHistoricalMessages();

    io.emit('initialMessages', messagesData);
    io.emit('dashboardUpdate', buildDashboardSummary({ range: '7d' }));
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
