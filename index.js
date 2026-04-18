// ============================================================
//  DISCORD BOT — SINGLE FILE
//  All commands, events, and utilities in one index.js
// ============================================================
'use strict';

require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, Collection,
  REST, Routes, SlashCommandBuilder, EmbedBuilder,
  PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, AuditLogEvent,
} = require('discord.js');
const https = require('https');
const os    = require('os');

// ─────────────────────────────────────────────────────────────
//  CLIENT
// ─────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildEmojisAndStickers, GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.Reaction, Partials.User],
});

client.commands      = new Collection();
client.prefixCmds    = new Collection();
client.aliases       = new Collection();
client.cooldowns     = new Collection();
client.autoResponders = new Collection();
client.snipes        = new Map();

const PREFIX = process.env.PREFIX || '!';

// ─────────────────────────────────────────────────────────────
//  DATABASE — MONGOOSE
// ─────────────────────────────────────────────────────────────
const mongoose = require('mongoose');

async function connectDB() {
  if (!process.env.MONGO_URI) {
    console.warn('[DB] No MONGO_URI set — using in-memory storage (data will reset on restart)');
    return;
  }
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[DB] Connected to MongoDB');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    console.warn('[DB] Falling back to in-memory storage');
  }
}

const isConnected = () => mongoose.connection.readyState === 1;

// ── Schemas ───────────────────────────────────────────────────
const warnSchema = new mongoose.Schema({
  guildId : String,
  userId  : String,
  warns   : [{ reason: String, moderator: String, at: String }],
});
const WarnModel = mongoose.model('Warn', warnSchema);

const ecoSchema = new mongoose.Schema({
  guildId   : String,
  userId    : String,
  wallet    : { type: Number, default: 0 },
  bank      : { type: Number, default: 0 },
  lastDaily : { type: Number, default: 0 },
  lastWork  : { type: Number, default: 0 },
});
const EcoModel = mongoose.model('Economy', ecoSchema);

const levelSchema = new mongoose.Schema({
  guildId  : { type: String, required: true },
  userId   : { type: String, required: true },
  xp       : { type: Number, default: 0 },   // XP within current level
  level    : { type: Number, default: 0 },
  totalXp  : { type: Number, default: 0 },   // cumulative XP ever
  messages : { type: Number, default: 0 },
});
// compound index for fast lookups
// levelSchema.index({ guildId: 1, userId: 1 }, { unique: true });
const LevelModel = mongoose.model('Level', levelSchema);

const levelCfgSchema = new mongoose.Schema({
  guildId : String,
  config  : { type: mongoose.Schema.Types.Mixed, default: {} },
});
const LevelCfgModel = mongoose.model('LevelConfig', levelCfgSchema);

const guildCfgSchema = new mongoose.Schema({
  guildId : String,
  config  : { type: mongoose.Schema.Types.Mixed, default: {} },
});
const GuildCfgModel = mongoose.model('GuildConfig', guildCfgSchema);

const tzSchema = new mongoose.Schema({ userId: String, timezone: String });
const TzModel = mongoose.model('Timezone', tzSchema);

const arSchema = new mongoose.Schema({
  guildId  : String,
  triggers : [{ trigger: String, response: String }],
});
const ARModel = mongoose.model('AutoResponder', arSchema);

// ── DB Warn helpers (override in-memory ones) ─────────────────
async function dbGetWarns(guildId, userId) {
  if (!isConnected()) return getWarns(guildId, userId);
  const doc = await WarnModel.findOne({ guildId, userId });
  return doc?.warns ?? [];
}
async function dbAddWarn(guildId, userId, reason, moderator) {
  if (!isConnected()) return addWarn(guildId, userId, reason, moderator);
  const doc = await WarnModel.findOneAndUpdate(
    { guildId, userId },
    { $push: { warns: { reason, moderator, at: new Date().toISOString() } } },
    { new: true, upsert: true }
  );
  return doc.warns.length;
}
async function dbClearWarns(guildId, userId) {
  if (!isConnected()) return clearWarns(guildId, userId);
  await WarnModel.findOneAndUpdate({ guildId, userId }, { $set: { warns: [] } }, { upsert: true });
}
async function dbRemoveWarn(guildId, userId, index) {
  if (!isConnected()) return removeWarn(guildId, userId, index);
  const doc = await WarnModel.findOne({ guildId, userId });
  if (!doc) return null;
  const removed = doc.warns.splice(index, 1)[0];
  await doc.save();
  return removed;
}

// ── DB Economy helpers ────────────────────────────────────────
async function dbGetUser(guildId, userId) {
  if (!isConnected()) return getUser(guildId, userId);
  let doc = await EcoModel.findOne({ guildId, userId });
  if (!doc) doc = await EcoModel.create({ guildId, userId });
  return doc;
}
async function dbSaveUser(doc) {
  if (!isConnected()) return;
  await doc.save();
}

// ── DB Level helpers ──────────────────────────────────────────
async function dbGetLevelUser(guildId, userId) {
  if (!isConnected()) return getLevelUser(guildId, userId);
  let doc = await LevelModel.findOne({ guildId, userId });
  if (!doc) doc = await LevelModel.create({ guildId, userId });
  return doc;
}
async function dbGetLeaderboard(guildId, limit = 10) {
  if (!isConnected()) return getLeaderboard(guildId, limit);
  const docs = await LevelModel.find({ guildId }).sort({ totalXp: -1 }).limit(limit);
  return docs.map((d, i) => ({ rank: i + 1, userId: d.userId, xp: d.xp, level: d.level, totalXp: d.totalXp, messages: d.messages }));
}
async function dbAwardXp(guildId, userId) {
  if (!isConnected()) return awardXp(guildId, userId);
  const cfg = getLevelConfig(guildId);
  if (!cfg.enabled || isOnCooldown(guildId, userId)) return null;
  _xpCooldowns.set(`${guildId}-${userId}`, Date.now());
  const gain = Math.floor(Math.random() * (cfg.xpMax - cfg.xpMin + 1)) + cfg.xpMin;
  let doc = await LevelModel.findOne({ guildId, userId });
  if (!doc) doc = await LevelModel.create({ guildId, userId, xp: 0, level: 0, totalXp: 0, messages: 0 });
  const old = doc.level;
  doc.totalXp += gain;
  doc.messages++;
  const nw = levelFromXp(doc.totalXp);
  doc.level = nw;
  // xp = XP within current level (for progress bar)
  let xpInLevel = doc.totalXp;
  for (let i = 0; i < nw; i++) xpInLevel -= xpForLevel(i);
  doc.xp = xpInLevel;
  await doc.save();
  if (nw > old) return { leveledUp: true, oldLevel: old, newLevel: nw };
  return { leveledUp: false };
}

// ── DB Guild config helpers ───────────────────────────────────
async function dbGetGuildConfig(guildId) {
  if (!isConnected()) return getGuildConfig(guildId);
  let doc = await GuildCfgModel.findOne({ guildId });
  if (!doc) doc = await GuildCfgModel.create({ guildId, config: { ...CONFIG_DEFAULTS } });
  return doc.config;
}
async function dbSetGuildConfig(guildId, key, value) {
  if (!isConnected()) return setGuildConfig(guildId, key, value);
  await GuildCfgModel.findOneAndUpdate(
    { guildId },
    { $set: { [`config.${key}`]: value } },
    { upsert: true }
  );
}

// ── DB Timezone helpers ───────────────────────────────────────
async function dbSetTz(userId, tz) {
  if (!isConnected()) return setTz(userId, tz);
  const ok = setTz(userId, tz); // validate
  if (!ok) return false;
  await TzModel.findOneAndUpdate({ userId }, { timezone: tz }, { upsert: true });
  return true;
}
async function dbGetTz(userId) {
  if (!isConnected()) return getTz(userId);
  const doc = await TzModel.findOne({ userId });
  return doc?.timezone ?? null;
}
async function dbRemoveTz(userId) {
  if (!isConnected()) return removeTz(userId);
  await TzModel.deleteOne({ userId });
  removeTz(userId);
}

// ── DB AutoResponder helpers ──────────────────────────────────
async function dbLoadAutoResponders() {
  if (!isConnected()) return;
  const docs = await ARModel.find();
  for (const doc of docs) {
    const map = new Map(doc.triggers.map(t => [t.trigger, t.response]));
    client.autoResponders.set(doc.guildId, map);
  }
  console.log(`[DB] Loaded auto-responders for ${docs.length} guild(s)`);
}
async function dbSaveAR(guildId) {
  if (!isConnected()) return;
  const ar = client.autoResponders.get(guildId);
  if (!ar) return;
  const triggers = [...ar.entries()].map(([trigger, response]) => ({ trigger, response }));
  await ARModel.findOneAndUpdate({ guildId }, { triggers }, { upsert: true });
}


// ─────────────────────────────────────────────────────────────
//  UTILS — EMBEDS
// ─────────────────────────────────────────────────────────────
const COLORS = { success:0x57F287, error:0xED4245, warn:0xFEE75C, info:0x5865F2, neutral:0x2B2D31 };
const successEmbed = (d,t) => { const e=new EmbedBuilder().setColor(COLORS.success).setDescription(`✅ ${d}`); if(t)e.setTitle(t); return e; };
const errorEmbed   = (d,t) => { const e=new EmbedBuilder().setColor(COLORS.error).setDescription(`❌ ${d}`);   if(t)e.setTitle(t); return e; };
const warnEmbed    = (d,t) => { const e=new EmbedBuilder().setColor(COLORS.warn).setDescription(`⚠️ ${d}`);   if(t)e.setTitle(t); return e; };
const infoEmbed    = (d,t) => { const e=new EmbedBuilder().setColor(COLORS.info).setDescription(d);           if(t)e.setTitle(t); return e; };

// ─────────────────────────────────────────────────────────────
//  UTILS — GUILD CONFIG
// ─────────────────────────────────────────────────────────────
const _configs = new Map();
const CONFIG_DEFAULTS = { ownerRoleId:null, coOwnerRoleId:null, modLogChannel:null, welcomeChannel:null, welcomeMessage:'Welcome {user} to {server}!', muteRoleId:null, prefix:'!', antiSpam:false, antiLink:false, lockdownMode:false, suggestChannel:null, ticketSupportRole:null };
const getGuildConfig   = id => { if(!_configs.has(id)) _configs.set(id,{...CONFIG_DEFAULTS}); return _configs.get(id); };
const setGuildConfig   = (id,k,v) => { getGuildConfig(id)[k]=v; };

// ─────────────────────────────────────────────────────────────
//  UTILS — WARN STORE
// ─────────────────────────────────────────────────────────────
const _warns = new Map();
const getWarns    = (g,u) => { if(!_warns.has(g))_warns.set(g,new Map()); const m=_warns.get(g); if(!m.has(u))m.set(u,[]); return m.get(u); };
const addWarn     = (g,u,reason,mod) => { const l=getWarns(g,u); l.push({reason,moderator:mod,at:new Date().toISOString()}); return l.length; };
const clearWarns  = (g,u) => { _warns.get(g)?.delete(u); };
const removeWarn  = (g,u,i) => { const l=getWarns(g,u); return l.splice(i,1)[0]; };

// ─────────────────────────────────────────────────────────────
//  UTILS — LOG SYSTEM
// ─────────────────────────────────────────────────────────────
const _logCfg = new Map();
const LOG_TYPES = ['messagelog','modlog','adminlog','reactionlog','voicelog'];
const getLogConfig    = g => { if(!_logCfg.has(g))_logCfg.set(g,{}); return _logCfg.get(g); };
const setLogChannel   = (g,t,id) => { getLogConfig(g)[t]=id; };
const getLogChannel   = (g,t) => getLogConfig(g)[t]??null;
const clearLogChannel = (g,t) => { delete getLogConfig(g)[t]; };
const sendLog = async (g,type,embed) => {
  const chId = getLogChannel(g,type);
  if(!chId) return;
  const ch = client.channels.cache.get(chId);
  if(ch) await ch.send({embeds:[embed]}).catch(()=>{});
};

// ─────────────────────────────────────────────────────────────
//  UTILS — LEVEL SYSTEM
// ─────────────────────────────────────────────────────────────
const _userXP      = new Map();
const _levelConfig = new Map();
const _xpCooldowns = new Map();
const LEVEL_DEFAULTS = { enabled:true, xpMin:15, xpMax:25, cooldown:60, levelUpChannel:null, levelUpMessage:'🎉 {user} just reached **level {level}**!', stackRoles:false, ignoredChannels:[], ignoredRoles:[], levelRoles:{}, dmOnLevelUp:false };
const getLevelConfig    = g => { if(!_levelConfig.has(g))_levelConfig.set(g,{...LEVEL_DEFAULTS,levelRoles:{},ignoredChannels:[],ignoredRoles:[]}); return _levelConfig.get(g); };
const setLevelConfigVal = (g,k,v) => { getLevelConfig(g)[k]=v; };
const xpForLevel        = l => 5*(l**2)+50*l+100;
const levelFromXp       = xp => { let l=0; while(xp>=xpForLevel(l)){xp-=xpForLevel(l);l++;} return l; };
const getLevelUser      = (g,u) => { if(!_userXP.has(g))_userXP.set(g,new Map()); const m=_userXP.get(g); if(!m.has(u))m.set(u,{xp:0,level:0,totalXp:0,messages:0}); return m.get(u); };
const getLevelRoles     = g => getLevelConfig(g).levelRoles;
const setLevelRole      = (g,l,r) => { getLevelConfig(g).levelRoles[l]=r; };
const removeLevelRole   = (g,l) => { delete getLevelConfig(g).levelRoles[l]; };
const setUserXpVal      = (g,u,xp) => { const d=getLevelUser(g,u); d.totalXp=Math.max(0,xp); d.xp=d.totalXp; d.level=levelFromXp(d.totalXp); };
const addUserXpVal      = (g,u,xp) => { const d=getLevelUser(g,u); d.totalXp=Math.max(0,d.totalXp+xp); d.xp=d.totalXp; d.level=levelFromXp(d.totalXp); };
const resetUserXp       = (g,u) => { _userXP.get(g)?.set(u,{xp:0,level:0,totalXp:0,messages:0}); };
const resetAllXp        = g => { _userXP.set(g,new Map()); };
const getLeaderboard    = (g,lim=10) => { const m=_userXP.get(g); if(!m)return []; return [...m.entries()].sort(([,a],[,b])=>b.totalXp-a.totalXp).slice(0,lim).map(([uid,d],i)=>({rank:i+1,userId:uid,...d})); };
const isOnCooldown      = (g,u) => { const k=`${g}-${u}`, last=_xpCooldowns.get(k); return last&&(Date.now()-last)<getLevelConfig(g).cooldown*1000; };
const awardXp = (g,u) => {
  const cfg=getLevelConfig(g);
  if(!cfg.enabled||isOnCooldown(g,u)) return null;
  _xpCooldowns.set(`${g}-${u}`,Date.now());
  const gain=Math.floor(Math.random()*(cfg.xpMax-cfg.xpMin+1))+cfg.xpMin;
  const d=getLevelUser(g,u);
  const old=d.level;
  d.totalXp+=gain; d.messages++;
  const nw=levelFromXp(d.totalXp);
  d.level=nw;
  // xp = XP within current level
  let xpInLevel=d.totalXp;
  for(let i=0;i<nw;i++) xpInLevel-=xpForLevel(i);
  d.xp=xpInLevel;
  if(nw>old) return {leveledUp:true,oldLevel:old,newLevel:nw};
  return {leveledUp:false};
};
const progressBar = (cur,tot,len=14) => {
  if(!tot||tot<=0) return '░'.repeat(len)+' 0%';
  const pct=Math.min(1,Math.max(0,cur/tot));
  const f=Math.round(pct*len);
  return '█'.repeat(f)+'░'.repeat(len-f)+` ${Math.round(pct*100)}%`;
};

// ─────────────────────────────────────────────────────────────
//  UTILS — TIMEZONE STORE
// ─────────────────────────────────────────────────────────────
const _tzMap = new Map();
const COMMON_ZONES = ["Africa/Abidjan", "Africa/Accra", "Africa/Addis_Ababa", "Africa/Algiers", "Africa/Asmera", "Africa/Bamako", "Africa/Bangui", "Africa/Banjul", "Africa/Bissau", "Africa/Blantyre", "Africa/Brazzaville", "Africa/Bujumbura", "Africa/Cairo", "Africa/Casablanca", "Africa/Ceuta", "Africa/Conakry", "Africa/Dakar", "Africa/Dar_es_Salaam", "Africa/Djibouti", "Africa/Douala", "Africa/El_Aaiun", "Africa/Freetown", "Africa/Gaborone", "Africa/Harare", "Africa/Johannesburg", "Africa/Juba", "Africa/Kampala", "Africa/Khartoum", "Africa/Kigali", "Africa/Kinshasa", "Africa/Lagos", "Africa/Libreville", "Africa/Lome", "Africa/Luanda", "Africa/Lubumbashi", "Africa/Lusaka", "Africa/Malabo", "Africa/Maputo", "Africa/Maseru", "Africa/Mbabane", "Africa/Mogadishu", "Africa/Monrovia", "Africa/Nairobi", "Africa/Ndjamena", "Africa/Niamey", "Africa/Nouakchott", "Africa/Ouagadougou", "Africa/Porto-Novo", "Africa/Sao_Tome", "Africa/Tripoli", "Africa/Tunis", "Africa/Windhoek", "America/Adak", "America/Anchorage", "America/Anguilla", "America/Antigua", "America/Araguaina", "America/Argentina/La_Rioja", "America/Argentina/Rio_Gallegos", "America/Argentina/Salta", "America/Argentina/San_Juan", "America/Argentina/San_Luis", "America/Argentina/Tucuman", "America/Argentina/Ushuaia", "America/Aruba", "America/Asuncion", "America/Bahia", "America/Bahia_Banderas", "America/Barbados", "America/Belem", "America/Belize", "America/Blanc-Sablon", "America/Boa_Vista", "America/Bogota", "America/Boise", "America/Buenos_Aires", "America/Cambridge_Bay", "America/Campo_Grande", "America/Cancun", "America/Caracas", "America/Catamarca", "America/Cayenne", "America/Cayman", "America/Chicago", "America/Chihuahua", "America/Ciudad_Juarez", "America/Coral_Harbour", "America/Cordoba", "America/Costa_Rica", "America/Coyhaique", "America/Creston", "America/Cuiaba", "America/Curacao", "America/Danmarkshavn", "America/Dawson", "America/Dawson_Creek", "America/Denver", "America/Detroit", "America/Dominica", "America/Edmonton", "America/Eirunepe", "America/El_Salvador", "America/Fort_Nelson", "America/Fortaleza", "America/Glace_Bay", "America/Godthab", "America/Goose_Bay", "America/Grand_Turk", "America/Grenada", "America/Guadeloupe", "America/Guatemala", "America/Guayaquil", "America/Guyana", "America/Halifax", "America/Havana", "America/Hermosillo", "America/Indiana/Knox", "America/Indiana/Marengo", "America/Indiana/Petersburg", "America/Indiana/Tell_City", "America/Indiana/Vevay", "America/Indiana/Vincennes", "America/Indiana/Winamac", "America/Indianapolis", "America/Inuvik", "America/Iqaluit", "America/Jamaica", "America/Jujuy", "America/Juneau", "America/Kentucky/Monticello", "America/Kralendijk", "America/La_Paz", "America/Lima", "America/Los_Angeles", "America/Louisville", "America/Lower_Princes", "America/Maceio", "America/Managua", "America/Manaus", "America/Marigot", "America/Martinique", "America/Matamoros", "America/Mazatlan", "America/Mendoza", "America/Menominee", "America/Merida", "America/Metlakatla", "America/Mexico_City", "America/Miquelon", "America/Moncton", "America/Monterrey", "America/Montevideo", "America/Montserrat", "America/Nassau", "America/New_York", "America/Nome", "America/Noronha", "America/North_Dakota/Beulah", "America/North_Dakota/Center", "America/North_Dakota/New_Salem", "America/Ojinaga", "America/Panama", "America/Paramaribo", "America/Phoenix", "America/Port-au-Prince", "America/Port_of_Spain", "America/Porto_Velho", "America/Puerto_Rico", "America/Punta_Arenas", "America/Rankin_Inlet", "America/Recife", "America/Regina", "America/Resolute", "America/Rio_Branco", "America/Santarem", "America/Santiago", "America/Santo_Domingo", "America/Sao_Paulo", "America/Scoresbysund", "America/Sitka", "America/St_Barthelemy", "America/St_Johns", "America/St_Kitts", "America/St_Lucia", "America/St_Thomas", "America/St_Vincent", "America/Swift_Current", "America/Tegucigalpa", "America/Thule", "America/Tijuana", "America/Toronto", "America/Tortola", "America/Vancouver", "America/Whitehorse", "America/Winnipeg", "America/Yakutat", "Antarctica/Casey", "Antarctica/Davis", "Antarctica/DumontDUrville", "Antarctica/Macquarie", "Antarctica/Mawson", "Antarctica/McMurdo", "Antarctica/Palmer", "Antarctica/Rothera", "Antarctica/Syowa", "Antarctica/Troll", "Antarctica/Vostok", "Arctic/Longyearbyen", "Asia/Aden", "Asia/Almaty", "Asia/Amman", "Asia/Anadyr", "Asia/Aqtau", "Asia/Aqtobe", "Asia/Ashgabat", "Asia/Atyrau", "Asia/Baghdad", "Asia/Bahrain", "Asia/Baku", "Asia/Bangkok", "Asia/Barnaul", "Asia/Beirut", "Asia/Bishkek", "Asia/Brunei", "Asia/Calcutta", "Asia/Chita", "Asia/Colombo", "Asia/Damascus", "Asia/Dhaka", "Asia/Dili", "Asia/Dubai", "Asia/Dushanbe", "Asia/Famagusta", "Asia/Gaza", "Asia/Hebron", "Asia/Hong_Kong", "Asia/Hovd", "Asia/Irkutsk", "Asia/Jakarta", "Asia/Jayapura", "Asia/Jerusalem", "Asia/Kabul", "Asia/Kamchatka", "Asia/Karachi", "Asia/Katmandu", "Asia/Khandyga", "Asia/Krasnoyarsk", "Asia/Kuala_Lumpur", "Asia/Kuching", "Asia/Kuwait", "Asia/Macau", "Asia/Magadan", "Asia/Makassar", "Asia/Manila", "Asia/Muscat", "Asia/Nicosia", "Asia/Novokuznetsk", "Asia/Novosibirsk", "Asia/Omsk", "Asia/Oral", "Asia/Phnom_Penh", "Asia/Pontianak", "Asia/Pyongyang", "Asia/Qatar", "Asia/Qostanay", "Asia/Qyzylorda", "Asia/Rangoon", "Asia/Riyadh", "Asia/Saigon", "Asia/Sakhalin", "Asia/Samarkand", "Asia/Seoul", "Asia/Shanghai", "Asia/Singapore", "Asia/Srednekolymsk", "Asia/Taipei", "Asia/Tashkent", "Asia/Tbilisi", "Asia/Tehran", "Asia/Thimphu", "Asia/Tokyo", "Asia/Tomsk", "Asia/Ulaanbaatar", "Asia/Urumqi", "Asia/Ust-Nera", "Asia/Vientiane", "Asia/Vladivostok", "Asia/Yakutsk", "Asia/Yekaterinburg", "Asia/Yerevan", "Atlantic/Azores", "Atlantic/Bermuda", "Atlantic/Canary", "Atlantic/Cape_Verde", "Atlantic/Faeroe", "Atlantic/Madeira", "Atlantic/Reykjavik", "Atlantic/South_Georgia", "Atlantic/St_Helena", "Atlantic/Stanley", "Australia/Adelaide", "Australia/Brisbane", "Australia/Broken_Hill", "Australia/Darwin", "Australia/Eucla", "Australia/Hobart", "Australia/Lindeman", "Australia/Lord_Howe", "Australia/Melbourne", "Australia/Perth", "Australia/Sydney", "Europe/Amsterdam", "Europe/Andorra", "Europe/Astrakhan", "Europe/Athens", "Europe/Belgrade", "Europe/Berlin", "Europe/Bratislava", "Europe/Brussels", "Europe/Bucharest", "Europe/Budapest", "Europe/Busingen", "Europe/Chisinau", "Europe/Copenhagen", "Europe/Dublin", "Europe/Gibraltar", "Europe/Guernsey", "Europe/Helsinki", "Europe/Isle_of_Man", "Europe/Istanbul", "Europe/Jersey", "Europe/Kaliningrad", "Europe/Kiev", "Europe/Kirov", "Europe/Lisbon", "Europe/Ljubljana", "Europe/London", "Europe/Luxembourg", "Europe/Madrid", "Europe/Malta", "Europe/Mariehamn", "Europe/Minsk", "Europe/Monaco", "Europe/Moscow", "Europe/Oslo", "Europe/Paris", "Europe/Podgorica", "Europe/Prague", "Europe/Riga", "Europe/Rome", "Europe/Samara", "Europe/San_Marino", "Europe/Sarajevo", "Europe/Saratov", "Europe/Simferopol", "Europe/Skopje", "Europe/Sofia", "Europe/Stockholm", "Europe/Tallinn", "Europe/Tirane", "Europe/Ulyanovsk", "Europe/Vaduz", "Europe/Vatican", "Europe/Vienna", "Europe/Vilnius", "Europe/Volgograd", "Europe/Warsaw", "Europe/Zagreb", "Europe/Zurich", "Indian/Antananarivo", "Indian/Chagos", "Indian/Christmas", "Indian/Cocos", "Indian/Comoro", "Indian/Kerguelen", "Indian/Mahe", "Indian/Maldives", "Indian/Mauritius", "Indian/Mayotte", "Indian/Reunion", "Pacific/Apia", "Pacific/Auckland", "Pacific/Bougainville", "Pacific/Chatham", "Pacific/Easter", "Pacific/Efate", "Pacific/Enderbury", "Pacific/Fakaofo", "Pacific/Fiji", "Pacific/Funafuti", "Pacific/Galapagos", "Pacific/Gambier", "Pacific/Guadalcanal", "Pacific/Guam", "Pacific/Honolulu", "Pacific/Kiritimati", "Pacific/Kosrae", "Pacific/Kwajalein", "Pacific/Majuro", "Pacific/Marquesas", "Pacific/Midway", "Pacific/Nauru", "Pacific/Niue", "Pacific/Norfolk", "Pacific/Noumea", "Pacific/Pago_Pago", "Pacific/Palau", "Pacific/Pitcairn", "Pacific/Ponape", "Pacific/Port_Moresby", "Pacific/Rarotonga", "Pacific/Saipan", "Pacific/Tahiti", "Pacific/Tarawa", "Pacific/Tongatapu", "Pacific/Truk", "Pacific/Wake", "Pacific/Wallis"];
const setTz = (u,tz) => { try { Intl.DateTimeFormat(undefined,{timeZone:tz}); _tzMap.set(u,tz); return true; } catch { return false; } };
const getTz = u => _tzMap.get(u)??null;
const removeTz = u => _tzMap.delete(u);
const getCurrentTime = tz => new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short',hour12:true}).format(new Date());
const getTzOffset = tz => { const d=new Date(),u=d.getTime(),l=new Date(d.toLocaleString('en-US',{timeZone:tz})).getTime(),off=Math.round((l-u)/60000),s=off>=0?'+':'-',a=Math.abs(off); return `UTC${s}${Math.floor(a/60).toString().padStart(2,'0')}:${(a%60).toString().padStart(2,'0')}`; };

// ─────────────────────────────────────────────────────────────
//  UTILS — AFK STORE
// ─────────────────────────────────────────────────────────────
const _afkMap = new Map();
const getAfkMap = g => { if(!_afkMap.has(g))_afkMap.set(g,new Map()); return _afkMap.get(g); };

// ─────────────────────────────────────────────────────────────
//  UTILS — EMBED STORE
// ─────────────────────────────────────────────────────────────
const _drafts    = new Map();
const _templates = new Map();
const blankDraft = () => ({title:null,description:null,color:'#5865F2',footer:null,footerIcon:null,author:null,authorIcon:null,authorUrl:null,thumbnail:null,image:null,url:null,timestamp:false,fields:[]});
const getDraft   = u => { if(!_drafts.has(u))_drafts.set(u,blankDraft()); return _drafts.get(u); };
const setDraft   = (u,d) => _drafts.set(u,d);
const clearDraft = u => _drafts.delete(u);
const getTemplateMap = g => { if(!_templates.has(g))_templates.set(g,new Map()); return _templates.get(g); };
const saveTemplate   = (g,n,d) => getTemplateMap(g).set(n.toLowerCase(),{...d,_savedAt:Date.now()});
const loadTemplate   = (g,n) => getTemplateMap(g).get(n.toLowerCase())??null;
const deleteTemplate = (g,n) => getTemplateMap(g).delete(n.toLowerCase());
const listTemplates  = g => [...getTemplateMap(g).entries()].map(([n,d])=>({name:n,...d}));
const toDiscordEmbed = d => {
  const e=new EmbedBuilder();
  if(d.title)e.setTitle(d.title);
  if(d.description)e.setDescription(d.description);
  if(d.color)e.setColor(d.color);
  if(d.url)e.setURL(d.url);
  if(d.image)e.setImage(d.image);
  if(d.thumbnail)e.setThumbnail(d.thumbnail);
  if(d.timestamp)e.setTimestamp();
  if(d.footer)e.setFooter({text:d.footer,iconURL:d.footerIcon??undefined});
  if(d.author)e.setAuthor({name:d.author,iconURL:d.authorIcon??undefined,url:d.authorUrl??undefined});
  if(d.fields?.length)e.addFields(d.fields.map(f=>({name:f.name,value:f.value,inline:f.inline??false})));
  return e;
};

// ─────────────────────────────────────────────────────────────
//  UTILS — COUNTING
// ─────────────────────────────────────────────────────────────
const _counting = new Map();

// ─────────────────────────────────────────────────────────────
//  UTILS — GIVEAWAYS
// ─────────────────────────────────────────────────────────────
const _giveaways = new Map();
const pickWinners = (entries,n) => [...entries].sort(()=>Math.random()-0.5).slice(0,Math.min(n,entries.length));
const gwEmbed = (prize,winners,endsAt,host,curWinners=[],ended=false) => {
  const e=new EmbedBuilder().setColor(ended?COLORS.neutral:0xFF73FA).setTitle(`🎁 ${ended?'[ENDED] ':''}${prize}`)
    .addFields({name:'🏆 Winners',value:`${winners}`,inline:true},{name:ended?'⏰ Ended':'⏰ Ends',value:`<t:${Math.floor(endsAt/1000)}:R>`,inline:true}).setTimestamp();
  if(host)e.addFields({name:'🎤 Hosted by',value:`<@${host}>`,inline:true});
  if(ended&&curWinners.length)e.addFields({name:'🎉 Winners',value:curWinners.map(w=>`<@${w}>`).join(', ')});
  return e;
};
const endGiveaway = async msgId => {
  const gw=_giveaways.get(msgId); if(!gw)return;
  const ch=client.channels.cache.get(gw.channelId); if(!ch)return;
  const msg=await ch.messages.fetch(msgId).catch(()=>null); if(!msg)return;
  const winners=pickWinners([...gw.entries],gw.winners);
  await msg.edit({embeds:[gwEmbed(gw.prize,gw.winners,gw.endsAt,gw.hostId,[...winners],true)],components:[]});
  if(winners.length) await ch.send({content:`🎉 Congratulations ${winners.map(w=>`<@${w}>`).join(', ')}! You won **${gw.prize}**!`});
  else await ch.send({content:`No valid entries for **${gw.prize}**.`});
};

// ─────────────────────────────────────────────────────────────
//  UTILS — TICKETS
// ─────────────────────────────────────────────────────────────
const _tickets = new Map();
let _ticketCounter = 0;
const parseDuration = str => { const m=str.match(/^(\d+)(s|m|h|d|w)$/); if(!m)return null; return parseInt(m[1])*{s:1000,m:60000,h:3600000,d:86400000,w:604800000}[m[2]]; };

// ─────────────────────────────────────────────────────────────
//  COMMANDS REGISTRY
// ─────────────────────────────────────────────────────────────
const COMMANDS = [];

function registerCommand(cmd) {
  if (cmd.data && cmd.execute) client.commands.set(cmd.data.name, cmd);
  if (cmd.name && cmd.run)    { client.prefixCmds.set(cmd.name, cmd); cmd.aliases?.forEach(a=>client.aliases.set(a,cmd.name)); }
  if (cmd.data) COMMANDS.push(cmd.data.toJSON());
}

// ─────────────────────────────────────────────────────────────
//  MODERATION COMMANDS
// ─────────────────────────────────────────────────────────────
registerCommand({
  userPermissions:[PermissionFlagsBits.KickMembers], cooldown:5,
  data: new SlashCommandBuilder().setName('kick').setDescription('Kick a member').setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason')),
  async execute(client,i) {
    const t=i.options.getMember('user'), r=i.options.getString('reason')??'No reason provided';
    if(!t)return i.reply({embeds:[errorEmbed('User not found.')],ephemeral:true});
    if(!t.kickable)return i.reply({embeds:[errorEmbed('I cannot kick that member.')],ephemeral:true});
    await t.kick(r);
    await sendLog(i.guild.id,'modlog',new EmbedBuilder().setColor(COLORS.warn).setTitle('👢 Member Kicked').addFields({name:'User',value:`${t.user.tag}`,inline:true},{name:'Moderator',value:`<@${i.user.id}>`,inline:true},{name:'Reason',value:r}).setTimestamp());
    return i.reply({embeds:[successEmbed(`**${t.user.tag}** kicked.\n**Reason:** ${r}`)]});
  },
  name:'kick',
  category:'moderation', aliases:[], usage:'!kick @user [reason]',
  async run(client,msg,args) {
    const t=msg.mentions.members.first()??await msg.guild.members.fetch(args[0]).catch(()=>null);
    if(!t)return msg.reply({embeds:[errorEmbed('Please mention a valid member.')]});
    if(!t.kickable)return msg.reply({embeds:[errorEmbed('I cannot kick that member.')]});
    const r=args.slice(1).join(' ')||'No reason provided';
    await t.kick(r); return msg.reply({embeds:[successEmbed(`**${t.user.tag}** kicked.`)]});
  },
});


