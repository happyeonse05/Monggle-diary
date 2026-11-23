(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MonggleDiaryStore = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  var clone = function (v) { return JSON.parse(JSON.stringify(v)); };
  function diaryKey(k) { return /^(dy:\d{4}-\d{2}-\d{2}|dm:\d{4}-\d{2}|pen:prefs)$/.test(k); }
  function createStore(indexedDB) {
    var opening, readFailed = false;
    function open() {
      if (!opening) opening = new Promise(function (ok, no) {
        if (!indexedDB) { no(Error('Persistent storage unavailable')); return; }
        var r = indexedDB.open('monggle-guest-diary-v1', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onerror = function () { no(r.error); };
        r.onblocked = function () { no(Error('Storage upgrade blocked')); };
        r.onsuccess = function () { r.result.onversionchange = function () { r.result.close(); }; ok(r.result); };
      });
      return opening;
    }
    function transaction(mode, work) {
      return open().then(function (db) { return new Promise(function (ok, no) {
        var tx = db.transaction('kv', mode), value;
        tx.oncomplete = function () { ok(value); };
        tx.onabort = function () { no(tx.error || Error('Storage transaction aborted')); };
        // Request errors bubble and abort the transaction. Do not report success
        // from an individual request: later writes can still fail.
        tx.onerror = function () {};
        try { work(tx.objectStore('kv'), function (v) { value = v; }, tx); }
        catch (error) { tx.abort(); no(error); }
      }); });
    }
    function writable() { if (readFailed) throw Error('Reload after a failed read before saving'); }
    return {
      get: function (key) {
        if (!diaryKey(key)) return Promise.reject(Error('Unsupported diary key'));
        return transaction('readonly', function (s, done) {
          var r = s.get(key); r.onsuccess = function () { done(r.result === undefined ? null : r.result); };
        }).catch(function (error) { readFailed = true; throw error; });
      },
      set: function (key, value) {
        return Promise.resolve().then(function () {
          writable(); if (!diaryKey(key)) throw Error('Unsupported diary key');
          var snapshot = clone(value);
          return transaction('readwrite', function (s) { s.put(snapshot, key); });
        });
      },
      saveDay: function (job) {
        return Promise.resolve().then(function () {
          writable();
          var match = /^dy:(\d{4}-\d{2})-(\d{2})$/.exec(job.key);
          if (!match || job.monthKey !== 'dm:' + match[1]) throw Error('Mismatched diary keys');
          var snapshot = clone(job);
          return transaction('readwrite', function (s, done, tx) {
            var r = s.get(snapshot.monthKey);
            r.onsuccess = function () {
              var month = r.result === undefined ? {} : r.result;
              if (!month || typeof month !== 'object' || Array.isArray(month)) { tx.abort(); return; }
              if (snapshot.summary) month[match[2]] = snapshot.summary;
              else delete month[match[2]];
              s.put(snapshot.day, snapshot.key); s.put(month, snapshot.monthKey); done(true);
            };
          });
        });
      },
      close: function () { return opening ? opening.then(function (db) { db.close(); }) : Promise.resolve(); }
    };
  }
  function createSaver(write, onState, delay) {
    var jobs = new Map(), timer, tail = Promise.resolve();
    function state(value) { if (onState) onState(value); }
    function flush() {
      clearTimeout(timer);
      var batch = Array.from(jobs.entries());
      var next = tail.then(async function () {
        if (!batch.length) return true;
        state('saving'); var failed = false;
        for (var pair of batch) {
          if (jobs.get(pair[0]) !== pair[1]) continue; // A newer snapshot wins.
          try {
            await write(pair[1]);
            if (jobs.get(pair[0]) === pair[1]) jobs.delete(pair[0]);
          } catch (_) { failed = true; }
        }
        state(failed ? 'error' : jobs.size ? 'pending' : 'saved');
        return !failed;
      });
      tail = next.catch(function () {}); return next;
    }
    return {
      schedule: function (job) {
        jobs.set(job.key, clone(job)); state('pending'); clearTimeout(timer);
        timer = setTimeout(flush, delay === undefined ? 500 : delay);
      },
      flush: flush
    };
  }
  return { createStore: createStore, createSaver: createSaver, diaryKey: diaryKey };
});
