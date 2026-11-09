  // ---- whiteboard-lib-i-pictures.js: pictures from the person's computer ----------------------------------------------
  //
  // A picture pasted, dropped or chosen with "Add a picture" becomes an image block (lib-e-block-image) in four steps, one
  // picture at a time: its facts are read from the start of the file (host.uploads.inspect), it is made smaller in the page
  // (about 2000 px on its long edge, and a thumbnail of about 400 px), it is sent (host.uploads.put, host.uploads.thumb), and
  // only then does the page put the block on the board, saved once (the pictures added together are one step of the undo
  // history: the page tags them so, lib-g). Until then the page
  // shows a placeholder where it will be; if anything fails, the placeholder goes and nothing is saved. A refusal for now
  // (429: too many pictures in a minute) waits the time the server names and carries on, as the sync manager does.
  //
  // What happens to an upload when its block goes (the rule, and why): nothing. Deleting a block never removes its upload:
  // an undo brings the block back with the same upload, copies share one upload, another person may still have it on their
  // screen or in their own undo history, and the server lets only the person who added a file (or an owner) remove it. The
  // only upload removed here is one this page added itself that never got a block at all (sent, but the block could not be
  // put on the board): nobody has seen it, so nothing can need it. Every other upload whose blocks are all gone stays, kept
  // with the space until the space is deleted (host.uploads.list can list them, for a tidy-up later).
  //
  // Nothing here draws or saves a block: the page does (onPlaced). The browser work (decoding and drawing on a canvas) is
  // in prepare, which a test replaces.
  const WB_PICTURE = {
    long: 2000, // px on the long edge of what is sent
    thumb: 400, // px on the long edge of the thumbnail
    board: 400, // board units on the long edge of a new picture block
    min: 24, // board units on the short edge, at least
    maxBytes: 5 * 1024 * 1024, // the manifest's uploads.maxBytes
    maxThumb: 400 * 1024, // the server's limit for a thumbnail
    head: 256 * 1024, // bytes read for the facts
    tries: 8, // waits on a 429 before giving up
  };
  // The pictures the board takes, and what each is sent as: a GIF becomes a PNG of its first frame (the server keeps JPEG,
  // PNG and WebP only).
  const WB_PICTURE_TYPES = { 'image/jpeg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp', 'image/gif': 'image/png' };
  const WB_PICTURE_ENDINGS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  const WB_PICTURE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';

  // The kind of picture a file is (its type, or by its ending when the browser gives no type), or null for anything else.
  function wbPictureType(file) {
    if (!file) return null;
    const type = String(file.type || '').toLowerCase();
    if (WB_PICTURE_TYPES[type]) return type;
    if (type && type !== 'application/octet-stream') return null;
    const m = /\.([a-z0-9]+)$/i.exec(String(file.name || ''));
    return (m && WB_PICTURE_ENDINGS[m[1].toLowerCase()]) || null;
  }
  // Files split into the pictures and how many others there were.
  function wbSplitPictures(files) {
    const pictures = [];
    let others = 0;
    for (const f of files || []) if (wbPictureType(f)) pictures.push(f); else others += 1;
    return { pictures, others };
  }
  // w by h made smaller, never larger, so its long edge is at most `long`: whole pixels, at least 1.
  function wbFit(w, h, long) {
    const f = Math.min(1, long / Math.max(w, h, 1));
    return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)) };
  }
  // A new picture block's size on the board for a picture of w by h pixels: the long edge at most WB_PICTURE.board units,
  // the short edge at least WB_PICTURE.min (a very thin picture), never past the board's largest block.
  function wbPictureSize(w, h) {
    const f = Math.min(1, WB_PICTURE.board / Math.max(w, h, 1));
    let bw = w * f;
    let bh = h * f;
    const short = Math.min(bw, bh);
    if (short < WB_PICTURE.min) { const g = WB_PICTURE.min / Math.max(short, 0.01); bw *= g; bh *= g; }
    const cap = (n) => Math.round(Math.min(WB_LIMITS.size, Math.max(WB_PICTURE.min, n)) * 10) / 10;
    return { w: cap(bw), h: cap(bh) };
  }
  // Where the i-th of several pictures added at once goes: each a small step down and to the right of the one before.
  const wbFanOut = (at, i) => ({ x: at.x + i * 32, y: at.y + i * 32 });
  // A box of w by h centred on a point.
  const wbCentred = (at, w, h) => ({ x: Math.round((at.x - w / 2) * 10) / 10, y: Math.round((at.y - h / 2) * 10) / 10, w, h });

  // fn(), again after the wait a 429 names (at most `tries` times); onBusy(err) hears each wait. wait(ms) is a test's.
  async function wbRetry(fn, { onBusy = () => {}, tries = WB_PICTURE.tries, wait = (ms) => new Promise((r) => { setTimeout(r, ms); }) } = {}) {
    for (let n = 0; ; n += 1) {
      try {
        return await fn();
      } catch (err) {
        if (!err || err.status !== 429 || n >= tries) throw err;
        onBusy(err);
        await wait(Math.max(1, Number(err.retryAfter) || 5) * 1000);
      }
    }
  }

  // The picture made ready in the page: { main, thumb (or null), width, height } (width and height of `main`, the right way
  // up). main keeps the picture's type (a GIF: a PNG of its first frame); one over the limit is sent as WebP, then smaller.
  async function wbPreparePicture(file, type) {
    let bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error('That picture could not be read.'); }
    const draw = (long, as, quality) => {
      const { w, h } = wbFit(bitmap.width, bitmap.height, long);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      return new Promise((resolve) => { canvas.toBlob((b) => resolve(b ? { blob: b, w, h } : null), as, quality); });
    };
    try {
      const as = WB_PICTURE_TYPES[type] || 'image/png';
      let long = WB_PICTURE.long;
      let main = await draw(long, as, 0.9);
      // Too big: WebP, then smaller, until it fits (a browser that cannot make WebP gives a PNG back, still a picture).
      while (main && main.blob.size > WB_PICTURE.maxBytes && long > 600) {
        main = await draw(long, 'image/webp', 0.85);
        if (main && main.blob.size <= WB_PICTURE.maxBytes) break;
        long = Math.round(long * 0.75);
      }
      if (!main || main.blob.size > WB_PICTURE.maxBytes || !WB_PICTURE_TYPES[main.blob.type] || main.blob.type === 'image/gif') throw new Error('That picture could not be made small enough.');
      let thumb = null;
      if (Math.max(main.w, main.h) > WB_PICTURE.thumb) {
        const t = await draw(WB_PICTURE.thumb, 'image/webp', 0.8);
        thumb = t && t.blob.size <= WB_PICTURE.maxThumb && WB_PICTURE_TYPES[t.blob.type] && t.blob.type !== 'image/gif' ? t.blob : null;
      } else if (main.blob.size <= WB_PICTURE.maxThumb) thumb = main.blob; // small already: the thumbnail is the picture
      return { main: main.blob, thumb, width: main.w, height: main.h };
    } finally {
      if (bitmap.close) bitmap.close();
    }
  }

  // The queue of pictures being added. host: the SDK (uploads); onStart(job), onStep(job) (its step or its box
  // changed), onPlaced(job, file) -> false when no block could be put on the board for it (its upload is then removed,
  // see forget), onFailed(job, err), onBusy(err): the page's (job: { id, at, box, name, step }; box: where its placeholder
  // is, in board units; file: the upload's facts). inUse(uploadId): whether a block on the board uses it (the page's).
  // newId() gives the block's id. prepare is wbPreparePicture unless a test gives its own.
  function createPictures({ host, newId, onStart = () => {}, onStep = () => {}, onPlaced = () => {}, onFailed = () => {}, onBusy = () => {}, inUse = () => false, prepare = wbPreparePicture, wait }) {
    const SCOPE = { scope: 'space' };
    const mine = new Set(); // ids of the uploads this page added
    const jobs = [];
    let running = false;
    const retry = (fn) => wbRetry(fn, { onBusy, wait });

    async function run(job) {
      const type = wbPictureType(job.file);
      job.step = 'reading';
      onStep(job);
      // The picture's own facts, read before the resize loses them: its true type (whatever its name says). Its place and
      // time are not kept on the board. A GIF is not asked about (the server reads only JPEG, PNG and WebP).
      let facts = {};
      if (type !== 'image/gif') {
        try { facts = (await retry(() => host.uploads.inspect(job.file.slice(0, WB_PICTURE.head, type), SCOPE))) || {}; } catch (err) { if (err && err.status === 429) throw err; facts = {}; }
      }
      const ready = await prepare(job.file, WB_PICTURE_TYPES[facts.type] ? facts.type : type);
      const size = wbPictureSize(ready.width, ready.height);
      job.box = wbCentred(job.at, size.w, size.h);
      job.step = 'sending';
      onStep(job);
      const file = await retry(() => host.uploads.put(ready.main, { name: job.name, ...SCOPE }));
      mine.add(file.id);
      // The thumbnail is a help, not the picture: without it the block shows the whole picture.
      if (ready.thumb) { try { await retry(() => host.uploads.thumb(file.id, ready.thumb, SCOPE)); } catch { /* the whole picture is shown */ } }
      return file;
    }

    async function pump() {
      if (running) return;
      running = true;
      while (jobs.length) {
        const job = jobs[0];
        try {
          const file = await run(job);
          jobs.shift();
          if (onPlaced(job, file) === false) await forget(file.id, inUse);
        } catch (err) {
          jobs.shift();
          onFailed(job, err);
        }
      }
      running = false;
    }

    // An upload this page added whose block never reached the board: removed, unless some block uses it after all
    // (inUse(id)). Any other upload is never removed here (see the top of this file).
    async function forget(id, used = inUse) {
      if (!mine.has(id) || used(id)) return false;
      mine.delete(id);
      try { await host.uploads.remove(id, SCOPE); return true; } catch { return false; }
    }

    return {
      // Add these picture files around `at` (a point on the board); each gets a placeholder at once. extra: fields of the
      // page's own for each job (the same object for all of them).
      add(files, at, extra = {}) {
        files.forEach((file, i) => {
          const point = wbFanOut(at, i);
          const job = { ...extra, id: newId(), file, at: point, box: wbCentred(point, 240, 180), name: String(file.name || 'picture').slice(0, 100), step: 'waiting' };
          jobs.push(job);
          onStart(job);
        });
        pump();
      },
      get count() { return jobs.length; },
      mine: (id) => mine.has(id),
      forget,
    };
  }