registerCommand({
  userPermissions:[PermissionFlagsBits.BanMembers], cooldown:5,
  data: new SlashCommandBuilder().setName('ban').setDescription('Ban a member').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason'))
    .addIntegerOption(o=>o.setName('days').setDescription('Delete message days 0-7').setMinValue(0).setMaxValue(7)),
  async execute(client,i) {
    const t=i.options.getMember('user'),r=i.options.getString('reason')??'No reason provided',days=i.options.getInteger('days')??0;
    if(!t)return i.reply({embeds:[errorEmbed('User not found.')],ephemeral:true});
    if(!t.bannable)return i.reply({embeds:[errorEmbed('I cannot ban that member.')],ephemeral:true});
    await t.ban({reason:r,deleteMessageDays:days});
    await sendLog(i.guild.id,'modlog',new EmbedBuilder().setColor(COLORS.error).setTitle('🔨 Member Banned').addFields({name:'User',value:`${t.user.tag}`,inline:true},{name:'Mod',value:`<@${i.user.id}>`,inline:true},{name:'Reason',value:r}).setTimestamp());
    return i.reply({embeds:[successEmbed(`**${t.user.tag}** banned.\n**Reason:** ${r}`)]});
  },
  name:'ban',
  category:'moderation', aliases:[], usage:'!ban @user [reason]',
  async run(client,msg,args) {
    const t=msg.mentions.members.first()??await msg.guild.members.fetch(args[0]).catch(()=>null);
    if(!t)return msg.reply({embeds:[errorEmbed('Please mention a valid member.')]});
    if(!t.bannable)return msg.reply({embeds:[errorEmbed('I cannot ban that member.')]});
    const r=args.slice(1).join(' ')||'No reason provided';
    await t.ban({reason:r}); return msg.reply({embeds:[successEmbed(`**${t.user.tag}** banned.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.BanMembers], cooldown:5,
  data: new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o=>o.setName('user_id').setDescription('User ID').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason')),
  async execute(client,i) {
    const uid=i.options.getString('user_id'),r=i.options.getString('reason')??'No reason provided';
    const ban=await i.guild.bans.fetch(uid).catch(()=>null);
    if(!ban)return i.reply({embeds:[errorEmbed('That user is not banned.')],ephemeral:true});
    await i.guild.members.unban(uid,r);
    return i.reply({embeds:[successEmbed(`**${ban.user.tag}** unbanned.`)]});
  },
  name:'unban',
  category:'moderation', aliases:[], usage:'!unban <id>',
  async run(client,msg,args) {
    const uid=args[0]; if(!uid)return msg.reply({embeds:[errorEmbed('Provide a user ID.')]});
    const ban=await msg.guild.bans.fetch(uid).catch(()=>null);
    if(!ban)return msg.reply({embeds:[errorEmbed('That user is not banned.')]});
    await msg.guild.members.unban(uid);
    return msg.reply({embeds:[successEmbed(`**${ban.user.tag}** unbanned.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.BanMembers], cooldown:5,
  data: new SlashCommandBuilder().setName('softban').setDescription('Ban then unban to delete messages').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason')),
  async execute(client,i) {
    const t=i.options.getMember('user'),r=i.options.getString('reason')??'Softban';
    if(!t||!t.bannable)return i.reply({embeds:[errorEmbed('Cannot softban that member.')],ephemeral:true});
    await t.ban({reason:r,deleteMessageDays:7}); await i.guild.members.unban(t.id,'Softban auto-unban');
    return i.reply({embeds:[successEmbed(`**${t.user.tag}** softbanned.`)]});
  },
  name:'softban',
  category:'moderation', aliases:['sb'], usage:'!softban @user [reason]',
  async run(client,msg,args) {
    const t=msg.mentions.members.first(); if(!t||!t.bannable)return msg.reply({embeds:[errorEmbed('Cannot softban.')]});
    const r=args.slice(1).join(' ')||'Softban';
    await t.ban({reason:r,deleteMessageDays:7}); await msg.guild.members.unban(t.id);
    return msg.reply({embeds:[successEmbed(`**${t.user.tag}** softbanned.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.BanMembers], cooldown:10,
  data: new SlashCommandBuilder().setName('massban').setDescription('Ban multiple users by ID').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o=>o.setName('user_ids').setDescription('Space-separated user IDs').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason')),
  async execute(client,i) {
    const ids=i.options.getString('user_ids').split(/\s+/).filter(Boolean),r=i.options.getString('reason')??'Mass ban';
    if(ids.length>20)return i.reply({embeds:[errorEmbed('Max 20 users.')],ephemeral:true});
    await i.deferReply(); let ok=0,fail=0;
    for(const id of ids) await i.guild.members.ban(id,{reason:r}).then(()=>ok++).catch(()=>fail++);
    return i.editReply({embeds:[successEmbed(`Mass ban: ✅ **${ok}** | ❌ **${fail}**`)]});
  },
  name:'massban',
  category:'moderation', aliases:['mban'], usage:'!massban <id1 id2 ...>',
  async run(client,msg,args) {
    const ids=args.filter(a=>/^\d{17,19}$/.test(a)); let ok=0,fail=0;
    for(const id of ids) await msg.guild.members.ban(id).then(()=>ok++).catch(()=>fail++);
    return msg.reply({embeds:[successEmbed(`Mass ban: ✅ **${ok}** | ❌ **${fail}**`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ModerateMembers], cooldown:3,
  data: new SlashCommandBuilder().setName('warn').setDescription('Warn a member').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s=>s.setName('add').setDescription('Add warning').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)))
    .addSubcommand(s=>s.setName('list').setDescription('List warnings').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)))
    .addSubcommand(s=>s.setName('clear').setDescription('Clear warnings').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true))),
  async execute(client,i) {
    const sub=i.options.getSubcommand(),target=i.options.getUser('user');
    if(sub==='add'){const r=i.options.getString('reason'),total=addWarn(i.guild.id,target.id,r,i.user.id);return i.reply({embeds:[successEmbed(`**${target.tag}** warned. Total: **${total}**.\n**Reason:** ${r}`)]});}
    if(sub==='list'){const l=await dbGetWarns(i.guild.id,target.id);if(!l.length)return i.reply({embeds:[infoEmbed(`No warnings for **${target.tag}**.`)],ephemeral:true});return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.warn).setTitle(`Warnings for ${target.tag}`).setDescription(l.map((w,i)=>`**${i+1}.** ${w.reason} — <t:${Math.floor(new Date(w.at).getTime()/1000)}:R>`).join('\n'))],ephemeral:true});}
    if(sub==='clear'){await dbClearWarns(i.guild.id,target.id);return i.reply({embeds:[successEmbed(`Cleared warnings for **${target.tag}**.`)]});}
  },
  name:'warn',
  category:'moderation', aliases:['warning'], usage:'!warn add @user <reason> | list @user | clear @user',
  async run(client,msg,args) {
    const sub=args[0]?.toLowerCase(),target=msg.mentions.users.first();
    if(!target)return msg.reply({embeds:[errorEmbed('Mention a user.')]});
    if(sub==='add'||!sub){const r=args.slice(2).join(' ')||args.slice(1).join(' ')||'No reason';const total=addWarn(msg.guild.id,target.id,r,msg.author.id);return msg.reply({embeds:[successEmbed(`**${target.tag}** warned. Total: **${total}**.`)]});}
    if(sub==='list'){const l=getWarns(msg.guild.id,target.id);if(!l.length)return msg.reply({embeds:[infoEmbed('No warnings.')]});return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.warn).setTitle(`Warnings for ${target.tag}`).setDescription(l.map((w,i)=>`**${i+1}.** ${w.reason}`).join('\n'))]});}
    if(sub==='clear'){clearWarns(msg.guild.id,target.id);return msg.reply({embeds:[successEmbed('Warnings cleared.')]});}
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ModerateMembers],
  data: new SlashCommandBuilder().setName('warnlist').setDescription('View warnings for a member').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)),
  async execute(client,i) {
    const target=i.options.getUser('user'),l=await dbGetWarns(i.guild.id,target.id);
    if(!l.length)return i.reply({embeds:[infoEmbed(`No warnings for **${target.tag}**.`)],ephemeral:true});
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.warn).setTitle(`⚠️ Warnings for ${target.tag} (${l.length})`).setDescription(l.map((w,i)=>`**${i+1}.** ${w.reason}\n*<t:${Math.floor(new Date(w.at).getTime()/1000)}:R> by <@${w.moderator}>*`).join('\n\n'))],ephemeral:true});
  },
  name:'warnlist',
  category:'moderation', aliases:['warnings'], usage:'!warnlist @user',
  async run(client,msg,args) {
    const target=msg.mentions.users.first()??await client.users.fetch(args[0]).catch(()=>null);
    if(!target)return msg.reply({embeds:[errorEmbed('Mention a user or provide ID.')]});
    const l=getWarns(msg.guild.id,target.id);
    if(!l.length)return msg.reply({embeds:[infoEmbed('No warnings.')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.warn).setTitle(`Warnings for ${target.tag}`).setDescription(l.map((w,i)=>`**${i+1}.** ${w.reason}`).join('\n'))]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ModerateMembers],
  data: new SlashCommandBuilder().setName('warnremove').setDescription('Remove a specific warning').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true))
    .addIntegerOption(o=>o.setName('index').setDescription('Warning number').setRequired(true).setMinValue(1)),
  async execute(client,i) {
    const target=i.options.getUser('user'),idx=i.options.getInteger('index')-1,l=getWarns(i.guild.id,target.id);
    if(!l.length)return i.reply({embeds:[errorEmbed('No warnings.')],ephemeral:true});
    if(idx<0||idx>=l.length)return i.reply({embeds:[errorEmbed(`Use 1–${l.length}.`)],ephemeral:true});
    const removed=await dbRemoveWarn(i.guild.id,target.id,idx);
    return i.reply({embeds:[successEmbed(`Removed warning #${idx+1}: ${removed.reason}`)]});
  },
  name:'warnremove',
  category:'moderation', aliases:['delwarn','removewarn'], usage:'!warnremove @user <n>',
  async run(client,msg,args) {
    const target=msg.mentions.users.first(),idx=parseInt(args[1])-1;
    if(!target||isNaN(idx))return msg.reply({embeds:[errorEmbed('Usage: !warnremove @user <n>')]});
    const removed=removeWarn(msg.guild.id,target.id,idx);
    if(!removed)return msg.reply({embeds:[errorEmbed('Warning not found.')]});
    return msg.reply({embeds:[successEmbed(`Removed: ${removed.reason}`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ModerateMembers], cooldown:5,
  data: new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o=>o.setName('duration').setDescription('Duration e.g. 10m, 1h').setRequired(true).addChoices({name:'60s',value:'60s'},{name:'5m',value:'5m'},{name:'10m',value:'10m'},{name:'1h',value:'1h'},{name:'12h',value:'12h'},{name:'1d',value:'1d'},{name:'1w',value:'1w'}))
    .addStringOption(o=>o.setName('reason').setDescription('Reason')),
  async execute(client,i) {
    const t=i.options.getMember('user'),dur=parseDuration(i.options.getString('duration')),r=i.options.getString('reason')??'No reason provided';
    if(!t)return i.reply({embeds:[errorEmbed('Member not found.')],ephemeral:true});
    if(!t.moderatable)return i.reply({embeds:[errorEmbed('Cannot timeout that member.')],ephemeral:true});
    if(!dur)return i.reply({embeds:[errorEmbed('Invalid duration.')],ephemeral:true});
    await t.timeout(dur,r);
    return i.reply({embeds:[successEmbed(`**${t.user.tag}** timed out.\n**Reason:** ${r}`)]});
  },
  name:'timeout',
  category:'moderation', aliases:['mute','to'], usage:'!timeout @user <duration> [reason]',
  async run(client,msg,args) {
    const t=msg.mentions.members.first(),dur=parseDuration(args[1]||'');
    if(!t)return msg.reply({embeds:[errorEmbed('Mention a member.')]});
    if(!dur)return msg.reply({embeds:[errorEmbed('Invalid duration. Try 10m, 1h, 1d.')]});
    if(!t.moderatable)return msg.reply({embeds:[errorEmbed('Cannot timeout that member.')]});
    const r=args.slice(2).join(' ')||'No reason provided';
    await t.timeout(dur,r); return msg.reply({embeds:[successEmbed(`**${t.user.tag}** timed out.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ModerateMembers],
  data: new SlashCommandBuilder().setName('untimeout').setDescription('Remove timeout').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)),
  async execute(client,i) {
    const t=i.options.getMember('user');
    if(!t)return i.reply({embeds:[errorEmbed('Member not found.')],ephemeral:true});
    if(!t.isCommunicationDisabled())return i.reply({embeds:[errorEmbed('Not timed out.')],ephemeral:true});
    await t.timeout(null); return i.reply({embeds:[successEmbed(`Timeout removed from **${t.user.tag}**.`)]});
  },
  name:'untimeout',
  category:'moderation', aliases:['unmute','uto'], usage:'!untimeout @user',
  async run(client,msg) {
    const t=msg.mentions.members.first();
    if(!t||!t.isCommunicationDisabled())return msg.reply({embeds:[errorEmbed('Member not found or not timed out.')]});
    await t.timeout(null); return msg.reply({embeds:[successEmbed(`Timeout removed from **${t.user.tag}**.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageMessages], cooldown:5,
  data: new SlashCommandBuilder().setName('purge').setDescription('Bulk delete messages').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o=>o.setName('amount').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o=>o.setName('user').setDescription('Only delete from this user'))
    .addBooleanOption(o=>o.setName('bots').setDescription('Only bots')),
  async execute(client,i) {
    const amount=i.options.getInteger('amount'),filterUser=i.options.getUser('user'),botsOnly=i.options.getBoolean('bots')??false;
    await i.deferReply({ephemeral:true});
    let msgs=[...(await i.channel.messages.fetch({limit:100})).values()].filter(m=>Date.now()-m.createdTimestamp<1209600000);
    if(filterUser)msgs=msgs.filter(m=>m.author.id===filterUser.id);
    if(botsOnly)msgs=msgs.filter(m=>m.author.bot);
    const deleted=await i.channel.bulkDelete(msgs.slice(0,amount),true).catch(()=>null);
    return i.editReply({embeds:[successEmbed(`Deleted **${deleted?.size??0}** message(s).`)]});
  },
  name:'purge',
  category:'moderation', aliases:['clear','prune'], usage:'!purge <amount>',
  async run(client,msg,args) {
    const n=parseInt(args[0]); if(isNaN(n)||n<1||n>100)return msg.reply({embeds:[errorEmbed('Provide 1-100.')]});
    let msgs=[...(await msg.channel.messages.fetch({limit:100})).values()].filter(m=>Date.now()-m.createdTimestamp<1209600000);
    const deleted=await msg.channel.bulkDelete(msgs.slice(0,n+1),true).catch(()=>null);
    const r=await msg.channel.send({embeds:[successEmbed(`Deleted **${(deleted?.size??1)-1}** message(s).`)]});
    setTimeout(()=>r.delete().catch(()=>{}),4000);
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageChannels],
  data: new SlashCommandBuilder().setName('slowmode').setDescription('Set channel slowmode').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o=>o.setName('seconds').setDescription('0 to disable, max 21600').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption(o=>o.setName('channel').setDescription('Channel')),
  async execute(client,i) {
    const s=i.options.getInteger('seconds'),ch=i.options.getChannel('channel')??i.channel;
    await ch.setRateLimitPerUser(s);
    return i.reply({embeds:[successEmbed(s===0?`Slowmode disabled in ${ch}.`:`Slowmode set to **${s}s** in ${ch}.`)]});
  },
  name:'slowmode',
  category:'moderation', aliases:['slow','sm'], usage:'!slowmode <seconds>',
  async run(client,msg,args) {
    const s=parseInt(args[0]); if(isNaN(s)||s<0||s>21600)return msg.reply({embeds:[errorEmbed('Provide 0-21600.')]});
    await msg.channel.setRateLimitPerUser(s); return msg.reply({embeds:[successEmbed(s===0?'Slowmode disabled.':`Slowmode: **${s}s**.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageChannels],
  data: new SlashCommandBuilder().setName('lock').setDescription('Lock a channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o=>o.setName('channel').setDescription('Channel'))
    .addStringOption(o=>o.setName('reason').setDescription('Reason')),
  async execute(client,i) {
    const ch=i.options.getChannel('channel')??i.channel,r=i.options.getString('reason')??'No reason provided';
    await ch.permissionOverwrites.edit(i.guild.roles.everyone,{SendMessages:false},{reason:r});
    return i.reply({embeds:[successEmbed(`🔒 ${ch} locked.\n**Reason:** ${r}`)]});
  },
  name:'lock',
  category:'moderation', aliases:[], usage:'!lock [#channel]',
  async run(client,msg,args) {
    const ch=msg.mentions.channels.first()??msg.channel;
    await ch.permissionOverwrites.edit(msg.guild.roles.everyone,{SendMessages:false});
    return msg.reply({embeds:[successEmbed(`🔒 ${ch} locked.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageChannels],
  data: new SlashCommandBuilder().setName('unlock').setDescription('Unlock a channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o=>o.setName('channel').setDescription('Channel')),
  async execute(client,i) {
    const ch=i.options.getChannel('channel')??i.channel;
    await ch.permissionOverwrites.edit(i.guild.roles.everyone,{SendMessages:null});
    return i.reply({embeds:[successEmbed(`🔓 ${ch} unlocked.`)]});
  },
  name:'unlock',
  category:'moderation', aliases:[], usage:'!unlock [#channel]',
  async run(client,msg) { const ch=msg.mentions.channels.first()??msg.channel; await ch.permissionOverwrites.edit(msg.guild.roles.everyone,{SendMessages:null}); return msg.reply({embeds:[successEmbed(`🔓 ${ch} unlocked.`)]}); },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.Administrator],
  data: new SlashCommandBuilder().setName('lockdown').setDescription('Lock or unlock ALL channels').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(o=>o.setName('enable').setDescription('true=lockdown, false=lift').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason')),
  async execute(client,i) {
    const on=i.options.getBoolean('enable'),r=i.options.getString('reason')??(on?'Server lockdown':'Lockdown lifted');
    await i.deferReply();
    const chs=i.guild.channels.cache.filter(c=>c.type===0);
    for(const [,ch] of chs) await ch.permissionOverwrites.edit(i.guild.roles.everyone,{SendMessages:on?false:null},{reason:r}).catch(()=>{});
    return i.editReply({embeds:[on?warnEmbed(`🔒 Lockdown enabled.\n**Reason:** ${r}`):successEmbed('🔓 Lockdown lifted.')]});
  },
  name:'lockdown',
  category:'moderation', aliases:['serverlock'], usage:'!lockdown on|off',
  async run(client,msg,args) {
    const on=args[0]?.toLowerCase()==='on';
    const chs=msg.guild.channels.cache.filter(c=>c.type===0);
    for(const [,ch] of chs) await ch.permissionOverwrites.edit(msg.guild.roles.everyone,{SendMessages:on?false:null}).catch(()=>{});
    return msg.reply({embeds:[on?warnEmbed('🔒 Lockdown enabled.'):successEmbed('🔓 Lockdown lifted.')]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageNicknames],
  data: new SlashCommandBuilder().setName('nick').setDescription('Change nickname').setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o=>o.setName('nickname').setDescription('New nickname').setMaxLength(32)),
  async execute(client,i) {
    const t=i.options.getMember('user'),n=i.options.getString('nickname')??null;
    if(!t||!t.manageable)return i.reply({embeds:[errorEmbed('Cannot manage that member.')],ephemeral:true});
    await t.setNickname(n); return i.reply({embeds:[successEmbed(n?`Nickname set to **${n}**.`:'Nickname reset.')]});
  },
  name:'nick',
  category:'moderation', aliases:['nickname','setnick'], usage:'!nick @user [nickname]',
  async run(client,msg,args) {
    const t=msg.mentions.members.first(); if(!t)return msg.reply({embeds:[errorEmbed('Mention a member.')]});
    const n=args.slice(1).join(' ')||null; await t.setNickname(n);
    return msg.reply({embeds:[successEmbed(n?`Nickname set to **${n}**.`:'Nickname reset.')]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.BanMembers],
  data: new SlashCommandBuilder().setName('banlist').setDescription('View all bans').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  async execute(client,i) {
    await i.deferReply({ephemeral:true});
    const bans=await i.guild.bans.fetch();
    if(!bans.size)return i.editReply({embeds:[infoEmbed('No bans.')]});
    const desc=[...bans.values()].map((b,i)=>`**${i+1}.** ${b.user.tag} (\`${b.user.id}\`) — ${b.reason??'No reason'}`).slice(0,25).join('\n');
    return i.editReply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`Bans (${bans.size})`).setDescription(desc)]});
  },
  name:'banlist',
  category:'moderation', aliases:['bans'], usage:'!banlist',
  async run(client,msg) {
    const bans=await msg.guild.bans.fetch();
    if(!bans.size)return msg.reply({embeds:[infoEmbed('No bans.')]});
    const desc=[...bans.values()].slice(0,20).map((b,i)=>`**${i+1}.** ${b.user.tag} — ${b.reason??'None'}`).join('\n');
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`Bans (${bans.size})`).setDescription(desc)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.DeafenMembers],
  data: new SlashCommandBuilder().setName('deafen').setDescription('Deafen/undeafen in voice').setDefaultMemberPermissions(PermissionFlagsBits.DeafenMembers)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true))
    .addBooleanOption(o=>o.setName('state').setDescription('true=deafen, false=undeafen').setRequired(true)),
  async execute(client,i) {
    const t=i.options.getMember('user'),s=i.options.getBoolean('state');
    if(!t?.voice?.channel)return i.reply({embeds:[errorEmbed('Not in a voice channel.')],ephemeral:true});
    await t.voice.setDeaf(s); return i.reply({embeds:[successEmbed(`**${t.user.tag}** ${s?'🔇 deafened':'🔊 undeafened'}.`)]});
  },
  name:'deafen',
  category:'moderation', aliases:['deaf'], usage:'!deafen @user',
  async run(client,msg) {
    const t=msg.mentions.members.first(); if(!t?.voice?.channel)return msg.reply({embeds:[errorEmbed('Not in voice.')]});
    const s=!t.voice.serverDeaf; await t.voice.setDeaf(s);
    return msg.reply({embeds:[successEmbed(`**${t.user.tag}** ${s?'🔇 deafened':'🔊 undeafened'}.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.MoveMembers],
  data: new SlashCommandBuilder().setName('vckick').setDescription('Disconnect from voice').setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)),
  async execute(client,i) {
    const t=i.options.getMember('user');
    if(!t?.voice?.channel)return i.reply({embeds:[errorEmbed('Not in a voice channel.')],ephemeral:true});
    await t.voice.disconnect(); return i.reply({embeds:[successEmbed(`**${t.user.tag}** disconnected.`)]});
  },
  name:'vckick',
  category:'moderation', aliases:['voicekick','dvc'], usage:'!vckick @user',
  async run(client,msg) {
    const t=msg.mentions.members.first(); if(!t?.voice?.channel)return msg.reply({embeds:[errorEmbed('Not in voice.')]});
    await t.voice.disconnect(); return msg.reply({embeds:[successEmbed(`**${t.user.tag}** disconnected.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.MoveMembers],
  data: new SlashCommandBuilder().setName('move').setDescription('Move member to voice channel').setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true))
    .addChannelOption(o=>o.setName('channel').setDescription('Voice channel').setRequired(true)),
  async execute(client,i) {
    const t=i.options.getMember('user'),ch=i.options.getChannel('channel');
    if(!t?.voice?.channel)return i.reply({embeds:[errorEmbed('Not in voice.')],ephemeral:true});
    if(ch.type!==2)return i.reply({embeds:[errorEmbed('Select a voice channel.')],ephemeral:true});
    await t.voice.setChannel(ch); return i.reply({embeds:[successEmbed(`Moved **${t.user.tag}** to **${ch.name}**.`)]});
  },
  name:'move',
  category:'moderation', aliases:['vcmove'], usage:'!move @user <channel_id>',
  async run(client,msg,args) {
    const t=msg.mentions.members.first(),ch=msg.guild.channels.cache.get(args[1]);
    if(!t?.voice?.channel)return msg.reply({embeds:[errorEmbed('Not in voice.')]});
    if(!ch||ch.type!==2)return msg.reply({embeds:[errorEmbed('Voice channel not found.')]});
    await t.voice.setChannel(ch); return msg.reply({embeds:[successEmbed(`Moved to **${ch.name}**.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageChannels],
  data: new SlashCommandBuilder().setName('nuke').setDescription('Nuke a channel (clone+delete)').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o=>o.setName('channel').setDescription('Channel')),
  async execute(client,i) {
    const ch=i.options.getChannel('channel')??i.channel;
    const cloned=await ch.clone({reason:`Nuked by ${i.user.tag}`});
    await cloned.setPosition(ch.position); await ch.delete();
    await cloned.send({embeds:[successEmbed('💥 Channel nuked!')]});
    if(ch.id!==i.channel.id) i.reply({content:'Done.',ephemeral:true}).catch(()=>{});
  },
  name:'nuke',
  category:'moderation', aliases:[], usage:'!nuke [#channel]',
  async run(client,msg) {
    const ch=msg.mentions.channels.first()??msg.channel;
    const cloned=await ch.clone(); await cloned.setPosition(ch.position); await ch.delete();
    await cloned.send({embeds:[successEmbed('💥 Channel nuked!')]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ModerateMembers],
  data: new SlashCommandBuilder().setName('modhistory').setDescription('View mod history for a user').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)),
  async execute(client,i) {
    const target=i.options.getUser('user'),l=await dbGetWarns(i.guild.id,target.id);
    if(!l.length)return i.reply({embeds:[infoEmbed(`No mod history for **${target.tag}**.`)],ephemeral:true});
    const desc=l.slice(0,10).map((w,i)=>`**${i+1}.** ${w.reason} — <t:${Math.floor(new Date(w.at).getTime()/1000)}:R>`).join('\n');
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.warn).setTitle(`Mod History — ${target.tag}`).setDescription(desc)],ephemeral:true});
  },
  name:'modhistory',
  category:'moderation', aliases:['mh','history'], usage:'!modhistory @user',
  async run(client,msg,args) {
    const t=msg.mentions.users.first()??await client.users.fetch(args[0]).catch(()=>null);
    if(!t)return msg.reply({embeds:[errorEmbed('User not found.')]});
    const l=getWarns(msg.guild.id,t.id);
    if(!l.length)return msg.reply({embeds:[infoEmbed('No history.')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.warn).setTitle(`History — ${t.tag}`).setDescription(l.slice(0,10).map((w,i)=>`**${i+1}.** ${w.reason}`).join('\n'))]});
  },
});

// ─────────────────────────────────────────────────────────────
//  CONFIG COMMANDS
// ─────────────────────────────────────────────────────────────
registerCommand({
  userPermissions:[PermissionFlagsBits.Administrator],
  data: new SlashCommandBuilder().setName('setownerrole').setDescription('Set the Owner role').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(o=>o.setName('role').setDescription('Role (omit to clear)')),
  async execute(client,i) {
    const role=i.options.getRole('role'); setGuildConfig(i.guild.id,'ownerRoleId',role?.id??null);
    return i.reply({embeds:[role?successEmbed(`Owner role set to ${role}.`):infoEmbed('Owner role cleared.')]});
  },
  name:'setownerrole',
  category:'config', aliases:['ownerrole'], usage:'!setownerrole @role',
  async run(client,msg,args) {
    const role=msg.mentions.roles.first()??msg.guild.roles.cache.get(args[0]);
    if(!args[0]){setGuildConfig(msg.guild.id,'ownerRoleId',null);return msg.reply({embeds:[infoEmbed('Cleared.')]});}
    if(!role)return msg.reply({embeds:[errorEmbed('Role not found.')]});
    setGuildConfig(msg.guild.id,'ownerRoleId',role.id); return msg.reply({embeds:[successEmbed(`Owner role: ${role}.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.Administrator],
  data: new SlashCommandBuilder().setName('setcoownerrole').setDescription('Set the Co-Owner role').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(o=>o.setName('role').setDescription('Role (omit to clear)')),
  async execute(client,i) {
    const role=i.options.getRole('role'); setGuildConfig(i.guild.id,'coOwnerRoleId',role?.id??null);
    return i.reply({embeds:[role?successEmbed(`Co-Owner role set to ${role}.`):infoEmbed('Co-Owner role cleared.')]});
  },
  name:'setcoownerrole',
  category:'config', aliases:['coownerrole'], usage:'!setcoownerrole @role',
  async run(client,msg,args) {
    const role=msg.mentions.roles.first()??msg.guild.roles.cache.get(args[0]);
    if(!args[0]){setGuildConfig(msg.guild.id,'coOwnerRoleId',null);return msg.reply({embeds:[infoEmbed('Cleared.')]});}
    if(!role)return msg.reply({embeds:[errorEmbed('Role not found.')]});
    setGuildConfig(msg.guild.id,'coOwnerRoleId',role.id); return msg.reply({embeds:[successEmbed(`Co-Owner role: ${role}.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder().setName('setprefix').setDescription('Change bot prefix').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o=>o.setName('prefix').setDescription('New prefix').setRequired(true).setMaxLength(5)),
  async execute(client,i) {
    const p=i.options.getString('prefix'); setGuildConfig(i.guild.id,'prefix',p);
    return i.reply({embeds:[successEmbed(`Prefix set to \`${p}\``)]});
  },
  name:'setprefix',
  category:'config', aliases:['prefix'], usage:'!setprefix <prefix>',
  async run(client,msg,args) {
    const p=args[0]; if(!p||p.length>5)return msg.reply({embeds:[errorEmbed('Max 5 characters.')]});
    setGuildConfig(msg.guild.id,'prefix',p); return msg.reply({embeds:[successEmbed(`Prefix: \`${p}\``)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder().setName('setmodlog').setDescription('Set the mod-log channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o=>o.setName('channel').setDescription('Channel (omit to clear)')),
  async execute(client,i) {
    const ch=i.options.getChannel('channel'); setGuildConfig(i.guild.id,'modLogChannel',ch?.id??null);
    return i.reply({embeds:[ch?successEmbed(`Mod log: ${ch}.`):infoEmbed('Mod log cleared.')]});
  },
  name:'setmodlog',
  category:'config', aliases:['modlog'], usage:'!setmodlog #channel',
  async run(client,msg,args) {
    const ch=msg.mentions.channels.first()??msg.guild.channels.cache.get(args[0]);
    if(!args[0]){setGuildConfig(msg.guild.id,'modLogChannel',null);return msg.reply({embeds:[infoEmbed('Cleared.')]});}
    if(!ch)return msg.reply({embeds:[errorEmbed('Channel not found.')]});
    setGuildConfig(msg.guild.id,'modLogChannel',ch.id); return msg.reply({embeds:[successEmbed(`Mod log: ${ch}.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageRoles],
  data: new SlashCommandBuilder().setName('setmuterole').setDescription('Set the mute role').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addRoleOption(o=>o.setName('role').setDescription('Role (omit to clear)')),
  async execute(client,i) {
    const role=i.options.getRole('role'); setGuildConfig(i.guild.id,'muteRoleId',role?.id??null);
    return i.reply({embeds:[role?successEmbed(`Mute role: ${role}.`):infoEmbed('Mute role cleared.')]});
  },
  name:'setmuterole',
  category:'config', aliases:['muterole'], usage:'!setmuterole @role',
  async run(client,msg,args) {
    const role=msg.mentions.roles.first()??msg.guild.roles.cache.get(args[0]);
    if(!args[0]){setGuildConfig(msg.guild.id,'muteRoleId',null);return msg.reply({embeds:[infoEmbed('Cleared.')]});}
    if(!role)return msg.reply({embeds:[errorEmbed('Role not found.')]});
    setGuildConfig(msg.guild.id,'muteRoleId',role.id); return msg.reply({embeds:[successEmbed(`Mute role: ${role}.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder().setName('setlogs').setDescription('Configure log channels').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s=>s.setName('set').setDescription('Set a log channel')
      .addStringOption(o=>o.setName('type').setDescription('Log type').setRequired(true).addChoices({name:'Message Log',value:'messagelog'},{name:'Mod Log',value:'modlog'},{name:'Admin Log',value:'adminlog'},{name:'Reaction Log',value:'reactionlog'},{name:'Voice Log',value:'voicelog'}))
      .addChannelOption(o=>o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand(s=>s.setName('clear').setDescription('Disable a log type')
      .addStringOption(o=>o.setName('type').setDescription('Log type').setRequired(true).addChoices({name:'Message Log',value:'messagelog'},{name:'Mod Log',value:'modlog'},{name:'Admin Log',value:'adminlog'},{name:'Reaction Log',value:'reactionlog'},{name:'Voice Log',value:'voicelog'})))
    .addSubcommand(s=>s.setName('view').setDescription('View log settings')),
  async execute(client,i) {
    const sub=i.options.getSubcommand(),gid=i.guild.id;
    if(sub==='set'){const t=i.options.getString('type'),ch=i.options.getChannel('channel');setLogChannel(gid,t,ch.id);return i.reply({embeds:[successEmbed(`**${t}** logs to ${ch}.`)]});}
    if(sub==='clear'){const t=i.options.getString('type');clearLogChannel(gid,t);return i.reply({embeds:[infoEmbed(`**${t}** disabled.`)]});}
    if(sub==='view'){
      const cfg=getLogConfig(gid);
      const lines=LOG_TYPES.map(t=>`**${t}:** ${cfg[t]?`<#${cfg[t]}>`:'❌ Not set'}`).join('\n');
      return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Log Channels').setDescription(lines)],ephemeral:true});
    }
  },
  name:'setlogs',
  category:'config', aliases:['logs'], usage:'!setlogs set <type> #channel | clear <type> | view',
  async run(client,msg,args) {
    const sub=args[0]?.toLowerCase(),gid=msg.guild.id;
    if(sub==='view'){const cfg=getLogConfig(gid);return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Logs').setDescription(LOG_TYPES.map(t=>`**${t}:** ${cfg[t]?`<#${cfg[t]}>`:'Not set'}`).join('\n'))]});}
    if(sub==='set'){const t=args[1]?.toLowerCase(),ch=msg.mentions.channels.first()??msg.guild.channels.cache.get(args[2]);if(!LOG_TYPES.includes(t))return msg.reply({embeds:[errorEmbed(`Types: ${LOG_TYPES.join(', ')}`)]});if(!ch)return msg.reply({embeds:[errorEmbed('Mention a channel.')]});setLogChannel(gid,t,ch.id);return msg.reply({embeds:[successEmbed(`${t} → ${ch}`)]});}
    if(sub==='clear'){const t=args[1]?.toLowerCase();if(!LOG_TYPES.includes(t))return msg.reply({embeds:[errorEmbed(`Types: ${LOG_TYPES.join(', ')}`)]});clearLogChannel(gid,t);return msg.reply({embeds:[infoEmbed(`${t} disabled.`)]});}
    return msg.reply({embeds:[infoEmbed('Usage: !setlogs set <type> #ch | clear <type> | view')]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure the welcome system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s
      .setName('channel')
      .setDescription('Set the welcome channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to send welcome messages in (omit to disable)').setRequired(false)))
    .addSubcommand(s => s
      .setName('message')
      .setDescription('Set the welcome message — plain text or {embed} code')
      .addStringOption(o => o.setName('message').setDescription('Welcome message. Use {embed}{title:...} for embed, or plain text.').setRequired(true)))
    .addSubcommand(s => s
      .setName('test')
      .setDescription('Preview the welcome message as if you just joined'))
    .addSubcommand(s => s
      .setName('reset')
      .setDescription('Reset the welcome message to default'))
    .addSubcommand(s => s
      .setName('view')
      .setDescription('View current welcome config'))
    .addSubcommand(s => s
      .setName('disable')
      .setDescription('Disable the welcome system')),

  async execute(client, i) {
    const sub = i.options.getSubcommand();
    const gid = i.guild.id;
    const cfg = getGuildConfig(gid);

    if (sub === 'channel') {
      const ch = i.options.getChannel('channel');
      setGuildConfig(gid, 'welcomeChannel', ch?.id ?? null);
      return i.reply({ embeds: [ch ? successEmbed(`Welcome channel set to ${ch}.\n\nNow set a message with \`/welcome message\`.`) : infoEmbed('Welcome channel cleared.')] });
    }

    if (sub === 'message') {
      const msg = i.options.getString('message');
      setGuildConfig(gid, 'welcomeMessage', msg);
      const isEmbed = msg.includes('{embed}');
      return i.reply({ embeds: [new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('✅ Welcome Message Updated')
        .setDescription(`**Type:** ${isEmbed ? '🖼️ Embed' : '💬 Plain Text'}\n\nUse \`/welcome test\` to preview it!`)
        .addFields({ name: 'Raw Message', value: `\`\`\`\n${msg.slice(0, 900)}\n\`\`\`` })] });
    }

    if (sub === 'test') {
      if (!cfg.welcomeMessage) return i.reply({ embeds: [errorEmbed('No welcome message set. Use `/welcome message` first.')], ephemeral: true });
      await i.reply({ content: '**Preview of your welcome message:**', ephemeral: true });
      const parsed = parseEmbedString(cfg.welcomeMessage, {
        user   : `<@${i.user.id}>`,
        tag    : i.user.tag,
        server : i.guild.name,
        count  : i.guild.memberCount.toString(),
        channel: cfg.welcomeChannel ? `<#${cfg.welcomeChannel}>` : i.channel.toString(),
      });
      if (parsed.type === 'embed') {
        return i.followUp({ embeds: [parsed.embed], ephemeral: true });
      } else {
        return i.followUp({ content: parsed.content, ephemeral: true });
      }
    }

    if (sub === 'reset') {
      setGuildConfig(gid, 'welcomeMessage', 'Welcome {user} to **{server}**! You are member #{count}.');
      return i.reply({ embeds: [successEmbed('Welcome message reset to default.')] });
    }

    if (sub === 'disable') {
      setGuildConfig(gid, 'welcomeChannel', null);
      setGuildConfig(gid, 'welcomeMessage', null);
      return i.reply({ embeds: [infoEmbed('Welcome system disabled.')] });
    }

    if (sub === 'view') {
      const ch      = cfg.welcomeChannel ? `<#${cfg.welcomeChannel}>` : '❌ Not set';
      const msgText = cfg.welcomeMessage ?? '❌ Not set';
      const isEmbed = msgText.includes('{embed}');
      return i.reply({ embeds: [new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('👋 Welcome System Config')
        .addFields(
          { name: '📢 Channel', value: ch, inline: true },
          { name: '🖼️ Type',   value: isEmbed ? 'Embed' : 'Plain Text', inline: true },
          { name: '💬 Message', value: msgText !== '❌ Not set' ? `\`\`\`\n${msgText.slice(0, 500)}\n\`\`\`` : '❌ Not set', inline: false },
          { name: '📋 Variables', value: '`{user}` `{tag}` `{server}` `{count}` `{channel}`', inline: false },
          { name: '💡 Embed Example', value: '```\n{embed}{title: Welcome!}{description: Hey {user}!}{color: #57F287}{thumbnail: {avatar}}{footer: Member #{count}}\n```', inline: false },
        )
        .setFooter({ text: 'Use /welcome test to preview' })], ephemeral: true });
    }
  },

  name: 'welcome',
  category: 'welcome',
  aliases: ['setwelcome', 'welcomeset'],
  usage: ',welcome channel #ch | message <text or embed code> | test | view | reset | disable',
  async run(client, msg, args) {
    const sub = args[0]?.toLowerCase();
    const gid = msg.guild.id;
    const cfg = getGuildConfig(gid);

    if (sub === 'channel') {
      const ch = msg.mentions.channels.first() ?? msg.guild.channels.cache.get(args[1]);
      if (!args[1]) { setGuildConfig(gid, 'welcomeChannel', null); return msg.reply({ embeds: [infoEmbed('Welcome channel cleared.')] }); }
      if (!ch) return msg.reply({ embeds: [errorEmbed('Channel not found.')] });
      setGuildConfig(gid, 'welcomeChannel', ch.id);
      return msg.reply({ embeds: [successEmbed(`Welcome channel: ${ch}`)] });
    }
    if (sub === 'message') {
      const m = args.slice(1).join(' ');
      if (!m) return msg.reply({ embeds: [errorEmbed('Provide a message.')] });
      setGuildConfig(gid, 'welcomeMessage', m);
      return msg.reply({ embeds: [successEmbed(`Welcome message updated! Use \`,welcome test\` to preview.`)] });
    }
    if (sub === 'test') {
      if (!cfg.welcomeMessage) return msg.reply({ embeds: [errorEmbed('No welcome message set.')] });
      await sendParsed(msg.channel, cfg.welcomeMessage, {
        user: `<@${msg.author.id}>`, tag: msg.author.tag, server: msg.guild.name,
        count: msg.guild.memberCount.toString(), channel: msg.channel.toString(),
      });
      return;
    }
    if (sub === 'disable') {
      setGuildConfig(gid, 'welcomeChannel', null);
      return msg.reply({ embeds: [infoEmbed('Welcome disabled.')] });
    }
    if (sub === 'reset') {
      setGuildConfig(gid, 'welcomeMessage', 'Welcome {user} to **{server}**!');
      return msg.reply({ embeds: [successEmbed('Reset to default.')] });
    }
    const ch = cfg.welcomeChannel ? `<#${cfg.welcomeChannel}>` : 'Not set';
    return msg.reply({ embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('Welcome Config').addFields(
      { name: 'Channel', value: ch, inline: true },
      { name: 'Message', value: cfg.welcomeMessage ?? 'Not set' },
    )] });
  },
});

// ─────────────────────────────────────────────────────────────
//  INFO COMMANDS
// ─────────────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
  async execute(client,i) {
    const sent=await i.reply({content:'Pinging...',fetchReply:true});
    return i.editReply({content:'',embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🏓 Pong!').addFields({name:'Round-trip',value:`${sent.createdTimestamp-i.createdTimestamp}ms`,inline:true},{name:'WS',value:`${client.ws.ping}ms`,inline:true})]});
  },
  name:'ping',
  category:'info', aliases:[], usage:'!ping',
  async run(client,msg) {
    const sent=await msg.reply('Pinging...');
    return sent.edit({content:'',embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🏓 Pong!').addFields({name:'Round-trip',value:`${sent.createdTimestamp-msg.createdTimestamp}ms`,inline:true},{name:'WS',value:`${client.ws.ping}ms`,inline:true})]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('View server information'),
  async execute(client,i) { return i.reply({embeds:[buildServerEmbed(i.guild)]}); },
  name:'serverinfo',
  category:'info', aliases:['si','guildinfo'], usage:'!serverinfo',
  async run(client,msg) { return msg.reply({embeds:[buildServerEmbed(msg.guild)]}); },
});

registerCommand({
  data: new SlashCommandBuilder().setName('userinfo').setDescription('View user info').addUserOption(o=>o.setName('user').setDescription('User')),
  async execute(client,i) { return i.reply({embeds:[buildUserEmbed(i.options.getMember('user')??i.member)]}); },
  name:'userinfo',
  category:'info', aliases:['ui'], usage:'!userinfo [@user]',
  async run(client,msg) { return msg.reply({embeds:[buildUserEmbed(msg.mentions.members.first()??msg.member)]}); },
});

registerCommand({
  data: new SlashCommandBuilder().setName('avatar').setDescription("Get a user's avatar").addUserOption(o=>o.setName('user').setDescription('User')),
  async execute(client,i) {
    const u=i.options.getUser('user')??i.user;
    const url=u.displayAvatarURL({dynamic:true,size:4096});
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`${u.tag}'s Avatar`).setImage(url)]});
  },
  name:'avatar',
  category:'info', aliases:['av','pfp'], usage:'!avatar [@user]',
  async run(client,msg,args) {
    const u=msg.mentions.users.first()??msg.author;
    const url=u.displayAvatarURL({dynamic:true,size:4096});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`${u.tag}'s Avatar`).setImage(url)]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('banner').setDescription("Get a user's banner").addUserOption(o=>o.setName('user').setDescription('User')),
  async execute(client,i) {
    const u=await client.users.fetch((i.options.getUser('user')??i.user).id,{force:true});
    if(!u.banner)return i.reply({embeds:[errorEmbed('No banner.')],ephemeral:true});
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`${u.tag}'s Banner`).setImage(u.bannerURL({dynamic:true,size:4096}))]});
  },
  name:'banner',
  category:'info', aliases:[], usage:'!banner [@user]',
  async run(client,msg,args) {
    const u=await client.users.fetch((msg.mentions.users.first()??msg.author).id,{force:true});
    if(!u.banner)return msg.reply({embeds:[errorEmbed('No banner.')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`${u.tag}'s Banner`).setImage(u.bannerURL({dynamic:true,size:4096}))]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('servericon').setDescription("Get the server's icon"),
  async execute(client,i) {
    const url=i.guild.iconURL({dynamic:true,size:4096});
    if(!url)return i.reply({embeds:[errorEmbed('No icon.')],ephemeral:true});
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`${i.guild.name} Icon`).setImage(url)]});
  },
  name:'servericon',
  category:'info', aliases:['icon'], usage:'!servericon',
  async run(client,msg) {
    const url=msg.guild.iconURL({dynamic:true,size:4096});
    if(!url)return msg.reply({embeds:[errorEmbed('No icon.')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`${msg.guild.name} Icon`).setImage(url)]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('botinfo').setDescription('View bot statistics'),
  async execute(client,i) { await i.deferReply(); return i.editReply({embeds:[buildBotEmbed(client)]}); },
  name:'botinfo',
  category:'info', aliases:['stats','about'], usage:'!botinfo',
  async run(client,msg) { return msg.reply({embeds:[buildBotEmbed(client)]}); },
});

registerCommand({
  data: new SlashCommandBuilder().setName('membercount').setDescription('Show member counts'),
  async execute(client,i) { return i.reply({embeds:[buildMemberCountEmbed(i.guild)]}); },
  name:'membercount',
  category:'info', aliases:['members','mc'], usage:'!membercount',
  async run(client,msg) { return msg.reply({embeds:[buildMemberCountEmbed(msg.guild)]}); },
});

registerCommand({
  data: new SlashCommandBuilder().setName('roleinfo').setDescription('View role info').addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true)),
  async execute(client,i) { return i.reply({embeds:[buildRoleEmbed(i.options.getRole('role'),i.guild)]}); },
  name:'roleinfo',
  category:'info', aliases:['ri'], usage:'!roleinfo @role',
  async run(client,msg,args) {
    const role=msg.mentions.roles.first()??msg.guild.roles.cache.get(args[0]);
    if(!role)return msg.reply({embeds:[errorEmbed('Role not found.')]});
    return msg.reply({embeds:[buildRoleEmbed(role,msg.guild)]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('channelinfo').setDescription('View channel info').addChannelOption(o=>o.setName('channel').setDescription('Channel')),
  async execute(client,i) {
    const ch=i.options.getChannel('channel')??i.channel;
    const fields=[{name:'ID',value:`\`${ch.id}\``,inline:true},{name:'Type',value:ch.type.toString(),inline:true},{name:'Created',value:`<t:${Math.floor(ch.createdTimestamp/1000)}:D>`,inline:true}];
    if(ch.topic)fields.push({name:'Topic',value:ch.topic.slice(0,256),inline:false});
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`#${ch.name}`).addFields(fields)]});
  },
  name:'channelinfo',
  category:'info', aliases:['ci'], usage:'!channelinfo [#channel]',
  async run(client,msg,args) {
    const ch=msg.mentions.channels.first()??msg.guild.channels.cache.get(args[0])??msg.channel;
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`#${ch.name}`).addFields({name:'ID',value:`\`${ch.id}\``,inline:true},{name:'Created',value:`<t:${Math.floor(ch.createdTimestamp/1000)}:D>`,inline:true})]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('whois').setDescription('Detailed member info').addUserOption(o=>o.setName('user').setDescription('User')),
  async execute(client,i) { return i.reply({embeds:[buildUserEmbed(i.options.getMember('user')??i.member)]}); },
  name:'whois',
  category:'info', aliases:[], usage:'!whois [@user]',
  async run(client,msg) { return msg.reply({embeds:[buildUserEmbed(msg.mentions.members.first()??msg.member)]}); },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder().setName('invites').setDescription('View invite stats').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o=>o.setName('user').setDescription('User')),
  async execute(client,i) {
    const target=i.options.getUser('user'),invs=await i.guild.invites.fetch();
    if(target){const ui=invs.filter(v=>v.inviter?.id===target.id),total=ui.reduce((a,v)=>a+(v.uses??0),0);return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`Invites for ${target.tag}`).addFields({name:'Uses',value:`${total}`,inline:true},{name:'Links',value:`${ui.size}`,inline:true})],ephemeral:true});}
    const top=[...invs.values()].sort((a,b)=>(b.uses??0)-(a.uses??0)).slice(0,10).map((v,n)=>`**${n+1}.** ${v.inviter?.tag??'?'} — \`${v.code}\` — **${v.uses??0}** uses`);
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Top Invites').setDescription(top.join('\n')||'None.')],ephemeral:true});
  },
  name:'invites',
  category:'info', aliases:['invite'], usage:'!invites [@user]',
  async run(client,msg) {
    const invs=await msg.guild.invites.fetch();
    const top=[...invs.values()].sort((a,b)=>(b.uses??0)-(a.uses??0)).slice(0,10).map((v,n)=>`**${n+1}.** ${v.inviter?.tag??'?'} — **${v.uses??0}** uses`);
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Top Invites').setDescription(top.join('\n')||'None.')]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('boosts').setDescription('View boost info'),
  async execute(client,i) { return i.reply({embeds:[buildBoostEmbed(i.guild)]}); },
  name:'boosts',
  category:'info', aliases:['boost'], usage:'!boosts',
  async run(client,msg) { return msg.reply({embeds:[buildBoostEmbed(msg.guild)]}); },
});

registerCommand({
  data: new SlashCommandBuilder().setName('emojiinfo').setDescription('Get info about a custom emoji').addStringOption(o=>o.setName('emoji').setDescription('Custom emoji').setRequired(true)),
  async execute(client,i) {
    const input=i.options.getString('emoji'),m=input.match(/<?(a?):(\w+):(\d+)>?/);
    if(!m)return i.reply({embeds:[errorEmbed('Invalid custom emoji.')],ephemeral:true});
    const [,animated,name,id]=m,url=`https://cdn.discordapp.com/emojis/${id}.${animated?'gif':'png'}`;
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`:${name}:`).setThumbnail(url).addFields({name:'ID',value:id,inline:true},{name:'Animated',value:animated?'Yes':'No',inline:true},{name:'URL',value:`[Click](${url})`,inline:true})]});
  },
  name:'emojiinfo',
  category:'info', aliases:['emoji'], usage:'!emojiinfo <emoji>',
  async run(client,msg,args) {
    const m=(args[0]||'').match(/<?(a?):(\w+):(\d+)>?/);
    if(!m)return msg.reply({embeds:[errorEmbed('Invalid emoji.')]});
    const [,a,name,id]=m,url=`https://cdn.discordapp.com/emojis/${id}.${a?'gif':'png'}`;
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`:${name}:`).setThumbnail(url).addFields({name:'ID',value:id,inline:true})]});
  },
});

// ── Info helper functions ─────────────────────────────────────
function buildServerEmbed(guild) {
  const chs=guild.channels.cache,text=chs.filter(c=>c.type===0).size,voice=chs.filter(c=>c.type===2).size;
  return new EmbedBuilder().setColor(COLORS.info).setTitle(guild.name).setThumbnail(guild.iconURL({dynamic:true}))
    .addFields({name:'👑 Owner',value:`<@${guild.ownerId}>`,inline:true},{name:'📅 Created',value:`<t:${Math.floor(guild.createdTimestamp/1000)}:D>`,inline:true},{name:'👥 Members',value:`${guild.memberCount}`,inline:true},{name:'💬 Channels',value:`${text} text · ${voice} voice`,inline:true},{name:'🎭 Roles',value:`${guild.roles.cache.size}`,inline:true},{name:'💎 Boosts',value:`${guild.premiumSubscriptionCount??0}`,inline:true},{name:'🆔 ID',value:`\`${guild.id}\``,inline:false}).setFooter({text:`Boost level ${guild.premiumTier}`});
}
function buildUserEmbed(member) {
  const {user}=member;
  const roles=member.roles.cache.filter(r=>r.id!==member.guild.id).map(r=>`${r}`).join(' ')||'None';
  return new EmbedBuilder().setColor(member.displayHexColor||COLORS.info).setThumbnail(user.displayAvatarURL({dynamic:true,size:256})).setTitle(user.tag)
    .addFields({name:'🆔 ID',value:`\`${user.id}\``,inline:true},{name:'🤖 Bot',value:user.bot?'Yes':'No',inline:true},{name:'📅 Created',value:`<t:${Math.floor(user.createdTimestamp/1000)}:D>`,inline:true},{name:'📥 Joined',value:`<t:${Math.floor(member.joinedTimestamp/1000)}:D>`,inline:true},{name:'📛 Nick',value:member.nickname??'None',inline:true},{name:`🎭 Roles (${member.roles.cache.size-1})`,value:roles.slice(0,512),inline:false});
}
function buildBotEmbed(client) {
  return new EmbedBuilder().setColor(COLORS.info).setTitle(`${client.user.username} — Stats`).setThumbnail(client.user.displayAvatarURL())
    .addFields({name:'🏓 Ping',value:`${client.ws.ping}ms`,inline:true},{name:'⏱️ Uptime',value:formatUptime(client.uptime),inline:true},{name:'🖥️ Memory',value:`${(process.memoryUsage().heapUsed/1024/1024).toFixed(1)} MB`,inline:true},{name:'🌐 Servers',value:`${client.guilds.cache.size}`,inline:true},{name:'📝 Commands',value:`${client.commands.size} slash · ${client.prefixCmds.size} prefix`,inline:true});
}
function buildMemberCountEmbed(guild) {
  const bots=guild.members.cache.filter(m=>m.user.bot).size;
  return new EmbedBuilder().setColor(COLORS.info).setTitle(`👥 ${guild.name}`).addFields({name:'Total',value:`${guild.memberCount}`,inline:true},{name:'Humans',value:`${guild.memberCount-bots}`,inline:true},{name:'Bots',value:`${bots}`,inline:true});
}
function buildRoleEmbed(role,guild) {
  const members=guild.members.cache.filter(m=>m.roles.cache.has(role.id)).size;
  return new EmbedBuilder().setColor(role.color||COLORS.info).setTitle(role.name)
    .addFields({name:'ID',value:`\`${role.id}\``,inline:true},{name:'Color',value:role.hexColor,inline:true},{name:'Members',value:`${members}`,inline:true},{name:'Created',value:`<t:${Math.floor(role.createdTimestamp/1000)}:D>`,inline:true},{name:'Hoisted',value:role.hoist?'Yes':'No',inline:true},{name:'Mentionable',value:role.mentionable?'Yes':'No',inline:true});
}
function buildBoostEmbed(guild) {
  const boosters=guild.members.cache.filter(m=>m.premiumSince).map(m=>`<@${m.id}> since <t:${Math.floor(m.premiumSinceTimestamp/1000)}:R>`).slice(0,15).join('\n')||'No boosters.';
  return new EmbedBuilder().setColor(0xFF73FA).setTitle(`✨ ${guild.name} Boosts`).addFields({name:'Level',value:`${guild.premiumTier}`,inline:true},{name:'Boosts',value:`${guild.premiumSubscriptionCount??0}`,inline:true},{name:`Boosters (${guild.members.cache.filter(m=>m.premiumSince).size})`,value:boosters,inline:false});
}
function formatUptime(ms) {
  const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60),d=Math.floor(h/24);
  return `${d}d ${h%24}h ${m%60}m ${s%60}s`;
}

// ─────────────────────────────────────────────────────────────
//  ROLE COMMANDS
// ─────────────────────────────────────────────────────────────
registerCommand({
  userPermissions:[PermissionFlagsBits.ManageRoles],
  data: new SlashCommandBuilder().setName('role').setDescription('Add or remove a role').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s=>s.setName('add').setDescription('Add role').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(s=>s.setName('remove').setDescription('Remove role').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true))),
  async execute(client,i) {
    const sub=i.options.getSubcommand(),t=i.options.getMember('user'),role=i.options.getRole('role');
    if(!t)return i.reply({embeds:[errorEmbed('Member not found.')],ephemeral:true});
    if(role.managed)return i.reply({embeds:[errorEmbed('Managed role.')],ephemeral:true});
    if(sub==='add'){await t.roles.add(role);return i.reply({embeds:[successEmbed(`Added ${role} to **${t.user.tag}**.`)]});}
    await t.roles.remove(role);return i.reply({embeds:[successEmbed(`Removed ${role} from **${t.user.tag}**.`)]});
  },
  name:'role',
  category:'roles', aliases:['giverole'], usage:'!role add/remove @user @role',
  async run(client,msg,args) {
    const sub=args[0]?.toLowerCase(),t=msg.mentions.members.first(),role=msg.mentions.roles.first();
    if(!['add','remove'].includes(sub)||!t||!role)return msg.reply({embeds:[errorEmbed('Usage: !role add/remove @user @role')]});
    if(sub==='add')await t.roles.add(role); else await t.roles.remove(role);
    return msg.reply({embeds:[successEmbed(`${sub==='add'?'Added':'Removed'} ${role} ${sub==='add'?'to':'from'} **${t.user.tag}**.`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageRoles],
  data: new SlashCommandBuilder().setName('roleall').setDescription('Give/remove role from everyone').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(o=>o.setName('action').setDescription('add or remove').setRequired(true).addChoices({name:'Add',value:'add'},{name:'Remove',value:'remove'}))
    .addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true)),
  async execute(client,i) {
    const action=i.options.getString('action'),role=i.options.getRole('role');
    if(role.managed)return i.reply({embeds:[errorEmbed('Managed role.')],ephemeral:true});
    await i.reply({embeds:[warnEmbed('Processing...')]});
    const members=await i.guild.members.fetch();let ok=0,fail=0;
    for(const [,m] of members){if(m.user.bot)continue;await(action==='add'?m.roles.add(role):m.roles.remove(role)).then(()=>ok++).catch(()=>fail++);}
    return i.editReply({embeds:[successEmbed(`Done! ✅ ${ok} | ❌ ${fail}`)]});
  },
  name:'roleall',
  category:'roles', aliases:['massrole'], usage:'!roleall add/remove @role',
  async run(client,msg,args) {
    const action=args[0]?.toLowerCase(),role=msg.mentions.roles.first();
    if(!['add','remove'].includes(action)||!role)return msg.reply({embeds:[errorEmbed('Usage: !roleall add/remove @role')]});
    const m2=await msg.reply({embeds:[warnEmbed('Processing...')]});
    const members=await msg.guild.members.fetch();let ok=0,fail=0;
    for(const [,m] of members){if(m.user.bot)continue;await(action==='add'?m.roles.add(role):m.roles.remove(role)).then(()=>ok++).catch(()=>fail++);}
    return m2.edit({embeds:[successEmbed(`Done! ✅ ${ok} | ❌ ${fail}`)]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('rolelist').setDescription('List all server roles'),
  async execute(client,i) {
    const roles=i.guild.roles.cache.filter(r=>r.id!==i.guild.id).sort((a,b)=>b.position-a.position).map(r=>`${r} — \`${r.members.size} members\``).slice(0,30).join('\n');
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`Roles (${i.guild.roles.cache.size-1})`).setDescription(roles||'None.')],ephemeral:true});
  },
  name:'rolelist',
  category:'roles', aliases:['roles'], usage:'!rolelist',
  async run(client,msg) {
    const roles=msg.guild.roles.cache.filter(r=>r.id!==msg.guild.id).sort((a,b)=>b.position-a.position).map(r=>`${r} — ${r.members.size} members`).slice(0,25).join('\n');
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Roles').setDescription(roles||'None.')]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageRoles],
  data: new SlashCommandBuilder().setName('createrole').setDescription('Create a new role').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(o=>o.setName('name').setDescription('Role name').setRequired(true))
    .addStringOption(o=>o.setName('color').setDescription('Hex color'))
    .addBooleanOption(o=>o.setName('hoist').setDescription('Show separately'))
    .addBooleanOption(o=>o.setName('mentionable').setDescription('Mentionable')),
  async execute(client,i) {
    const role=await i.guild.roles.create({name:i.options.getString('name'),color:i.options.getString('color')??'#99AAB5',hoist:i.options.getBoolean('hoist')??false,mentionable:i.options.getBoolean('mentionable')??false});
    return i.reply({embeds:[successEmbed(`Role ${role} created!`)]});
  },
  name:'createrole',
  category:'roles', aliases:['mkrole','newrole'], usage:'!createrole <name> [color]',
  async run(client,msg,args) {
    const name=args[0],color=args[1]??'#99AAB5';
    if(!name)return msg.reply({embeds:[errorEmbed('Provide a name.')]});
    const role=await msg.guild.roles.create({name,color});
    return msg.reply({embeds:[successEmbed(`Role ${role} created!`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageRoles],
  data: new SlashCommandBuilder().setName('deleterole').setDescription('Delete a role').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true)),
  async execute(client,i) {
    const role=i.options.getRole('role');
    if(role.managed)return i.reply({embeds:[errorEmbed('Cannot delete managed role.')],ephemeral:true});
    const name=role.name; await role.delete();
    return i.reply({embeds:[successEmbed(`Role \`${name}\` deleted.`)]});
  },
  name:'deleterole',
  category:'roles', aliases:['delrole'], usage:'!deleterole @role',
  async run(client,msg,args) {
    const role=msg.mentions.roles.first()??msg.guild.roles.cache.get(args[0]);
    if(!role)return msg.reply({embeds:[errorEmbed('Role not found.')]});
    const name=role.name; await role.delete();
    return msg.reply({embeds:[successEmbed(`Role \`${name}\` deleted.`)]});
  },
});

// ─────────────────────────────────────────────────────────────
//  UTILITY COMMANDS
// ─────────────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('poll').setDescription('Create a reaction poll').addStringOption(o=>o.setName('question').setDescription('Question').setRequired(true)).addStringOption(o=>o.setName('options').setDescription('Comma-separated options')).addIntegerOption(o=>o.setName('duration').setDescription('Duration in minutes')),
  async execute(client,i) {
    const q=i.options.getString('question'),raw=i.options.getString('options'),dur=i.options.getInteger('duration');
    const opts=raw?raw.split(',').map(s=>s.trim()).filter(Boolean):null;
    const EMOJIS=['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    const embed=new EmbedBuilder().setColor(COLORS.info).setTitle('📊 '+q).setFooter({text:`Poll by ${i.user.tag}${dur?` · Ends in ${dur}m`:''}`}).setTimestamp();
    if(opts)embed.setDescription(opts.map((o,idx)=>`${EMOJIS[idx]} ${o}`).join('\n'));
    await i.reply({content:'✅',ephemeral:true});
    const msg=await i.channel.send({embeds:[embed]});
    if(opts){for(let idx=0;idx<opts.length;idx++)await msg.react(EMOJIS[idx]);}else{await msg.react('👍');await msg.react('👎');}
    if(dur)setTimeout(async()=>{const u=await msg.fetch();embed.setTitle('📊 [ENDED] '+q);await u.edit({embeds:[embed]});},dur*60000);
  },
  name:'poll',
  category:'utility', aliases:[], usage:'!poll <question> | [opt1, opt2]',
  async run(client,msg,args) {
    const EMOJIS=['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    const full=args.join(' '),[question,optStr]=full.split('|').map(s=>s.trim());
    if(!question)return msg.reply({embeds:[errorEmbed('Provide a question.')]});
    const opts=optStr?optStr.split(',').map(s=>s.trim()).filter(Boolean):null;
    const embed=new EmbedBuilder().setColor(COLORS.info).setTitle('📊 '+question).setTimestamp();
    if(opts)embed.setDescription(opts.map((o,i)=>`${EMOJIS[i]} ${o}`).join('\n'));
    await msg.delete().catch(()=>{});
    const m=await msg.channel.send({embeds:[embed]});
    if(opts){for(let i=0;i<opts.length;i++)await m.react(EMOJIS[i]);}else{await m.react('👍');await m.react('👎');}
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('remind').setDescription('Set a reminder').addStringOption(o=>o.setName('time').setDescription('e.g. 10m, 2h').setRequired(true)).addStringOption(o=>o.setName('message').setDescription('Reminder text').setRequired(true)),
  async execute(client,i) {
    const ms=parseDuration(i.options.getString('time')),reminder=i.options.getString('message');
    if(!ms)return i.reply({embeds:[errorEmbed('Invalid time. Try 10m, 2h, 1d.')],ephemeral:true});
    const fireAt=Date.now()+ms;
    await i.reply({embeds:[successEmbed(`Reminder set for <t:${Math.floor(fireAt/1000)}:R>:\n> ${reminder}`)]});
    setTimeout(()=>{const e=new EmbedBuilder().setColor(COLORS.warn).setTitle('⏰ Reminder!').setDescription(reminder).setTimestamp();i.user.send({embeds:[e]}).catch(()=>i.channel.send({content:`<@${i.user.id}>`,embeds:[e]}));},ms);
  },
  name:'remind',
  category:'utility', aliases:['reminder','remindme'], usage:'!remind <time> <message>',
  async run(client,msg,args) {
    const ms=parseDuration(args[0]||''),reminder=args.slice(1).join(' ');
    if(!ms||!reminder)return msg.reply({embeds:[errorEmbed('Usage: !remind <time> <message>')]});
    await msg.reply({embeds:[successEmbed(`Reminder set: ${reminder}`)]});
    setTimeout(()=>{const e=new EmbedBuilder().setColor(COLORS.warn).setTitle('⏰ Reminder!').setDescription(reminder).setTimestamp();msg.author.send({embeds:[e]}).catch(()=>msg.channel.send({content:`<@${msg.author.id}>`,embeds:[e]}));},ms);
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('snipe').setDescription('Show last deleted message'),
  async execute(client,i) {
    const s=client.snipes?.get(i.channel.id);
    if(!s)return i.reply({embeds:[errorEmbed('No recent deleted messages.')],ephemeral:true});
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.warn).setAuthor({name:s.author.tag,iconURL:s.author.displayAvatarURL()}).setDescription(s.content||'*no content*').setTimestamp(s.deletedAt)]});
  },
  name:'snipe',
  category:'utility', aliases:['s'], usage:'!snipe',
  async run(client,msg) {
    const s=client.snipes?.get(msg.channel.id);
    if(!s)return msg.reply({embeds:[errorEmbed('No recent deleted messages.')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.warn).setAuthor({name:s.author.tag,iconURL:s.author.displayAvatarURL()}).setDescription(s.content||'*no content*')]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageMessages],
  data: new SlashCommandBuilder().setName('say').setDescription('Make the bot say something').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)).addChannelOption(o=>o.setName('channel').setDescription('Channel')),
  async execute(client,i) { await(i.options.getChannel('channel')??i.channel).send(i.options.getString('message')); return i.reply({content:'✅',ephemeral:true}); },
  name:'say',
  category:'utility', aliases:['echo'], usage:'!say <message>',
  async run(client,msg,args) { if(!args.length)return msg.reply({embeds:[errorEmbed('Provide a message.')]}); await msg.delete().catch(()=>{}); await msg.channel.send(args.join(' ')); },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageMessages],
  data: new SlashCommandBuilder().setName('announce').setDescription('Send announcement').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)).addChannelOption(o=>o.setName('channel').setDescription('Channel')).addRoleOption(o=>o.setName('ping').setDescription('Ping role')).addStringOption(o=>o.setName('title').setDescription('Title')),
  async execute(client,i) {
    const ch=i.options.getChannel('channel')??i.channel,ping=i.options.getRole('ping');
    const embed=new EmbedBuilder().setColor(COLORS.warn).setTitle(i.options.getString('title')??'📢 Announcement').setDescription(i.options.getString('message')).setFooter({text:`By ${i.user.tag}`}).setTimestamp();
    await ch.send({content:ping?`${ping}`:undefined,embeds:[embed]});
    return i.reply({content:`✅ Announced in ${ch}`,ephemeral:true});
  },
  name:'announce',
  category:'utility', aliases:['announcement'], usage:'!announce <message>',
  async run(client,msg,args) {
    if(!args.length)return msg.reply({embeds:[errorEmbed('Provide a message.')]});
    const embed=new EmbedBuilder().setColor(COLORS.warn).setTitle('📢 Announcement').setDescription(args.join(' ')).setFooter({text:`By ${msg.author.tag}`}).setTimestamp();
    await msg.delete().catch(()=>{}); await msg.channel.send({embeds:[embed]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('afk').setDescription('Set AFK status').addStringOption(o=>o.setName('reason').setDescription('AFK reason')),
  async execute(client,i) {
    const reason=i.options.getString('reason')??'AFK';
    getAfkMap(i.guild.id).set(i.user.id,{reason,since:Date.now()});
    return i.reply({embeds:[successEmbed(`You are AFK: **${reason}**`)]});
  },
  name:'afk',
  category:'utility', aliases:[], usage:'!afk [reason]',
  async run(client,msg,args) {
    const reason=args.join(' ')||'AFK';
    getAfkMap(msg.guild.id).set(msg.author.id,{reason,since:Date.now()});
    return msg.reply({embeds:[successEmbed(`AFK: **${reason}**`)]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('calc').setDescription('Evaluate a math expression').addStringOption(o=>o.setName('expression').setDescription('e.g. (5+3)*2').setRequired(true)),
  async execute(client,i) { return i.reply({embeds:[evalMath(i.options.getString('expression'))]}); },
  name:'calc',
  category:'utility', aliases:['math','calculate'], usage:'!calc <expression>',
  async run(client,msg,args) { return msg.reply({embeds:[evalMath(args.join(' '))]}); },
});

registerCommand({
  data: new SlashCommandBuilder().setName('color').setDescription('Random color or hex lookup').addStringOption(o=>o.setName('hex').setDescription('Hex e.g. #FF5733')),
  async execute(client,i) { return i.reply({embeds:[colorEmbed(i.options.getString('hex'))]}); },
  name:'color',
  category:'utility', aliases:['colour','hex'], usage:'!color [#hex]',
  async run(client,msg,args) { return msg.reply({embeds:[colorEmbed(args[0]||null)]}); },
});

registerCommand({
  data: new SlashCommandBuilder().setName('timestamp').setDescription('Convert date to Discord timestamps').addStringOption(o=>o.setName('date').setDescription('"now" or date string').setRequired(true)),
  async execute(client,i) { return i.reply({embeds:[tsEmbed(i.options.getString('date'))],ephemeral:true}); },
  name:'timestamp',
  category:'utility', aliases:['ts'], usage:'!timestamp <date>',
  async run(client,msg,args) { return msg.reply({embeds:[tsEmbed(args.join(' '))]}); },
});

registerCommand({
  data: new SlashCommandBuilder().setName('translate').setDescription('Translate text').addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)).addStringOption(o=>o.setName('to').setDescription('Target lang code e.g. es, fr').setRequired(true)).addStringOption(o=>o.setName('from').setDescription('Source lang (default: auto)')),
  async execute(client,i) {
    const text=i.options.getString('text'),to=i.options.getString('to'),from=i.options.getString('from')??'auto';
    await i.deferReply();
    const result=await googleTranslate(text,from,to);
    if(!result)return i.editReply({embeds:[errorEmbed('Translation failed.')]});
    return i.editReply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🌐 Translation').addFields({name:`Original (${from})`,value:text.slice(0,1024)},{name:`Translated (${to})`,value:result.slice(0,1024)})]});
  },
  name:'translate',
  category:'utility', aliases:['tr'], usage:'!translate <to> <text>',
  async run(client,msg,args) {
    const to=args[0],text=args.slice(1).join(' ');
    if(!to||!text)return msg.reply({embeds:[errorEmbed('Usage: !translate <lang> <text>')]});
    const result=await googleTranslate(text,'auto',to);
    if(!result)return msg.reply({embeds:[errorEmbed('Failed.')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🌐 Translation').addFields({name:'Result',value:result.slice(0,1024)})]});
  },
});

registerCommand({
  cooldown:5,
  data: new SlashCommandBuilder().setName('weather').setDescription('Current weather for a city').addStringOption(o=>o.setName('city').setDescription('City name').setRequired(true)),
  async execute(client,i) {
    const city=i.options.getString('city'); await i.deferReply();
    const data=await fetchWeather(city);
    if(!data)return i.editReply({embeds:[errorEmbed(`Could not find weather for **${city}**.`)]});
    return i.editReply({embeds:[weatherEmbed(data)]});
  },
  name:'weather',
  category:'utility', aliases:[], usage:'!weather <city>',
  async run(client,msg,args) {
    const city=args.join(' '); if(!city)return msg.reply({embeds:[errorEmbed('Provide a city.')]});
    const data=await fetchWeather(city);
    if(!data)return msg.reply({embeds:[errorEmbed(`Could not find **${city}**.`)]});
    return msg.reply({embeds:[weatherEmbed(data)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageEmojisAndStickers],
  data: new SlashCommandBuilder().setName('stealemoji').setDescription('Add emoji from another server').setDefaultMemberPermissions(PermissionFlagsBits.ManageEmojisAndStickers).addStringOption(o=>o.setName('emoji').setDescription('Custom emoji or URL').setRequired(true)).addStringOption(o=>o.setName('name').setDescription('Name for URL emoji')),
  async execute(client,i) {
    const input=i.options.getString('emoji'),name=i.options.getString('name');
    const m=input.match(/<?(a?):(\w+):(\d+)>?/);
    if(!m&&!input.startsWith('http'))return i.reply({embeds:[errorEmbed('Provide a custom emoji or URL.')],ephemeral:true});
    const url=m?`https://cdn.discordapp.com/emojis/${m[3]}.${m[1]?'gif':'png'}`:input;
    const ename=name||(m?m[2]:'emoji');
    const emoji=await i.guild.emojis.create({attachment:url,name:ename}).catch(e=>e);
    if(emoji instanceof Error)return i.reply({embeds:[errorEmbed(`Failed: ${emoji.message}`)],ephemeral:true});
    return i.reply({embeds:[successEmbed(`Emoji ${emoji} added as \`:${emoji.name}:\``)]});
  },
  name:'stealemoji',
  category:'utility', aliases:['addemoji','steal'], usage:'!stealemoji <emoji>',
  async run(client,msg,args) {
    const m=(args[0]||'').match(/<?(a?):(\w+):(\d+)>?/);
    if(!m)return msg.reply({embeds:[errorEmbed('Provide a custom emoji.')]});
    const url=`https://cdn.discordapp.com/emojis/${m[3]}.${m[1]?'gif':'png'}`;
    const emoji=await msg.guild.emojis.create({attachment:url,name:args[1]??m[2]}).catch(e=>e);
    if(emoji instanceof Error)return msg.reply({embeds:[errorEmbed(`Failed: ${emoji.message}`)]});
    return msg.reply({embeds:[successEmbed(`Emoji ${emoji} added!`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageChannels],
  data: new SlashCommandBuilder().setName('createchannel').setDescription('Create a channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addStringOption(o=>o.setName('name').setDescription('Name').setRequired(true)).addStringOption(o=>o.setName('type').setDescription('text or voice').addChoices({name:'Text',value:'text'},{name:'Voice',value:'voice'})).addStringOption(o=>o.setName('topic').setDescription('Topic')).addChannelOption(o=>o.setName('category').setDescription('Category')),
  async execute(client,i) {
    const name=i.options.getString('name').toLowerCase().replace(/\s+/g,'-'),type=i.options.getString('type')??'text';
    const ch=await i.guild.channels.create({name,type:type==='voice'?ChannelType.GuildVoice:ChannelType.GuildText,topic:i.options.getString('topic')??undefined,parent:i.options.getChannel('category')?.id??undefined});
    return i.reply({embeds:[successEmbed(`Channel ${ch} created!`)]});
  },
  name:'createchannel',
  category:'utility', aliases:['mkchan'], usage:'!createchannel <name>',
  async run(client,msg,args) {
    const name=args[0]?.toLowerCase().replace(/\s+/g,'-');
    if(!name)return msg.reply({embeds:[errorEmbed('Provide a name.')]});
    const ch=await msg.guild.channels.create({name,type:ChannelType.GuildText});
    return msg.reply({embeds:[successEmbed(`Channel ${ch} created!`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageChannels],
  data: new SlashCommandBuilder().setName('deletechannel').setDescription('Delete a channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addChannelOption(o=>o.setName('channel').setDescription('Channel')).addStringOption(o=>o.setName('reason').setDescription('Reason')),
  async execute(client,i) {
    const ch=i.options.getChannel('channel')??i.channel,r=i.options.getString('reason')??'No reason';
    await i.reply({embeds:[successEmbed(`Deleting \`#${ch.name}\`...`)],ephemeral:true});
    await ch.delete(r);
  },
  name:'deletechannel',
  category:'utility', aliases:['delchan'], usage:'!deletechannel [#channel]',
  async run(client,msg,args) {
    const ch=msg.mentions.channels.first()??msg.channel;
    await msg.reply({embeds:[successEmbed(`Deleting...`)]});
    setTimeout(()=>ch.delete().catch(()=>{}),2000);
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageChannels],
  data: new SlashCommandBuilder().setName('renamechannel').setDescription('Rename a channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addStringOption(o=>o.setName('name').setDescription('New name').setRequired(true)).addChannelOption(o=>o.setName('channel').setDescription('Channel')),
  async execute(client,i) {
    const name=i.options.getString('name').toLowerCase().replace(/\s+/g,'-'),ch=i.options.getChannel('channel')??i.channel,old=ch.name;
    await ch.setName(name); return i.reply({embeds:[successEmbed(`Renamed \`#${old}\` → \`#${name}\``)]});
  },
  name:'renamechannel',
  category:'utility', aliases:['rename'], usage:'!renamechannel <name> [#channel]',
  async run(client,msg,args) {
    const ch=msg.mentions.channels.first()??msg.channel,name=args.filter(a=>!a.startsWith('<')).join('-').toLowerCase();
    if(!name)return msg.reply({embeds:[errorEmbed('Provide a name.')]});
    const old=ch.name; await ch.setName(name);
    return msg.reply({embeds:[successEmbed(`Renamed \`#${old}\` → \`#${name}\``)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageChannels],
  data: new SlashCommandBuilder().setName('topic').setDescription('Set channel topic').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addStringOption(o=>o.setName('topic').setDescription('New topic (omit to clear)')).addChannelOption(o=>o.setName('channel').setDescription('Channel')),
  async execute(client,i) {
    const topic=i.options.getString('topic')??null,ch=i.options.getChannel('channel')??i.channel;
    await ch.setTopic(topic); return i.reply({embeds:[successEmbed(topic?`Topic: *${topic}*`:'Topic cleared.')]});
  },
  name:'topic',
  category:'utility', aliases:['settopic'], usage:'!topic <text>',
  async run(client,msg,args) { const topic=args.join(' ')||null; await msg.channel.setTopic(topic); return msg.reply({embeds:[successEmbed(topic?`Topic: *${topic}*`:'Cleared.')]}); },
});

registerCommand({
  data: new SlashCommandBuilder().setName('suggest').setDescription('Submit a suggestion or manage the system')
    .addSubcommand(s=>s.setName('submit').setDescription('Submit').addStringOption(o=>o.setName('suggestion').setDescription('Your suggestion').setRequired(true)))
    .addSubcommand(s=>s.setName('setchannel').setDescription('Set channel (Admin only)').addChannelOption(o=>o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand(s=>s.setName('approve').setDescription('Approve a suggestion').addStringOption(o=>o.setName('message_id').setDescription('Msg ID').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')))
    .addSubcommand(s=>s.setName('deny').setDescription('Deny a suggestion').addStringOption(o=>o.setName('message_id').setDescription('Msg ID').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason'))),
  async execute(client,i) {
    const sub=i.options.getSubcommand(),cfg=getGuildConfig(i.guild.id);
    if(sub==='setchannel'){setGuildConfig(i.guild.id,'suggestChannel',i.options.getChannel('channel').id);return i.reply({embeds:[successEmbed('Suggestion channel set.')]});}
    if(sub==='submit'){
      const chId=cfg.suggestChannel; if(!chId)return i.reply({embeds:[errorEmbed('No suggestion channel set.')],ephemeral:true});
      const ch=i.guild.channels.cache.get(chId); if(!ch)return i.reply({embeds:[errorEmbed('Channel not found.')],ephemeral:true});
      const embed=new EmbedBuilder().setColor(COLORS.info).setTitle('💡 Suggestion').setDescription(i.options.getString('suggestion')).setAuthor({name:i.user.tag,iconURL:i.user.displayAvatarURL()}).addFields({name:'Status',value:'⏳ Pending'}).setTimestamp();
      const msg=await ch.send({embeds:[embed]}); await msg.react('👍'); await msg.react('👎');
      return i.reply({embeds:[successEmbed('Submitted!')],ephemeral:true});
    }
    if(sub==='approve'||sub==='deny'){
      const msgId=i.options.getString('message_id'),r=i.options.getString('reason')??'No reason',approved=sub==='approve';
      const chId=cfg.suggestChannel; if(!chId)return i.reply({embeds:[errorEmbed('No channel.')],ephemeral:true});
      const ch=i.guild.channels.cache.get(chId);
      const msg=await ch?.messages.fetch(msgId).catch(()=>null);
      if(!msg)return i.reply({embeds:[errorEmbed('Message not found.')],ephemeral:true});
      const newEmbed=EmbedBuilder.from(msg.embeds[0]).setColor(approved?COLORS.success:COLORS.error).spliceFields(-1,1,{name:'Status',value:`${approved?'✅ Approved':'❌ Denied'} by ${i.user.tag}\n**Reason:** ${r}`});
      await msg.edit({embeds:[newEmbed]}); return i.reply({embeds:[successEmbed(`${approved?'Approved':'Denied'}.`)],ephemeral:true});
    }
  },
  name:'suggest',
  category:'utility', aliases:['suggestion'], usage:'!suggest <text>',
  async run(client,msg,args) {
    const cfg=getGuildConfig(msg.guild.id),chId=cfg.suggestChannel;
    if(!chId)return msg.reply({embeds:[errorEmbed('No suggestion channel.')]});
    const ch=msg.guild.channels.cache.get(chId); if(!ch)return msg.reply({embeds:[errorEmbed('Channel not found.')]});
    const embed=new EmbedBuilder().setColor(COLORS.info).setTitle('💡 Suggestion').setDescription(args.join(' ')).setAuthor({name:msg.author.tag,iconURL:msg.author.displayAvatarURL()}).addFields({name:'Status',value:'⏳ Pending'}).setTimestamp();
    const m=await ch.send({embeds:[embed]}); await m.react('👍'); await m.react('👎');
    return msg.reply({embeds:[successEmbed('Submitted!')]});
  },
});

// ─────────────────────────────────────────────────────────────
//  FUN COMMANDS
// ─────────────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin'),
  async execute(client,i) { return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Coin Flip').setDescription(`**${Math.random()<0.5?'🪙 Heads':'🪙 Tails'}!**`)]}); },
  name:'coinflip',
  category:'fun', aliases:['flip','cf'], usage:'!coinflip',
  async run(client,msg) { return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Coin Flip').setDescription(`**${Math.random()<0.5?'🪙 Heads':'🪙 Tails'}!**`)]}); },
});

registerCommand({
  data: new SlashCommandBuilder().setName('8ball').setDescription('Ask the magic 8-ball').addStringOption(o=>o.setName('question').setDescription('Your question').setRequired(true)),
  async execute(client,i) {
    const RESP=['✅ It is certain.','✅ Without a doubt.','✅ Yes, definitely.','✅ Most likely.','✅ Outlook good.','✅ Yes.','🤔 Ask again later.','🤔 Cannot predict now.','🤔 Better not tell you.','❌ My reply is no.','❌ Very doubtful.','❌ Outlook not so good.','❌ Don\'t count on it.','❌ My sources say no.'];
    const answer=RESP[Math.floor(Math.random()*RESP.length)];
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🎱 Magic 8-Ball').addFields({name:'❓',value:i.options.getString('question')},{name:'🎱',value:answer})]});
  },
  name:'8ball',
  category:'fun', aliases:['eightball'], usage:'!8ball <question>',
  async run(client,msg,args) {
    const RESP=['✅ It is certain.','✅ Yes.','🤔 Ask again later.','❌ No.','❌ Very doubtful.'];
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🎱').addFields({name:'Q',value:args.join(' ')||'...'},{name:'A',value:RESP[Math.floor(Math.random()*RESP.length)]})]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('roll').setDescription('Roll dice e.g. 2d6').addStringOption(o=>o.setName('dice').setDescription('Dice notation').setRequired(true)),
  async execute(client,i) { return i.reply({embeds:[rollDice(i.options.getString('dice'))]}); },
  name:'roll',
  category:'fun', aliases:['dice'], usage:'!roll <dice>',
  async run(client,msg,args) { return msg.reply({embeds:[rollDice(args[0]??'d6')]}); },
});

registerCommand({
  data: new SlashCommandBuilder().setName('random').setDescription('Random number').addIntegerOption(o=>o.setName('min').setDescription('Min').setRequired(true)).addIntegerOption(o=>o.setName('max').setDescription('Max').setRequired(true)),
  async execute(client,i) {
    const min=i.options.getInteger('min'),max=i.options.getInteger('max');
    if(min>=max)return i.reply({embeds:[errorEmbed('Min must be less than max.')],ephemeral:true});
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🎲 Random').setDescription(`**${Math.floor(Math.random()*(max-min+1))+min}**`).setFooter({text:`${min}–${max}`})]});
  },
  name:'random',
  category:'fun', aliases:['rng','rand'], usage:'!random <min> <max>',
  async run(client,msg,args) {
    const min=parseInt(args[0]),max=parseInt(args[1]);
    if(isNaN(min)||isNaN(max)||min>=max)return msg.reply({embeds:[errorEmbed('Usage: !random <min> <max>')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🎲').setDescription(`**${Math.floor(Math.random()*(max-min+1))+min}**`)]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('choose').setDescription('Pick between options').addStringOption(o=>o.setName('options').setDescription('Comma-separated options').setRequired(true)),
  async execute(client,i) {
    const opts=i.options.getString('options').split(',').map(s=>s.trim()).filter(Boolean);
    if(opts.length<2)return i.reply({embeds:[errorEmbed('Provide 2+ options.')],ephemeral:true});
    return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🤔 I choose...').setDescription(`**${opts[Math.floor(Math.random()*opts.length)]}**`)]});
  },
  name:'choose',
  category:'fun', aliases:['pick','decide'], usage:'!choose opt1, opt2',
  async run(client,msg,args) {
    const opts=args.join(' ').split(',').map(s=>s.trim()).filter(Boolean);
    if(opts.length<2)return msg.reply({embeds:[errorEmbed('Provide 2+ comma-separated options.')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🤔').setDescription(`**${opts[Math.floor(Math.random()*opts.length)]}**`)]});
  },
});

registerCommand({
  cooldown:5,
  data: new SlashCommandBuilder().setName('meme').setDescription('Get a random meme'),
  async execute(client,i) {
    await i.deferReply();
    const meme=await fetchMeme();
    if(!meme)return i.editReply({embeds:[errorEmbed('Could not fetch a meme.')]});
    return i.editReply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(meme.title.slice(0,256)).setImage(meme.url).setFooter({text:`👍 ${meme.ups} | r/${meme.subreddit}`})]});
  },
  name:'meme',
  category:'fun', aliases:[], usage:'!meme',
  async run(client,msg) {
    const meme=await fetchMeme();
    if(!meme)return msg.reply({embeds:[errorEmbed('Could not fetch.')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(meme.title.slice(0,256)).setImage(meme.url)]});
  },
});

registerCommand({
  cooldown:5,
  data: new SlashCommandBuilder().setName('trivia').setDescription('Answer a trivia question'),
  async execute(client,i) {
    await i.deferReply();
    const q=await fetchTrivia();
    if(!q)return i.editReply({embeds:[errorEmbed('Could not fetch question.')]});
    const answers=[...q.incorrect,q.correct].sort(()=>Math.random()-0.5);
    const LABELS=['A','B','C','D'];
    const embed=new EmbedBuilder().setColor(COLORS.info).setTitle('🧠 Trivia').setDescription(`**${decodeHTML(q.question)}**`).addFields({name:'Category',value:q.category,inline:true},{name:'Difficulty',value:q.difficulty,inline:true}).setFooter({text:'15 seconds!'});
    const row=new ActionRowBuilder().addComponents(answers.map((a,i)=>new ButtonBuilder().setCustomId(`trivia_${i}`).setLabel(`${LABELS[i]}. ${decodeHTML(a).slice(0,80)}`).setStyle(ButtonStyle.Secondary)));
    const msg=await i.editReply({embeds:[embed],components:[row]});
    const col=msg.createMessageComponentCollector({time:15000});
    col.on('collect',async bi=>{
      const chosen=answers[parseInt(bi.customId.split('_')[1])],correct=chosen===q.correct;
      embed.setColor(correct?COLORS.success:COLORS.error).setDescription(`${correct?'✅ Correct!':'❌ Wrong! Answer: **'+decodeHTML(q.correct)+'**'}\n\n**${decodeHTML(q.question)}**`);
      const updated=new ActionRowBuilder().addComponents(answers.map((a,i)=>new ButtonBuilder().setCustomId(`td_${i}`).setLabel(`${LABELS[i]}. ${decodeHTML(a).slice(0,80)}`).setStyle(a===q.correct?ButtonStyle.Success:ButtonStyle.Danger).setDisabled(true)));
      await bi.update({embeds:[embed],components:[updated]}); col.stop();
    });
    col.on('end',async(_,r)=>{if(r==='time'){embed.setColor(COLORS.error).setDescription(`⏱️ Time's up! Answer: **${decodeHTML(q.correct)}**`);await i.editReply({embeds:[embed],components:[]}).catch(()=>{});}});
  },
  name:'trivia',
  category:'fun', aliases:[], usage:'!trivia',
  async run(client,msg) {
    const q=await fetchTrivia();
    if(!q)return msg.reply({embeds:[errorEmbed('Could not fetch a question. Try again!')]});
    const answers=[...q.incorrect,q.correct].sort(()=>Math.random()-0.5);
    const LABELS=['A','B','C','D'];
    const embed=new EmbedBuilder().setColor(COLORS.info).setTitle('🧠 Trivia').setDescription(`**${decodeHTML(q.question)}**`).addFields({name:'Category',value:q.category,inline:true},{name:'Difficulty',value:q.difficulty,inline:true}).setFooter({text:'Reply with A, B, C or D — 15 seconds!'});
    const list=answers.map((a,i)=>`**${LABELS[i]}.** ${decodeHTML(a)}`).join('\n');
    await msg.reply({embeds:[embed.addFields({name:'Options',value:list})]});
    const filter=m=>m.author.id===msg.author.id&&['a','b','c','d'].includes(m.content.toLowerCase());
    const col=await msg.channel.awaitMessages({filter,max:1,time:15000}).catch(()=>null);
    if(!col||!col.size)return msg.channel.send({embeds:[errorEmbed(`⏱️ Time's up! Answer: **${decodeHTML(q.correct)}**`)]});
    const ans=col.first().content.toUpperCase();
    const chosen=answers[LABELS.indexOf(ans)];
    const correct=chosen===q.correct;
    return msg.channel.send({embeds:[new EmbedBuilder().setColor(correct?COLORS.success:COLORS.error).setDescription(correct?`✅ Correct! **${decodeHTML(q.correct)}**`:`❌ Wrong! Answer: **${decodeHTML(q.correct)}**`)]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder().setName('counting').setDescription('Set up counting game').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s=>s.setName('setup').setDescription('Set counting channel').addChannelOption(o=>o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand(s=>s.setName('reset').setDescription('Reset count'))
    .addSubcommand(s=>s.setName('view').setDescription('View count')),
  async execute(client,i) {
    const sub=i.options.getSubcommand();
    if(sub==='setup'){const ch=i.options.getChannel('channel');_counting.set(ch.id,{count:0,lastUser:null});await ch.send({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🔢 Counting Game!').setDescription('Start from **1**!\n• One number per person at a time\n• No consecutive numbers from same person\n• Wrong number resets to 0!')]});return i.reply({embeds:[successEmbed(`Counting started in ${ch}.`)]});}
    if(sub==='reset'){const data=_counting.get(i.channel.id);if(data){data.count=0;data.lastUser=null;}return i.reply({embeds:[successEmbed('Count reset to 0.')]});}
    if(sub==='view'){const data=_counting.get(i.channel.id);if(!data)return i.reply({embeds:[errorEmbed('Not a counting channel.')],ephemeral:true});return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🔢 Count').setDescription(`**${data.count}**\nNext: **${data.count+1}**`)],ephemeral:true});}
  },
  name:'counting',
  category:'fun', aliases:[], usage:'!counting setup #channel',
  async run(client,msg,args) {
    const sub=args[0]?.toLowerCase();
    if(sub==='setup'){
      const ch=msg.mentions.channels.first()??msg.channel;
      _counting.set(ch.id,{count:0,lastUser:null});
      await ch.send({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🔢 Counting Game!').setDescription('Start from **1**!\n• One number per person at a time\n• No consecutive numbers from same person\n• Wrong number resets to 0!')]});
      return msg.reply({embeds:[successEmbed(`Counting started in ${ch}.`)]});
    }
    if(sub==='reset'){const d=_counting.get(msg.channel.id);if(d){d.count=0;d.lastUser=null;}return msg.reply({embeds:[successEmbed('Count reset to 0.')]});}
    if(sub==='view'){const d=_counting.get(msg.channel.id);if(!d)return msg.reply({embeds:[errorEmbed('Not a counting channel.')]});return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🔢 Count').setDescription(`**${d.count}**\nNext: **${d.count+1}**`)]});}
    return msg.reply({embeds:[infoEmbed('Usage: `,counting setup [#channel]` | `,counting reset` | `,counting view`')]});
  },
});

// ── Utility helper functions ─────────────────────────────────
function evalMath(expr) {
  if(!/^[\d+\-*/().\s%^]+$/.test(expr)) return new EmbedBuilder().setColor(COLORS.error).setDescription('❌ Invalid. Only numbers and `+ - * / ( ) %` allowed.');
  try {
    // eslint-disable-next-line no-new-func
    const r=Function(`"use strict";return(${expr.replace(/\^/g,'**')})`)();
    if(!isFinite(r))throw new Error();
    return new EmbedBuilder().setColor(COLORS.info).setTitle('🧮 Calculator').addFields({name:'Expression',value:`\`${expr}\``,inline:true},{name:'Result',value:`**${r}**`,inline:true});
  } catch { return new EmbedBuilder().setColor(COLORS.error).setDescription('❌ Could not evaluate.'); }
}
function colorEmbed(input) {
  let hex=(input||'').replace('#','');
  if(!hex||!/^[0-9A-Fa-f]{6}$/.test(hex))hex=Math.floor(Math.random()*0xFFFFFF).toString(16).padStart(6,'0');
  const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
  return new EmbedBuilder().setColor(parseInt(hex,16)).setTitle(`🎨 #${hex.toUpperCase()}`).addFields({name:'HEX',value:`#${hex.toUpperCase()}`,inline:true},{name:'RGB',value:`rgb(${r},${g},${b})`,inline:true},{name:'INT',value:`${parseInt(hex,16)}`,inline:true});
}
function tsEmbed(input) {
  const date=input.toLowerCase()==='now'?new Date():new Date(input);
  if(isNaN(date.getTime()))return new EmbedBuilder().setColor(COLORS.error).setDescription('❌ Invalid date.');
  const unix=Math.floor(date.getTime()/1000);
  const fmts=[['t','Short Time'],['T','Long Time'],['d','Short Date'],['D','Long Date'],['f','Date/Time'],['F','Long Date/Time'],['R','Relative']];
  const desc=fmts.map(([s,l])=>`**${l}**\n<t:${unix}:${s}> → \`<t:${unix}:${s}>\``).join('\n\n');
  return new EmbedBuilder().setColor(COLORS.info).setTitle('🕐 Timestamps').setDescription(desc).setFooter({text:`Unix: ${unix}`});
}
function rollDice(input) {
  const m=input.match(/^(\d+)?d(\d+)([+-]\d+)?$/i);
  if(!m)return new EmbedBuilder().setColor(COLORS.error).setDescription('Invalid notation. Try `2d6` or `d20`.');
  const count=parseInt(m[1]??'1'),sides=parseInt(m[2]),mod=parseInt(m[3]??'0');
  if(count>100||sides>10000)return new EmbedBuilder().setColor(COLORS.error).setDescription('Too many dice/sides!');
  const rolls=Array.from({length:count},()=>Math.floor(Math.random()*sides)+1);
  const total=rolls.reduce((a,b)=>a+b,0)+mod;
  return new EmbedBuilder().setColor(COLORS.info).setTitle(`🎲 ${input.toUpperCase()}`).addFields({name:'Rolls',value:rolls.join(', '),inline:true},{name:'Total',value:`**${total}**`,inline:true});
}
function fetchMeme() {
  return new Promise(resolve=>{
    const subs=['memes','dankmemes','me_irl'],sub=subs[Math.floor(Math.random()*subs.length)];
    https.get(`https://www.reddit.com/r/${sub}/random/.json`,{headers:{'User-Agent':'discord-bot/1.0'}},res=>{
      let data=''; res.on('data',d=>data+=d); res.on('end',()=>{
        try{const j=JSON.parse(data),p=j[0]?.data?.children[0]?.data;if(!p||p.over_18)return resolve(null);resolve({title:p.title,url:p.url,ups:p.ups,subreddit:p.subreddit});}catch{resolve(null);}
      });
    }).on('error',()=>resolve(null));
  });
}
function fetchTrivia() {
  return new Promise(resolve=>{
    https.get('https://opentdb.com/api.php?amount=1&type=multiple',res=>{
      let data=''; res.on('data',d=>data+=d); res.on('end',()=>{
        try{const j=JSON.parse(data),q=j.results[0];resolve({question:q.question,correct:q.correct_answer,incorrect:q.incorrect_answers,category:q.category,difficulty:q.difficulty});}catch{resolve(null);}
      });
    }).on('error',()=>resolve(null));
  });
}
function decodeHTML(str){return str.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'");}
function googleTranslate(text,from,to){
  return new Promise(resolve=>{
    const url=`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
    https.get(url,res=>{let data='';res.on('data',d=>data+=d);res.on('end',()=>{try{const j=JSON.parse(data);resolve(j[0]?.map(s=>s[0]).join('')||null);}catch{resolve(null);}});}).on('error',()=>resolve(null));
  });
}
function fetchWeather(city){
  return new Promise(resolve=>{
    const key=process.env.WEATHER_API_KEY;
    if(!key)return resolve({name:city,country:'N/A',temp:'N/A',feels:'N/A',humidity:'N/A',wind:'N/A',description:'Add WEATHER_API_KEY to .env',visibility:0,icon:'01d'});
    https.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${key}&units=metric`,res=>{
      let data='';res.on('data',d=>data+=d);res.on('end',()=>{try{const j=JSON.parse(data);if(j.cod!==200)return resolve(null);resolve({name:j.name,country:j.sys.country,temp:j.main.temp.toFixed(1),feels:j.main.feels_like.toFixed(1),humidity:j.main.humidity,wind:j.wind.speed,description:j.weather[0].description,visibility:j.visibility,icon:j.weather[0].icon});}catch{resolve(null);}});
    }).on('error',()=>resolve(null));
  });
}
function weatherEmbed(d){
  return new EmbedBuilder().setColor(COLORS.info).setTitle(`🌤️ ${d.name}, ${d.country}`).setThumbnail(`https://openweathermap.org/img/wn/${d.icon}@2x.png`)
    .addFields({name:'🌡️ Temp',value:`${d.temp}°C (feels ${d.feels}°C)`,inline:true},{name:'💧 Humidity',value:`${d.humidity}%`,inline:true},{name:'💨 Wind',value:`${d.wind}m/s`,inline:true},{name:'☁️ Conditions',value:d.description,inline:true});
}

// ─────────────────────────────────────────────────────────────
//  AUTORESPONDER COMMANDS
// ─────────────────────────────────────────────────────────────
registerCommand({
  userPermissions:[PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder().setName('autoresponder').setDescription('Manage auto-responders').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s=>s.setName('add').setDescription('Add trigger').addStringOption(o=>o.setName('trigger').setDescription('Trigger phrase').setRequired(true)).addStringOption(o=>o.setName('response').setDescription('Response').setRequired(true)))
    .addSubcommand(s=>s.setName('delete').setDescription('Delete trigger').addStringOption(o=>o.setName('trigger').setDescription('Trigger').setRequired(true)))
    .addSubcommand(s=>s.setName('list').setDescription('List all')),
  async execute(client,i) {
    const sub=i.options.getSubcommand(),gid=i.guild.id;
    if(!client.autoResponders.has(gid))client.autoResponders.set(gid,new Map());
    const ar=client.autoResponders.get(gid);
    if(sub==='add'){const t=i.options.getString('trigger').toLowerCase(),r=i.options.getString('response');ar.set(t,r);await dbSaveAR(i.guild.id);return i.reply({embeds:[successEmbed(`AR added!\n**Trigger:** \`${t}\`\n**Response:** ${r}`)],ephemeral:true});}
    if(sub==='delete'){const t=i.options.getString('trigger').toLowerCase();if(!ar.has(t))return i.reply({embeds:[errorEmbed(`Not found: \`${t}\``)],ephemeral:true});ar.delete(t);await dbSaveAR(i.guild.id);return i.reply({embeds:[successEmbed(`Deleted: \`${t}\``)],ephemeral:true});}
    if(sub==='list'){if(!ar.size)return i.reply({embeds:[infoEmbed('No auto-responders.')],ephemeral:true});const list=[...ar.entries()].map(([t,r],i)=>`**${i+1}.** \`${t}\` → ${r}`).join('\n');return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`Auto-responders (${ar.size})`).setDescription(list)],ephemeral:true});}
  },
  name:'autoresponder',
  category:'autoresponder', aliases:['ar'], usage:'!ar add <trigger> | <response> | delete <trigger> | list',
  async run(client,msg,args) {
    const sub=args[0]?.toLowerCase(),gid=msg.guild.id;
    if(!client.autoResponders.has(gid))client.autoResponders.set(gid,new Map());
    const ar=client.autoResponders.get(gid);
    if(sub==='add'){const rest=args.slice(1).join(' ');const[trigger,...resp]=rest.split('|');if(!trigger||!resp.length)return msg.reply({embeds:[errorEmbed('Usage: !ar add <trigger> | <response>')]});ar.set(trigger.trim().toLowerCase(),resp.join('|').trim());return msg.reply({embeds:[successEmbed('AR added!')]});}
    if(sub==='delete'){const t=args.slice(1).join(' ').toLowerCase();if(!ar.has(t))return msg.reply({embeds:[errorEmbed('Not found.')]});ar.delete(t);return msg.reply({embeds:[successEmbed('Deleted.')]});}
    if(sub==='list'){if(!ar.size)return msg.reply({embeds:[infoEmbed('None.')]});return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Auto-responders').setDescription([...ar.entries()].map(([t,r],i)=>`**${i+1}.** \`${t}\` → ${r}`).join('\n'))]});}
    return msg.reply({embeds:[infoEmbed('Usage: !ar add/delete/list')]});
  },
});

// ─────────────────────────────────────────────────────────────
//  TIMEZONE COMMAND
// ─────────────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('tz').setDescription('Timezone commands')
    .addSubcommand(s=>s.setName('set').setDescription('Set your timezone').addStringOption(o=>o.setName('timezone').setDescription('IANA timezone e.g. America/New_York').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s=>s.setName('view').setDescription('View timezone').addUserOption(o=>o.setName('user').setDescription('User')))
    .addSubcommand(s=>s.setName('clear').setDescription('Remove your timezone'))
    .addSubcommand(s=>s.setName('list').setDescription('All members with timezones'))
    .addSubcommand(s=>s.setName('convert').setDescription('Convert a time').addStringOption(o=>o.setName('time').setDescription('e.g. 3:00 PM').setRequired(true)).addStringOption(o=>o.setName('from').setDescription('Source timezone').setRequired(true)).addStringOption(o=>o.setName('to').setDescription('Target timezone').setRequired(true))),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase().trim();

    // Build GMT/UTC offset labels for display
    const gmtOffsets = [];
    for (let i = -12; i <= 14; i++) {
      const sign = i >= 0 ? '+' : '-';
      const abs  = Math.abs(i);
      // Etc/GMT signs are INVERTED in IANA — Etc/GMT+3 = UTC-3
      // So we flip the sign when mapping to Etc/GMT
      const etcSign = i > 0 ? '-' : i < 0 ? '+' : '';
      const zone = i === 0 ? 'Etc/GMT' : `Etc/GMT${etcSign}${abs}`;
      const label = i === 0 ? 'GMT+0 / UTC+0' : `GMT${sign}${abs}:00 / UTC${sign}${abs}:00`;
      gmtOffsets.push({ name: label, value: zone });
    }
    // UTC offsets (same as GMT but labeled differently)
    const utcOffsets = []; // handled in gmtOffsets above (same zones)

    // Half-hour and 45-min offsets (both GMT and UTC labels)
    const specialOffsets = [
      { name: 'GMT+3:30  / UTC+3:30  (Iran)',           value: 'Asia/Tehran'        },
      { name: 'GMT+4:30  / UTC+4:30  (Afghanistan)',    value: 'Asia/Kabul'         },
      { name: 'GMT+5:30  / UTC+5:30  (India/Sri Lanka)',value: 'Asia/Kolkata'       },
      { name: 'GMT+5:45  / UTC+5:45  (Nepal)',          value: 'Asia/Kathmandu'     },
      { name: 'GMT+6:30  / UTC+6:30  (Myanmar)',        value: 'Asia/Rangoon'       },
      { name: 'GMT+9:30  / UTC+9:30  (Adelaide)',       value: 'Australia/Adelaide' },
      { name: 'GMT+12:45 / UTC+12:45 (Chatham Islands)',value: 'Pacific/Chatham'    },
      { name: 'GMT+5:30  / UTC+5:30  (Philippines)',    value: 'Asia/Manila'        },
      { name: 'GMT+8:00  / UTC+8:00  (China/PH/SG)',   value: 'Asia/Shanghai'      },
    ];

    let results;
    if (!focused) {
      results = [
        { name: 'America/New_York  (GMT-5)',  value: 'America/New_York'   },
        { name: 'America/Los_Angeles (GMT-8)', value: 'America/Los_Angeles'},
        { name: 'America/Chicago  (GMT-6)',   value: 'America/Chicago'    },
        { name: 'America/Toronto  (GMT-5)',   value: 'America/Toronto'    },
        { name: 'America/Sao_Paulo (GMT-3)',  value: 'America/Sao_Paulo'  },
        { name: 'Europe/London    (GMT+0)',   value: 'Europe/London'      },
        { name: 'Europe/Paris     (GMT+1)',   value: 'Europe/Paris'       },
        { name: 'Europe/Berlin    (GMT+1)',   value: 'Europe/Berlin'      },
        { name: 'Europe/Moscow    (GMT+3)',   value: 'Europe/Moscow'      },
        { name: 'Asia/Dubai       (GMT+4)',   value: 'Asia/Dubai'         },
        { name: 'Asia/Kolkata     (GMT+5:30)',value: 'Asia/Kolkata'       },
        { name: 'Asia/Singapore   (GMT+8)',   value: 'Asia/Singapore'     },
        { name: 'Asia/Tokyo       (GMT+9)',   value: 'Asia/Tokyo'         },
        { name: 'Asia/Manila      (GMT+8)',   value: 'Asia/Manila'        },
        { name: 'Asia/Seoul       (GMT+9)',   value: 'Asia/Seoul'         },
        { name: 'Australia/Sydney (GMT+11)',  value: 'Australia/Sydney'   },
        { name: 'Pacific/Auckland (GMT+13)',  value: 'Pacific/Auckland'   },
        { name: 'Africa/Cairo     (GMT+2)',   value: 'Africa/Cairo'       },
        { name: 'Africa/Lagos     (GMT+1)',   value: 'Africa/Lagos'       },
        { name: 'UTC              (GMT+0)',   value: 'UTC'                },
      ];
    } else {
      // Search IANA zones
      const ianaMatches = COMMON_ZONES
        .filter(z => z.toLowerCase().includes(focused))
        .map(z => ({ name: z, value: z }));

      // Search GMT + UTC offsets (e.g. user types "gmt+4" or "utc+4" or "+4")
      const gmtMatches = [...gmtOffsets, ...utcOffsets, ...specialOffsets]
        .filter(o => o.name.toLowerCase().includes(focused) || o.value.toLowerCase().includes(focused));

      // Merge, deduplicate by value
      const seen = new Set();
      results = [...gmtMatches, ...ianaMatches].filter(r => {
        if (seen.has(r.value)) return false;
        seen.add(r.value);
        return true;
      });
    }

    await interaction.respond(results.slice(0, 25));
  },
  async execute(client,i) {
    const sub=i.options.getSubcommand();
    if(sub==='set'){
      let tz=i.options.getString('timezone');
      // Handle GMT+X / UTC+X shorthand
      const gmtMatch = tz.match(/^(?:GMT|UTC)([+-]\d+)$/i);
      if(gmtMatch){
        const offset = parseInt(gmtMatch[1]);
        if(offset === 0) tz = 'Etc/GMT';
        else tz = `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
      }
      const ok=await dbSetTz(i.user.id,tz);
      if(!ok)return i.reply({embeds:[errorEmbed(`\`${tz}\` is not valid. Try \`America/New_York\` or \`GMT+8\`.`)],ephemeral:true});
      return i.reply({embeds:[successEmbed(`Timezone set to **${tz}**\n🕐 ${getCurrentTime(tz)}`)],ephemeral:true});
    }
    if(sub==='view'){const target=i.options.getUser('user')??i.user,tz=await dbGetTz(target.id);if(!tz)return i.reply({embeds:[infoEmbed(target.id===i.user.id?'No timezone set. Use `/tz set`.':'That user has no timezone set.')],ephemeral:true});return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`🕐 ${target.tag}'s Timezone`).addFields({name:'Timezone',value:tz,inline:true},{name:'Offset',value:getTzOffset(tz),inline:true},{name:'Current Time',value:getCurrentTime(tz)})]});}
    if(sub==='clear'){await dbRemoveTz(i.user.id);return i.reply({embeds:[infoEmbed('Timezone removed.')],ephemeral:true});}
    if(sub==='list'){
      await i.deferReply();
      const members=await i.guild.members.fetch();
      const entries=[];
      for(const [,m] of members){if(m.user.bot)continue;const tz=getTz(m.user.id);if(tz)entries.push({tag:m.user.tag,tz,time:getCurrentTime(tz),offset:getTzOffset(tz)});}
      if(!entries.length)return i.editReply({embeds:[infoEmbed('No members have set a timezone.')]});
      entries.sort((a,b)=>a.tz.localeCompare(b.tz));
      const desc=entries.slice(0,20).map(e=>`**${e.tag}** — \`${e.tz}\` (${e.offset})\n> ${e.time}`).join('\n\n');
      return i.editReply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🌍 Member Timezones').setDescription(desc)]});
    }
    if(sub==='convert'){
      const timeStr=i.options.getString('time'),fromTz=i.options.getString('from'),toTz=i.options.getString('to');
      try{Intl.DateTimeFormat(undefined,{timeZone:fromTz});Intl.DateTimeFormat(undefined,{timeZone:toTz});}catch{return i.reply({embeds:[errorEmbed('Invalid timezone.')],ephemeral:true});}
      const m=timeStr.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
      if(!m)return i.reply({embeds:[errorEmbed('Invalid time format. Use e.g. `3:30 PM` or `15:00`.')],ephemeral:true});
      let h=parseInt(m[1]);const mins=parseInt(m[2]),ampm=m[3]?.toLowerCase();
      if(ampm==='pm'&&h!==12)h+=12; if(ampm==='am'&&h===12)h=0;
      const srcDate=new Date(new Date().toLocaleDateString('en-US',{timeZone:fromTz}));
      srcDate.setHours(h,mins,0,0);
      const converted=new Intl.DateTimeFormat('en-US',{timeZone:toTz,hour:'2-digit',minute:'2-digit',timeZoneName:'short',hour12:true}).format(srcDate);
      return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🕐 Time Conversion').addFields({name:`📍 ${fromTz}`,value:`**${timeStr.toUpperCase()}**`,inline:true},{name:'➡️',value:'→',inline:true},{name:`📍 ${toTz}`,value:`**${converted}**`,inline:true})]});
    }
  },
  name:'tz',
  category:'utility', aliases:['timezone'], usage:'!tz set <zone> | view [@user] | clear | list | convert <time> <from> <to>',
  async run(client,msg,args) {
    const sub=args[0]?.toLowerCase();
    if(sub==='set'){
      let tz=args[1];
      if(!tz)return msg.reply({embeds:[errorEmbed('Provide a timezone. e.g. ,tz set America/New_York or GMT+8')]});
      // Handle GMT+X / UTC+X shorthand — convert to correct Etc/GMT zone (signs are flipped in IANA)
      const gmtMatch = tz.match(/^(?:GMT|UTC)([+-]\d+)$/i);
      if(gmtMatch){
        const offset = parseInt(gmtMatch[1]);
        // Flip sign for Etc/GMT
        if(offset === 0) tz = 'Etc/GMT';
        else tz = `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
      }
      const ok=setTz(msg.author.id,tz);
      if(!ok)return msg.reply({embeds:[errorEmbed(`Invalid timezone: \`${tz}\`\nTry: America/New_York, Europe/London, GMT+8, UTC-5`)]});
      return msg.reply({embeds:[successEmbed(`Timezone set to **${tz}**\n🕐 ${getCurrentTime(tz)}`)]});
    }
    if(sub==='clear'){removeTz(msg.author.id);return msg.reply({embeds:[infoEmbed('Timezone removed.')]});}
    const target=msg.mentions.users.first()??msg.author,tz=getTz(target.id);
    if(!tz)return msg.reply({embeds:[infoEmbed(`No timezone set. Use \`!tz set <timezone>\``)]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`🕐 ${target.tag}`).addFields({name:'Timezone',value:tz,inline:true},{name:'Time',value:getCurrentTime(tz)})]});
  },
});

// ─────────────────────────────────────────────────────────────
//  LEVELING COMMANDS
// ─────────────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('rank').setDescription('View your rank').addUserOption(o=>o.setName('user').setDescription('Member')),
  async execute(client,i) {
    const member = i.options.getMember('user') ?? i.member;
    const data   = await dbGetLevelUser(i.guild.id, member.user.id);
    const needed = xpForLevel(data.level);
    const cur    = data.xp ?? 0;
    const roles  = getLevelRoles(i.guild.id);
    const next   = Object.entries(roles).sort((a,b)=>parseInt(a)-parseInt(b)).find(([l])=>parseInt(l)>data.level);
    const pct    = needed > 0 ? Math.min(100, Math.round((cur/needed)*100)) : 0;
    const bar    = progressBar(cur, needed);
    return i.reply({embeds:[new EmbedBuilder()
      .setColor(member.displayHexColor||COLORS.info)
      .setAuthor({name:member.user.tag, iconURL:member.user.displayAvatarURL({dynamic:true})})
      .setThumbnail(member.user.displayAvatarURL({dynamic:true, size:256}))
      .addFields(
        {name:'🏅 Level',    value:`**${data.level}**`,                    inline:true},
        {name:'✨ Total XP', value:`**${(data.totalXp||0).toLocaleString()}**`, inline:true},
        {name:'💬 Messages', value:`**${(data.messages||0).toLocaleString()}**`, inline:true},
        {name:`📊 Progress to Level ${data.level+1}`, value:`${bar}
${cur.toLocaleString()} / ${needed.toLocaleString()} XP (${pct}%)`, inline:false},
        ...(next ? [{name:'🎭 Next Role Reward', value:`<@&${next[1]}> at level **${next[0]}**`, inline:false}] : []),
      )]});
  },
  name:'rank',
  category:'levels', aliases:['xp'], usage:'!rank [@user]',
  async run(client,msg,args) {
    const member = msg.mentions.members.first() ?? msg.member;
    const data   = await dbGetLevelUser(msg.guild.id, member.user.id);
    const needed = xpForLevel(data.level);
    const cur    = data.xp ?? 0;
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor(COLORS.info)
      .setAuthor({name:member.user.tag, iconURL:member.user.displayAvatarURL({dynamic:true})})
      .addFields(
        {name:'Level',    value:`${data.level}`,                    inline:true},
        {name:'Total XP', value:`${(data.totalXp||0).toLocaleString()}`, inline:true},
        {name:'Messages', value:`${(data.messages||0).toLocaleString()}`, inline:true},
        {name:'Progress', value:`${progressBar(cur,needed)}
${cur}/${needed} XP`, inline:false},
      )]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Server XP leaderboard'),
  async execute(client,i) {
    await i.deferReply();
    const lb=await dbGetLeaderboard(i.guild.id,10);
    if(!lb.length)return i.editReply({embeds:[infoEmbed('No XP data yet!')]});
    const medals=['🥇','🥈','🥉'];
    const lines=lb.map((e,idx)=>`${medals[idx]??`**${e.rank}.**`} <@${e.userId}> — Level **${e.level}** · ${e.totalXp.toLocaleString()} XP`);
    return i.editReply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`⭐ ${i.guild.name} Leaderboard`).setDescription(lines.join('\n'))]});
  },
  name:'leaderboard',
  category:'levels', aliases:['lb','top'], usage:'!leaderboard',
  async run(client,msg) {
    const lb=getLeaderboard(msg.guild.id,10);
    if(!lb.length)return msg.reply({embeds:[infoEmbed('No data yet.')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('⭐ Leaderboard').setDescription(lb.map((e,i)=>`**${i+1}.** <@${e.userId}> — Lv.**${e.level}** · ${e.totalXp.toLocaleString()} XP`).join('\n'))]});
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('level').setDescription('Leveling system commands')
    .addSubcommandGroup(g=>g.setName('config').setDescription('Configure leveling')
      .addSubcommand(s=>s.setName('view').setDescription('View config'))
      .addSubcommand(s=>s.setName('toggle').setDescription('Enable/disable').addBooleanOption(o=>o.setName('enabled').setDescription('Enable?').setRequired(true)))
      .addSubcommand(s=>s.setName('xp').setDescription('Set XP range').addIntegerOption(o=>o.setName('min').setDescription('Min XP').setRequired(true).setMinValue(1).setMaxValue(1000)).addIntegerOption(o=>o.setName('max').setDescription('Max XP').setRequired(true).setMinValue(1).setMaxValue(1000)))
      .addSubcommand(s=>s.setName('cooldown').setDescription('Set cooldown seconds').addIntegerOption(o=>o.setName('seconds').setDescription('Seconds').setRequired(true).setMinValue(0).setMaxValue(3600)))
      .addSubcommand(s=>s.setName('levelupchannel').setDescription('Level-up message channel').addChannelOption(o=>o.setName('channel').setDescription('Channel (omit=same channel)')))
      .addSubcommand(s=>s.setName('levelupmessage').setDescription('Level-up message. Use {user} {level} {server}').addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)))
      .addSubcommand(s=>s.setName('stackroles').setDescription('Stack level roles?').addBooleanOption(o=>o.setName('stack').setDescription('Stack?').setRequired(true)))
      .addSubcommand(s=>s.setName('dm').setDescription('DM on level-up?').addBooleanOption(o=>o.setName('enabled').setDescription('Enable?').setRequired(true)))
      .addSubcommand(s=>s.setName('ignorechannel').setDescription('Toggle XP ignore for channel').addChannelOption(o=>o.setName('channel').setDescription('Channel').setRequired(true)))
      .addSubcommand(s=>s.setName('ignorerole').setDescription('Toggle XP ignore for role').addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true))))
    .addSubcommandGroup(g=>g.setName('levelrole').setDescription('Level role rewards')
      .addSubcommand(s=>s.setName('add').setDescription('Add level role').addIntegerOption(o=>o.setName('level').setDescription('Level').setRequired(true).setMinValue(1)).addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true)))
      .addSubcommand(s=>s.setName('remove').setDescription('Remove level role').addIntegerOption(o=>o.setName('level').setDescription('Level').setRequired(true)))
      .addSubcommand(s=>s.setName('list').setDescription('List level roles')))
    .addSubcommandGroup(g=>g.setName('xp').setDescription('Manage user XP')
      .addSubcommand(s=>s.setName('set').setDescription('Set XP').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(0)))
      .addSubcommand(s=>s.setName('add').setDescription('Add XP').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(true)))
      .addSubcommand(s=>s.setName('remove').setDescription('Remove XP').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(true)))
      .addSubcommand(s=>s.setName('reset').setDescription('Reset user XP').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)))
      .addSubcommand(s=>s.setName('resetall').setDescription('Reset ALL XP (Admin only)'))),
  async execute(client,i) {
    const group=i.options.getSubcommandGroup(false),sub=i.options.getSubcommand(),gid=i.guild.id;
    if(group==='config'){
      if(!i.member.permissions.has(PermissionFlagsBits.ManageGuild))return i.reply({embeds:[errorEmbed('Need Manage Server.')],ephemeral:true});
      const cfg=getLevelConfig(gid);
      if(sub==='view'){
        const roles=getLevelRoles(gid),roleLines=Object.entries(roles).sort((a,b)=>parseInt(a)-parseInt(b)).map(([l,r])=>`Level **${l}** → <@&${r}>`).join('\n')||'None';
        return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('⭐ Leveling Config')
          .addFields({name:'Enabled',value:cfg.enabled?'Yes':'No',inline:true},{name:'XP Range',value:`${cfg.xpMin}–${cfg.xpMax}`,inline:true},{name:'Cooldown',value:`${cfg.cooldown}s`,inline:true},{name:'Level-Up Channel',value:cfg.levelUpChannel?`<#${cfg.levelUpChannel}>`:'Same channel',inline:true},{name:'DM on Level-Up',value:cfg.dmOnLevelUp?'Yes':'No',inline:true},{name:'Stack Roles',value:cfg.stackRoles?'Yes':'No',inline:true},{name:'Message',value:`\`${cfg.levelUpMessage}\``},{name:'Level Roles',value:roleLines})],ephemeral:true});
      }
      if(sub==='toggle'){setLevelConfigVal(gid,'enabled',i.options.getBoolean('enabled'));return i.reply({embeds:[successEmbed(`Leveling ${getLevelConfig(gid).enabled?'enabled':'disabled'}.`)]});}
      if(sub==='xp'){const min=i.options.getInteger('min'),max=i.options.getInteger('max');if(min>max)return i.reply({embeds:[errorEmbed('Min must be less than max.')],ephemeral:true});setLevelConfigVal(gid,'xpMin',min);setLevelConfigVal(gid,'xpMax',max);return i.reply({embeds:[successEmbed(`XP range: **${min}–${max}**`)]});}
      if(sub==='cooldown'){setLevelConfigVal(gid,'cooldown',i.options.getInteger('seconds'));return i.reply({embeds:[successEmbed(`Cooldown: **${getLevelConfig(gid).cooldown}s**`)]});}
      if(sub==='levelupchannel'){const ch=i.options.getChannel('channel');setLevelConfigVal(gid,'levelUpChannel',ch?.id??null);return i.reply({embeds:[successEmbed(ch?`Level-up channel: ${ch}.`:'Using same channel.')]});}
      if(sub==='levelupmessage'){setLevelConfigVal(gid,'levelUpMessage',i.options.getString('message'));return i.reply({embeds:[successEmbed('Level-up message updated.')]});}
      if(sub==='stackroles'){setLevelConfigVal(gid,'stackRoles',i.options.getBoolean('stack'));return i.reply({embeds:[successEmbed(`Role stacking ${getLevelConfig(gid).stackRoles?'enabled':'disabled'}.`)]});}
      if(sub==='dm'){setLevelConfigVal(gid,'dmOnLevelUp',i.options.getBoolean('enabled'));return i.reply({embeds:[successEmbed(`DM on level-up ${getLevelConfig(gid).dmOnLevelUp?'enabled':'disabled'}.`)]});}
      if(sub==='ignorechannel'){const ch=i.options.getChannel('channel'),cfg2=getLevelConfig(gid),idx=cfg2.ignoredChannels.indexOf(ch.id);if(idx>=0){cfg2.ignoredChannels.splice(idx,1);return i.reply({embeds:[successEmbed(`${ch} will earn XP.`)]});}cfg2.ignoredChannels.push(ch.id);return i.reply({embeds:[successEmbed(`${ch} will not earn XP.`)]});}
      if(sub==='ignorerole'){const role=i.options.getRole('role'),cfg2=getLevelConfig(gid),idx=cfg2.ignoredRoles.indexOf(role.id);if(idx>=0){cfg2.ignoredRoles.splice(idx,1);return i.reply({embeds:[successEmbed(`${role} earns XP.`)]});}cfg2.ignoredRoles.push(role.id);return i.reply({embeds:[successEmbed(`${role} earns no XP.`)]});}
    }
    if(group==='levelrole'){
      if(!i.member.permissions.has(PermissionFlagsBits.ManageGuild))return i.reply({embeds:[errorEmbed('Need Manage Server.')],ephemeral:true});
      if(sub==='add'){const level=i.options.getInteger('level'),role=i.options.getRole('role');if(role.managed)return i.reply({embeds:[errorEmbed('Cannot use managed roles.')],ephemeral:true});setLevelRole(gid,level,role.id);return i.reply({embeds:[successEmbed(`${role} awarded at level **${level}**.`)]});}
      if(sub==='remove'){removeLevelRole(gid,i.options.getInteger('level'));return i.reply({embeds:[successEmbed('Level role removed.')]});}
      if(sub==='list'){const roles=getLevelRoles(gid),entries=Object.entries(roles).sort((a,b)=>parseInt(a)-parseInt(b));if(!entries.length)return i.reply({embeds:[infoEmbed('No level roles. Use `/level levelrole add`.')],ephemeral:true});return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🎭 Level Roles').setDescription(entries.map(([l,r])=>`Level **${l}** → <@&${r}>`).join('\n'))],ephemeral:true});}
    }
    if(group==='xp'){
      if(!i.member.permissions.has(PermissionFlagsBits.ManageGuild))return i.reply({embeds:[errorEmbed('Need Manage Server.')],ephemeral:true});
      const target=i.options.getUser('user');
      if(sub==='set'){const amt=i.options.getInteger('amount');setUserXpVal(gid,target.id,amt);const d=getLevelUser(gid,target.id);return i.reply({embeds:[successEmbed(`Set **${target.tag}** XP to **${amt}** (Level ${d.level}).`)]});}
      if(sub==='add'){const amt=i.options.getInteger('amount');addUserXpVal(gid,target.id,amt);const d=getLevelUser(gid,target.id);return i.reply({embeds:[successEmbed(`Added **${amt} XP** to **${target.tag}** (Now: ${d.totalXp} XP, Level ${d.level}).`)]});}
      if(sub==='remove'){const amt=i.options.getInteger('amount');addUserXpVal(gid,target.id,-amt);const d=getLevelUser(gid,target.id);return i.reply({embeds:[successEmbed(`Removed **${amt} XP** from **${target.tag}** (Now: ${d.totalXp} XP, Level ${d.level}).`)]});}
      if(sub==='reset'){resetUserXp(gid,target.id);return i.reply({embeds:[successEmbed(`Reset **${target.tag}**'s XP.`)]});}
      if(sub==='resetall'){resetAllXp(gid);return i.reply({embeds:[warnEmbed('All XP reset for this server.')]});}
    }
  },
  name:'level',
  category:'levels', aliases:['lvl'], usage:'!level rank | leaderboard | config | levelrole | xp',
  async run(client,msg,args) {
    const sub=args[0]?.toLowerCase()??'rank';
    const gid=msg.guild.id;
    if(sub==='rank'||sub==='r'){
      const member=msg.mentions.members.first()??msg.member;
      const data=await dbGetLevelUser(gid,member.user.id);
      const needed=xpForLevel(data.level),cur=data.xp??0;
      return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setAuthor({name:member.user.tag,iconURL:member.user.displayAvatarURL({dynamic:true})}).addFields({name:'Level',value:`${data.level}`,inline:true},{name:'Total XP',value:`${(data.totalXp||0).toLocaleString()}`,inline:true},{name:'Messages',value:`${(data.messages||0).toLocaleString()}`,inline:true},{name:'Progress',value:`${progressBar(cur,needed)}\n${cur}/${needed} XP`})]});
    }
    if(sub==='leaderboard'||sub==='lb'){
      const lb=await dbGetLeaderboard(gid,10);
      if(!lb.length)return msg.reply({embeds:[infoEmbed('No XP data yet!')]});
      return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('⭐ Leaderboard').setDescription(lb.map((e,i)=>`**${i+1}.** <@${e.userId}> — Lv.**${e.level}** · ${e.totalXp.toLocaleString()} XP`).join('\n'))]});
    }
    if(sub==='config'){
      const cfg=getLevelConfig(gid);
      return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('⭐ Level Config').addFields({name:'Enabled',value:cfg.enabled?'Yes':'No',inline:true},{name:'XP Range',value:`${cfg.xpMin}–${cfg.xpMax}`,inline:true},{name:'Cooldown',value:`${cfg.cooldown}s`,inline:true},{name:'Stack Roles',value:cfg.stackRoles?'Yes':'No',inline:true})]});
    }
    if(sub==='toggle'){
      if(!msg.member.permissions.has(PermissionFlagsBits.ManageGuild))return msg.reply({embeds:[errorEmbed('Need Manage Server.')]});
      const cfg=getLevelConfig(gid); setLevelConfigVal(gid,'enabled',!cfg.enabled);
      return msg.reply({embeds:[successEmbed(`Leveling ${getLevelConfig(gid).enabled?'enabled':'disabled'}.`)]});
    }
    if(sub==='setxp'||sub==='xp'){
      if(!msg.member.permissions.has(PermissionFlagsBits.ManageGuild))return msg.reply({embeds:[errorEmbed('Need Manage Server.')]});
      const target=msg.mentions.users.first();const amount=parseInt(args[args.length-1]);
      if(!target||isNaN(amount))return msg.reply({embeds:[errorEmbed('Usage: `,level xp @user <amount>`')]});
      setUserXpVal(gid,target.id,amount); const d=getLevelUser(gid,target.id);
      return msg.reply({embeds:[successEmbed(`Set **${target.tag}** XP to **${amount}** (Level ${d.level}).`)]});
    }
    if(sub==='levelrole'){
      if(!msg.member.permissions.has(PermissionFlagsBits.ManageGuild))return msg.reply({embeds:[errorEmbed('Need Manage Server.')]});
      const action=args[1]?.toLowerCase();
      if(action==='list'){const roles=getLevelRoles(gid),entries=Object.entries(roles).sort((a,b)=>parseInt(a)-parseInt(b));if(!entries.length)return msg.reply({embeds:[infoEmbed('No level roles.')]});return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Level Roles').setDescription(entries.map(([l,r])=>`Level **${l}** → <@&${r}>`).join('\n'))]});}
      if(action==='add'){const level=parseInt(args[2]),role=msg.mentions.roles.first();if(!level||!role)return msg.reply({embeds:[errorEmbed('Usage: `,level levelrole add <level> @role`')]});setLevelRole(gid,level,role.id);return msg.reply({embeds:[successEmbed(`${role} at level **${level}**.`)]});}
      if(action==='remove'){const level=parseInt(args[2]);if(!level)return msg.reply({embeds:[errorEmbed('Provide a level.')]});removeLevelRole(gid,level);return msg.reply({embeds:[successEmbed(`Level role removed.`)]});}
    }
    return msg.reply({embeds:[infoEmbed('Usage: `,level rank [@user]` | `,level lb` | `,level config` | `,level toggle` | `,level levelrole add/remove/list` | `,level xp @user <amount>`')]});
  },
});

// ─────────────────────────────────────────────────────────────
//  GIVEAWAY COMMANDS
// ─────────────────────────────────────────────────────────────
registerCommand({
  userPermissions:[PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder().setName('giveaway').setDescription('Manage giveaways').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s=>s.setName('start').setDescription('Start giveaway').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)).addStringOption(o=>o.setName('duration').setDescription('e.g. 10m, 1h').setRequired(true)).addIntegerOption(o=>o.setName('winners').setDescription('Winners').setMinValue(1).setMaxValue(10)).addChannelOption(o=>o.setName('channel').setDescription('Channel')))
    .addSubcommand(s=>s.setName('end').setDescription('End early').addStringOption(o=>o.setName('message_id').setDescription('Message ID').setRequired(true)))
    .addSubcommand(s=>s.setName('reroll').setDescription('Reroll').addStringOption(o=>o.setName('message_id').setDescription('Message ID').setRequired(true))),
  async execute(client,i) {
    const sub=i.options.getSubcommand();
    if(sub==='start'){
      const prize=i.options.getString('prize'),dur=parseDuration(i.options.getString('duration')),winners=i.options.getInteger('winners')??1,ch=i.options.getChannel('channel')??i.channel;
      if(!dur)return i.reply({embeds:[errorEmbed('Invalid duration.')],ephemeral:true});
      const endsAt=Date.now()+dur;
      const msg=await ch.send({embeds:[gwEmbed(prize,winners,endsAt,i.user.id)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('giveaway_enter').setLabel('🎉 Enter').setStyle(ButtonStyle.Primary))]});
      _giveaways.set(msg.id,{prize,winners,endsAt,hostId:i.user.id,channelId:ch.id,entries:new Set()});
      setTimeout(()=>endGiveaway(msg.id),dur);
      return i.reply({embeds:[successEmbed(`Giveaway started in ${ch}!`)],ephemeral:true});
    }
    if(sub==='end'){await endGiveaway(i.options.getString('message_id'));return i.reply({embeds:[successEmbed('Giveaway ended.')],ephemeral:true});}
    if(sub==='reroll'){const gw=_giveaways.get(i.options.getString('message_id'));if(!gw?.entries.size)return i.reply({embeds:[errorEmbed('No entries found.')],ephemeral:true});const nw=pickWinners([...gw.entries],gw.winners);return i.reply({embeds:[successEmbed(`New winners: ${nw.map(w=>`<@${w}>`).join(', ')}`)]});}
  },
  name:'giveaway',
  category:'giveaway', aliases:['gw'], usage:'!giveaway start <prize> <duration>',
  async run(client,msg,args) {
    const sub=args[0]?.toLowerCase();
    if(!msg.member.permissions.has(PermissionFlagsBits.ManageGuild))return msg.reply({embeds:[errorEmbed('Need Manage Server.')]});
    if(sub==='start'){
      const prize=args.slice(2).join(' ').split('|')[0]?.trim()||args[1];
      const durStr=args[1];const winners=1;
      if(!prize||!durStr)return msg.reply({embeds:[errorEmbed('Usage: `,giveaway start <duration> <prize>`')]});
      const dur=parseDuration(durStr);
      if(!dur)return msg.reply({embeds:[errorEmbed('Invalid duration. Try 10m, 1h, 1d.')]});
      const endsAt=Date.now()+dur;
      const m=await msg.channel.send({embeds:[gwEmbed(prize,winners,endsAt,msg.author.id)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('giveaway_enter').setLabel('🎉 Enter').setStyle(ButtonStyle.Primary))]});
      _giveaways.set(m.id,{prize,winners,endsAt,hostId:msg.author.id,channelId:msg.channel.id,entries:new Set()});
      setTimeout(()=>endGiveaway(m.id),dur);
      return msg.reply({embeds:[successEmbed(`Giveaway started for **${prize}**!`)]});
    }
    if(sub==='end'){const msgId=args[1];if(!msgId)return msg.reply({embeds:[errorEmbed('Provide message ID.')]});await endGiveaway(msgId);return msg.reply({embeds:[successEmbed('Giveaway ended.')]});}
    if(sub==='reroll'){const gw=_giveaways.get(args[1]);if(!gw?.entries.size)return msg.reply({embeds:[errorEmbed('No entries found.')]});const nw=pickWinners([...gw.entries],gw.winners);return msg.reply({embeds:[successEmbed(`New winners: ${nw.map(w=>`<@${w}>`).join(', ')}`)]});}
    return msg.reply({embeds:[infoEmbed('Usage: `,giveaway start <duration> <prize>` | `,giveaway end <msgId>` | `,giveaway reroll <msgId>`')]});
  },
});

// ─────────────────────────────────────────────────────────────
//  TICKET COMMANDS
// ─────────────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('ticket').setDescription('Ticket system')
    .addSubcommand(s=>s.setName('setup').setDescription('Create ticket panel').addChannelOption(o=>o.setName('channel').setDescription('Channel for panel').setRequired(true)).addRoleOption(o=>o.setName('support_role').setDescription('Support role').setRequired(true)))
    .addSubcommand(s=>s.setName('close').setDescription('Close this ticket'))
    .addSubcommand(s=>s.setName('add').setDescription('Add user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(s=>s.setName('remove').setDescription('Remove user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true))),
  async execute(client,i) {
    const sub=i.options.getSubcommand(),gid=i.guild.id;
    if(sub==='setup'){
      const ch=i.options.getChannel('channel'),role=i.options.getRole('support_role');
      setGuildConfig(gid,'ticketSupportRole',role.id);
      await ch.send({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('🎫 Support Tickets').setDescription('Click below to open a ticket.')],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_create').setLabel('📩 Open Ticket').setStyle(ButtonStyle.Primary))]});
      return i.reply({embeds:[successEmbed(`Panel sent to ${ch}.`)],ephemeral:true});
    }
    if(sub==='close'){if(!_tickets.has(i.channel.id))return i.reply({embeds:[errorEmbed('Not a ticket.')],ephemeral:true});await i.reply({embeds:[infoEmbed('Closing in 5 seconds...')]});setTimeout(()=>i.channel.delete().catch(()=>{}),5000);_tickets.delete(i.channel.id);return;}
    if(sub==='add'||sub==='remove'){
      if(!_tickets.has(i.channel.id))return i.reply({embeds:[errorEmbed('Not a ticket.')],ephemeral:true});
      const user=i.options.getMember('user');
      if(sub==='add'){await i.channel.permissionOverwrites.edit(user,{ViewChannel:true,SendMessages:true});return i.reply({embeds:[successEmbed(`Added ${user}.`)]});}
      await i.channel.permissionOverwrites.edit(user,{ViewChannel:false}); return i.reply({embeds:[successEmbed(`Removed ${user}.`)]});
    }
  },
  name:'ticket',
  category:'tickets', aliases:['tickets'], usage:'!ticket setup|close|add|remove',
  async run(client,msg,args) {
    const sub=args[0]?.toLowerCase();
    if(sub==='close'){const ticket=_tickets.get(msg.channel.id);if(!ticket)return msg.reply({embeds:[errorEmbed('Not a ticket.')]});await msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.error).setDescription('🔒 Closing in 5 seconds...')]});_tickets.delete(msg.channel.id);setTimeout(()=>msg.channel.delete().catch(()=>{}),5000);return;}
    if(sub==='add'){if(!_tickets.has(msg.channel.id))return msg.reply({embeds:[errorEmbed('Not a ticket.')]});const user=msg.mentions.members.first();if(!user)return msg.reply({embeds:[errorEmbed('Mention a user.')]});await msg.channel.permissionOverwrites.edit(user,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});return msg.reply({embeds:[successEmbed(`Added ${user}.`)]});}
    if(sub==='remove'){if(!_tickets.has(msg.channel.id))return msg.reply({embeds:[errorEmbed('Not a ticket.')]});const user=msg.mentions.members.first();if(!user)return msg.reply({embeds:[errorEmbed('Mention a user.')]});await msg.channel.permissionOverwrites.edit(user,{ViewChannel:false});return msg.reply({embeds:[successEmbed(`Removed ${user}.`)]});}
    if(sub==='list'){const open=[..._tickets.entries()].filter(([,t])=>t.guildId===msg.guild.id);if(!open.length)return msg.reply({embeds:[infoEmbed('No open tickets.')]});return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Open Tickets').setDescription(open.map(([chId,t],i)=>`**${i+1}.** <#${chId}> — <@${t.userId}> — #${t.number}`).join('\n'))]});}
    if(sub==='rename'){if(!_tickets.has(msg.channel.id))return msg.reply({embeds:[errorEmbed('Not a ticket.')]});const name=args.slice(1).join('-').toLowerCase();if(!name)return msg.reply({embeds:[errorEmbed('Provide a name.')]});await msg.channel.setName(`ticket-${name}`);return msg.reply({embeds:[successEmbed(`Renamed.`)]});}
        const P=process.env.PREFIX||',';
    return msg.reply({embeds:[infoEmbed('**Ticket Commands:**\n'+P+'ticket close — Close ticket\n'+P+'ticket add @user — Add user\n'+P+'ticket remove @user — Remove user\n'+P+'ticket list — List tickets\n'+P+'ticket rename <n> — Rename')]});
  },
});

