/**
 * Exam papers live on the device, not in the cloud.
 *
 * Only the paper's details — title, subject, timings — go to Firestore, so the
 * library list follows the student between devices. The file itself stays in
 * this browser's IndexedDB. That keeps exam material off any server, needs no
 * paid Storage bucket, and means a paper is only ever readable on the machine
 * it was added to.
 *
 * Records are keyed by uid and paper id together, so two accounts sharing a
 * browser can never see each other's files.
 */

const DB_NAME = 'scriber-papers'
const DB_VERSION = 1
const STORE = 'files'

export type StoredFile = {
  key: string
  uid: string
  paperId: string
  name: string
  type: string
  size: number
  savedAt: string
  blob: Blob
}

const keyFor = (uid: string, paperId: string) => `${uid}:${paperId}`

/** IndexedDB is unavailable in private windows on some browsers. */
export const fileStoreAvailable = () =>
  typeof indexedDB !== 'undefined' && indexedDB !== null

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('uid', 'uid', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local storage.'))
  })
  return dbPromise
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const tx = database.transaction(STORE, mode)
        const request = work(tx.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Local storage failed.'))
      }),
  )
}

export async function saveFile(uid: string, paperId: string, file: File): Promise<void> {
  const record: StoredFile = {
    key: keyFor(uid, paperId),
    uid,
    paperId,
    name: file.name,
    type: file.type,
    size: file.size,
    savedAt: new Date().toISOString(),
    // Copying to a Blob detaches the record from the original File handle.
    blob: new Blob([await file.arrayBuffer()], { type: file.type }),
  }
  await run('readwrite', (store) => store.put(record))
}

export async function getFile(uid: string, paperId: string): Promise<StoredFile | null> {
  try {
    const record = await run<StoredFile | undefined>('readonly', (store) =>
      store.get(keyFor(uid, paperId)),
    )
    return record ?? null
  } catch {
    return null
  }
}

export async function hasFile(uid: string, paperId: string): Promise<boolean> {
  return (await getFile(uid, paperId)) !== null
}

export async function deleteFile(uid: string, paperId: string): Promise<void> {
  await run('readwrite', (store) => store.delete(keyFor(uid, paperId))).catch(() => undefined)
}

/** Which of these papers are actually held on this device. */
export async function storedPaperIds(uid: string, paperIds: string[]): Promise<Set<string>> {
  const held = new Set<string>()
  await Promise.all(
    paperIds.map(async (id) => {
      if (await hasFile(uid, id)) held.add(id)
    }),
  )
  return held
}

/** Total bytes this account is using on this device. */
export async function usedBytes(uid: string): Promise<number> {
  try {
    const records = await run<StoredFile[]>('readonly', (store) => store.getAll())
    return records.filter((r) => r.uid === uid).reduce((sum, r) => sum + (r.size ?? 0), 0)
  } catch {
    return 0
  }
}

/** Remove every file this account holds on this device. */
export async function clearFiles(uid: string): Promise<void> {
  const records = await run<StoredFile[]>('readonly', (store) => store.getAll()).catch(
    () => [] as StoredFile[],
  )
  await Promise.all(
    records.filter((r) => r.uid === uid).map((r) => run('readwrite', (s) => s.delete(r.key))),
  )
}

/**
 * Roughly how much room the browser will give us. Used to warn before a large
 * paper fails to save.
 */
export async function quota(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  const estimate = await navigator.storage.estimate().catch(() => null)
  if (!estimate) return null
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
}
