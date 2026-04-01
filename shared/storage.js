/**
 * storage.js
 * IndexedDB wrapper for ConfluenceX edit history.
 * Runs in the background service worker context.
 */
(function () {
  'use strict';

  let _db = null;

  function openDB() {
    if (_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(CFX.DB_CONFIG.NAME, CFX.DB_CONFIG.VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(CFX.DB_CONFIG.STORES.EDIT_HISTORY)) {
          const store = db.createObjectStore(CFX.DB_CONFIG.STORES.EDIT_HISTORY, {
            keyPath: 'id',
          });
          store.createIndex('pageId', 'pageId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        _db = event.target.result;
        resolve(_db);
      };

      request.onerror = (event) => {
        reject(new Error(`Failed to open IndexedDB: ${event.target.error}`));
      };
    });
  }

  /**
   * Save an edit snapshot for a page.
   * Snapshot schema:
   * {
   *   id: string (UUID),
   *   pageId: string,
   *   timestamp: number (Date.now()),
   *   contentBefore: string (XHTML),
   *   contentAfter: string (XHTML),
   *   userPrompt: string,
   *   aiResponse: string,
   *   applied: boolean,
   *   versionBefore: number,
   *   versionAfter: number|null,
   * }
   */
  async function saveEditSnapshot(snapshot) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(CFX.DB_CONFIG.STORES.EDIT_HISTORY, 'readwrite');
      const store = tx.objectStore(CFX.DB_CONFIG.STORES.EDIT_HISTORY);

      // Ensure required fields
      const record = {
        id: snapshot.id || crypto.randomUUID(),
        pageId: String(snapshot.pageId),
        timestamp: snapshot.timestamp || Date.now(),
        contentBefore: snapshot.contentBefore || '',
        contentAfter: snapshot.contentAfter || '',
        userPrompt: snapshot.userPrompt || '',
        aiResponse: snapshot.aiResponse || '',
        applied: snapshot.applied || false,
        versionBefore: snapshot.versionBefore || null,
        versionAfter: snapshot.versionAfter || null,
      };

      const request = store.put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = (e) => reject(new Error(`Failed to save snapshot: ${e.target.error}`));
    });
  }

  /**
   * Update an existing snapshot (e.g., mark as applied).
   */
  async function updateEditSnapshot(snapshotId, updates) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(CFX.DB_CONFIG.STORES.EDIT_HISTORY, 'readwrite');
      const store = tx.objectStore(CFX.DB_CONFIG.STORES.EDIT_HISTORY);

      const getRequest = store.get(snapshotId);
      getRequest.onsuccess = (event) => {
        const existing = event.target.result;
        if (!existing) {
          reject(new Error(`Snapshot ${snapshotId} not found`));
          return;
        }
        const updated = { ...existing, ...updates };
        const putRequest = store.put(updated);
        putRequest.onsuccess = () => resolve(updated);
        putRequest.onerror = (e) => reject(new Error(`Failed to update snapshot: ${e.target.error}`));
      };
      getRequest.onerror = (e) => reject(new Error(`Failed to get snapshot: ${e.target.error}`));
    });
  }

  /**
   * Get all edit history for a page, sorted by timestamp descending.
   */
  async function getEditHistory(pageId) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(CFX.DB_CONFIG.STORES.EDIT_HISTORY, 'readonly');
      const store = tx.objectStore(CFX.DB_CONFIG.STORES.EDIT_HISTORY);
      const index = store.index('pageId');

      const results = [];
      const request = index.openCursor(IDBKeyRange.only(String(pageId)));

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          // Sort by timestamp descending
          results.sort((a, b) => b.timestamp - a.timestamp);
          resolve(results);
        }
      };

      request.onerror = (e) => reject(new Error(`Failed to get edit history: ${e.target.error}`));
    });
  }

  /**
   * Delete a specific snapshot.
   */
  async function deleteEditSnapshot(pageId, snapshotId) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(CFX.DB_CONFIG.STORES.EDIT_HISTORY, 'readwrite');
      const store = tx.objectStore(CFX.DB_CONFIG.STORES.EDIT_HISTORY);
      const request = store.delete(snapshotId);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(new Error(`Failed to delete snapshot: ${e.target.error}`));
    });
  }

  /**
   * Clear all history for a page.
   */
  async function clearEditHistory(pageId) {
    const db = await openDB();
    const history = await getEditHistory(pageId);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(CFX.DB_CONFIG.STORES.EDIT_HISTORY, 'readwrite');
      const store = tx.objectStore(CFX.DB_CONFIG.STORES.EDIT_HISTORY);

      let count = history.length;
      if (count === 0) { resolve(); return; }

      history.forEach((item) => {
        const request = store.delete(item.id);
        request.onsuccess = () => {
          count--;
          if (count === 0) resolve();
        };
        request.onerror = (e) => reject(new Error(`Failed to clear history: ${e.target.error}`));
      });
    });
  }

  const cfxStorage = {
    openDB,
    saveEditSnapshot,
    updateEditSnapshot,
    getEditHistory,
    deleteEditSnapshot,
    clearEditHistory,
  };

  if (typeof window !== 'undefined') {
    window.cfxStorage = cfxStorage;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.cfxStorage = cfxStorage;
  }
})();