// ─────────────────────────────────────────────────────────────
//  HELP COMMAND
// ─────────────────────────────────────────────────────────────
registerCommand({
  name: 'help',
  aliases: ['h', 'commands', 'cmds'],
  usage: ',help [command]',
  category: 'info',

  async run(client, msg, args) {
    const PREFIX = process.env.PREFIX || ',';

    // ── Single command lookup ──────────────────────────────────
    if (args[0]) {
      const name = args[0].toLowerCase();
      const cmd  = client.prefixCmds.get(name)
                ?? client.prefixCmds.get(client.aliases.get(name));
      if (!cmd) return msg.reply({ embeds: [errorEmbed(`Command \`${name}\` not found.`)] });

      const embed = new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle(`📖 ${PREFIX}${cmd.name}`)
        .addFields(
          { name: '📝 Usage',     value: `\`${cmd.usage ?? PREFIX + cmd.name}\``, inline: false },
          { name: '🏷️ Aliases',  value: cmd.aliases?.length ? cmd.aliases.map(a => `\`${PREFIX}${a}\``).join(', ') : 'None', inline: true },
          { name: '⏱️ Cooldown', value: cmd.cooldown ? `${cmd.cooldown}s` : 'None', inline: true },
          { name: '📁 Category', value: cmd.category ?? 'general', inline: true },
        );
      return msg.reply({ embeds: [embed] });
    }

    // ── Paginated command list ─────────────────────────────────
    const CATEGORIES = {
      moderation  : { emoji: '🔨', label: 'Moderation'    },
      config      : { emoji: '⚙️',  label: 'Configuration' },
      info        : { emoji: 'ℹ️',  label: 'Info'          },
      utility     : { emoji: '🛠️',  label: 'Utility'       },
      fun         : { emoji: '🎉',  label: 'Fun'           },
      economy     : { emoji: '💰',  label: 'Economy'       },
      gambling    : { emoji: '🎰',  label: 'Gambling'      },
      shop        : { emoji: '🛒',  label: 'Shop'          },
      levels      : { emoji: '⭐',  label: 'Levels'        },
      roles       : { emoji: '🎭',  label: 'Roles'         },
      embed       : { emoji: '🖼️',  label: 'Embeds'        },
      tickets     : { emoji: '🎫',  label: 'Tickets'       },
      giveaway    : { emoji: '🎁',  label: 'Giveaways'     },
      autoresponder:{ emoji: '🤖',  label: 'Auto-Responder'},
      music       : { emoji: '🎵',  label: 'Music'         },
      booster     : { emoji: '💎',  label: 'Boosters'      },
      welcome     : { emoji: '👋',  label: 'Welcome'       },
    };

    // Group commands by category
    const grouped = {};
    for (const [, cmd] of client.prefixCmds) {
      const cat = cmd.category ?? 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(cmd);
    }

    // Build one embed per category
    const pages = [];

    // Page 0 — Overview
    const totalCmds = client.prefixCmds.size;
    const catList   = Object.entries(grouped).map(([cat, cmds]) => {
      const meta = CATEGORIES[cat] ?? { emoji: '📦', label: cat };
      return `${meta.emoji} **${meta.label}** — ${cmds.length} commands`;
    }).join('\n');

    pages.push(new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle(`📋 ${msg.guild.name} Bot Commands`)
      .setDescription(
        `**Prefix:** \`${PREFIX}\`\n` +
        `**Total Commands:** ${totalCmds}\n\n` +
        `Use \`${PREFIX}help <command>\` for details on a specific command.\n` +
        `Use the ◀ ▶ buttons to browse categories.\n\n` +
        catList
      )
      .setThumbnail(client.user.displayAvatarURL())
      .setFooter({ text: `Page 1/${Object.keys(grouped).length + 1}` })
    );

    // One page per category
    Object.entries(grouped).forEach(([cat, cmds], idx) => {
      const meta = CATEGORIES[cat] ?? { emoji: '📦', label: cat };
      const cmdList = cmds
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(cmd => {
          const aliases = cmd.aliases?.length ? ` *(${cmd.aliases.map(a=>`${PREFIX}${a}`).join(', ')})* ` : '';
          return `\`${PREFIX}${cmd.name}\`${aliases}`;
        })
        .join('  ');

      pages.push(new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle(`${meta.emoji} ${meta.label} Commands`)
        .setDescription(cmdList || 'No commands.')
        .setFooter({ text: `Page ${idx + 2}/${Object.keys(grouped).length + 1} • Use ${PREFIX}help <command> for details` })
      );
    });

    // Send with buttons
    let page = 0;
    const row = (p, total) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('help_first').setLabel('⏮').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
      new ButtonBuilder().setCustomId('help_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
      new ButtonBuilder().setCustomId('help_page').setLabel(`${p + 1}/${total}`).setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId('help_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(p === total - 1),
      new ButtonBuilder().setCustomId('help_last').setLabel('⏭').setStyle(ButtonStyle.Secondary).setDisabled(p === total - 1),
    );

    const sent = await msg.reply({ embeds: [pages[page]], components: [row(page, pages.length)] });
    const col  = sent.createMessageComponentCollector({ time: 120000, filter: b => b.user.id === msg.author.id });

    col.on('collect', async b => {
      if (b.customId === 'help_first') page = 0;
      else if (b.customId === 'help_prev')  page = Math.max(0, page - 1);
      else if (b.customId === 'help_next')  page = Math.min(pages.length - 1, page + 1);
      else if (b.customId === 'help_last')  page = pages.length - 1;
      await b.update({ embeds: [pages[page]], components: [row(page, pages.length)] });
    });

    col.on('end', () => sent.edit({ components: [] }).catch(() => {}));
  },
});

// ─────────────────────────────────────────────────────────────
//  MUSIC COMMAND
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
//  MUSIC SYSTEM
//  Uses DisTube. Install: npm install distube @distube/yt-dlp
//  Add to package.json dependencies:
//    "distube": "^4.2.3",
//    "@distube/yt-dlp": "^1.3.10"
// ─────────────────────────────────────────────────────────────

function getQueue(guildId) { return client.distube?.getQueue(guildId) ?? null; }
function checkVC(i) {
  const vc = i.member?.voice?.channel;
  if (!vc) return i.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
  return vc;
}
function checkQueue(i) {
  const q = getQueue(i.guild.id);
  if (!q) { i.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true }); return null; }
  return q;
}

