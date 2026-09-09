import {get, post} from './request'

interface ItemResult {
  item: string
  item_key: string | null
  translate: {
    zh_cn: string | null
    en_us: string | null
  }
  texture: string | null
}

interface BatchResponse {
  success: boolean
  items: ItemResult[]
  total: number
}

const DB_NAME = 'itemIconCache'
const DB_VERSION = 2
const STORE_TEXTURES = 'textures'
const STORE_NAMES = 'names'
const MEMORY_TEXTURES = new Map<string, string>()
const MEMORY_NAMES = new Map<string, string>()
const PENDING_FETCHES = new Map<string, Promise<string | null>>()
let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_TEXTURES)) {
        db.createObjectStore(STORE_TEXTURES)
      }
      if (!db.objectStoreNames.contains(STORE_NAMES)) {
        db.createObjectStore(STORE_NAMES)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

async function getFromDB(store: string, key: string): Promise<string | null> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly')
      const request = tx.objectStore(store).get(key)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  } catch { return null }
}

async function setToDB(store: string, key: string, value: string): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch { /* silent */ }
}

const FALLBACK_SVG = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="4" fill="#2a2a2a"/>
    <path d="M16 8a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" fill="#555"/>
    <path d="M16 12v8M12 16h8" stroke="#888" stroke-width="2" stroke-linecap="round"/>
  </svg>`
)}`

let batchTimer: ReturnType<typeof setTimeout> | null = null
let batchQueue: string[] = []
let batchResolve: Map<string, (result: ItemResult) => void> = new Map()

async function flushBatch() {
  const queue = batchQueue
  const resolvers = new Map(batchResolve)
  batchQueue = []
  batchResolve = new Map()
  batchTimer = null
  if (!queue.length) return

  try {
    const result = await post<BatchResponse>('/api/item/translate/batch', {items: queue})
    if (result.success && Array.isArray(result.items)) {
      for (const item of result.items) {
        const cacheKey = item.item_key || item.item.toLowerCase()
        MEMORY_TEXTURES.set(cacheKey, item.texture || FALLBACK_SVG)
        MEMORY_NAMES.set(cacheKey, item.translate.zh_cn || item.translate.en_us || item.item)
        if (item.texture) void setToDB(STORE_TEXTURES, cacheKey, item.texture)
        if (item.translate.zh_cn || item.translate.en_us) void setToDB(STORE_NAMES, cacheKey, item.translate.zh_cn || item.translate.en_us || item.item)
        resolvers.get(item.item.toLowerCase())?.(item)
      }
    }
  } catch {
    // Fallback: resolve with item ID as name
  }
  for (const [key, resolve] of resolvers) {
    if (!MEMORY_NAMES.has(key)) {
      MEMORY_NAMES.set(key, key)
      resolve({item: key, item_key: null, translate: {zh_cn: null, en_us: null}, texture: null})
    }
  }
}

function enqueueBatch(itemId: string): Promise<ItemResult> {
  return new Promise(resolve => {
    batchQueue.push(itemId)
    batchResolve.set(itemId.toLowerCase(), resolve)
    if (!batchTimer) batchTimer = setTimeout(flushBatch, 100)
  })
}

export function getItemIcon(itemId: string): Promise<string> {
  const key = itemId.trim().toLowerCase()
  const cached = MEMORY_TEXTURES.get(key)
  if (cached) return Promise.resolve(cached)

  return getFromDB(STORE_TEXTURES, key).then(dbVal => {
    if (dbVal) {
      MEMORY_TEXTURES.set(key, dbVal)
      return dbVal
    }
    const existing = PENDING_FETCHES.get(key)
    if (existing) return existing.then(url => url || FALLBACK_SVG)

    const promise = enqueueBatch(itemId).then(r => {
      const url = r.texture || FALLBACK_SVG
      MEMORY_TEXTURES.set(key, url)
      return url
    })
    PENDING_FETCHES.set(key, promise)
    promise.finally(() => PENDING_FETCHES.delete(key))
    return promise
  })
}

export function getItemName(itemId: string): Promise<string> {
  const key = itemId.trim().toLowerCase()
  const cached = MEMORY_NAMES.get(key)
  if (cached) return Promise.resolve(cached)

  return getFromDB(STORE_NAMES, key).then(dbVal => {
    if (dbVal) {
      MEMORY_NAMES.set(key, dbVal)
      return dbVal
    }
    return enqueueBatch(itemId).then(r => {
      const name = r.translate.zh_cn || r.translate.en_us || itemId
      MEMORY_NAMES.set(key, name)
      return name
    })
  })
}

export function clearIconCache() {
  MEMORY_TEXTURES.clear()
  MEMORY_NAMES.clear()
  dbPromise = null
}
