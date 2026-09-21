export type StoredMapTile = {
  id: string
  key: string
  x: number
  z: number
  span: number
  width: number
  height: number
  pixels: ArrayBuffer
  biomeIds: ArrayBuffer
  updatedAt: number
}

const databaseName = 'world-map-cache'
const storeName = 'tiles'
let database: Promise<IDBDatabase> | undefined

function openDatabase() {
  database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, {keyPath: 'id'})
      store.createIndex('updatedAt', 'updatedAt')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return database
}

export async function getCachedMapTile(id: string): Promise<StoredMapTile | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(id)
    request.onsuccess = () => resolve(request.result as StoredMapTile | undefined)
    request.onerror = () => reject(request.error)
  })
}

export async function putCachedMapTile(tile: StoredMapTile): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(tile)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