function songEmbed(song, title = '🎵 Now Playing') {
  return new EmbedBuilder()
    .setColor(0x1DB954)
    .setTitle(title)
    .setDescription(`**[${song.name}](${song.url})**`)
    .setThumbnail(song.thumbnail)
    .addFields(
      { name: '⏱️ Duration',   value: song.formattedDuration ?? 'Live',      inline: true },
      { name: '👤 Requested',  value: `${song.user}`,                         inline: true },
      { name: '🔊 Volume',     value: `${song.queue?.volume ?? 100}%`,        inline: true },
    );
}

// ── /play ─────────────────────────────────────────────────────
registerCommand({
  cooldown: 3,
  data: new SlashCommandBuilder().setName('play').setDescription('Play a song or playlist')
    .addStringOption(o => o.setName('query').setDescription('Song name or YouTube/Spotify URL').setRequired(true)),
  async execute(client, i) {
    const vc = checkVC(i); if (!vc) return;
    if (!client.distube) return i.reply({ embeds: [errorEmbed('Music is not set up. Add DisTube to package.json.')], ephemeral: true });
    await i.deferReply();
    try {
      await client.distube.play(vc, i.options.getString('query'), { member: i.member, textChannel: i.channel });
      if (!i.replied && !i.deferred) return;
      await i.editReply({ embeds: [new EmbedBuilder().setColor(0x1DB954).setDescription('🎵 Added to queue!')] });
    } catch(e) {
      return i.editReply({ embeds: [errorEmbed(`Could not play: ${e.message}`)] });
    }
  },
  name: 'play',
  category: 'music', aliases: ['p'], usage: ',play <song or URL>',
  async run(client, msg, args) {
    const query = args.join(' ');
    if (!query) return msg.reply({ embeds: [errorEmbed('Provide a song name or URL.')] });
    const vc = msg.member.voice.channel;
    if (!vc) return msg.reply({ embeds: [errorEmbed('Join a voice channel first.')] });
    if (!client.distube) return msg.reply({ embeds: [errorEmbed('Music not set up.')] });
    try { await client.distube.play(vc, query, { member: msg.member, textChannel: msg.channel, message: msg }); }
    catch(e) { return msg.reply({ embeds: [errorEmbed(`Error: ${e.message}`)] }); }
  },
});

