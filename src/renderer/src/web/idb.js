// A promise wrapper around the bits of IndexedDB the web backend needs.

const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

export function openDatabase(name, version, upgrade) {
  const req = indexedDB.open(name, version)
  req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion)
  return request(req)
}

// Run `fn(store)` in a transaction over one object store and resolve with its
// return value once the transaction has committed.
export function withStore(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    let result
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
    Promise.resolve(fn(tx.objectStore(storeName))).then(
      (r) => {
        result = r
      },
      (err) => {
        reject(err)
        try {
          tx.abort()
        } catch {
          // already finished
        }
      }
    )
  })
}

export const get = (db, store, key) => withStore(db, store, 'readonly', (s) => request(s.get(key)))
export const getAll = (db, store) => withStore(db, store, 'readonly', (s) => request(s.getAll()))
export const put = (db, store, value) => withStore(db, store, 'readwrite', (s) => request(s.put(value)))
export const del = (db, store, key) => withStore(db, store, 'readwrite', (s) => request(s.delete(key)))

// Fetch many keys in one transaction; missing keys yield undefined.
export const getMany = (db, store, keys) =>
  withStore(db, store, 'readonly', (s) => Promise.all(keys.map((k) => request(s.get(k)))))

export const putMany = (db, store, values) =>
  withStore(db, store, 'readwrite', (s) => Promise.all(values.map((v) => request(s.put(v)))))
