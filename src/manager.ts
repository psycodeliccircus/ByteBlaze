import {
  Client,
  GatewayIntentBits,
  Collection,
  ColorResolvable,
  Message,
  ActionRowBuilder,
  ButtonBuilder,
} from "discord.js";
import { DatabaseService } from "./database/index.js";
import { I18n, I18nArgs } from "@hammerhq/localization";
import { resolve } from "path";
import { ConfigDataService } from "./services/ConfigDataService.js";
import { LoggerService } from "./services/LoggerService.js";
import { ClusterClient, getInfo } from "discord-hybrid-sharding";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { WebServer } from "./webserver/index.js";
import { ManifestService } from "./services/ManifestService.js";
import { NormalModeIcons } from "./assets/NormalModeIcons.js";
import { SafeModeIcons } from "./assets/SafeModeIcons.js";
import { config } from "dotenv";
import { initHandler } from "./handlers/index.js";
import { DeployService } from "./services/DeployService.js";
import { RainlinkInit } from "./structures/Rainlink.js";
import { Metadata } from "./@types/Metadata.js";
import { Config } from "./@types/Config.js";
import { DatabaseTable } from "./database/@types.js";
import { LavalinkDataType, LavalinkUsingDataType } from "./@types/Lavalink.js";
import { Rainlink } from "./rainlink/Rainlink.js";
import { Command } from "./structures/Command.js";
import { Premium } from "./database/schema/Premium.js";
import { PlayerButton } from "./@types/Button.js";
import { GlobalMsg } from "./structures/CommandHandler.js";
import { RequestInterface } from "./webserver/RequestInterface.js";
import { RainlinkPlayer } from "./rainlink/main.js";
import { IconType } from "./@types/Emoji.js";
import { WebSocket } from "ws";
import { TopggService } from "./services/TopggService.js";
config();
const __dirname = dirname(fileURLToPath(import.meta.url));
const configData = new ConfigDataService().data;
const REGEX = [
  /(?:https?:\/\/)?(?:www\.)?youtu(?:\.be\/|be.com\/\S*(?:watch|embed)(?:(?:(?=\/[-a-zA-Z0-9_]{11,}(?!\S))\/)|(?:\S*v=|v\/)))([-a-zA-Z0-9_]{11,})/,
  /^.*(youtu.be\/|list=)([^#\&\?]*).*/,
  /^(?:spotify:|https:\/\/[a-z]+\.spotify\.com\/(track\/|user\/(.*)\/playlist\/|playlist\/))(.*)$/,
  /^https?:\/\/(?:www\.)?deezer\.com\/[a-z]+\/(track|album|playlist)\/(\d+)$/,
  /^(?:(https?):\/\/)?(?:(?:www|m)\.)?(soundcloud\.com|snd\.sc)\/(.*)$/,
  /(?:https:\/\/music\.apple\.com\/)(?:.+)?(artist|album|music-video|playlist)\/([\w\-\.]+(\/)+[\w\-\.]+|[^&]+)\/([\w\-\.]+(\/)+[\w\-\.]+|[^&]+)/,
  /^https?:\/\/(?:www\.|secure\.|sp\.)?nicovideo\.jp\/watch\/([a-z]{2}[0-9]+)/,
  /(?:https:\/\/spotify\.link)\/([A-Za-z0-9]+)/,
  /^https:\/\/deezer\.page\.link\/[a-zA-Z0-9]{12}$/,
];

export class Manager extends Client {
  metadata: Metadata;
  config: Config;
  logger: LoggerService;
  db!: DatabaseTable;
  owner: string;
  color: ColorResolvable;
  i18n: I18n;
  prefix: string;
  isDatabaseConnected: boolean;
  shardStatus: boolean;
  lavalinkList: LavalinkDataType[];
  lavalinkUsing: LavalinkUsingDataType[];
  lavalinkUsed: LavalinkUsingDataType[];
  rainlink: Rainlink;
  commands: Collection<string, Command>;
  premiums: Collection<string, Premium>;
  interval: Collection<string, NodeJS.Timer>;
  sentQueue: Collection<string, boolean>;
  nplayingMsg: Collection<string, Message>;
  aliases: Collection<string, string>;
  plButton: Collection<string, PlayerButton>;
  leaveDelay: Collection<string, NodeJS.Timeout>;
  nowPlaying: Collection<string, { interval: NodeJS.Timeout; msg: GlobalMsg }>;
  websocket?: WebSocket;
  wsMessage?: Collection<string, RequestInterface>;
  UpdateMusic!: (player: RainlinkPlayer) => Promise<void | Message<true>>;
  UpdateQueueMsg!: (player: RainlinkPlayer) => Promise<void | Message<true>>;
  enSwitch!: ActionRowBuilder<ButtonBuilder>;
  diSwitch!: ActionRowBuilder<ButtonBuilder>;
  enSwitchMod!: ActionRowBuilder<ButtonBuilder>;
  topgg?: TopggService;
  icons: IconType;
  cluster?: ClusterClient<Client>;
  REGEX: RegExp[];
  constructor() {
    super({
      shards: process.env.IS_SHARING == "true" ? getInfo().SHARD_LIST : "auto",
      shardCount: process.env.IS_SHARING == "true" ? getInfo().TOTAL_SHARDS : 1,
      allowedMentions: {
        parse: ["roles", "users", "everyone"],
        repliedUser: false,
      },
      intents: configData.features.MESSAGE_CONTENT.enable
        ? [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
          ]
        : [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages],
    });

    // Initial basic bot config
    // process.argv[1].replace(/^.*[\\\/]/, "") + " " +
    this.logger = new LoggerService();
    this.logger.info(import.meta.url, "Booting client...");
    this.config = configData;
    this.metadata = new ManifestService().data.metadata.bot;
    this.owner = this.config.bot.OWNER_ID;
    this.color = (this.config.bot.EMBED_COLOR || "#2b2d31") as ColorResolvable;
    this.i18n = new I18n({
      defaultLocale: this.config.bot.LANGUAGE || "en",
      directory: resolve(join(__dirname, "languages")),
    });
    this.prefix = this.config.features.MESSAGE_CONTENT.commands.prefix || "d!";
    this.shardStatus = false;
    this.REGEX = REGEX;

    if (!this.config.lavalink.AVOID_SUSPEND)
      this.logger.warn(
        import.meta.url,
        "You just disabled AVOID_SUSPEND feature. Enable this on app.yml to avoid discord suspend your bot!"
      );
    // Initial autofix lavalink varibles
    this.lavalinkList = [];
    this.lavalinkUsing = [];
    this.lavalinkUsed = [];

    // Ws varible
    this.config.features.WEB_SERVER.websocket.enable ? (this.wsMessage = new Collection()) : undefined;

    // Collections
    this.commands = new Collection<string, Command>();
    this.premiums = new Collection<string, Premium>();
    this.interval = new Collection<string, NodeJS.Timer>();
    this.sentQueue = new Collection<string, boolean>();
    this.aliases = new Collection<string, string>();
    this.nplayingMsg = new Collection<string, Message>();
    this.plButton = new Collection<string, PlayerButton>();
    this.leaveDelay = new Collection<string, NodeJS.Timeout>();
    this.nowPlaying = new Collection<string, { interval: NodeJS.Timeout; msg: GlobalMsg }>();
    this.isDatabaseConnected = false;

    // Sharing
    this.cluster = process.env.IS_SHARING == "true" ? new ClusterClient(this) : undefined;

    // Icons setup
    this.icons = this.config.bot.SAFE_ICONS_MODE ? SafeModeIcons : NormalModeIcons;

    process.on("unhandledRejection", (error) => this.logger.unhandled(import.meta.url, error));
    process.on("uncaughtException", (error) => this.logger.unhandled(import.meta.url, error));

    if (
      this.config.features.WEB_SERVER.websocket.enable &&
      (!this.config.features.WEB_SERVER.websocket.secret ||
        this.config.features.WEB_SERVER.websocket.secret.length == 0)
    ) {
      this.logger.error(import.meta.url, "Must have secret in your ws config for secure!");
      process.exit();
    }

    this.rainlink = new RainlinkInit(this).init;

    if (this.config.features.WEB_SERVER.enable) {
      new WebServer(this);
    }
    new DeployService(this);
    new initHandler(this);
    new DatabaseService(this);
    super.login(this.config.bot.TOKEN);
  }

  configVolCheck(vol: number = this.config.lavalink.DEFAULT_VOLUME) {
    if (!vol || isNaN(vol) || vol > 100 || vol < 1) {
      this.config.lavalink.DEFAULT_VOLUME = 100;
      return false;
    }
    return true;
  }

  configSearchCheck(data: string[] = this.config.lavalink.AUTOCOMPLETE_SEARCH) {
    const defaultSearch = ["yorushika", "yoasobi", "tuyu", "hinkik"];
    if (!data || data.length == 0) {
      this.config.lavalink.AUTOCOMPLETE_SEARCH = defaultSearch;
      return false;
    }
    for (const element of data) {
      if (!this.stringCheck(element)) {
        this.config.lavalink.AUTOCOMPLETE_SEARCH = defaultSearch;
        return false;
      }
    }
    return true;
  }

  stringCheck(data: unknown) {
    if (typeof data === "string" || data instanceof String) return true;
    return false;
  }

  getString(locale: string, section: string, key: string, args?: I18nArgs | undefined) {
    const currentString = this.i18n.get(locale, section, key, args);
    const locateErr = `Locale '${locale}' not found.`;
    const sectionErr = `Section '${section}' not found in locale '${locale}'`;
    const keyErr = `Key '${key}' not found in section ${section} in locale '${locale}'`;
    if (currentString == locateErr || currentString == sectionErr || currentString == keyErr) {
      return this.i18n.get("en", section, key, args);
    } else return currentString;
  }
}