// ── /skip ─────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
  async execute(client, i) {
    const q = checkQueue(i); if (!q) return;
    try { await q.skip(); return i.reply({ embeds: [successEmbed('⏭️ Skipped!')] }); }
    catch(e) { return i.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  },
  name: 'skip',
  category: 'music', aliases: ['s', 'next'], usage: ',skip',
  async run(client, msg) {
    const q = getQueue(msg.guild.id);
    if (!q) return msg.reply({ embeds: [errorEmbed('Nothing playing.')] });
    try { await q.skip(); return msg.reply({ embeds: [successEmbed('⏭️ Skipped!')] }); }
    catch(e) { return msg.reply({ embeds: [errorEmbed(e.message)] }); }
  },
});

// ── /stop ─────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('stop').setDescription('Stop music and leave the voice channel'),
  async execute(client, i) {
    const q = checkQueue(i); if (!q) return;
    await q.stop();
    return i.reply({ embeds: [successEmbed('⏹️ Stopped and left the voice channel.')] });
  },
  name: 'stop',
  category: 'music', aliases: ['leave', 'dc'], usage: ',stop',
  async run(client, msg) {
    const q = getQueue(msg.guild.id);
    if (!q) return msg.reply({ embeds: [errorEmbed('Nothing playing.')] });
    await q.stop();
    return msg.reply({ embeds: [successEmbed('⏹️ Stopped.')] });
  },
});

// ── /pause ────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause the current song'),
  async execute(client, i) {
    const q = checkQueue(i); if (!q) return;
    if (q.paused) return i.reply({ embeds: [errorEmbed('Already paused. Use `/resume`.')], ephemeral: true });
    q.pause();
    return i.reply({ embeds: [successEmbed('⏸️ Paused.')] });
  },
  name: 'pause',
  category: 'music', aliases: [], usage: ',pause',
  async run(client, msg) {
    const q = getQueue(msg.guild.id);
    if (!q || q.paused) return msg.reply({ embeds: [errorEmbed('Nothing playing or already paused.')] });
    q.pause(); return msg.reply({ embeds: [successEmbed('⏸️ Paused.')] });
  },
});

// ── /resume ───────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('resume').setDescription('Resume the paused song'),
  async execute(client, i) {
    const q = checkQueue(i); if (!q) return;
    if (!q.paused) return i.reply({ embeds: [errorEmbed('Not paused.')], ephemeral: true });
    q.resume();
    return i.reply({ embeds: [successEmbed('▶️ Resumed.')] });
  },
  name: 'resume',
  category: 'music', aliases: ['unpause'], usage: ',resume',
  async run(client, msg) {
    const q = getQueue(msg.guild.id);
    if (!q || !q.paused) return msg.reply({ embeds: [errorEmbed('Nothing paused.')] });
    q.resume(); return msg.reply({ embeds: [successEmbed('▶️ Resumed.')] });
  },
});

// ── /nowplaying ───────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the currently playing song'),
  async execute(client, i) {
    const q = checkQueue(i); if (!q) return;
    return i.reply({ embeds: [songEmbed(q.songs[0])] });
  },
  name: 'nowplaying',
  category: 'music', aliases: ['np', 'current'], usage: ',nowplaying',
  async run(client, msg) {
    const q = getQueue(msg.guild.id);
    if (!q) return msg.reply({ embeds: [errorEmbed('Nothing playing.')] });
    return msg.reply({ embeds: [songEmbed(q.songs[0])] });
  },
});

// ── /queue ────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('queue').setDescription('Show the music queue')
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1)),
  async execute(client, i) {
    const q = checkQueue(i); if (!q) return;
    const page     = (i.options.getInteger('page') ?? 1) - 1;
    const perPage  = 10;
    const songs    = q.songs.slice(1); // exclude now playing
    const pages    = Math.max(1, Math.ceil(songs.length / perPage));
    const slice    = songs.slice(page * perPage, (page + 1) * perPage);
    const desc     = slice.length
      ? slice.map((s, idx) => `**${page * perPage + idx + 1}.** [${s.name}](${s.url}) — ${s.formattedDuration} — ${s.user}`).join('\n')
      : 'No more songs in queue.';
    return i.reply({ embeds: [new EmbedBuilder()
      .setColor(0x1DB954)
      .setTitle('🎵 Music Queue')
      .setDescription(`**Now Playing:**\n[${q.songs[0].name}](${q.songs[0].url})\n\n**Up Next:**\n${desc}`)
      .setFooter({ text: `Page ${page + 1}/${pages} • ${q.songs.length} song(s) • Volume: ${q.volume}%` })] });
  },
  name: 'queue',
  category: 'music', aliases: ['q'], usage: ',queue [page]',
  async run(client, msg) {
    const q = getQueue(msg.guild.id);
    if (!q) return msg.reply({ embeds: [errorEmbed('Nothing playing.')] });
    const songs = q.songs.slice(1).slice(0, 10);
    const desc  = songs.length ? songs.map((s,i)=>`**${i+1}.** ${s.name} — ${s.formattedDuration}`).join('\n') : 'No more songs.';
    return msg.reply({ embeds: [new EmbedBuilder().setColor(0x1DB954).setTitle('🎵 Queue')
      .setDescription(`**Now:** ${q.songs[0].name}\n\n${desc}`)
      .setFooter({ text: `${q.songs.length} song(s)` })] });
  },
});

// ── /volume ───────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('volume').setDescription('Set the music volume')
    .addIntegerOption(o => o.setName('level').setDescription('Volume 1-100').setRequired(true).setMinValue(1).setMaxValue(100)),
  async execute(client, i) {
    const q = checkQueue(i); if (!q) return;
    const vol = i.options.getInteger('level');
    q.setVolume(vol);
    return i.reply({ embeds: [successEmbed(`🔊 Volume set to **${vol}%**`)] });
  },
  name: 'volume',
  category: 'music', aliases: ['vol', 'v'], usage: ',volume <1-100>',
  async run(client, msg, args) {
    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 1 || vol > 100) return msg.reply({ embeds: [errorEmbed('Provide a number 1-100.')] });
    const q = getQueue(msg.guild.id);
    if (!q) return msg.reply({ embeds: [errorEmbed('Nothing playing.')] });
    q.setVolume(vol); return msg.reply({ embeds: [successEmbed(`🔊 Volume: **${vol}%**`)] });
  },
});

// ── /loop ─────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('loop').setDescription('Set loop mode')
    .addStringOption(o => o.setName('mode').setDescription('Loop mode').setRequired(true).addChoices(
      { name: '🚫 Off',        value: '0' },
      { name: '🔂 Song',       value: '1' },
      { name: '🔁 Queue',      value: '2' },
      { name: '🔀 Autoplay',   value: '3' },
    )),
  async execute(client, i) {
    const q = checkQueue(i); if (!q) return;
    const mode = parseInt(i.options.getString('mode'));
    q.setRepeatMode(mode);
    const LABELS = { 0: '🚫 Off', 1: '🔂 Song', 2: '🔁 Queue', 3: '🔀 Autoplay' };
    return i.reply({ embeds: [successEmbed(`Loop mode set to **${LABELS[mode]}**`)] });
  },
  name: 'loop',
  category: 'music', aliases: ['repeat'], usage: ',loop <off|song|queue>',
  async run(client, msg, args) {
    const q = getQueue(msg.guild.id);
    if (!q) return msg.reply({ embeds: [errorEmbed('Nothing playing.')] });
    const modes = { off: 0, song: 1, queue: 2, auto: 3 };
    const mode  = modes[args[0]?.toLowerCase()] ?? 0;
    q.setRepeatMode(mode);
    return msg.reply({ embeds: [successEmbed(`Loop: **${args[0] ?? 'off'}**`)] });
  },
});

// ── /shuffle ──────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the music queue'),
  async execute(client, i) {
    const q = checkQueue(i); if (!q) return;
    q.shuffle();
    return i.reply({ embeds: [successEmbed('🔀 Queue shuffled!')] });
  },
  name: 'shuffle',
  category: 'music', aliases: [], usage: ',shuffle',
  async run(client, msg) {
    const q = getQueue(msg.guild.id);
    if (!q) return msg.reply({ embeds: [errorEmbed('Nothing playing.')] });
    q.shuffle(); return msg.reply({ embeds: [successEmbed('🔀 Shuffled!')] });
  },
});

