/* ============ turn store: turns packed into size-capped page documents ============ */
import { noteIgnored, pad, utf8Bytes } from './util.js';
import { dset, inflate, packTurn, platform, thaw, userCol, userDoc } from './db.js';
import { app } from './app.js';
import { T } from './i18n.js';

export const DB_DOC_CAP = 5000; // documents per artifact database
const jbytes = o => utf8Bytes(JSON.stringify(o));
export const savePageDoc = (id, p) => userDoc(`saves/items/${id}/pages/${pad(p)}`);
const savePagesCol = id => userCol(`saves/items/${id}/pages`);
class StoreConflict extends Error {
  constructor() {
    super(T('This save moved on from another device'));
    this.code = 'conflict';
  }
}
export const turnStore = {
  pageMax: 200000, // bytes per page document (the platform limit is 256 KiB); tests lower it to get many pages
  tail: null, // {id,p,v,rows,bytes} for the save that is open
  pageDoc(p, v, rows) {
    return {
      p,
      v,
      first: rows.length ? rows[0].i : null,
      last: rows.length ? rows[rows.length - 1].i : null,
      n: rows.length,
      rows,
    };
  },
  async hasPages(id) {
    try {
      const q = await savePagesCol(id).limit(1).get();
      return !q.empty && q.size > 0;
    } catch (e) {
      return false;
    }
  },
  async legacyRows(id) {
    const all = [];
    let last = -1;
    for (let g = 0; g < 100; g++) {
      const q = await userCol(`saves/items/${id}/turns`).where('i', '>', last).orderBy('i', 'asc').limit(200).get();
      const rows = q.docs.map(d => thaw(d.data()));
      if (!rows.length) break;
      all.push(...rows);
      last = rows[rows.length - 1].i;
      if (rows.length < 200) break;
    }
    return all;
  },
  paginate(rows, startP = 0) {
    const pages = [];
    let cur = [],
      b = 0;
    for (const r of rows) {
      const rb = jbytes(r);
      if (cur.length && b + rb > this.pageMax) {
        pages.push(cur);
        cur = [];
        b = 0;
      }
      cur.push(r);
      b += rb;
    }
    if (cur.length) pages.push(cur);
    return pages.map((rs, k) => this.pageDoc(startP + k, 1, rs));
  },
  async rawAll(id) {
    const rows = [];
    let after = -1;
    for (let g = 0; g < 400; g++) {
      const r = await savePagesCol(id).where('p', '>', after).orderBy('p', 'asc').limit(10).get();
      if (!r.docs.length) break;
      for (const d of r.docs) {
        const pg = thaw(d.data());
        rows.push(...(pg.rows || []));
        after = pg.p;
      }
      if (r.docs.length < 10) break;
    }
    return rows;
  },
  async legacyAny(id) {
    try {
      const q = await userCol(`saves/items/${id}/turns`).limit(1).get();
      return q.docs.length > 0;
    } catch (e) {
      return false;
    }
  },
  async countPages(id) {
    try {
      const q = await savePagesCol(id).orderBy('p', 'desc').limit(1).get();
      return q.docs.length ? q.docs[0].data().p + 1 : 0;
    } catch (e) {
      return 0;
    }
  },
  async ensure(id, onStat) {
    // legacy one-doc-per-turn -> pages. Pages are written and verified before any legacy doc is deleted.
    if (!(await this.legacyAny(id))) return;
    const legacy = await this.legacyRows(id);
    if (!legacy.length) return;
    const pageRows = (await this.hasPages(id)) ? await this.rawAll(id) : [];
    const have = new Set(pageRows.map(r => r.i));
    const missing = legacy.filter(r => !have.has(r.i));
    if (missing.length) {
      onStat && onStat(T('Updating the save format'));
      const merged = [...pageRows, ...missing].sort((x, y) => x.i - y.i);
      const before = await this.countPages(id);
      const pages = this.paginate(merged);
      for (const pg of pages) await savePageDoc(id, pg.p).set(pg);
      for (let p = pages.length; p < before; p++)
        await savePageDoc(id, p)
          .delete()
          .catch(e => noteIgnored('turn-store: savePageDoc.delete', e));
      const check = new Set((await this.rawAll(id)).map(r => r.i));
      if (legacy.some(r => !check.has(r.i))) throw new Error('migration verify failed');
    }
    for (const r of legacy)
      await platform.db
        .doc(`${platform.userPath}/saves/items/${id}/turns/${pad(r.i)}`)
        .delete()
        .catch(e => noteIgnored('turn-store: DB.doc.delete', e));
    const meta = app.saves.find(x => x.id === id);
    if (meta) {
      meta.store = 2;
      meta.pages = await this.countPages(id);
      await dset(`saves/items/${id}`, meta).catch(e => noteIgnored('turn-store: dset saves/items', e));
    }
  },
  async loadAll2Latest(id, want = 80) {
    if (await this.legacyAny(id)) {
      const all = await this.loadAll(id);
      this.tail = null;
      if (await this.hasPages(id)) await this.loadLatest(id, 1);
      return all.slice(-want);
    }
    return await this.loadLatest(id, want);
  },
  async loadLatest(id, want = 80) {
    this.tail = null;
    const rows = [];
    let before = Infinity;
    for (let g = 0; g < 40 && rows.length < want; g++) {
      let q = savePagesCol(id);
      if (before !== Infinity) q = q.where('p', '<', before);
      const r = await q.orderBy('p', 'desc').limit(3).get();
      if (!r.docs.length) break;
      for (const d of r.docs) {
        const pg = thaw(d.data());
        if (!this.tail) this.tail = { id, p: pg.p, v: pg.v || 1, rows: pg.rows || [], bytes: jbytes(pg) };
        rows.unshift(...(pg.rows || []));
        before = pg.p;
      }
    }
    return await inflate(rows);
  },
  async loadBefore(id, beforeI, want = 80) {
    const rows = [];
    let lim = beforeI;
    for (let g = 0; g < 40 && rows.length < want; g++) {
      const r = await savePagesCol(id).where('first', '<', lim).orderBy('first', 'desc').limit(3).get();
      if (!r.docs.length) break;
      for (const d of r.docs) {
        const pg = thaw(d.data());
        rows.unshift(...(pg.rows || []).filter(x => x.i < beforeI));
        lim = pg.first;
      }
    }
    return await inflate(rows);
  },
  async loadRange(id, fromExcl, toIncl) {
    const rows = [];
    const r = await savePagesCol(id).where('last', '>', fromExcl).orderBy('last', 'asc').limit(60).get();
    for (const d of r.docs) {
      const pg = thaw(d.data());
      for (const x of pg.rows || []) if (x.i > fromExcl && x.i <= toIncl) rows.push(x);
    }
    return await inflate(rows.sort((a, b) => a.i - b.i));
  },
  async loadAll(id, onStat) {
    if (platform.memMode && app.currentSave && app.currentSave.id === id && !(await this.hasPages(id)))
      return app.turns.slice();
    if (!(await this.hasPages(id))) {
      const rows = await this.legacyRows(id);
      return await inflate(rows);
    }
    if (await this.legacyAny(id)) {
      const pr = await this.rawAll(id),
        have = new Set(pr.map(r => r.i));
      const lg = (await this.legacyRows(id)).filter(r => !have.has(r.i));
      return await inflate([...pr, ...lg].sort((a, b) => a.i - b.i));
    }
    const rows = [];
    let after = -1;
    for (let g = 0; g < 400; g++) {
      const r = await savePagesCol(id).where('p', '>', after).orderBy('p', 'asc').limit(10).get();
      if (!r.docs.length) break;
      for (const d of r.docs) {
        const pg = thaw(d.data());
        rows.push(...(pg.rows || []));
        after = pg.p;
      }
      onStat && onStat(T('Reading {n} {n|turn|turns}', { n: rows.length }));
      if (r.docs.length < 10) break;
    }
    return await inflate(rows);
  },
  writeTail() {
    const t = this.tail;
    const run = () => this._writeTail(t);
    const p = (this._q || Promise.resolve()).then(run, run);
    this._q = p.catch(() => {}); // the queue only orders the writes: whoever awaits p gets its error
    return p;
  }, // queued: two writes in flight would trip each other's version check (or the later one would land an older copy)
  async _writeTail(t) {
    // optimistic check: the page must still be the version we last wrote
    if (GONE_SAVES.has(t.id)) throw new StoreConflict(); // never write a deleted save back
    const ref = savePageDoc(t.id, t.p);
    const snap = await ref.get();
    if (snap.exists) {
      const v = snap.data().v || 1;
      if (v !== t.v) throw new StoreConflict();
    } else if (t.v > 0)
      throw new StoreConflict(); // we knew this page and it is gone: deleted, never recreate it
    else if (!NEW_SAVES.has(t.id)) {
      let ex = true;
      try {
        ex = (await userDoc(`saves/items/${t.id}`).get()).exists;
      } catch (e) {
        noteIgnored('turn-store: does the save still exist', e);
      }
      if (!ex) throw new StoreConflict();
    } // a first page for a save that no longer exists
    const nv = (snap.exists ? t.v : 0) + 1;
    const doc = this.pageDoc(t.p, nv, t.rows);
    await ref.set(doc);
    t.v = nv;
    t.written = true;
    t.bytes = jbytes(doc);
  },
  async append(t) {
    const row = await packTurn(t);
    const rb = jbytes(row);
    if (!this.tail || this.tail.id !== app.currentSave.id)
      this.tail = { id: app.currentSave.id, p: 0, v: 0, rows: [], bytes: 0 };
    if (this.tail.rows.length && this.tail.bytes + rb > this.pageMax) {
      this.tail = { id: app.currentSave.id, p: this.tail.p + 1, v: 0, rows: [], bytes: 0 };
      app.currentSave.pages = this.tail.p + 1;
    }
    this.tail.rows.push(row);
    try {
      await this.writeTail();
    } catch (e) {
      this.tail.rows.pop();
      throw e;
    }
    if (!app.currentSave.pages || app.currentSave.pages < this.tail.p + 1) app.currentSave.pages = this.tail.p + 1;
  },
  async popTail(i) {
    const t = this.tail;
    if (!t) return;
    const k = t.rows.findIndex(r => r.i === i);
    if (k < 0) return;
    const removed = t.rows.splice(k, 1);
    if (t.rows.length) {
      try {
        await this.writeTail();
      } catch (e) {
        t.rows.splice(k, 0, ...removed);
        throw e;
      }
      return;
    }
    // the page emptied: drop it and make the previous page the tail again
    try {
      await savePageDoc(t.id, t.p).delete();
    } catch (e) {
      noteIgnored('turn-store: drop an emptied page', e);
    }
    if (t.p === 0) {
      this.tail = { id: t.id, p: 0, v: 0, rows: [], bytes: 0 };
      app.currentSave.pages = 0;
      return;
    }
    const prev = await savePageDoc(t.id, t.p - 1).get();
    if (prev.exists) {
      const pg = thaw(prev.data());
      this.tail = { id: t.id, p: pg.p, v: pg.v || 1, rows: pg.rows || [], bytes: jbytes(pg), written: true };
    } else this.tail = { id: t.id, p: t.p - 1, v: 0, rows: [], bytes: 0 };
    app.currentSave.pages = this.tail.p + 1;
  },
  async update(t) {
    // rewrite one turn in place (e.g. a hall id added to a ledger)
    const row = await packTurn(t);
    if (this.tail && this.tail.id === app.currentSave.id) {
      const k = this.tail.rows.findIndex(r => r.i === t.i);
      if (k >= 0) {
        this.tail.rows[k] = row;
        await this.writeTail();
        return;
      }
    }
    const r = await savePagesCol(app.currentSave.id).where('first', '<=', t.i).orderBy('first', 'desc').limit(1).get();
    if (!r.docs.length) return;
    const pg = thaw(r.docs[0].data());
    const k = (pg.rows || []).findIndex(x => x.i === t.i);
    if (k < 0) return;
    pg.rows[k] = row;
    pg.v = (pg.v || 1) + 1;
    await savePageDoc(app.currentSave.id, pg.p).set(pg);
  },
  async copyUpTo(src, dst, i) {
    // for forks: whole pages up to the one holding i, that one cut after i
    let n = 0,
      after = -1;
    for (let g = 0; g < 400; g++) {
      const r = await savePagesCol(src).where('p', '>', after).orderBy('p', 'asc').limit(10).get();
      if (!r.docs.length) break;
      let stop = false;
      for (const d of r.docs) {
        const pg = thaw(d.data());
        after = pg.p;
        if (pg.first == null || pg.first > i) {
          stop = true;
          break;
        }
        const rows = (pg.rows || []).filter(x => x.i <= i);
        await savePageDoc(dst, pg.p).set(this.pageDoc(pg.p, 1, rows));
        n++;
        if (pg.last >= i) {
          stop = true;
          break;
        }
      }
      if (stop || r.docs.length < 10) break;
    }
    return n;
  },
  async deleteAll(id) {
    try {
      for (let g = 0; g < 100; g++) {
        const q = await savePagesCol(id).limit(50).get();
        if (!q.docs.length) break;
        for (const d of q.docs) await platform.db.doc(`${platform.userPath}/saves/items/${id}/pages/${d.id}`).delete();
      }
    } catch (e) {
      noteIgnored('delete save: pages', e);
    }
    try {
      for (let g = 0; g < 50; g++) {
        const q = await userCol(`saves/items/${id}/turns`).limit(100).get();
        if (!q.docs.length) break;
        for (const d of q.docs) await platform.db.doc(`${platform.userPath}/saves/items/${id}/turns/${d.id}`).delete();
      }
    } catch (e) {
      noteIgnored('delete save: old turn documents', e);
    }
  },
};
export const NEW_SAVES = new Set(); // saves created in this session and not yet written: nothing elsewhere can have changed them
export const GONE_SAVES = new Set(); // saves deleted here or elsewhere: never written again
