import * as fs from 'fs'
import * as path from 'path'
import { EventEmitter } from 'node:events'
import * as readline from 'node:readline'
import Database from 'better-sqlite3'
import {integer, sqliteTable, text} from "drizzle-orm/sqlite-core";
import {and, count, desc, like} from "drizzle-orm";
import {drizzle} from 'drizzle-orm/better-sqlite3'
import {path_utils} from "./path_utils.js";

/** 日志事件发射器，供 Web 控制台等外部订阅实时日志 */
export const logEvents = new EventEmitter()
logEvents.setMaxListeners(50)

export type LoggerType = 'info' | 'warn' | 'error'

const R = '\x1b[0m'
const B = '\x1b[1m'
const D = '\x1b[2m'

const logger_type_style: Record<LoggerType, { icon: string; color: string; msgColor: string }> = {
  info:  { icon: '✔', color: '\x1b[32m', msgColor: '\x1b[97m' },
  warn:  { icon: '⚠', color: '\x1b[33m', msgColor: '\x1b[97m' },
  error: { icon: '✖', color: '\x1b[31m', msgColor: '\x1b[97m' }
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${formatDate(date)} ${hh}:${mm}:${ss}`
}

const log_table = sqliteTable("logs", {
    id: integer("id").primaryKey({autoIncrement: true}),
    time: text("time").notNull(),
    platform: text("platform").notNull(),
    plugin: text("plugin").notNull(),
    type: text("type").notNull(),
    msg: text("msg").notNull()
})

const log_meta_table = sqliteTable("log_meta", {
    platform: text("platform").notNull(),
    plugin: text("plugin").notNull(),
    type: text("type").notNull()
})

let _db: ReturnType<typeof Database> | null = null
let _orm: ReturnType<typeof drizzle> | null = null

let _rl: readline.Interface | null = null

function bindReadline(rl: readline.Interface) {
  _rl = rl
}

function ensureDb() {
  if (_db) return
  const dbPath = path.join(path_utils.get_project_root_path(), 'logs', 'logs.db')
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  _db = new Database(dbPath)
  _orm = drizzle(_db)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL,
      platform TEXT NOT NULL,
      plugin TEXT NOT NULL,
      type TEXT NOT NULL,
      msg TEXT NOT NULL
    )
  `)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS log_meta (
      platform TEXT NOT NULL,
      plugin TEXT NOT NULL,
      type TEXT NOT NULL,
      UNIQUE(platform, plugin, type)
    )
  `)
}

interface LogEntry {
  time: string
  platform: string
  plugin: string
  type: string
  msg: string
}

type LogFilter = { platform?: string; plugin?: string; type?: string }

function queryLogs(filter: LogFilter, page: number, pageSize: number): [number, LogEntry[]] {
  ensureDb()
  const conditions: any[] = []
  if (filter.platform) {
    conditions.push(like(log_table.platform, filter.platform))
  }
  if (filter.plugin) {
    conditions.push(like(log_table.plugin, filter.plugin))
  }
  if (filter.type) {
    conditions.push(like(log_table.type, filter.type))
  }
  const where_condition = conditions.length > 0 ? and(...conditions) : undefined

  const rows = _orm!.select().from(log_table).where(where_condition).orderBy(desc(log_table.id)).limit(pageSize).offset((page - 1) * pageSize).all()
  const totalResult = _orm!.select({count: count()}).from(log_table).where(where_condition).all()
  return [totalResult[0].count, rows]
}

function logger(platform: string, plugin: string, msg: string, type: LoggerType = 'info') {
  const now = new Date()
  const timeStr = formatTime(now)

  const s = logger_type_style[type]
  const time = `${D}[${timeStr.split(' ')[1] ?? timeStr}]${R}`
  const label = `${s.color}${B}[${type.toUpperCase()}]${R}`
  const tags = `${s.color}[${platform}][${plugin}]${R}`
  const line = `${time}${label}${tags} ${s.msgColor}${msg}${R}`

  if (_rl) {
    const input = (_rl as any).line ?? ''
    readline.cursorTo(process.stdout, 0)
    readline.clearLine(process.stdout, 0)
    process.stdout.write(line + '\n')
    if (input) {
      process.stdout.write(input)
    }
  } else {
    console.log(line)
  }

  ensureDb()
  _orm!.insert(log_table).values({
    time: timeStr,
    platform,
    plugin,
    type,
    msg
  }).run()
  _orm!.insert(log_meta_table).values({platform, plugin, type}).onConflictDoNothing().run()

  // 推送实时日志事件
  logEvents.emit('log', { time: timeStr, platform, plugin, type, msg })
}

function get_logger_by_platform(platform: string, page: number = 1, page_size: number = 10) {
  return queryLogs({platform}, page, page_size)
}

function get_logger_by_platform_type(platform: string, type: LoggerType, page: number = 1, page_size: number = 10) {
  return queryLogs({platform, type}, page, page_size)
}
function get_logger_by_platform_plugin(platform: string, plugin: string, page: number = 1, page_size: number = 10) {
  return queryLogs({platform, plugin}, page, page_size)
}

function get_logger_by_platform_plugin_type(platform: string, plugin: string, type: LoggerType, page: number = 1, page_size: number = 10) {
  return queryLogs({platform, plugin, type}, page, page_size)
}


function get_platforms_plugins_types() {
  ensureDb()
  const platforms = _orm!.select({value: log_meta_table.platform}).from(log_meta_table).groupBy(log_meta_table.platform).all().map(r => r.value)
  const plugins = _orm!.select({value: log_meta_table.plugin}).from(log_meta_table).groupBy(log_meta_table.plugin).all().map(r => r.value)
  const types = _orm!.select({value: log_meta_table.type}).from(log_meta_table).groupBy(log_meta_table.type).all().map(r => r.value)
  return { platforms, plugins, types }
}

export const log_utils = {
  logger,
  logEvents,
  bindReadline,
  get_logger_by_platform,
  get_logger_by_platform_type,
  get_logger_by_platform_plugin,
  get_logger_by_platform_plugin_type,
  get_platforms_plugins_types
}