// ── /remove ───────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('remove').setDescription('Remove a song from the queue by its position')
    .addIntegerOption(o => o.setName('position').setDescription('Song position in queue').setRequired(true).setMinValue(1)),
  async execute(client, i) {
    const q = checkQueue(i); if (!q) return;
    const pos = i.options.getInteger('position');
    if (pos >= q.songs.length) return i.reply({ embeds: [errorEmbed(`Only **${q.songs.length - 1}** song(s) in queue.`)], ephemeral: true });
    const removed = q.songs.splice(pos, 1)[0];
    return i.reply({ embeds: [successEmbed(`Removed **${removed.name}** from the queue.`)] });
  },
  name: 'remove',
  category: 'music', aliases: ['rm'], usage: ',remove <position>',
  async run(client, msg, args) {
    const pos = parseInt(args[0]);
    const q   = getQueue(msg.guild.id);
    if (!q || isNaN(pos) || pos < 1 || pos >= q.songs.length) return msg.reply({ embeds: [errorEmbed('Invalid position.')] });
    const removed = q.songs.splice(pos, 1)[0];
    return msg.reply({ embeds: [successEmbed(`Removed **${removed.name}**`)] });
  },
});

// ── DisTube event handlers ────────────────────────────────────
function setupDistube() {
  if (!client.distube) return;
  client.distube
    .on('playSong', (queue, song) => {
      queue.textChannel?.send({ embeds: [songEmbed(song)] }).catch(() => {});
    })
    .on('addSong', (queue, song) => {
      queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(0x1DB954)
        .setDescription(`➕ Added **[${song.name}](${song.url})** to queue. Position: **${queue.songs.length - 1}**`)] }).catch(() => {});
    })
    .on('addList', (queue, playlist) => {
      queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(0x1DB954)
        .setDescription(`➕ Added playlist **${playlist.name}** (${playlist.songs.length} songs) to queue.`)] }).catch(() => {});
    })
    .on('error', (queue, err) => {
      queue.textChannel?.send({ embeds: [errorEmbed(`Music error: ${err.message}`)] }).catch(() => {});
      console.error('[MUSIC]', err);
    })
    .on('finish', queue => {
      queue.textChannel?.send({ embeds: [infoEmbed('Queue finished! Use `/play` to add more songs.')] }).catch(() => {});
    })
    .on('disconnect', queue => {
      queue.textChannel?.send({ embeds: [infoEmbed('Disconnected from voice channel.')] }).catch(() => {});
    })
    .on('empty', queue => {
      queue.textChannel?.send({ embeds: [infoEmbed('Voice channel is empty. Leaving...')] }).catch(() => {});
    });
}


// ─────────────────────────────────────────────────────────────
//  EMBED COMMANDS
// ─────────────────────────────────────────────────────────────
registerCommand({
  userPermissions:[PermissionFlagsBits.ManageMessages],
  data: new SlashCommandBuilder().setName('embed').setDescription('Send a quick embed').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o=>o.setName('description').setDescription('Description').setRequired(true))
    .addStringOption(o=>o.setName('title').setDescription('Title'))
    .addStringOption(o=>o.setName('color').setDescription('Hex color'))
    .addStringOption(o=>o.setName('footer').setDescription('Footer text'))
    .addChannelOption(o=>o.setName('channel').setDescription('Target channel')),
  async execute(client,i) {
    const ch=i.options.getChannel('channel')??i.channel;
    const e=new EmbedBuilder().setColor(i.options.getString('color')??'#5865F2').setDescription(i.options.getString('description'));
    if(i.options.getString('title'))e.setTitle(i.options.getString('title'));
    if(i.options.getString('footer'))e.setFooter({text:i.options.getString('footer')});
    await ch.send({embeds:[e]}); return i.reply({embeds:[successEmbed(`Embed sent to ${ch}.`)],ephemeral:true});
  },
  name:'embed',
  category:'embed', aliases:[], usage:'!embed <description>',
  async run(client,msg,args) {
    if(!args.length)return msg.reply({embeds:[errorEmbed('Provide content.')]});
    await msg.channel.send({embeds:[new EmbedBuilder().setColor(0x5865F2).setDescription(args.join(' '))]});
    await msg.delete().catch(()=>{});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageMessages],
  data: new SlashCommandBuilder().setName('copyembed').setDescription('Copy an embed from a message').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o=>o.setName('message_id').setDescription('Message ID').setRequired(true))
    .addChannelOption(o=>o.setName('source').setDescription('Source channel'))
    .addChannelOption(o=>o.setName('destination').setDescription('Where to resend')),
  async execute(client,i) {
    const source=i.options.getChannel('source')??i.channel,dest=i.options.getChannel('destination')??i.channel;
    const msg=await source.messages.fetch(i.options.getString('message_id')).catch(()=>null);
    if(!msg)return i.reply({embeds:[errorEmbed('Message not found.')],ephemeral:true});
    if(!msg.embeds.length)return i.reply({embeds:[errorEmbed('No embeds found.')],ephemeral:true});
    await dest.send({embeds:msg.embeds});
    return i.reply({embeds:[successEmbed(`Copied ${msg.embeds.length} embed(s) to ${dest}.`)],ephemeral:true});
  },
  name:'copyembed',
  category:'embed', aliases:['cloneembed'], usage:'!copyembed <message_id>',
  async run(client,msg,args) {
    const msgId=args[0]; if(!msgId)return msg.reply({embeds:[errorEmbed('Provide a message ID.')]});
    const target=await msg.channel.messages.fetch(msgId).catch(()=>null);
    if(!target||!target.embeds.length)return msg.reply({embeds:[errorEmbed('No embeds found.')]});
    await msg.channel.send({embeds:target.embeds});
    return msg.reply({embeds:[successEmbed('Embed copied!')]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageMessages],
  data: new SlashCommandBuilder().setName('embedbuilder').setDescription('Interactive embed builder').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o=>o.setName('channel').setDescription('Target channel'))
    .addStringOption(o=>o.setName('template').setDescription('Load saved template')),
  async execute(client,i) {
    const targetCh=i.options.getChannel('channel')??i.channel,tname=i.options.getString('template');
    let draft=tname?(loadTemplate(i.guild.id,tname)??blankDraft()):getDraft(i.user.id);
    if(tname&&!loadTemplate(i.guild.id,tname))return i.reply({embeds:[errorEmbed(`Template \`${tname}\` not found.`)],ephemeral:true});
    setDraft(i.user.id,draft);

    const buildPanel=d=>new EmbedBuilder().setColor(COLORS.neutral).setTitle('⚙️ Embed Builder').setDescription([`**Title:** ${d.title??'*(not set)*'}`,`**Description:** ${d.description?d.description.slice(0,60)+'…':'*(not set)*'}`,`**Color:** ${d.color}`,`**Author:** ${d.author??'*(not set)*'}`,`**Footer:** ${d.footer??'*(not set)*'}`,`**Image:** ${d.image?'✅':'❌'} **Thumbnail:** ${d.thumbnail?'✅':'❌'}`,`**Timestamp:** ${d.timestamp?'✅':'❌'} **Fields:** ${d.fields.length}/25`].join('\n')).setFooter({text:'10 min timeout'});
    const buildComponents=()=>[
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('eb_edit').setPlaceholder('✏️ Edit property...').addOptions([{label:'Title',value:'title',emoji:'📝'},{label:'Description',value:'description',emoji:'📄'},{label:'Color',value:'color',emoji:'🎨'},{label:'Author',value:'author',emoji:'👤'},{label:'Footer',value:'footer',emoji:'📌'},{label:'Thumbnail',value:'thumbnail',emoji:'🖼️'},{label:'Image',value:'image',emoji:'🌄'},{label:'URL',value:'url',emoji:'🔗'}])),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('eb_addfield').setLabel('Add Field').setStyle(ButtonStyle.Primary).setEmoji('➕'),new ButtonBuilder().setCustomId('eb_clearfields').setLabel('Clear Fields').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),new ButtonBuilder().setCustomId('eb_togglets').setLabel('Timestamp').setStyle(ButtonStyle.Secondary).setEmoji('🕐'),new ButtonBuilder().setCustomId('eb_reset').setLabel('Reset').setStyle(ButtonStyle.Danger).setEmoji('♻️')),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('eb_savetemp').setLabel('Save Template').setStyle(ButtonStyle.Secondary).setEmoji('💾'),new ButtonBuilder().setCustomId('eb_send').setLabel('Send Embed').setStyle(ButtonStyle.Success).setEmoji('🚀')),
    ];

    const msg=await i.reply({embeds:[buildPanel(draft),toDiscordEmbed(draft)],components:buildComponents(),ephemeral:true,fetchReply:true});
    const col=msg.createMessageComponentCollector({time:600000});
    col.on('collect',async bi=>{
      if(bi.user.id!==i.user.id)return bi.reply({content:'Not your builder.',ephemeral:true});
      draft=getDraft(i.user.id);
      if(bi.isStringSelectMenu()){
        const action=bi.values[0];
        const MODALS={title:['Set Title','title','Title',TextInputStyle.Short,false,256,draft.title??''],description:['Set Description','description','Description',TextInputStyle.Paragraph,false,4096,draft.description??''],color:['Set Color','color','Hex color e.g. #FF0000',TextInputStyle.Short,false,7,draft.color??'#5865F2'],author:['Set Author','author','Author Name',TextInputStyle.Short,false,256,draft.author??''],footer:['Set Footer','footer','Footer Text',TextInputStyle.Short,false,2048,draft.footer??''],thumbnail:['Set Thumbnail','thumbnail','Image URL',TextInputStyle.Short,false,2048,draft.thumbnail??''],image:['Set Image','image','Image URL',TextInputStyle.Short,false,2048,draft.image??''],url:['Set URL','url','URL',TextInputStyle.Short,false,2048,draft.url??'']};
        const m=MODALS[action]; if(!m)return;
        const modal=new ModalBuilder().setCustomId(`ebm_${action}`).setTitle(m[0]).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(m[1]).setLabel(m[2]).setStyle(m[3]).setRequired(m[4]).setMaxLength(m[5]).setValue(m[6])));
        await bi.showModal(modal);
        const sub=await bi.awaitModalSubmit({time:120000}).catch(()=>null); if(!sub)return;
        const val=sub.fields.getTextInputValue(m[1]).trim()||null;
        draft[action]=val; setDraft(i.user.id,draft);
        return sub.update({embeds:[buildPanel(draft),toDiscordEmbed(draft)],components:buildComponents()});
      }
      if(bi.customId==='eb_addfield'){
        const modal=new ModalBuilder().setCustomId('ebm_addfield').setTitle('Add Field').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fname').setLabel('Field Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fvalue').setLabel('Field Value').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1024)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('finline').setLabel('Inline? (yes/no)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(3)));
        await bi.showModal(modal);
        const sub=await bi.awaitModalSubmit({time:120000}).catch(()=>null); if(!sub)return;
        if(draft.fields.length>=25)return sub.reply({content:'Max 25 fields.',ephemeral:true});
        draft.fields.push({name:sub.fields.getTextInputValue('fname'),value:sub.fields.getTextInputValue('fvalue'),inline:sub.fields.getTextInputValue('finline')?.toLowerCase().startsWith('y')??false});
        setDraft(i.user.id,draft); return sub.update({embeds:[buildPanel(draft),toDiscordEmbed(draft)],components:buildComponents()});
      }
      if(bi.customId==='eb_clearfields'){draft.fields=[];setDraft(i.user.id,draft);return bi.update({embeds:[buildPanel(draft),toDiscordEmbed(draft)],components:buildComponents()});}
      if(bi.customId==='eb_togglets'){draft.timestamp=!draft.timestamp;setDraft(i.user.id,draft);return bi.update({embeds:[buildPanel(draft),toDiscordEmbed(draft)],components:buildComponents()});}
      if(bi.customId==='eb_reset'){const f=blankDraft();setDraft(i.user.id,f);return bi.update({embeds:[buildPanel(f),toDiscordEmbed(f)],components:buildComponents()});}
      if(bi.customId==='eb_savetemp'){
        const modal=new ModalBuilder().setCustomId('ebm_savetemp').setTitle('Save Template').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tname').setLabel('Template Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)));
        await bi.showModal(modal);
        const sub=await bi.awaitModalSubmit({time:60000}).catch(()=>null); if(!sub)return;
        const name=sub.fields.getTextInputValue('tname');
        saveTemplate(i.guild.id,name,draft);
        await sub.update({embeds:[buildPanel(draft),toDiscordEmbed(draft)],components:buildComponents()});
        return sub.followUp({embeds:[successEmbed(`Template **${name}** saved!`)],ephemeral:true});
      }
      if(bi.customId==='eb_send'){
        if(!draft.description&&!draft.title&&!draft.fields?.length)return bi.reply({embeds:[errorEmbed('Add content before sending.')],ephemeral:true});
        await targetCh.send({embeds:[toDiscordEmbed(draft)]});
        clearDraft(i.user.id);
        return bi.update({embeds:[successEmbed(`Embed sent to ${targetCh}! 🎉`)],components:[]});
      }
    });
    col.on('end',(_,r)=>{if(r==='time')i.editReply({components:[]}).catch(()=>{});});
  },
  name:'embedbuilder',
  category:'embed', aliases:['eb'], usage:'!embedbuilder',
  async run(client,msg,args) {
    const sub=args[0]?.toLowerCase();
    if(sub==='template'||sub==='templates'){
      const tmps=listTemplates(msg.guild.id);
      if(!tmps.length)return msg.reply({embeds:[infoEmbed('No templates. Use `/embedbuilder` to create and save one.')]});
      return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Embed Templates').setDescription(tmps.map((t,i)=>`**${i+1}.** \`${t.name}\``).join('\n'))]});
    }
    if(sub==='send'&&args[1]){
      const tmpl=loadTemplate(msg.guild.id,args[1].toLowerCase());
      if(!tmpl)return msg.reply({embeds:[errorEmbed(`Template \`${args[1]}\` not found.`)]});
      return msg.channel.send({embeds:[toDiscordEmbed(tmpl)]});
    }
    return msg.reply({embeds:[infoEmbed('Use `/embedbuilder` for the interactive builder.\n\n**Prefix commands:**\n`,embedbuilder templates` — list templates\n`,embedbuilder send <name>` — send a template')]});
  },
});

registerCommand({
  userPermissions:[PermissionFlagsBits.ManageMessages],
  data: new SlashCommandBuilder().setName('embedtemplates').setDescription('Manage embed templates').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s=>s.setName('list').setDescription('List templates'))
    .addSubcommand(s=>s.setName('preview').setDescription('Preview template').addStringOption(o=>o.setName('name').setDescription('Name').setRequired(true)))
    .addSubcommand(s=>s.setName('send').setDescription('Send template').addStringOption(o=>o.setName('name').setDescription('Name').setRequired(true)).addChannelOption(o=>o.setName('channel').setDescription('Channel')))
    .addSubcommand(s=>s.setName('delete').setDescription('Delete template').addStringOption(o=>o.setName('name').setDescription('Name').setRequired(true))),
  async execute(client,i) {
    const sub=i.options.getSubcommand(),gid=i.guild.id;
    if(sub==='list'){const tmps=listTemplates(gid);if(!tmps.length)return i.reply({embeds:[infoEmbed('No templates. Use `/embedbuilder` and save one.')],ephemeral:true});return i.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('📁 Templates').setDescription(tmps.map((t,n)=>`**${n+1}.** \`${t.name}\``).join('\n'))],ephemeral:true});}
    const name=i.options.getString('name'),tmpl=loadTemplate(gid,name);
    if(!tmpl)return i.reply({embeds:[errorEmbed(`Template \`${name}\` not found.`)],ephemeral:true});
    if(sub==='preview')return i.reply({embeds:[toDiscordEmbed(tmpl)],ephemeral:true});
    if(sub==='send'){const ch=i.options.getChannel('channel')??i.channel;await ch.send({embeds:[toDiscordEmbed(tmpl)]});return i.reply({embeds:[successEmbed(`Template sent to ${ch}.`)],ephemeral:true});}
    if(sub==='delete'){deleteTemplate(gid,name);return i.reply({embeds:[successEmbed(`Template \`${name}\` deleted.`)],ephemeral:true});}
  },
  name:'embedtemplates',
  category:'embed', aliases:['etemplates'], usage:'!embedtemplates list|preview|send|delete',
  async run(client,msg,args) {
    const sub=args[0]?.toLowerCase(),gid=msg.guild.id;
    if(sub==='list'){const tmps=listTemplates(gid);return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Templates').setDescription(tmps.length?tmps.map((t,n)=>`**${n+1}.** \`${t.name}\``).join('\n'):'None.')]});}
    if(sub==='delete'){deleteTemplate(gid,args[1]);return msg.reply({embeds:[successEmbed(`Deleted \`${args[1]}\`.`)]});}
    if(sub==='send'&&args[1]){const tmpl=loadTemplate(msg.guild.id,args[1].toLowerCase());if(!tmpl)return msg.reply({embeds:[errorEmbed('Template not found.')]});return msg.channel.send({embeds:[toDiscordEmbed(tmpl)]});}
    if(sub==='preview'&&args[1]){const tmpl=loadTemplate(msg.guild.id,args[1].toLowerCase());if(!tmpl)return msg.reply({embeds:[errorEmbed('Template not found.')]});return msg.reply({embeds:[toDiscordEmbed(tmpl)]});}
    return msg.reply({embeds:[infoEmbed('Usage: `,embedtemplates list` | `,embedtemplates send <name>` | `,embedtemplates preview <name>` | `,embedtemplates delete <name>`')]});
  },
});

// ─────────────────────────────────────────────────────────────
//  EVENTS
// ─────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  client.user.setActivity('your server | /help', { type: 3 });
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  // AFK check
  const guildAfk = _afkMap.get(message.guild.id);
  if (guildAfk?.has(message.author.id)) {
    guildAfk.delete(message.author.id);
    const m = await message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.success).setDescription(`👋 Welcome back <@${message.author.id}>! AFK removed.`)] }).catch(() => {});
    if (m) setTimeout(() => m.delete().catch(() => {}), 5000);
  }
  if (message.mentions.users.size && guildAfk) {
    for (const [, user] of message.mentions.users) {
      const afkData = guildAfk.get(user.id);
      if (afkData) {
        const m = await message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.warn).setDescription(`💤 **${user.tag}** is AFK: ${afkData.reason}\n*Since <t:${Math.floor(afkData.since / 1000)}:R>*`)] }).catch(() => {});
        if (m) setTimeout(() => m.delete().catch(() => {}), 8000);
        break;
      }
    }
  }

  // Counting game
  const cData = _counting.get(message.channel.id);
  if (cData) {
    const num = parseInt(message.content.trim());
    if (!isNaN(num)) {
      if (num === cData.count + 1 && message.author.id !== cData.lastUser) {
        cData.count = num; cData.lastUser = message.author.id;
        await message.react('✅').catch(() => {});
      } else {
        const old = cData.count; cData.count = 0; cData.lastUser = null;
        await message.react('❌').catch(() => {});
        await message.reply(`❌ **${message.author.tag}** ruined it at **${old}**! ${num !== old + 1 ? `(Expected ${old + 1})` : '(Same person twice)'} Start from 1!`).catch(() => {});
      }
    }
  }

  // Auto-responder
  const ar = client.autoResponders?.get(message.guild.id);
  if (ar) {
    const lower = message.content.toLowerCase();
    for (const [trigger, response] of ar) {
      if (lower.includes(trigger.toLowerCase())) {
        await message.channel.send(response).catch(() => {});
        break;
      }
    }
  }

  // XP / Leveling
  const lvlCfg = getLevelConfig(message.guild.id);
  if (lvlCfg.enabled && !lvlCfg.ignoredChannels.includes(message.channel.id)) {
    const memberRoles = message.member.roles.cache.map(r => r.id);
    if (!lvlCfg.ignoredRoles.some(r => memberRoles.includes(r))) {
      const result = await dbAwardXp(message.guild.id, message.author.id);
      if (result?.leveledUp) {
        const { newLevel } = result;
        const levelRoles = getLevelRoles(message.guild.id);
        const lvlCh = lvlCfg.levelUpChannel ? (message.guild.channels.cache.get(lvlCfg.levelUpChannel) ?? message.channel) : message.channel;
        await sendParsed(lvlCh, lvlCfg.levelUpMessage, {
          user   : `<@${message.author.id}>`,
          tag    : message.author.tag,
          server : message.guild.name,
          count  : message.guild.memberCount.toString(),
          level  : newLevel.toString(),
        }).catch(() => {});
        if (lvlCfg.dmOnLevelUp) await message.author.send({ embeds: [new EmbedBuilder().setColor(COLORS.success).setTitle('⭐ Level Up!').setDescription(`You reached **level ${newLevel}** in **${message.guild.name}**!`)] }).catch(() => {});
        const rolesToAdd = Object.entries(levelRoles).filter(([l]) => parseInt(l) <= newLevel).map(([, r]) => r);
        if (rolesToAdd.length) {
          if (!lvlCfg.stackRoles) {
            for (const roleId of Object.values(levelRoles)) {
              if (!rolesToAdd.includes(roleId)) await message.member.roles.remove(roleId).catch(() => {});
            }
          }
          for (const roleId of rolesToAdd) await message.member.roles.add(roleId).catch(() => {});
        }
      }
    }
  }

  // Prefix commands
  if (!message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  const command = resolveCommand(message.guild.id, commandName);
  if (!command) return;
  const resolved = command.name;

  if (command.cooldown) {
    const key = `prefix-${resolved}-${message.author.id}`;
    if (!client.cooldowns.has(key)) {
      client.cooldowns.set(key, Date.now());
      setTimeout(() => client.cooldowns.delete(key), command.cooldown * 1000);
    } else {
      const rem = ((client.cooldowns.get(key) + command.cooldown * 1000 - Date.now()) / 1000).toFixed(1);
      return message.reply({ embeds: [errorEmbed(`Wait **${rem}s**.`)] });
    }
  }
  if (command.userPermissions) {
    const missing = message.member.permissions.missing(command.userPermissions);
    if (missing.length) return message.reply({ embeds: [errorEmbed(`You need: ${missing.map(p => `\`${p}\``).join(', ')}`)] });
  }
  try { await command.run(client, message, args); }
  catch (err) { console.error(`[ERR] ${PREFIX}${resolved}:`, err); message.reply({ embeds: [errorEmbed('Something went wrong.')] }).catch(() => {}); }
});

client.on('messageDelete', async message => {
  if (message.author && !message.author.bot) {
    client.snipes.set(message.channel.id, { content: message.content, author: message.author, deletedAt: Date.now() });
    setTimeout(() => client.snipes.delete(message.channel.id), 300000);
  }
  if (!message.guild || message.author?.bot) return;
  await sendLog(message.guild.id, 'messagelog', new EmbedBuilder().setColor(COLORS.error).setTitle('🗑️ Message Deleted')
    .setAuthor({ name: message.author?.tag ?? 'Unknown', iconURL: message.author?.displayAvatarURL() })
    .addFields({ name: 'Channel', value: `<#${message.channel.id}>`, inline: true }, { name: 'Content', value: (message.content || '*empty*').slice(0, 1024) })
    .setFooter({ text: `Msg ID: ${message.id}` }).setTimestamp());
});

client.on('messageUpdate', async (oldMsg, newMsg) => {
  if (!oldMsg.guild || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
  await sendLog(oldMsg.guild.id, 'messagelog', new EmbedBuilder().setColor(COLORS.warn).setTitle('✏️ Message Edited')
    .setAuthor({ name: oldMsg.author.tag, iconURL: oldMsg.author.displayAvatarURL() })
    .addFields({ name: 'Channel', value: `<#${oldMsg.channel.id}>`, inline: true }, { name: 'Before', value: (oldMsg.content || '*empty*').slice(0, 1024) }, { name: 'After', value: (newMsg.content || '*empty*').slice(0, 1024) })
    .setTimestamp());
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!newState.guild || newState.member?.user.bot) return;
  const member = newState.member, gid = newState.guild.id;
  const e = new EmbedBuilder().setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() }).setTimestamp().setFooter({ text: `ID: ${member.id}` });
  if (!oldState.channel && newState.channel) {
    e.setColor(COLORS.success).setTitle('🔊 Joined Voice').addFields({ name: 'Member', value: `<@${member.id}>`, inline: true }, { name: 'Channel', value: `<#${newState.channel.id}>`, inline: true });
    return sendLog(gid, 'voicelog', e);
  }
  if (oldState.channel && !newState.channel) {
    e.setColor(COLORS.error).setTitle('🔇 Left Voice').addFields({ name: 'Member', value: `<@${member.id}>`, inline: true }, { name: 'Channel', value: `<#${oldState.channel.id}>`, inline: true });
    return sendLog(gid, 'voicelog', e);
  }
  if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
    e.setColor(COLORS.warn).setTitle('🔀 Voice Move').addFields({ name: 'Member', value: `<@${member.id}>` }, { name: 'From', value: `<#${oldState.channel.id}>`, inline: true }, { name: 'To', value: `<#${newState.channel.id}>`, inline: true });
    return sendLog(gid, 'voicelog', e);
  }
  if (oldState.serverMute !== newState.serverMute) {
    e.setColor(COLORS.warn).setTitle(newState.serverMute ? '🔇 Server Muted' : '🔊 Unmuted').addFields({ name: 'Member', value: `<@${member.id}>`, inline: true });
    return sendLog(gid, 'voicelog', e);
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  const gid = reaction.message.guild?.id; if (!gid) return;
  await sendLog(gid, 'reactionlog', new EmbedBuilder().setColor(COLORS.success).setTitle('😀 Reaction Added').addFields({ name: 'User', value: `<@${user.id}>`, inline: true }, { name: 'Emoji', value: reaction.emoji.toString(), inline: true }, { name: 'Channel', value: `<#${reaction.message.channel.id}>`, inline: true }).setTimestamp());
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  const gid = reaction.message.guild?.id; if (!gid) return;
  await sendLog(gid, 'reactionlog', new EmbedBuilder().setColor(COLORS.error).setTitle('😶 Reaction Removed').addFields({ name: 'User', value: `<@${user.id}>`, inline: true }, { name: 'Emoji', value: reaction.emoji.toString(), inline: true }).setTimestamp());
});

client.on('channelCreate', async ch => {
  if (!ch.guild) return;
  await sendLog(ch.guild.id, 'adminlog', new EmbedBuilder().setColor(COLORS.success).setTitle('📢 Channel Created').addFields({ name: 'Channel', value: `<#${ch.id}> (\`${ch.name}\`)`, inline: true }).setTimestamp());
});
client.on('channelDelete', async ch => {
  if (!ch.guild) return;
  await sendLog(ch.guild.id, 'adminlog', new EmbedBuilder().setColor(COLORS.error).setTitle('🗑️ Channel Deleted').addFields({ name: 'Channel', value: `\`#${ch.name}\``, inline: true }).setTimestamp());
});
client.on('roleCreate', async role => {
  await sendLog(role.guild.id, 'adminlog', new EmbedBuilder().setColor(COLORS.success).setTitle('🎭 Role Created').addFields({ name: 'Role', value: `${role} (\`${role.name}\`)`, inline: true }).setTimestamp());
});
client.on('roleDelete', async role => {
  await sendLog(role.guild.id, 'adminlog', new EmbedBuilder().setColor(COLORS.error).setTitle('🗑️ Role Deleted').addFields({ name: 'Role', value: `\`${role.name}\``, inline: true }).setTimestamp());
});
client.on('guildMemberAdd', async member => {
  const cfg = getGuildConfig(member.guild.id);
  // Auto-role
  if (cfg.autoroleId) {
    const autoRole = member.guild.roles.cache.get(cfg.autoroleId);
    if (autoRole) await member.roles.add(autoRole).catch(() => {});
  }

  if (cfg.welcomeChannel) {
    const ch = member.guild.channels.cache.get(cfg.welcomeChannel);
    if (ch) {
      const raw = cfg.welcomeMessage || 'Welcome {user} to **{server}**! You are member #{count}.';
      await sendParsed(ch, raw, {
        user   : `<@${member.id}>`,
        tag    : member.user.tag,
        server : member.guild.name,
        count  : member.guild.memberCount.toString(),
        avatar : member.user.displayAvatarURL({ dynamic: true, size: 1024 }),
        channel: cfg.welcomeChannel ? `<#${cfg.welcomeChannel}>` : '',
      }).catch(() => {});
    }
  }
  await sendLog(member.guild.id, 'adminlog', new EmbedBuilder().setColor(COLORS.success).setTitle('📥 Member Joined').setThumbnail(member.user.displayAvatarURL()).addFields({ name: 'User', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true }, { name: 'Account Age', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }).setTimestamp());
});
client.on('guildMemberRemove', async member => {
  await sendLog(member.guild.id, 'adminlog', new EmbedBuilder().setColor(COLORS.error).setTitle('📤 Member Left').setThumbnail(member.user.displayAvatarURL()).addFields({ name: 'User', value: `\`${member.user.tag}\``, inline: true }).setTimestamp());
});
client.on('guildBanAdd', async ban => {
  await sendLog(ban.guild.id, 'modlog', new EmbedBuilder().setColor(COLORS.error).setTitle('🔨 Member Banned').addFields({ name: 'User', value: `\`${ban.user.tag}\``, inline: true }, { name: 'Reason', value: ban.reason ?? 'None', inline: true }).setTimestamp());
});
client.on('guildBanRemove', async ban => {
  await sendLog(ban.guild.id, 'modlog', new EmbedBuilder().setColor(COLORS.success).setTitle('✅ Member Unbanned').addFields({ name: 'User', value: `\`${ban.user.tag}\``, inline: true }).setTimestamp());
});

client.on('interactionCreate', async interaction => {
  // Autocomplete
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd?.autocomplete) await cmd.autocomplete(interaction).catch(console.error);
    return;
  }

  // Buttons
  if (interaction.isButton()) {
    // Ticket open
    if (interaction.customId === 'ticket_create') {
      const gid = interaction.guild.id, cfg = getGuildConfig(gid);
      const role = cfg.ticketSupportRole ? interaction.guild.roles.cache.get(cfg.ticketSupportRole) : null;
      _ticketCounter++;
      const num = String(_ticketCounter).padStart(4, '0');
      const ch = await interaction.guild.channels.create({
        name: `ticket-${num}`, type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone, deny: ['ViewChannel'] },
          { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
          ...(role ? [{ id: role.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }] : []),
          { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'] },
        ],
      });
      _tickets.set(ch.id, { userId: interaction.user.id, guildId: gid, number: num });
      await ch.send({ content: `${interaction.user}${role ? ` | ${role}` : ''}`, embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`🎫 Ticket #${num}`).setDescription(`Hello ${interaction.user}! Support will be with you shortly.\n\nUse \`/ticket close\` to close.`).setTimestamp()], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close_btn').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger))] });
      return interaction.reply({ content: `✅ Ticket: ${ch}`, ephemeral: true });
    }
    // Ticket close button
    if (interaction.customId === 'ticket_close_btn') {
      const ticket = _tickets.get(interaction.channel.id);
      if (!ticket) { await interaction.channel.delete().catch(() => {}); return; }
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.error).setTitle('🔒 Closing Ticket').setDescription(`Closed by ${interaction.user}\n\nDeleting in **5 seconds**...`)] });
      _tickets.delete(interaction.channel.id);
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
      return;
    }
    // Giveaway entry
    if (interaction.customId === 'giveaway_enter') {
      const gw = _giveaways.get(interaction.message.id);
      if (!gw) return interaction.reply({ content: 'This giveaway has ended.', ephemeral: true });
      if (gw.entries.has(interaction.user.id)) { gw.entries.delete(interaction.user.id); return interaction.reply({ content: '❌ You left the giveaway.', ephemeral: true }); }
      gw.entries.add(interaction.user.id); return interaction.reply({ content: '🎉 Entered!', ephemeral: true });
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return interaction.reply({ content: 'Commands can only be used in a server.', ephemeral: true }).catch(() => {});
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  if (command.cooldown) {
    const key = `${interaction.commandName}-${interaction.user.id}`;
    if (!client.cooldowns.has(key)) {
      client.cooldowns.set(key, Date.now());
      setTimeout(() => client.cooldowns.delete(key), command.cooldown * 1000);
    } else {
      const rem = ((client.cooldowns.get(key) + command.cooldown * 1000 - Date.now()) / 1000).toFixed(1);
      return interaction.reply({ embeds: [errorEmbed(`Wait **${rem}s**.`)], ephemeral: true });
    }
  }
  if (command.userPermissions && interaction.member) {
    const missing = interaction.member.permissions.missing(command.userPermissions);
    if (missing.length) return interaction.reply({ embeds: [errorEmbed(`You need: ${missing.map(p => `\`${p}\``).join(', ')}`)], ephemeral: true });
  }
  try { await command.execute(client, interaction); }
  catch (err) {
    console.error(`[ERR] /${interaction.commandName}:`, err);
    const reply = { embeds: [errorEmbed('Something went wrong.')], ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
});


// ─────────────────────────────────────────────────────────────
//  BOOSTER SYSTEM
// ─────────────────────────────────────────────────────────────
const _boosterConfig = new Map(); // Map<guildId, boosterConfig>

function getBoosterConfig(guildId) {
  if (!_boosterConfig.has(guildId)) _boosterConfig.set(guildId, {
    boostMessage   : null,  // raw message string (supports {embed} syntax)
    boostChannel   : null,  // channelId
    boosterRoleId  : null,  // auto-assigned role
    perks          : [],    // [{ name, description }]
  });
  return _boosterConfig.get(guildId);
}

// ── /booster command ─────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder()
    .setName('booster')
    .setDescription('Configure the server booster system')
    .addSubcommandGroup(g => g
      .setName('config')
      .setDescription('Configure boost settings')
      .addSubcommand(s => s
        .setName('message')
        .setDescription('Set the boost message (supports {embed} syntax)')
        .addStringOption(o => o.setName('message').setDescription('Boost message. Use {user} {server} {count}. Start with {embed} for embed.').setRequired(true)))
      .addSubcommand(s => s
        .setName('channel')
        .setDescription('Set the channel to send boost messages in')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
      .addSubcommand(s => s
        .setName('view')
        .setDescription('View current booster config')))
    .addSubcommandGroup(g => g
      .setName('role')
      .setDescription('Manage the booster role')
      .addSubcommand(s => s
        .setName('create')
        .setDescription('Create a new booster role')
        .addStringOption(o => o.setName('name').setDescription('Role name').setRequired(true))
        .addStringOption(o => o.setName('color').setDescription('Hex color e.g. #FF73FA'))
        .addStringOption(o => o.setName('icon').setDescription('Emoji icon for the role e.g. 💎')))
      .addSubcommand(s => s
        .setName('set')
        .setDescription('Set an existing role as the booster role')
        .addRoleOption(o => o.setName('role').setDescription('Role to assign to boosters').setRequired(true)))
      .addSubcommand(s => s
        .setName('edit')
        .setDescription('Edit the booster role name, color or icon')
        .addStringOption(o => o.setName('name').setDescription('New name'))
        .addStringOption(o => o.setName('color').setDescription('New hex color'))
        .addStringOption(o => o.setName('icon').setDescription('New emoji icon')))
      .addSubcommand(s => s
        .setName('clear')
        .setDescription('Remove the assigned booster role')))
    .addSubcommandGroup(g => g
      .setName('perks')
      .setDescription('Manage booster perks list')
      .addSubcommand(s => s
        .setName('add')
        .setDescription('Add a perk to the booster perks list')
        .addStringOption(o => o.setName('name').setDescription('Perk name').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Perk description').setRequired(true)))
      .addSubcommand(s => s
        .setName('remove')
        .setDescription('Remove a perk')
        .addIntegerOption(o => o.setName('number').setDescription('Perk number from /booster perks list').setRequired(true).setMinValue(1)))
      .addSubcommand(s => s
        .setName('list')
        .setDescription('View all booster perks'))),

  async execute(client, i) {
    if (!i.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
        getGuildConfig(i.guild.id).ownerRoleId !== i.guild.id &&
        !i.member.roles.cache.has(getGuildConfig(i.guild.id).ownerRoleId) &&
        !i.member.roles.cache.has(getGuildConfig(i.guild.id).coOwnerRoleId)) {
      return i.reply({ embeds: [errorEmbed('You need **Manage Server**, Owner role, or Co-Owner role.')], ephemeral: true });
    }

    const group = i.options.getSubcommandGroup();
    const sub   = i.options.getSubcommand();
    const gid   = i.guild.id;
    const cfg   = getBoosterConfig(gid);

    // ── Config ──────────────────────────────────────────────
    if (group === 'config') {
      if (sub === 'message') {
        cfg.boostMessage = i.options.getString('message');
        return i.reply({ embeds: [successEmbed(`Boost message set!\n\nUse \`/booster config view\` to see it.\nUse \`/embedtest\` to preview your embed syntax.`)] });
      }
      if (sub === 'channel') {
        const ch = i.options.getChannel('channel');
        cfg.boostChannel = ch.id;
        return i.reply({ embeds: [successEmbed(`Boost messages will be sent to ${ch}.`)] });
      }
      if (sub === 'view') {
        const role = cfg.boosterRoleId ? i.guild.roles.cache.get(cfg.boosterRoleId) : null;
        const ch   = cfg.boostChannel  ? `<#${cfg.boostChannel}>` : 'Not set';
        return i.reply({ embeds: [new EmbedBuilder()
          .setColor(0xFF73FA)
          .setTitle('💎 Booster System Config')
          .addFields(
            { name: '📢 Boost Channel',  value: ch,                                         inline: true },
            { name: '🎭 Booster Role',   value: role ? `${role}` : 'Not set',               inline: true },
            { name: '💬 Boost Message',  value: cfg.boostMessage ? `\`\`\`\n${cfg.boostMessage.slice(0,200)}\n\`\`\`` : 'Not set', inline: false },
            { name: `🎁 Perks (${cfg.perks.length})`, value: cfg.perks.length ? cfg.perks.map((p,i) => `**${i+1}.** ${p.name} — ${p.description}`).join('\n') : 'None', inline: false },
          )], ephemeral: true });
      }
    }

    // ── Role ────────────────────────────────────────────────
    if (group === 'role') {
      if (sub === 'create') {
        const name  = i.options.getString('name');
        const color = i.options.getString('color') ?? '#FF73FA';
        const icon  = i.options.getString('icon');

        const role = await i.guild.roles.create({
          name,
          color,
          reason: `Booster role created by ${i.user.tag}`,
        });

        // Set unicode emoji icon if provided (requires server level 2+)
        if (icon && i.guild.premiumTier >= 2) {
          await role.setUnicodeEmoji(icon).catch(() => {});
        }

        cfg.boosterRoleId = role.id;
        return i.reply({ embeds: [successEmbed(`Booster role ${role} created!\n${icon ? `Icon: ${icon}\n` : ''}Color: ${color}\n\nAll current and future boosters will get this role automatically.`)] });
      }

      if (sub === 'set') {
        const role = i.options.getRole('role');
        cfg.boosterRoleId = role.id;
        return i.reply({ embeds: [successEmbed(`${role} set as the booster role. Boosters will receive it automatically!`)] });
      }

      if (sub === 'edit') {
        if (!cfg.boosterRoleId) return i.reply({ embeds: [errorEmbed('No booster role set. Use `/booster role create` or `/booster role set` first.')], ephemeral: true });
        const role  = i.guild.roles.cache.get(cfg.boosterRoleId);
        if (!role)  return i.reply({ embeds: [errorEmbed('Booster role not found.')], ephemeral: true });
        const name  = i.options.getString('name');
        const color = i.options.getString('color');
        const icon  = i.options.getString('icon');
        if (name)  await role.setName(name);
        if (color) await role.setColor(color);
        if (icon && i.guild.premiumTier >= 2) await role.setUnicodeEmoji(icon).catch(() => {});
        return i.reply({ embeds: [successEmbed(`Booster role updated!\n${name ? `Name: ${name}\n` : ''}${color ? `Color: ${color}\n` : ''}${icon ? `Icon: ${icon}` : ''}`)] });
      }

      if (sub === 'clear') {
        cfg.boosterRoleId = null;
        return i.reply({ embeds: [infoEmbed('Booster role cleared. New boosters will no longer receive a role.')] });
      }
    }

    // ── Perks ───────────────────────────────────────────────
    if (group === 'perks') {
      if (sub === 'add') {
        const name = i.options.getString('name');
        const desc = i.options.getString('description');
        cfg.perks.push({ name, description: desc });
        return i.reply({ embeds: [successEmbed(`Perk **${name}** added! Boosters now have ${cfg.perks.length} perk(s).`)] });
      }
      if (sub === 'remove') {
        const num = i.options.getInteger('number') - 1;
        if (num < 0 || num >= cfg.perks.length) return i.reply({ embeds: [errorEmbed(`Invalid number. Use 1–${cfg.perks.length}.`)], ephemeral: true });
        const removed = cfg.perks.splice(num, 1)[0];
        return i.reply({ embeds: [successEmbed(`Removed perk: **${removed.name}**`)] });
      }
      if (sub === 'list') {
        if (!cfg.perks.length) return i.reply({ embeds: [infoEmbed('No perks set. Use `/booster perks add` to add some!')], ephemeral: true });
        const desc = cfg.perks.map((p, i) => `**${i+1}. ${p.name}**\n> ${p.description}`).join('\n\n');
        return i.reply({ embeds: [new EmbedBuilder().setColor(0xFF73FA).setTitle('💎 Booster Perks').setDescription(desc)] });
      }
    }
  },

  name: 'booster',
  category: 'booster',
  aliases: ['boost'],
  usage: ',booster config/role/perks',
  async run(client, msg) {
    const sub=args[0]?.toLowerCase();
    if(!msg.member.permissions.has(PermissionFlagsBits.ManageGuild)&&!msg.member.roles.cache.has(getGuildConfig(msg.guild.id).ownerRoleId)&&!msg.member.roles.cache.has(getGuildConfig(msg.guild.id).coOwnerRoleId))
      return msg.reply({embeds:[errorEmbed('Need Manage Server, Owner or Co-Owner role.')]});
    const cfg=getBoosterConfig(msg.guild.id);
    if(sub==='message'){const m=args.slice(1).join(' ');if(!m)return msg.reply({embeds:[errorEmbed('Provide a message.')]});cfg.boostMessage=m;return msg.reply({embeds:[successEmbed('Boost message set!')]});}
    if(sub==='channel'){const ch=msg.mentions.channels.first();if(!ch)return msg.reply({embeds:[errorEmbed('Mention a channel.')]});cfg.boostChannel=ch.id;return msg.reply({embeds:[successEmbed(`Boost channel: ${ch}`)]});}
    if(sub==='role'){const role=msg.mentions.roles.first();if(!role)return msg.reply({embeds:[errorEmbed('Mention a role.')]});cfg.boosterRoleId=role.id;return msg.reply({embeds:[successEmbed(`Booster role: ${role}`)]});}
    if(sub==='perk'||sub==='perkadd'){const name=args[1],desc=args.slice(2).join(' ');if(!name||!desc)return msg.reply({embeds:[errorEmbed('Usage: `,booster perkadd <name> <description>`')]});cfg.perks.push({name,description:desc});return msg.reply({embeds:[successEmbed(`Perk **${name}** added!`)]});}
    if(sub==='view'){return msg.reply({embeds:[new EmbedBuilder().setColor(0xFF73FA).setTitle('💎 Booster Config').addFields({name:'Channel',value:cfg.boostChannel?`<#${cfg.boostChannel}>`:'Not set',inline:true},{name:'Role',value:cfg.boosterRoleId?`<@&${cfg.boosterRoleId}>`:'Not set',inline:true},{name:'Perks',value:`${cfg.perks.length}`,inline:true},{name:'Message',value:cfg.boostMessage?cfg.boostMessage.slice(0,100):'Not set',inline:false})]});}
    return msg.reply({embeds:[infoEmbed('Usage: `,booster view` | `,booster channel #ch` | `,booster message <text>` | `,booster role @role` | `,booster perkadd <name> <desc>`')]});
  },
});

// ── /perks — public perks viewer ─────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('perks').setDescription('View server booster perks'),
  async execute(client, i) {
    const cfg = getBoosterConfig(i.guild.id);
    if (!cfg.perks.length) return i.reply({ embeds: [infoEmbed('No booster perks set up yet.')] });
    return i.reply({ embeds: [new EmbedBuilder()
      .setColor(0xFF73FA)
      .setTitle('💎 Server Booster Perks')
      .setDescription(cfg.perks.map((p, i) => `**${i+1}. ${p.name}**\n> ${p.description}`).join('\n\n'))
      .setFooter({ text: `Boost ${i.guild.name} to get these perks!` })] });
  },
  name: 'perks',
  category: 'booster',
  aliases: ['boostperks'],
  usage: ',perks',
  async run(client, msg) {
    const cfg = getBoosterConfig(msg.guild.id);
    if (!cfg.perks.length) return msg.reply({ embeds: [infoEmbed('No booster perks yet.')] });
    return msg.reply({ embeds: [new EmbedBuilder().setColor(0xFF73FA).setTitle('💎 Booster Perks').setDescription(cfg.perks.map((p,i)=>`**${i+1}. ${p.name}**\n> ${p.description}`).join('\n\n'))] });
  },
});
// ── Boost detection event ─────────────────────────────────────
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  // Detect new boost
  const justBoosted = !oldMember.premiumSince && newMember.premiumSince;
  // Detect unboost
  const justUnboosted = oldMember.premiumSince && !newMember.premiumSince;

  const cfg    = getBoosterConfig(newMember.guild.id);
  const gCfg   = getGuildConfig(newMember.guild.id);

  if (justBoosted) {
    // Assign booster role
    if (cfg.boosterRoleId) {
      const role = newMember.guild.roles.cache.get(cfg.boosterRoleId);
      if (role) await newMember.roles.add(role).catch(() => {});
    }

    // Send boost message
    if (cfg.boostMessage && cfg.boostChannel) {
      const ch = newMember.guild.channels.cache.get(cfg.boostChannel);
      if (ch) {
        await sendParsed(ch, cfg.boostMessage, {
          user   : `<@${newMember.id}>`,
          tag    : newMember.user.tag,
          server : newMember.guild.name,
          count  : newMember.guild.memberCount.toString(),
        }).catch(() => {});
      }
    } else if (cfg.boostChannel) {
      // Default boost message if none set
      const ch = newMember.guild.channels.cache.get(cfg.boostChannel);
      if (ch) {
        await ch.send({ embeds: [new EmbedBuilder()
          .setColor(0xFF73FA)
          .setTitle('💎 New Boost!')
          .setDescription(`${newMember} just boosted the server! 🎉\nWe now have **${newMember.guild.premiumSubscriptionCount}** boost(s)!`)
          .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp()] }).catch(() => {});
      }
    }
  }

  if (justUnboosted) {
    // Remove booster role
    if (cfg.boosterRoleId) {
      const role = newMember.guild.roles.cache.get(cfg.boosterRoleId);
      if (role && newMember.roles.cache.has(role.id)) {
        await newMember.roles.remove(role).catch(() => {});
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────
//  SLASH COMMAND REGISTRATION + LOGIN
// ─────────────────────────────────────────────────────────────
async function registerSlashCommands() {
  // Slash commands disabled — prefix only mode
  console.log('[CMD] Running in prefix-only mode. All commands use the prefix.');
}


// ─────────────────────────────────────────────────────────────
//  20 NEW COMMANDS
// ─────────────────────────────────────────────────────────────

// 1. ,hug
registerCommand({
  name:'hug', category:'fun', aliases:['cuddle'], usage:',hug @user',
  async run(client,msg,args){
    const target=msg.mentions.users.first();
    if(!target)return msg.reply({embeds:[errorEmbed('Mention someone to hug!')]});
    const GIFS=['https://media.tenor.com/I7Q6c9H9rBkAAAAC/hug.gif','https://media.tenor.com/GqTDmFTfMbUAAAAC/anime-hug.gif'];
    const gif=GIFS[Math.floor(Math.random()*GIFS.length)];
    return msg.reply({embeds:[new EmbedBuilder().setColor(0xFF69B4).setDescription(`💞 **${msg.author.username}** hugs **${target.username}**!`).setImage(gif)]});
  }
});

// 2. ,slap
registerCommand({
  name:'slap', category:'fun', aliases:[], usage:',slap @user',
  async run(client,msg,args){
    const target=msg.mentions.users.first();
    if(!target)return msg.reply({embeds:[errorEmbed('Mention someone to slap!')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.error).setDescription(`👋 **${msg.author.username}** slaps **${target.username}**! Ouch!`)]});
  }
});

// 3. ,kiss
registerCommand({
  name:'kiss', category:'fun', aliases:[], usage:',kiss @user',
  async run(client,msg,args){
    const target=msg.mentions.users.first();
    if(!target)return msg.reply({embeds:[errorEmbed('Mention someone to kiss!')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(0xFF69B4).setDescription(`💋 **${msg.author.username}** kisses **${target.username}**! 😘`)]});
  }
});

// 4. ,pat
registerCommand({
  name:'pat', category:'fun', aliases:['headpat'], usage:',pat @user',
  async run(client,msg,args){
    const target=msg.mentions.users.first();
    if(!target)return msg.reply({embeds:[errorEmbed('Mention someone to pat!')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(0xFFD700).setDescription(`👋 **${msg.author.username}** pats **${target.username}**! ʕ•ᴥ•ʔ`)]});
  }
});

// 5. ,punch
registerCommand({
  name:'punch', category:'fun', aliases:[], usage:',punch @user',
  async run(client,msg,args){
    const target=msg.mentions.users.first();
    if(!target)return msg.reply({embeds:[errorEmbed('Mention someone to punch!')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.error).setDescription(`🥊 **${msg.author.username}** punches **${target.username}**! POW!`)]});
  }
});

// 6. ,ship  
registerCommand({
  name:'ship', category:'fun', aliases:['love'], usage:',ship @user1 @user2',
  async run(client,msg,args){
    const u1=msg.mentions.users.first()??msg.author;
    const u2=msg.mentions.users.at(1)??msg.author;
    const pct=Math.floor(Math.random()*101);
    const bar='█'.repeat(Math.floor(pct/10))+'░'.repeat(10-Math.floor(pct/10));
    const emoji=pct>=80?'💞':pct>=50?'💕':pct>=30?'💔':'😬';
    return msg.reply({embeds:[new EmbedBuilder().setColor(0xFF69B4).setTitle(`💘 Ship Meter`).setDescription(`**${u1.username}** + **${u2.username}**\n\n${bar} **${pct}%** ${emoji}`)]});
  }
});

// 7. ,rps (rock paper scissors)
registerCommand({
  name:'rps', category:'fun', aliases:['rockpaperscissors'], usage:',rps <rock|paper|scissors>',
  async run(client,msg,args){
    const choices=['rock','paper','scissors'];
    const emojis={rock:'🪨',paper:'📄',scissors:'✂️'};
    const pick=args[0]?.toLowerCase();
    if(!choices.includes(pick))return msg.reply({embeds:[errorEmbed('Choose rock, paper, or scissors!')]});
    const bot=choices[Math.floor(Math.random()*3)];
    const wins={rock:'scissors',paper:'rock',scissors:'paper'};
    const result=wins[pick]===bot?'🎉 You win!':pick===bot?'🤝 Tie!':'❌ Bot wins!';
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('Rock Paper Scissors').addFields({name:'Your pick',value:`${emojis[pick]} ${pick}`,inline:true},{name:'Bot pick',value:`${emojis[bot]} ${bot}`,inline:true},{name:'Result',value:result,inline:false})]});
  }
});

// 8. ,rate
registerCommand({
  name:'rate', category:'fun', aliases:['howmuch'], usage:',rate <thing>',
  async run(client,msg,args){
    if(!args.length)return msg.reply({embeds:[errorEmbed('Provide something to rate!')]});
    const thing=args.join(' ');
    const rating=Math.floor(Math.random()*11);
    const bar='⭐'.repeat(rating)+'☆'.repeat(10-rating);
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('⭐ Rating').setDescription(`**${thing}**\n\n${bar}\n**${rating}/10**`)]});
  }
});

// 9. ,pp
registerCommand({
  name:'pp', category:'fun', aliases:['ppsize'], usage:',pp [@user]',
  async run(client,msg,args){
    const user=msg.mentions.users.first()??msg.author;
    const size=Math.floor(Math.random()*16);
    const bar='='+'='.repeat(size)+'D';
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setDescription(`🍆 **${user.username}'s pp:**\n8${bar} (${size} inches)`)]});
  }
});

// 10. ,iq
registerCommand({
  name:'iq', category:'fun', aliases:[], usage:',iq [@user]',
  async run(client,msg,args){
    const user=msg.mentions.users.first()??msg.author;
    const iq=Math.floor(Math.random()*201);
    const labels=iq>=150?'🧠 Galaxy brain':iq>=120?'🎓 Very smart':iq>=100?'😊 Average':iq>=80?'🤔 A bit slow':'🥔 Potato';
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🧠 IQ Test').setDescription(`**${user.username}'s IQ: ${iq}**\n${labels}`)]});
  }
});

// 11. ,8ball alias (eightball)
// Already exists, skip

// 12. ,gay
registerCommand({
  name:'gay', category:'fun', aliases:['howgay'], usage:',gay [@user]',
  async run(client,msg,args){
    const user=msg.mentions.users.first()??msg.author;
    const pct=Math.floor(Math.random()*101);
    const bar='🌈'.repeat(Math.floor(pct/10))+'⬜'.repeat(10-Math.floor(pct/10));
    return msg.reply({embeds:[new EmbedBuilder().setColor(0xFF73FA).setDescription(`**${user.username}** is **${pct}% gay** 🏳️‍🌈\n${bar}`)]});
  }
});

// 13. ,steal - steal someone's avatar
registerCommand({
  name:'steal', category:'utility', aliases:['savepfp'], usage:',steal [@user]',
  async run(client,msg,args){
    const user=msg.mentions.users.first()??msg.author;
    const url=user.displayAvatarURL({dynamic:true,size:4096,format:'png'});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`${user.username}'s Avatar`).setImage(url).setDescription(`[Download PNG](${url})`)]});
  }
});

// 14. ,usercount
registerCommand({
  name:'usercount', category:'info', aliases:['uc'], usage:',usercount',
  async run(client,msg){
    const total=client.guilds.cache.reduce((a,g)=>a+g.memberCount,0);
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('👥 Total Users').addFields({name:'Servers',value:`${client.guilds.cache.size}`,inline:true},{name:'Total Members',value:`${total.toLocaleString()}`,inline:true})]});
  }
});

// 15. ,uptime
registerCommand({
  name:'uptime', category:'info', aliases:[], usage:',uptime',
  async run(client,msg){
    const ms=client.uptime,s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60),d=Math.floor(h/24);
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('⏱️ Uptime').setDescription(`**${d}d ${h%24}h ${m%60}m ${s%60}s**`)]});
  }
});

// 16. ,createvc (create temp voice channel)
registerCommand({
  name:'createvc', category:'utility', aliases:['vc'], usage:',createvc <name>',
  async run(client,msg,args){
    if(!msg.member.permissions.has(PermissionFlagsBits.ManageChannels))return msg.reply({embeds:[errorEmbed('Need Manage Channels.')]});
    const name=args.join(' ')||`${msg.author.username}'s VC`;
    const ch=await msg.guild.channels.create({name,type:2,permissionOverwrites:[{id:msg.author.id,allow:['ManageChannels','MoveMembers']}]});
    return msg.reply({embeds:[successEmbed(`Voice channel **${name}** created! (ID: \`${ch.id}\`)`)]});
  }
});

// 17. ,deletemsg
registerCommand({
  name:'deletemsg', category:'moderation', aliases:['delmsg','dm2'], usage:',deletemsg <message_id>',
  async run(client,msg,args){
    if(!msg.member.permissions.has(PermissionFlagsBits.ManageMessages))return msg.reply({embeds:[errorEmbed('Need Manage Messages.')]});
    const id=args[0];
    if(!id)return msg.reply({embeds:[errorEmbed('Provide a message ID.')]});
    const target=await msg.channel.messages.fetch(id).catch(()=>null);
    if(!target)return msg.reply({embeds:[errorEmbed('Message not found.')]});
    await target.delete();
    const reply=await msg.reply({embeds:[successEmbed('Message deleted.')]});
    setTimeout(()=>reply.delete().catch(()=>{}),3000);
  }
});

// 18. ,pin / ,unpin
registerCommand({
  name:'pin', category:'utility', aliases:[], usage:',pin <message_id>',
  async run(client,msg,args){
    if(!msg.member.permissions.has(PermissionFlagsBits.ManageMessages))return msg.reply({embeds:[errorEmbed('Need Manage Messages.')]});
    const id=args[0];
    const target=id?await msg.channel.messages.fetch(id).catch(()=>null):msg;
    if(!target)return msg.reply({embeds:[errorEmbed('Message not found.')]});
    await target.pin();
    return msg.reply({embeds:[successEmbed('📌 Message pinned!')]});
  }
});

// 19. ,unpin
registerCommand({
  name:'unpin', category:'utility', aliases:[], usage:',unpin <message_id>',
  async run(client,msg,args){
    if(!msg.member.permissions.has(PermissionFlagsBits.ManageMessages))return msg.reply({embeds:[errorEmbed('Need Manage Messages.')]});
    const id=args[0];
    if(!id)return msg.reply({embeds:[errorEmbed('Provide a message ID.')]});
    const target=await msg.channel.messages.fetch(id).catch(()=>null);
    if(!target)return msg.reply({embeds:[errorEmbed('Message not found.')]});
    await target.unpin();
    return msg.reply({embeds:[successEmbed('📌 Message unpinned!')]});
  }
});

// 20. ,listpins
registerCommand({
  name:'listpins', category:'utility', aliases:['pins'], usage:',listpins',
  async run(client,msg){
    const pins=await msg.channel.messages.fetchPinned();
    if(!pins.size)return msg.reply({embeds:[infoEmbed('No pinned messages in this channel.')]});
    const desc=pins.map((p,i)=>`**${i+1}.** [Jump](${p.url}) — by ${p.author.tag} — ${p.content.slice(0,50)||'(embed/attachment)'}`).join('\n');
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle(`📌 Pinned Messages (${pins.size})`).setDescription(desc)]});
  }
});

// 21. ,serverroles
registerCommand({
  name:'serverroles', category:'info', aliases:['allroles'], usage:',serverroles',
  async run(client,msg){
    const roles=msg.guild.roles.cache.filter(r=>r.id!==msg.guild.id).sort((a,b)=>b.position-a.position);
    const pages=[];
    const roleArr=[...roles.values()];
    for(let i=0;i<roleArr.length;i+=20){
      pages.push(roleArr.slice(i,i+20).map(r=>`${r} — \`${r.members.size} members\``).join('\n'));
    }
    if(!pages.length)return msg.reply({embeds:[infoEmbed('No roles.')]});
    const embed=new EmbedBuilder().setColor(COLORS.info).setTitle(`🎭 All Roles (${roles.size})`).setDescription(pages[0]);
    return msg.reply({embeds:[embed]});
  }
});

// 22. ,memberswithrole
registerCommand({
  name:'memberswithrole', category:'info', aliases:['rolemembers','inrole'], usage:',memberswithrole @role',
  async run(client,msg,args){
    const role=msg.mentions.roles.first()??msg.guild.roles.cache.get(args[0]);
    if(!role)return msg.reply({embeds:[errorEmbed('Mention a role or provide its ID.')]});
    const members=role.members.map(m=>`<@${m.id}>`).slice(0,50);
    if(!members.length)return msg.reply({embeds:[infoEmbed(`No members have ${role}.`)]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(role.color||COLORS.info).setTitle(`${role.name} — ${role.members.size} members`).setDescription(members.join(', ').slice(0,2000))]});
  }
});

// 23. ,cleanup (delete bot messages)
registerCommand({
  name:'cleanup', category:'moderation', aliases:['botclean','cleanbot'], usage:',cleanup [amount]',
  async run(client,msg,args){
    if(!msg.member.permissions.has(PermissionFlagsBits.ManageMessages))return msg.reply({embeds:[errorEmbed('Need Manage Messages.')]});
    const n=Math.min(parseInt(args[0])||20,100);
    const msgs=await msg.channel.messages.fetch({limit:100});
    const botMsgs=msgs.filter(m=>m.author.bot&&Date.now()-m.createdTimestamp<1209600000).first(n);
    const deleted=await msg.channel.bulkDelete(botMsgs,true).catch(()=>null);
    const r=await msg.channel.send({embeds:[successEmbed(`Deleted **${deleted?.size??0}** bot message(s).`)]});
    setTimeout(()=>r.delete().catch(()=>{}),4000);
  }
});

// 24. ,resetxp
registerCommand({
  name:'resetxp', category:'levels', aliases:[], usage:',resetxp @user',
  async run(client,msg,args){
    if(!msg.member.permissions.has(PermissionFlagsBits.ManageGuild))return msg.reply({embeds:[errorEmbed('Need Manage Server.')]});
    const target=msg.mentions.users.first();
    if(!target)return msg.reply({embeds:[errorEmbed('Mention a user.')]});
    resetUserXp(msg.guild.id,target.id);
    return msg.reply({embeds:[successEmbed(`Reset **${target.tag}**'s XP and level.`)]});
  }
});

// 25. ,addxp
registerCommand({
  name:'addxp', category:'levels', aliases:[], usage:',addxp @user <amount>',
  async run(client,msg,args){
    if(!msg.member.permissions.has(PermissionFlagsBits.ManageGuild))return msg.reply({embeds:[errorEmbed('Need Manage Server.')]});
    const target=msg.mentions.users.first(),amount=parseInt(args[1]);
    if(!target||isNaN(amount))return msg.reply({embeds:[errorEmbed('Usage: ,addxp @user <amount>')]});
    addUserXpVal(msg.guild.id,target.id,amount);
    const d=getLevelUser(msg.guild.id,target.id);
    return msg.reply({embeds:[successEmbed(`Added **${amount} XP** to **${target.tag}** (Now: Level ${d.level}, ${d.totalXp.toLocaleString()} XP)`)]});
  }
});

// 26. ,setxp
registerCommand({
  name:'setxp', category:'levels', aliases:[], usage:',setxp @user <amount>',
  async run(client,msg,args){
    if(!msg.member.permissions.has(PermissionFlagsBits.ManageGuild))return msg.reply({embeds:[errorEmbed('Need Manage Server.')]});
    const target=msg.mentions.users.first(),amount=parseInt(args[1]);
    if(!target||isNaN(amount)||amount<0)return msg.reply({embeds:[errorEmbed('Usage: ,setxp @user <amount>')]});
    setUserXpVal(msg.guild.id,target.id,amount);
    const d=getLevelUser(msg.guild.id,target.id);
    return msg.reply({embeds:[successEmbed(`Set **${target.tag}**'s XP to **${amount}** (Level ${d.level})`)]});
  }
});

// 27. ,noxp (toggle XP for a channel)
registerCommand({
  name:'noxp', category:'config', aliases:['xpignore'], usage:',noxp [#channel]',
  async run(client,msg,args){
    if(!msg.member.permissions.has(PermissionFlagsBits.ManageGuild))return msg.reply({embeds:[errorEmbed('Need Manage Server.')]});
    const ch=msg.mentions.channels.first()??msg.channel;
    const cfg=getLevelConfig(msg.guild.id);
    const idx=cfg.ignoredChannels.indexOf(ch.id);
    if(idx>=0){cfg.ignoredChannels.splice(idx,1);return msg.reply({embeds:[successEmbed(`${ch} will now give XP.`)]});}
    cfg.ignoredChannels.push(ch.id);
    return msg.reply({embeds:[successEmbed(`${ch} will no longer give XP.`)]});
  }
});

// 28. ,autorole (set a role given to all new members)
registerCommand({
  name:'autorole', category:'config', aliases:['joinrole'], usage:',autorole @role | ,autorole off',
  async run(client,msg,args){
    if(!msg.member.permissions.has(PermissionFlagsBits.ManageRoles))return msg.reply({embeds:[errorEmbed('Need Manage Roles.')]});
    if(args[0]?.toLowerCase()==='off'){setGuildConfig(msg.guild.id,'autoroleId',null);return msg.reply({embeds:[successEmbed('Auto-role disabled.')]});}
    const role=msg.mentions.roles.first()??msg.guild.roles.cache.get(args[0]);
    if(!role)return msg.reply({embeds:[errorEmbed('Mention a role or provide its ID. Use ,autorole off to disable.')]});
    setGuildConfig(msg.guild.id,'autoroleId',role.id);
    return msg.reply({embeds:[successEmbed(`New members will now receive ${role} when they join.`)]});
  }
});

// 29. ,invitelink
registerCommand({
  name:'invitelink', category:'info', aliases:['invite','botinvite'], usage:',invitelink',
  async run(client,msg){
    const link=`https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot`;
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.info).setTitle('🔗 Invite Link').setDescription(`[Click here to invite **${client.user.username}** to your server!](${link})`)]});
  }
});

// 30. ,quote
registerCommand({
  name:'quote', category:'utility', aliases:[], usage:',quote <message_id> [#channel]',
  async run(client,msg,args){
    const id=args[0];
    if(!id)return msg.reply({embeds:[errorEmbed('Provide a message ID.')]});
    const ch=msg.mentions.channels.first()??msg.channel;
    const target=await ch.messages.fetch(id).catch(()=>null);
    if(!target)return msg.reply({embeds:[errorEmbed('Message not found.')]});
    return msg.reply({embeds:[new EmbedBuilder().setColor(COLORS.neutral)
      .setAuthor({name:target.author.tag,iconURL:target.author.displayAvatarURL()})
      .setDescription(target.content||'*(no text content)*')
      .addFields({name:'Source',value:`[Jump to message](${target.url})`,inline:true},{name:'Channel',value:`<#${target.channel.id}>`,inline:true})
      .setTimestamp(target.createdAt)]});
  }
});

(async () => {
  // ── Initialize DisTube (music) ────────────────────────────
  try {
    const { DisTube }       = require('distube');
    const { YouTubePlugin } = require('@distube/youtube');
    client.distube = new DisTube(client, {
      plugins: [new YouTubePlugin()],
    });
    setupDistube();
    console.log('[MUSIC] DisTube v5 initialized');
  } catch(e) {
    console.warn('[MUSIC] DisTube not installed — music commands disabled.');
    console.warn('[MUSIC] Error:', e.message);
  }

  await connectDB();
  await dbLoadAutoResponders();
  await registerSlashCommands();
  await client.login(process.env.BOT_TOKEN);
})();

// ─────────────────────────────────────────────────────────────
//  ECONOMY SYSTEM
// ─────────────────────────────────────────────────────────────
const _economy = new Map(); // Map<guildId, Map<userId, { wallet, bank, lastDaily, lastWork }>>
const _shop    = new Map(); // Map<guildId, Map<itemName, { action, price, description }>>

function getEconomy(guildId) {
  if (!_economy.has(guildId)) _economy.set(guildId, new Map());
  return _economy.get(guildId);
}
function getUser(guildId, userId) {
  const g = getEconomy(guildId);
  if (!g.has(userId)) g.set(userId, { wallet: 0, bank: 0, lastDaily: 0, lastWork: 0 });
  return g.get(userId);
}
function getShop(guildId) {
  if (!_shop.has(guildId)) _shop.set(guildId, new Map());
  return _shop.get(guildId);
}

const CURRENCY = '🪙';
const fmt = n => `${CURRENCY} **${n.toLocaleString()}**`;

// ── Balance ───────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('balance').setDescription('Check your balance or another member\'s')
    .addUserOption(o => o.setName('user').setDescription('User')),
  async execute(client, i) {
    const target = i.options.getUser('user') ?? i.user;
    const data   = await dbGetUser(i.guild.id, target.id);
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.info)
      .setTitle(`${CURRENCY} ${target.username}'s Balance`)
      .addFields(
        { name: '👛 Wallet', value: fmt(data.wallet), inline: true },
        { name: '🏦 Bank',   value: fmt(data.bank),   inline: true },
        { name: '💰 Total',  value: fmt(data.wallet + data.bank), inline: true },
      )] });
  },
  name: 'balance',
  category: 'economy', aliases: ['bal', 'money'], usage: ',balance [@user]',
  async run(client, msg, args) {
    const target = msg.mentions.users.first() ?? msg.author;
    const data   = getUser(msg.guild.id, target.id);
    return msg.reply({ embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle(`${CURRENCY} ${target.username}'s Balance`)
      .addFields({ name: '👛 Wallet', value: fmt(data.wallet), inline: true }, { name: '🏦 Bank', value: fmt(data.bank), inline: true }, { name: '💰 Total', value: fmt(data.wallet + data.bank), inline: true })] });
  },
});

// ── Daily ─────────────────────────────────────────────────────
registerCommand({
  cooldown: 3,
  data: new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins'),
  async execute(client, i) {
    const data = await dbGetUser(i.guild.id, i.user.id);
    const now  = Date.now(), cooldown = 86400000;
    const diff = now - data.lastDaily;
    if (diff < cooldown) {
      const rem = cooldown - diff;
      const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000);
      return i.reply({ embeds: [errorEmbed(`Daily already claimed! Come back in **${h}h ${m}m**.`)], ephemeral: true });
    }
    const amount = Math.floor(Math.random() * 500) + 500; // 500-1000
    data.wallet += amount;
    data.lastDaily = now;
    await dbSaveUser(data);
    return i.reply({ embeds: [successEmbed(`You claimed your daily ${fmt(amount)}!\n👛 Wallet: ${fmt(data.wallet)}`)] });
  },
  name: 'daily',
  category: 'economy', aliases: [], usage: ',daily',
  async run(client, msg) {
    const data = getUser(msg.guild.id, msg.author.id);
    const now  = Date.now(), cooldown = 86400000, diff = now - data.lastDaily;
    if (diff < cooldown) { const rem = cooldown - diff, h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000); return msg.reply({ embeds: [errorEmbed(`Come back in **${h}h ${m}m**.`)] }); }
    const amount = Math.floor(Math.random() * 500) + 500;
    data.wallet += amount; data.lastDaily = now;
    return msg.reply({ embeds: [successEmbed(`Daily claimed! ${fmt(amount)}`)] });
  },
});

// ── Work ──────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('work').setDescription('Work for some coins (1 hour cooldown)'),
  async execute(client, i) {
    const data = await dbGetUser(i.guild.id, i.user.id);
    const now  = Date.now(), cooldown = 3600000, diff = now - data.lastWork;
    if (diff < cooldown) {
      const rem = cooldown - diff, m = Math.floor(rem / 60000);
      return i.reply({ embeds: [errorEmbed(`You're tired! Rest for **${m}m** more.`)], ephemeral: true });
    }
    const JOBS  = ['🍕 delivered pizzas', '💻 fixed some code', '🎨 painted a mural', '🔧 fixed a car', '📦 sorted packages', '🌿 mowed lawns', '🎵 busked on the street'];
    const job   = JOBS[Math.floor(Math.random() * JOBS.length)];
    const amount = Math.floor(Math.random() * 200) + 100;
    data.wallet += amount; data.lastWork = now;
    await dbSaveUser(data);
    return i.reply({ embeds: [successEmbed(`You ${job} and earned ${fmt(amount)}!\n👛 Wallet: ${fmt(data.wallet)}`)] });
  },
  name: 'work',
  category: 'economy', aliases: [], usage: ',work',
  async run(client, msg) {
    const data = getUser(msg.guild.id, msg.author.id);
    const now  = Date.now(), cooldown = 3600000, diff = now - data.lastWork;
    if (diff < cooldown) { const rem = cooldown - diff, m = Math.floor(rem / 60000); return msg.reply({ embeds: [errorEmbed(`Rest for **${m}m** more.`)] }); }
    const amount = Math.floor(Math.random() * 200) + 100;
    data.wallet += amount; data.lastWork = now;
    return msg.reply({ embeds: [successEmbed(`You worked and earned ${fmt(amount)}!`)] });
  },
});

// ── Deposit ───────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('deposit').setDescription('Deposit coins into your bank')
    .addStringOption(o => o.setName('amount').setDescription('Amount or "all"').setRequired(true)),
  async execute(client, i) {
    const data = await dbGetUser(i.guild.id, i.user.id);
    const input = i.options.getString('amount').toLowerCase();
    const amount = input === 'all' ? data.wallet : parseInt(input);
    if (isNaN(amount) || amount <= 0) return i.reply({ embeds: [errorEmbed('Invalid amount.')], ephemeral: true });
    if (amount > data.wallet) return i.reply({ embeds: [errorEmbed(`You only have ${fmt(data.wallet)} in your wallet.`)], ephemeral: true });
    data.wallet -= amount; data.bank += amount;
    await dbSaveUser(data);
    return i.reply({ embeds: [successEmbed(`Deposited ${fmt(amount)} into your bank.\n🏦 Bank: ${fmt(data.bank)}`)] });
  },
  name: 'deposit',
  category: 'economy', aliases: ['dep'], usage: ',deposit <amount|all>',
  async run(client, msg, args) {
    const data = getUser(msg.guild.id, msg.author.id);
    const input = args[0]?.toLowerCase();
    const amount = input === 'all' ? data.wallet : parseInt(input);
    if (!input || isNaN(amount) || amount <= 0) return msg.reply({ embeds: [errorEmbed('Provide an amount.')] });
    if (amount > data.wallet) return msg.reply({ embeds: [errorEmbed(`Not enough in wallet.`)] });
    data.wallet -= amount; data.bank += amount;
    return msg.reply({ embeds: [successEmbed(`Deposited ${fmt(amount)}. Bank: ${fmt(data.bank)}`)] });
  },
});

// ── Withdraw ──────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('withdraw').setDescription('Withdraw coins from your bank')
    .addStringOption(o => o.setName('amount').setDescription('Amount or "all"').setRequired(true)),
  async execute(client, i) {
    const data = await dbGetUser(i.guild.id, i.user.id);
    const input = i.options.getString('amount').toLowerCase();
    const amount = input === 'all' ? data.bank : parseInt(input);
    if (isNaN(amount) || amount <= 0) return i.reply({ embeds: [errorEmbed('Invalid amount.')], ephemeral: true });
    if (amount > data.bank) return i.reply({ embeds: [errorEmbed(`You only have ${fmt(data.bank)} in your bank.`)], ephemeral: true });
    data.bank -= amount; data.wallet += amount;
    await dbSaveUser(data);
    return i.reply({ embeds: [successEmbed(`Withdrew ${fmt(amount)} from your bank.\n👛 Wallet: ${fmt(data.wallet)}`)] });
  },
  name: 'withdraw',
  category: 'economy', aliases: ['with'], usage: ',withdraw <amount|all>',
  async run(client, msg, args) {
    const data = getUser(msg.guild.id, msg.author.id);
    const input = args[0]?.toLowerCase();
    const amount = input === 'all' ? data.bank : parseInt(input);
    if (!input || isNaN(amount) || amount <= 0) return msg.reply({ embeds: [errorEmbed('Provide an amount.')] });
    if (amount > data.bank) return msg.reply({ embeds: [errorEmbed('Not enough in bank.')] });
    data.bank -= amount; data.wallet += amount;
    return msg.reply({ embeds: [successEmbed(`Withdrew ${fmt(amount)}. Wallet: ${fmt(data.wallet)}`)] });
  },
});

// ── Pay ───────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('pay').setDescription('Pay another member')
    .addUserOption(o => o.setName('user').setDescription('Who to pay').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
  async execute(client, i) {
    const target = i.options.getUser('user'), amount = i.options.getInteger('amount');
    if (target.id === i.user.id) return i.reply({ embeds: [errorEmbed('You cannot pay yourself.')], ephemeral: true });
    if (target.bot) return i.reply({ embeds: [errorEmbed('You cannot pay bots.')], ephemeral: true });
    const sender = await dbGetUser(i.guild.id, i.user.id), receiver = await dbGetUser(i.guild.id, target.id);
    if (sender.wallet < amount) return i.reply({ embeds: [errorEmbed(`You only have ${fmt(sender.wallet)} in your wallet.`)], ephemeral: true });
    sender.wallet -= amount; receiver.wallet += amount;
    await dbSaveUser(sender); await dbSaveUser(receiver);
    return i.reply({ embeds: [successEmbed(`Paid ${fmt(amount)} to **${target.username}**!`)] });
  },
  name: 'pay',
  category: 'economy', aliases: ['give'], usage: ',pay @user <amount>',
  async run(client, msg, args) {
    const target = msg.mentions.users.first(), amount = parseInt(args[1]);
    if (!target || isNaN(amount) || amount <= 0) return msg.reply({ embeds: [errorEmbed('Usage: ,pay @user <amount>')] });
    const sender = getUser(msg.guild.id, msg.author.id), receiver = getUser(msg.guild.id, target.id);
    if (sender.wallet < amount) return msg.reply({ embeds: [errorEmbed('Not enough in wallet.')] });
    sender.wallet -= amount; receiver.wallet += amount;
    return msg.reply({ embeds: [successEmbed(`Paid ${fmt(amount)} to **${target.username}**!`)] });
  },
});

// ── Rich list ─────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('richlist').setDescription('Top 10 richest members'),
  async execute(client, i) {
    const sorted = isConnected()
      ? await EcoModel.find({ guildId: i.guild.id }).sort({ wallet: -1 }).limit(10).lean()
      : [...getEconomy(i.guild.id).entries()].sort(([,a],[,b])=>(b.wallet+b.bank)-(a.wallet+a.bank)).slice(0,10).map(([userId,d])=>({userId,...d}));
    if (!sorted.length) return i.reply({ embeds: [infoEmbed('No economy data yet.')] });
    const medals = ['🥇', '🥈', '🥉'];
    const desc = sorted.map((e, idx) => `${medals[idx] ?? `**${idx + 1}.**`} <@${e.userId}> — ${fmt((e.wallet||0) + (e.bank||0))}`).join('\n');
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle(`${CURRENCY} Richest Members`).setDescription(desc)] });
  },
  name: 'richlist',
  category: 'economy', aliases: ['top', 'econlb'], usage: ',richlist',
  async run(client, msg) {
    const guild = getEconomy(msg.guild.id);
    const sorted = [...guild.entries()].sort(([, a], [, b]) => (b.wallet + b.bank) - (a.wallet + a.bank)).slice(0, 10);
    if (!sorted.length) return msg.reply({ embeds: [infoEmbed('No data yet.')] });
    return msg.reply({ embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('Richest Members').setDescription(sorted.map(([uid, d], i) => `**${i + 1}.** <@${uid}> — ${fmt(d.wallet + d.bank)}`).join('\n'))] });
  },
});

// ─────────────────────────────────────────────────────────────
//  GAMBLING COMMANDS
// ─────────────────────────────────────────────────────────────

// ── Bet Coinflip ──────────────────────────────────────────────
registerCommand({
  cooldown: 5,
  data: new SlashCommandBuilder().setName('betcoin').setDescription('Bet coins on a coinflip')
    .addStringOption(o => o.setName('side').setDescription('heads or tails').setRequired(true).addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to bet').setRequired(true).setMinValue(1)),
  async execute(client, i) {
    const side = i.options.getString('side'), amount = i.options.getInteger('amount');
    const data = await dbGetUser(i.guild.id, i.user.id);
    if (data.wallet < amount) return i.reply({ embeds: [errorEmbed(`Not enough coins. You have ${fmt(data.wallet)}.`)], ephemeral: true });
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won    = result === side;
    if (won) data.wallet += amount; else data.wallet -= amount;
    await dbSaveUser(data);
    return i.reply({ embeds: [new EmbedBuilder()
      .setColor(won ? COLORS.success : COLORS.error)
      .setTitle(`🪙 Coinflip — ${result.toUpperCase()}`)
      .setDescription(won ? `✅ You won ${fmt(amount)}!` : `❌ You lost ${fmt(amount)}.`)
      .addFields({ name: '👛 New Balance', value: fmt(data.wallet) })] });
  },
  name: 'betcoin',
  category: 'gambling', aliases: ['cf', 'coinbet'], usage: ',betcoin <heads|tails> <amount>',
  async run(client, msg, args) {
    const side = args[0]?.toLowerCase(), amount = parseInt(args[1]);
    if (!['heads', 'tails'].includes(side) || isNaN(amount) || amount <= 0) return msg.reply({ embeds: [errorEmbed('Usage: ,betcoin <heads|tails> <amount>')] });
    const data = getUser(msg.guild.id, msg.author.id);
    if (data.wallet < amount) return msg.reply({ embeds: [errorEmbed('Not enough coins.')] });
    const result = Math.random() < 0.5 ? 'heads' : 'tails', won = result === side;
    if (won) data.wallet += amount; else data.wallet -= amount;
    return msg.reply({ embeds: [new EmbedBuilder().setColor(won ? COLORS.success : COLORS.error).setTitle(`Coinflip — ${result}`).setDescription(won ? `✅ Won ${fmt(amount)}!` : `❌ Lost ${fmt(amount)}.`)] });
  },
});

// ── Slots ─────────────────────────────────────────────────────
registerCommand({
  cooldown: 5,
  data: new SlashCommandBuilder().setName('slots').setDescription('Play the slot machine')
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to bet').setRequired(true).setMinValue(1)),
  async execute(client, i) {
    const amount = i.options.getInteger('amount');
    const data   = await dbGetUser(i.guild.id, i.user.id);
    if (data.wallet < amount) return i.reply({ embeds: [errorEmbed(`Not enough coins. You have ${fmt(data.wallet)}.`)], ephemeral: true });
    const result = spinSlots();
    let winnings = 0;
    if (result.jackpot)    { winnings = amount * 10; }
    else if (result.two)   { winnings = amount * 2;  }
    else                   { winnings = -amount;      }
    data.wallet += winnings;
    await dbSaveUser(data);
    const won = winnings > 0;
    return i.reply({ embeds: [new EmbedBuilder()
      .setColor(result.jackpot ? 0xFFD700 : won ? COLORS.success : COLORS.error)
      .setTitle('🎰 Slot Machine')
      .setDescription(`[ ${result.reels.join(' | ')} ]\n\n${result.jackpot ? '🎉 JACKPOT! 10x!' : result.two ? '✅ Two of a kind! 2x!' : '❌ No match.'}`)
      .addFields({ name: won ? '💰 Won' : '💸 Lost', value: fmt(Math.abs(winnings)), inline: true }, { name: '👛 Balance', value: fmt(data.wallet), inline: true })] });
  },
  name: 'slots',
  category: 'gambling', aliases: ['slot'], usage: ',slots <amount>',
  async run(client, msg, args) {
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0) return msg.reply({ embeds: [errorEmbed('Usage: ,slots <amount>')] });
    const data = getUser(msg.guild.id, msg.author.id);
    if (data.wallet < amount) return msg.reply({ embeds: [errorEmbed('Not enough coins.')] });
    const result = spinSlots();
    let winnings = result.jackpot ? amount * 10 : result.two ? amount * 2 : -amount;
    data.wallet += winnings;
    return msg.reply({ embeds: [new EmbedBuilder().setColor(winnings > 0 ? COLORS.success : COLORS.error).setTitle('🎰 Slots').setDescription(`[ ${result.reels.join(' | ')} ]\n${result.jackpot ? '🎉 JACKPOT!' : result.two ? '✅ 2x!' : '❌ Lost.'}`).addFields({ name: 'Balance', value: fmt(data.wallet) })] });
  },
});

// ── Dice bet ──────────────────────────────────────────────────
registerCommand({
  cooldown: 5,
  data: new SlashCommandBuilder().setName('dice').setDescription('Roll dice and bet. Pick higher or lower than 7')
    .addStringOption(o => o.setName('pick').setDescription('Higher or lower than 7').setRequired(true).addChoices({ name: 'Higher (8-12)', value: 'high' }, { name: 'Lower (2-6)', value: 'low' }, { name: 'Exactly 7 (3x)', value: 'seven' }))
    .addIntegerOption(o => o.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(1)),
  async execute(client, i) {
    const pick = i.options.getString('pick'), amount = i.options.getInteger('amount');
    const data = await dbGetUser(i.guild.id, i.user.id);
    if (data.wallet < amount) return i.reply({ embeds: [errorEmbed(`You only have ${fmt(data.wallet)}.`)], ephemeral: true });
    const roll = Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
    const won  = (pick === 'high' && roll > 7) || (pick === 'low' && roll < 7) || (pick === 'seven' && roll === 7);
    const mult = pick === 'seven' ? 3 : 1;
    const winnings = won ? amount * mult : -amount;
    data.wallet += winnings;
    await dbSaveUser(data);
    return i.reply({ embeds: [new EmbedBuilder()
      .setColor(won ? COLORS.success : COLORS.error)
      .setTitle('🎲 Dice Roll')
      .setDescription(`You rolled **${roll}**!\n${won ? `✅ You won ${fmt(Math.abs(winnings))}!` : `❌ You lost ${fmt(amount)}.`}`)
      .addFields({ name: '👛 Balance', value: fmt(data.wallet) })] });
  },
  name: 'dice',
  category: 'gambling', aliases: [], usage: ',dice <high|low|seven> <amount>',
  async run(client, msg, args) {
    const pick = args[0]?.toLowerCase(), amount = parseInt(args[1]);
    if (!['high', 'low', 'seven'].includes(pick) || isNaN(amount)) return msg.reply({ embeds: [errorEmbed('Usage: ,dice <high|low|seven> <amount>')] });
    const data = getUser(msg.guild.id, msg.author.id);
    if (data.wallet < amount) return msg.reply({ embeds: [errorEmbed('Not enough coins.')] });
    const roll = Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
    const won  = (pick === 'high' && roll > 7) || (pick === 'low' && roll < 7) || (pick === 'seven' && roll === 7);
    const winnings = won ? amount * (pick === 'seven' ? 3 : 1) : -amount;
    data.wallet += winnings;
    return msg.reply({ embeds: [new EmbedBuilder().setColor(won ? COLORS.success : COLORS.error).setTitle(`🎲 Rolled ${roll}`).setDescription(won ? `✅ Won ${fmt(Math.abs(winnings))}!` : `❌ Lost ${fmt(amount)}.`)] });
  },
});

// ── Rob ───────────────────────────────────────────────────────
registerCommand({
  cooldown: 60,
  data: new SlashCommandBuilder().setName('rob').setDescription('Try to rob another member (risky!)')
    .addUserOption(o => o.setName('user').setDescription('Who to rob').setRequired(true)),
  async execute(client, i) {
    const target = i.options.getUser('user');
    if (target.id === i.user.id || target.bot) return i.reply({ embeds: [errorEmbed('You can\'t rob that user.')], ephemeral: true });
    const robber = await dbGetUser(i.guild.id, i.user.id), victim = await dbGetUser(i.guild.id, target.id);
    if (victim.wallet < 100) return i.reply({ embeds: [errorEmbed(`**${target.username}** is broke — not worth robbing!`)], ephemeral: true });
    if (robber.wallet < 100) return i.reply({ embeds: [errorEmbed('You need at least 100 coins to attempt a rob.')], ephemeral: true });
    const success = Math.random() < 0.4; // 40% chance
    if (success) {
      const stolen = Math.floor(victim.wallet * (Math.random() * 0.3 + 0.1)); // 10-40%
      victim.wallet -= stolen; robber.wallet += stolen;
      await dbSaveUser(robber); await dbSaveUser(victim);
      return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('🦹 Robbery Successful!').setDescription(`You robbed ${fmt(stolen)} from **${target.username}**!\n👛 Your wallet: ${fmt(robber.wallet)}`)] });
    } else {
      const fine = Math.floor(robber.wallet * 0.2);
      robber.wallet -= fine;
      await dbSaveUser(robber);
      return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.error).setTitle('🚔 Caught!').setDescription(`You got caught trying to rob **${target.username}** and paid a fine of ${fmt(fine)}!\n👛 Your wallet: ${fmt(robber.wallet)}`)] });
    }
  },
  name: 'rob',
  category: 'gambling', aliases: [], usage: ',rob @user',
  async run(client, msg, args) {
    const target = msg.mentions.users.first();
    if (!target || target.bot || target.id === msg.author.id) return msg.reply({ embeds: [errorEmbed('Mention a valid user to rob.')] });
    const robber = getUser(msg.guild.id, msg.author.id), victim = getUser(msg.guild.id, target.id);
    if (victim.wallet < 100 || robber.wallet < 100) return msg.reply({ embeds: [errorEmbed('Not enough coins to rob.')] });
    const success = Math.random() < 0.4;
    if (success) {
      const stolen = Math.floor(victim.wallet * (Math.random() * 0.3 + 0.1));
      victim.wallet -= stolen; robber.wallet += stolen;
      return msg.reply({ embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('🦹 Success!').setDescription(`Robbed ${fmt(stolen)} from **${target.username}**!`)] });
    } else {
      const fine = Math.floor(robber.wallet * 0.2);
      robber.wallet -= fine;
      return msg.reply({ embeds: [new EmbedBuilder().setColor(COLORS.error).setTitle('🚔 Caught!').setDescription(`Paid a fine of ${fmt(fine)}!`)] });
    }
  },
});

// ── Blackjack ─────────────────────────────────────────────────
registerCommand({
  cooldown: 5,
  data: new SlashCommandBuilder().setName('blackjack').setDescription('Play blackjack against the dealer')
    .addIntegerOption(o => o.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(1)),
  async execute(client, i) {
    const amount = i.options.getInteger('amount');
    const data   = await dbGetUser(i.guild.id, i.user.id);
    if (data.wallet < amount) return i.reply({ embeds: [errorEmbed(`You only have ${fmt(data.wallet)}.`)], ephemeral: true });

    const deck = shuffleDeck();
    let player = [deck.pop(), deck.pop()];
    let dealer = [deck.pop(), deck.pop()];
    const handValue = cards => {
      let val = 0, aces = 0;
      for (const c of cards) {
        if (c.v === 'A') { aces++; val += 11; }
        else if (['K','Q','J'].includes(c.v)) val += 10;
        else val += parseInt(c.v);
      }
      while (val > 21 && aces > 0) { val -= 10; aces--; }
      return val;
    };
    const cardStr = cards => cards.map(c => `${c.v}${c.s}`).join(' ');

    const pVal = handValue(player), dVal = handValue(dealer);
    if (pVal === 21) {
      const win = Math.floor(amount * 1.5);
      data.wallet += win;
      await dbSaveUser(data);
      return i.reply({ embeds: [new EmbedBuilder().setColor(0xFFD700).setTitle('🃏 Blackjack — BLACKJACK!').setDescription(`Your hand: ${cardStr(player)} = **21**\nDealer: ${cardStr(dealer)} = **${dVal}**\n\n🎉 Blackjack! You win ${fmt(win)}!`).addFields({ name: '👛 Balance', value: fmt(data.wallet) })] });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('bj_stand').setLabel('Stand').setStyle(ButtonStyle.Secondary),
    );
    const embed = () => new EmbedBuilder().setColor(COLORS.info).setTitle('🃏 Blackjack')
      .addFields({ name: '🧑 Your Hand', value: `${cardStr(player)} = **${handValue(player)}**` }, { name: '🏠 Dealer', value: `${dealer[0].v}${dealer[0].s} + ?` })
      .setFooter({ text: `Bet: ${amount} coins` });

    const msg2 = await i.reply({ embeds: [embed()], components: [row], fetchReply: true });
    const col  = msg2.createMessageComponentCollector({ time: 30000, filter: b => b.user.id === i.user.id });

    col.on('collect', async b => {
      if (b.customId === 'bj_hit') {
        player.push(deck.pop());
        const pv = handValue(player);
        if (pv > 21) {
          data.wallet -= amount; await dbSaveUser(data); col.stop();
          return b.update({ embeds: [new EmbedBuilder().setColor(COLORS.error).setTitle('🃏 Blackjack — Bust!').setDescription(`Your hand: ${cardStr(player)} = **${pv}**\n\n❌ Bust! You lost ${fmt(amount)}.`).addFields({ name: '👛 Balance', value: fmt(data.wallet) })], components: [] });
        }
        return b.update({ embeds: [embed()], components: [row] });
      }
      if (b.customId === 'bj_stand') {
        while (handValue(dealer) < 17) dealer.push(deck.pop());
        const pv = handValue(player), dv = handValue(dealer);
        let result, winnings = 0;
        if (dv > 21 || pv > dv) { result = `✅ You win!`; winnings = amount; }
        else if (pv === dv)      { result = `🤝 Push! Bet returned.`; }
        else                     { result = `❌ Dealer wins.`; winnings = -amount; }
        data.wallet += winnings; await dbSaveUser(data); col.stop();
        return b.update({ embeds: [new EmbedBuilder().setColor(winnings >= 0 ? COLORS.success : COLORS.error).setTitle('🃏 Blackjack — Result').setDescription(`Your hand: ${cardStr(player)} = **${pv}**\nDealer: ${cardStr(dealer)} = **${dv}**\n\n${result}`).addFields({ name: '👛 Balance', value: fmt(data.wallet) })], components: [] });
      }
    });
    col.on('end', (_, reason) => { if (reason === 'time') i.editReply({ components: [] }).catch(() => {}); });
  },
  name: 'blackjack',
  category: 'gambling', aliases: ['bj'], usage: ',blackjack <amount>',
  async run(client,msg,args) {
    const amount=parseInt(args[0]);
    if(isNaN(amount)||amount<=0)return msg.reply({embeds:[errorEmbed('Usage: `,blackjack <bet amount>`')]});
    const data=await dbGetUser(msg.guild.id,msg.author.id);
    if(data.wallet<amount)return msg.reply({embeds:[errorEmbed(`You only have ${fmt(data.wallet)}.`)]});
    const deck=shuffleDeck();
    let player=[deck.pop(),deck.pop()],dealer=[deck.pop(),deck.pop()];
    const handValue=cards=>{let val=0,aces=0;for(const c of cards){if(c.v==='A'){aces++;val+=11;}else if(['K','Q','J'].includes(c.v))val+=10;else val+=parseInt(c.v);}while(val>21&&aces>0){val-=10;aces--;}return val;};
    const cardStr=cards=>cards.map(c=>`${c.v}${c.s}`).join(' ');
    const pVal=handValue(player);
    if(pVal===21){const win=Math.floor(amount*1.5);data.wallet+=win;await dbSaveUser(data);return msg.reply({embeds:[new EmbedBuilder().setColor(0xFFD700).setTitle('🃏 BLACKJACK!').setDescription(`Your hand: ${cardStr(player)} = **21**\n\n🎉 Won ${fmt(win)}!`)]});}
    const status=()=>new EmbedBuilder().setColor(COLORS.info).setTitle('🃏 Blackjack').addFields({name:'Your Hand',value:`${cardStr(player)} = **${handValue(player)}**`},{name:'Dealer',value:`${dealer[0].v}${dealer[0].s} + ?`}).setFooter({text:`Bet: ${amount} | Reply H=Hit S=Stand`});
    await msg.reply({embeds:[status()]});
    const filter=m=>m.author.id===msg.author.id&&['h','s','hit','stand'].includes(m.content.toLowerCase());
    let playing=true;
    while(playing){
      const col=await msg.channel.awaitMessages({filter,max:1,time:30000}).catch(()=>null);
      if(!col||!col.size){playing=false;data.wallet-=amount;await dbSaveUser(data);await msg.channel.send({embeds:[errorEmbed(`Time's up! Lost ${fmt(amount)}.`)]});break;}
      const choice=col.first().content.toLowerCase();
      if(choice==='h'||choice==='hit'){
        player.push(deck.pop());const pv=handValue(player);
        if(pv>21){playing=false;data.wallet-=amount;await dbSaveUser(data);await msg.channel.send({embeds:[new EmbedBuilder().setColor(COLORS.error).setTitle('🃏 Bust!').setDescription(`${cardStr(player)} = **${pv}**\n❌ Lost ${fmt(amount)}.`)]});break;}
        await msg.channel.send({embeds:[status()]});
      } else {
        while(handValue(dealer)<17)dealer.push(deck.pop());
        const pv=handValue(player),dv=handValue(dealer);
        let result,winnings=0;
        if(dv>21||pv>dv){result='✅ You win!';winnings=amount;}else if(pv===dv){result='🤝 Push!';}else{result='❌ Dealer wins.';winnings=-amount;}
        data.wallet+=winnings;await dbSaveUser(data);
        await msg.channel.send({embeds:[new EmbedBuilder().setColor(winnings>=0?COLORS.success:COLORS.error).setTitle('🃏 Result').setDescription(`Your: ${cardStr(player)} = **${pv}**\nDealer: ${cardStr(dealer)} = **${dv}**\n\n${result}`).addFields({name:'Balance',value:fmt(data.wallet)})]});
        playing=false;
      }
    }
  },
});

// ─────────────────────────────────────────────────────────────
//  SHOP COMMANDS
// ─────────────────────────────────────────────────────────────

// ── Shop view ─────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('shop').setDescription('View the server shop'),
  async execute(client, i) {
    const shop = getShop(i.guild.id);
    if (!shop.size) return i.reply({ embeds: [infoEmbed('The shop is empty! Admins can add items with `/setprize`.')] });
    const desc = [...shop.entries()].map(([name, item], idx) =>
      `**${idx + 1}. ${name}**\n> ${item.description || item.action}\n> Price: ${fmt(item.price)}`
    ).join('\n\n');
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('🛒 Server Shop').setDescription(desc).setFooter({ text: 'Use /buy <item> to purchase' })] });
  },
  name: 'shop',
  category: 'shop', aliases: [], usage: ',shop',
  async run(client, msg) {
    const shop = getShop(msg.guild.id);
    if (!shop.size) return msg.reply({ embeds: [infoEmbed('Shop is empty.')] });
    const desc = [...shop.entries()].map(([name, item], i) => `**${i + 1}. ${name}** — ${fmt(item.price)}\n> ${item.description || item.action}`).join('\n\n');
    return msg.reply({ embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('🛒 Shop').setDescription(desc)] });
  },
});

// ── Set prize / add shop item ─────────────────────────────────
registerCommand({
  userPermissions: [PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder().setName('setprize').setDescription('Add or update an item in the shop').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true))
    .addStringOption(o => o.setName('action').setDescription('What happens when bought e.g. "Gets the VIP role"').setRequired(true))
    .addIntegerOption(o => o.setName('price').setDescription('Price in coins').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('description').setDescription('Item description (optional)')),
  async execute(client, i) {
    const name   = i.options.getString('name');
    const action = i.options.getString('action');
    const price  = i.options.getInteger('price');
    const desc   = i.options.getString('description') ?? action;
    getShop(i.guild.id).set(name.toLowerCase(), { action, price, description: desc });
    return i.reply({ embeds: [successEmbed(`**${name}** added to the shop!\n**Action:** ${action}\n**Price:** ${fmt(price)}`)] });
  },
  name: 'setprize',
  category: 'shop', aliases: ['additem', 'shopset'], usage: ',setprize <name> <action> <price>',
  async run(client, msg, args) {
    if (!msg.member.permissions.has(PermissionFlagsBits.ManageGuild)) return msg.reply({ embeds: [errorEmbed('You need Manage Server.')] });
    const name = args[0], price = parseInt(args[args.length - 1]), action = args.slice(1, -1).join(' ');
    if (!name || !action || isNaN(price)) return msg.reply({ embeds: [errorEmbed('Usage: ,setprize <name> <action> <price>')] });
    getShop(msg.guild.id).set(name.toLowerCase(), { action, price, description: action });
    return msg.reply({ embeds: [successEmbed(`**${name}** added to shop for ${fmt(price)}!`)] });
  },
});

// ── Remove shop item ──────────────────────────────────────────
registerCommand({
  userPermissions: [PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder().setName('removeitem').setDescription('Remove an item from the shop').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true)),
  async execute(client, i) {
    const name = i.options.getString('name').toLowerCase();
    const shop = getShop(i.guild.id);
    if (!shop.has(name)) return i.reply({ embeds: [errorEmbed(`Item \`${name}\` not found in shop.`)], ephemeral: true });
    shop.delete(name);
    return i.reply({ embeds: [successEmbed(`**${name}** removed from the shop.`)] });
  },
  name: 'removeitem',
  category: 'shop', aliases: ['delitem', 'shopremove'], usage: ',removeitem <name>',
  async run(client, msg, args) {
    if (!msg.member.permissions.has(PermissionFlagsBits.ManageGuild)) return msg.reply({ embeds: [errorEmbed('Need Manage Server.')] });
    const name = args.join(' ').toLowerCase();
    if (!name) return msg.reply({ embeds: [errorEmbed('Provide item name.')] });
    getShop(msg.guild.id).delete(name);
    return msg.reply({ embeds: [successEmbed(`Removed **${name}** from shop.`)] });
  },
});

// ── Buy ───────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder().setName('buy').setDescription('Buy an item from the shop')
    .addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true)),
  async execute(client, i) {
    const name = i.options.getString('item').toLowerCase();
    const shop = getShop(i.guild.id), item = shop.get(name);
    if (!item) return i.reply({ embeds: [errorEmbed(`Item \`${name}\` not found. Use \`/shop\` to see available items.`)], ephemeral: true });
    const data = getUser(i.guild.id, i.user.id);
    if (data.wallet < item.price) return i.reply({ embeds: [errorEmbed(`You need ${fmt(item.price)} but only have ${fmt(data.wallet)}.`)], ephemeral: true });
    data.wallet -= item.price;
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.success).setTitle('🛒 Purchase Successful!')
      .setDescription(`You bought **${name}** for ${fmt(item.price)}!\n\n**What happens:** ${item.action}`)
      .addFields({ name: '👛 Remaining Balance', value: fmt(data.wallet) })] });
  },
  name: 'buy',
  category: 'shop', aliases: [], usage: ',buy <item>',
  async run(client, msg, args) {
    const name = args.join(' ').toLowerCase();
    if (!name) return msg.reply({ embeds: [errorEmbed('Provide an item name.')] });
    const shop = getShop(msg.guild.id), item = shop.get(name);
    if (!item) return msg.reply({ embeds: [errorEmbed(`Item not found. Use \`,shop\` to see items.`)] });
    const data = getUser(msg.guild.id, msg.author.id);
    if (data.wallet < item.price) return msg.reply({ embeds: [errorEmbed(`Need ${fmt(item.price)}, have ${fmt(data.wallet)}.`)] });
    data.wallet -= item.price;
    return msg.reply({ embeds: [successEmbed(`Bought **${name}** for ${fmt(item.price)}!\n**Action:** ${item.action}`)] });
  },
});

// ── Helper functions ──────────────────────────────────────────
function spinSlots() {
  const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎', '7️⃣'];
  const reels   = [SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)], SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)], SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]];
  const jackpot = reels[0] === reels[1] && reels[1] === reels[2];
  const two     = !jackpot && (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]);
  return { reels, jackpot, two };
}

function shuffleDeck() {
  const suits  = ['♠', '♥', '♦', '♣'];
  const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const deck   = suits.flatMap(s => values.map(v => ({ v, s })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ─────────────────────────────────────────────────────────────
//  EMBED TEMPLATE PARSER
//  Parses {embed}{title: ...}{description: ...} etc from strings
//  Supports variables: {user} {server} {count} {level} {tag}
// ─────────────────────────────────────────────────────────────
function parseEmbedString(raw, vars = {}) {
  // Replace variables
  let str = raw
    .replace(/\{user\}/g,    vars.user    ?? '')
    .replace(/\{tag\}/g,     vars.tag     ?? '')
    .replace(/\{server\}/g,  vars.server  ?? '')
    .replace(/\{count\}/g,   vars.count   ?? '')
    .replace(/\{level\}/g,   vars.level   ?? '')
    .replace(/\{channel\}/g, vars.channel ?? '')
    .replace(/\{avatar\}/g,  vars.avatar  ?? '')
    .replace(/\{membercount\}/g, vars.count ?? '')
    .replace(/\{mention\}/g, vars.user    ?? '');

  // If no {embed} tag, return plain text message
  if (!str.includes('{embed}')) return { type: 'text', content: str };

  // Parse all {key: value} pairs after {embed}
  const embedPart = str.replace('{embed}', '').trim();
  const props = {};
  const regex = /\{(\w+):\s*([\s\S]*?)\}(?=\s*\{|$)/g;
  let match;
  while ((match = regex.exec(embedPart)) !== null) {
    props[match[1].toLowerCase()] = match[2].trim();
  }

  const embed = new EmbedBuilder();

  if (props.title)       embed.setTitle(props.title);
  if (props.description) embed.setDescription(props.description);
  if (props.color)       { try { embed.setColor(props.color); } catch { embed.setColor('#5865F2'); } }
  if (props.footer)      embed.setFooter({ text: props.footer, iconURL: props.footericon ?? undefined });
  if (props.thumbnail)   embed.setThumbnail(props.thumbnail);
  if (props.image)       embed.setImage(props.image);
  if (props.author)      embed.setAuthor({ name: props.author, iconURL: props.authoricon ?? undefined });
  if (props.url)         embed.setURL(props.url);
  if (props.timestamp)   embed.setTimestamp();

  // Support multiple fields: {field1name: Name} {field1value: Value} {field1inline: yes}
  for (let i = 1; i <= 10; i++) {
    if (props[`field${i}name`] && props[`field${i}value`]) {
      embed.addFields({
        name  : props[`field${i}name`],
        value : props[`field${i}value`],
        inline: props[`field${i}inline`]?.toLowerCase().startsWith('y') ?? false,
      });
    }
  }

  // Default color if none set
  if (!props.color) embed.setColor('#5865F2');

  return { type: 'embed', embed };
}

// Helper to send a parsed embed/text to a channel
async function sendParsed(channel, raw, vars = {}) {
  const parsed = parseEmbedString(raw, vars);
  if (parsed.type === 'embed') {
    await channel.send({ embeds: [parsed.embed] });
  } else {
    await channel.send(parsed.content);
  }
}

// ─────────────────────────────────────────────────────────────
//  COMMAND ALIAS SYSTEM
//  Lets server admins rename any command to anything
// ─────────────────────────────────────────────────────────────
const _cmdAliases = new Map(); // Map<guildId, Map<alias, realCommandName>>

function getCmdAliases(guildId) {
  if (!_cmdAliases.has(guildId)) _cmdAliases.set(guildId, new Map());
  return _cmdAliases.get(guildId);
}

// Override prefix command resolution to check custom aliases first
function resolveCommand(guildId, name) {
  const guildAliases = getCmdAliases(guildId);
  // Check custom guild aliases first
  if (guildAliases.has(name)) {
    const real = guildAliases.get(name);
    return client.prefixCmds.get(real) ?? client.prefixCmds.get(client.aliases.get(real));
  }
  // Fall back to built-in aliases
  const resolved = client.aliases.get(name) ?? name;
  return client.prefixCmds.get(resolved) ?? null;
}

// ─────────────────────────────────────────────────────────────
//  ALIAS COMMAND — /alias
// ─────────────────────────────────────────────────────────────
registerCommand({
  userPermissions: [PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder()
    .setName('alias')
    .setDescription('Rename any command to a custom name')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s
      .setName('set')
      .setDescription('Set a custom alias for a command')
      .addStringOption(o => o.setName('alias').setDescription('Your custom name e.g. slime').setRequired(true))
      .addStringOption(o => o.setName('command').setDescription('The real command e.g. ban').setRequired(true)))
    .addSubcommand(s => s
      .setName('remove')
      .setDescription('Remove a custom alias')
      .addStringOption(o => o.setName('alias').setDescription('Alias to remove').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List all custom aliases')),

  async execute(client, i) {
    const sub = i.options.getSubcommand();
    const guildAliases = getCmdAliases(i.guild.id);

    if (sub === 'set') {
      const alias   = i.options.getString('alias').toLowerCase();
      const cmdName = i.options.getString('command').toLowerCase();
      // Verify the target command exists
      const exists = client.prefixCmds.has(cmdName) || client.aliases.has(cmdName) || client.prefixCmds.has(client.aliases.get(cmdName));
      if (!exists) return i.reply({ embeds: [errorEmbed(`Command \`${cmdName}\` not found. Make sure you use the base command name.`)], ephemeral: true });
      // Resolve to real name
      const real = client.aliases.get(cmdName) ?? cmdName;
      guildAliases.set(alias, real);
      return i.reply({ embeds: [successEmbed(`\`${alias}\` now runs \`${real}\`.\nUse \`,${alias}\` to trigger it!`)] });
    }

    if (sub === 'remove') {
      const alias = i.options.getString('alias').toLowerCase();
      if (!guildAliases.has(alias)) return i.reply({ embeds: [errorEmbed(`Alias \`${alias}\` not found.`)], ephemeral: true });
      guildAliases.delete(alias);
      return i.reply({ embeds: [successEmbed(`Alias \`${alias}\` removed.`)] });
    }

    if (sub === 'list') {
      if (!guildAliases.size) return i.reply({ embeds: [infoEmbed('No custom aliases set.\nUse `/alias set` to create one.')], ephemeral: true });
      const desc = [...guildAliases.entries()].map(([a, r]) => `\`,${a}\` → \`,${r}\``).join('\n');
      return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('📝 Custom Command Aliases').setDescription(desc)], ephemeral: true });
    }
  },

  name: 'alias',
  category: 'config',
  aliases: ['cmdalias'],
  usage: ',alias set <alias> <command> | remove <alias> | list',
  async run(client, msg, args) {
    if (!msg.member.permissions.has(PermissionFlagsBits.ManageGuild)) return msg.reply({ embeds: [errorEmbed('You need Manage Server.')] });
    const sub = args[0]?.toLowerCase();
    const guildAliases = getCmdAliases(msg.guild.id);

    if (sub === 'set') {
      const alias = args[1]?.toLowerCase(), cmdName = args[2]?.toLowerCase();
      if (!alias || !cmdName) return msg.reply({ embeds: [errorEmbed('Usage: ,alias set <alias> <command>')] });
      const real = client.aliases.get(cmdName) ?? cmdName;
      if (!client.prefixCmds.has(real)) return msg.reply({ embeds: [errorEmbed(`Command \`${cmdName}\` not found.`)] });
      guildAliases.set(alias, real);
      return msg.reply({ embeds: [successEmbed(`\`${alias}\` → \`${real}\` set!`)] });
    }
    if (sub === 'remove') {
      const alias = args[1]?.toLowerCase();
      if (!alias || !guildAliases.has(alias)) return msg.reply({ embeds: [errorEmbed('Alias not found.')] });
      guildAliases.delete(alias);
      return msg.reply({ embeds: [successEmbed(`Alias \`${alias}\` removed.`)] });
    }
    if (sub === 'list') {
      if (!guildAliases.size) return msg.reply({ embeds: [infoEmbed('No custom aliases.')] });
      return msg.reply({ embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('Custom Aliases').setDescription([...guildAliases.entries()].map(([a, r]) => `\`,${a}\` → \`,${r}\``).join('\n'))] });
    }
    return msg.reply({ embeds: [infoEmbed('Usage: ,alias set/remove/list')] });
  },
});

// ─────────────────────────────────────────────────────────────
//  EMBED SYNTAX PREVIEW / TESTER COMMAND
// ─────────────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder()
    .setName('embedtest')
    .setDescription('Test your embed syntax before using it in welcome/autoresponder etc')
    .addStringOption(o => o.setName('code').setDescription('Your embed code').setRequired(true)),
  async execute(client, i) {
    const code   = i.options.getString('code');
    const parsed = parseEmbedString(code, {
      user   : i.user.toString(),
      tag    : i.user.tag,
      server : i.guild.name,
      count  : i.guild.memberCount.toString(),
      level  : '5',
    });
    if (parsed.type === 'text') {
      return i.reply({ content: `**Preview (plain text):**\n${parsed.content}`, ephemeral: true });
    }
    return i.reply({ embeds: [parsed.embed], content: '**Preview:**', ephemeral: true });
  },
  name: 'embedtest',
  category: 'utility',
  aliases: ['testembed'],
  usage: ',embedtest {embed}{title: Hi}{description: Hello!}',
  async run(client, msg, args) {
    const code   = args.join(' ');
    if (!code) return msg.reply({ embeds: [errorEmbed('Provide embed code.')] });
    const parsed = parseEmbedString(code, { user: msg.author.toString(), tag: msg.author.tag, server: msg.guild.name, count: msg.guild.memberCount.toString() });
    if (parsed.type === 'text') return msg.reply({ content: `**Preview:** ${parsed.content}` });
    return msg.reply({ embeds: [parsed.embed], content: '**Preview:**' });
  },
});

// ─────────────────────────────────────────────────────────────
//  EMBED SYNTAX HELP COMMAND
// ─────────────────────────────────────────────────────────────
registerCommand({
  data: new SlashCommandBuilder()
    .setName('embedsyntax')
    .setDescription('Show all available embed syntax tags'),
  async execute(client, i) {
    return i.reply({ embeds: [buildEmbedSyntaxHelp()], ephemeral: true });
  },
  name: 'embedsyntax',
  category: 'utility',
  aliases: ['embedhelp', 'embeds'],
  usage: ',embedsyntax',
  async run(client, msg) {
    return msg.reply({ embeds: [buildEmbedSyntaxHelp()] });
  },
});

function buildEmbedSyntaxHelp() {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('📋 Embed Syntax Guide')
    .setDescription('Use `{embed}` followed by any of these tags.\nWorks in: welcome messages, autoresponder, level-up messages, announcements.')
    .addFields(
      { name: '🏗️ Basic Tags', value:
        '`{embed}` — Start of embed\n' +
        '`{title: Your Title}`\n' +
        '`{description: Your text here}`\n' +
        '`{color: #FF0000}` — Hex color\n' +
        '`{footer: Footer text}`\n' +
        '`{footericon: https://...}` — Footer icon URL\n' +
        '`{thumbnail: https://...}` — Small image top-right\n' +
        '`{image: https://...}` — Large bottom image\n' +
        '`{author: Author Name}`\n' +
        '`{authoricon: https://...}` — Author icon\n' +
        '`{url: https://...}` — Clickable title URL\n' +
        '`{timestamp}` — Adds current timestamp',
        inline: false },
      { name: '📦 Fields (up to 10)', value:
        '`{field1name: Field Title}`\n' +
        '`{field1value: Field Content}`\n' +
        '`{field1inline: yes}` — Side by side\n\n' +
        'Use field2, field3... for more.',
        inline: false },
      { name: '🔤 Variables', value:
        '`{user}` — Mentions the user e.g. <@123>\n' +
        '`{tag}` — Username#0000\n' +
        '`{server}` — Server name\n' +
        '`{count}` — Member count\n' +
        '`{level}` — User\'s level (level-up only)\n' +
        '`{channel}` — Current channel',
        inline: false },
      { name: '💡 Example', value:
        '```\n{embed}{title: Welcome!}{description: Hey {user}, welcome to {server}!}{color: #57F287}{footer: Member #{count}}\n```',
        inline: false },
    );
}

