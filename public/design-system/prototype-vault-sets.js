// The Prototype's Vault section, the second half (Thomas, 2026-11-02): Add files and its refusals, the viewers, the narrow module, the
// permission views. The first half and the helpers (set, state, pair) are prototype-vault.js's.
import { TYPE_REFUSAL } from './prototype-vault-app.js';
import { MB, GB } from './prototype-vault-data.js';
import { ROLES } from './prototype-vault-app.js';
import { heldMenu } from './prototype-vault-ui.js';

const up = (name, mb, kind, status, extra = {}) => ({ name, size: Math.round(mb * MB), kind, status, pct: 0, msg: '', ...extra });

export function buildAddAndViewers({ set, state, pair }) {
  // ================= Add files =================
  {
    const s = set('add', 'Add files', 'The "+" in the title bar is Add files. It opens a panel at the top of the module (or a dialog: Q4): a drop zone and Choose files (several at once; on a phone the photo library and camera), the option for pictures, the notice for video, "Everyone in this trip can see what you add.", what is left, and a row for each file with its progress or its refusal. Dropping files on the module shows the drop outline over it.');
    const p = pair(s);
    state(p, { name: 'The panel', note: 'Open, nothing sent yet. The option and the notice are the plan\'s decision 10; its default is Q6.', cfg: { role: 'member', state: { panel: true } }, h: 720 });
    state(p, { name: 'Dropping files on the module', note: 'The outline covers the module while files are dragged over it, and says where they go.', cfg: { role: 'member', state: { dropping: true } } });
    const p2 = pair(s);
    state(p2, { name: 'The drop zone, files over it', cfg: { role: 'member', state: { panel: true, dropping: true } }, h: 720 });
    state(p2, { name: 'Adding: progress, one waiting, one done', note: 'Each file shows its own bar and the bytes. A second upload waits when two are running (429, "Another upload is still running.").', cfg: { role: 'member', state: { panel: true, queue: [up('Cooking class, full.mp4', 330, 'video', 'uploading', { pct: 23 }), up('Pasta lunch, second.jpg', 3.1, 'picture', 'uploading', { pct: 62 }), up('Menu.pdf', 0.4, 'pdf', 'done', { pct: 100 }), up('Hotel receipt.pdf', 0.2, 'pdf', 'queued', { msg: 'Waiting. Another upload is still running.' })] } }, h: 800 });
    const p3 = pair(s);
    state(p3, { name: 'Refused: the arrival rules', note: 'Each refusal is the plan\'s own sentence on its row (section 1 and 3). Two sentences are new and marked in the questions: a script in a PDF and a slow upload.', cfg: { role: 'member', state: { panel: true, queue: [
      up('Trip video.mkv', 800, 'video', 'refused', { msg: TYPE_REFUSAL }),
      up('IMG_5012.HEIC', 2.4, 'picture', 'refused', { msg: 'Save it as a JPEG.' }),
      up('Panorama, whole valley.jpg', 24, 'picture', 'refused', { msg: 'That picture is too large to show.' }),
      up('The whole day.mp4', 3200, 'video', 'refused', { msg: 'That file is over the 2 GB limit for video.' }),
      up('Booking form.pdf', 0.3, 'pdf', 'refused', { msg: "This PDF has a script or a link out that the Vault doesn't take." }),
      up('Long clip.mp4', 190, 'video', 'refused', { msg: 'That upload was too slow and was stopped. Try again.' }),
    ] } }, h: 800 });
    state(p3, { name: 'Damaged PDFs: refused or download only (Q7)', note: 'Two rows, the two answers: refused with a plain sentence (the plan today), or kept for download only like a PDF the scanner cannot judge.', cfg: { role: 'member', state: { panel: true, queue: [
      up('Scan of the booking.pdf', 0.9, 'pdf', 'refused', { msg: 'This PDF looks damaged. Save it again and try once more.' }),
      up('Insurance, encrypted.pdf', 3.4, 'pdf', 'done', { pct: 100, msg: "Added · 3.4 MB · Download only: this PDF can't be opened here." }),
    ] } }, h: 800 });
    const p4 = pair(s);
    state(p4, { name: 'Full: the space, the person, the server', note: 'Each over-limit sentence is the plan\'s, with the template\'s word for the Vault (Q9). The drop zone turns off when the space is full.', cfg: { role: 'member', state: { panel: true, usedBytes: 5 * GB, notice: { kind: 'danger', text: "This trip's Vault is full (5 GB). Remove some files to add more." }, queue: [
      up('Cooking class, full.mp4', 330, 'video', 'refused', { msg: "This trip's Vault is full (5 GB). Remove some files to add more." }),
      up('Dinner toast, again.mp4', 60, 'video', 'refused', { msg: 'You have used your 2 GB in the Vault. Remove some of your files to add more.' }),
      up('Rome walk, long.mp4', 90, 'video', 'refused', { msg: "The server's file storage is full. Ask the admin." }),
    ] } }, h: 800 });
    state(p4, { name: 'Add files as a dialog (Q4, the other way)', note: 'The same panel in the product\'s dialog. A dialog blocks the list behind it; the panel keeps it in view.', cfg: { role: 'member', held: true, state: { panel: true, queue: [up('Pasta lunch, second.jpg', 3.1, 'picture', 'uploading', { pct: 62 })] }, trial: { add: 'dialog' } }, h: 800 });
    state(s, { name: 'Remove where it was taken: on by default (Q6, the other way)', note: 'The same option checked. A picture lets go of its position and the camera\'s notes unless the person keeps them; video is not cleaned, and the notice says so either way.', cfg: { role: 'member', state: { panel: true }, trial: { removeWhere: 'on' } }, h: 720 });
  }

  // ================= File windows =================
  {
    const s = set('viewers', 'File windows', 'A file opens in one of the app\'s own windows (the module frame\'s window, as a module\'s window on the canvas), over the canvas and over the Vault; the Vault panel only lists, searches, filters, selects, adds and shares. Each file opens its own window (at most four; a fifth says "Close a window to open another.", decided; on a phone one at a time, a new file replaces it), the one you touch comes to the front, each moves by its title bar and resizes by its corner as the Workspace\'s windows do (open two and set them side by side), and Layout has Close all file windows. The title is the file name; the toolbar is Previous, Next (the Vault\'s list, in its order), Info, Download, Share and Full screen (the host\'s). Esc closes the window that has the focus and the focus goes back to what opened it. Pictures zoom and pan; audio and video use the browser\'s own controls; Markdown is read only through the SDK\'s own safe renderer; a PDF has page, zoom, Fit width and search. Info is a side panel in a wide window and sits under the file in a narrow one. At phone width the window is a full-screen sheet, one at a time (a new file replaces it), with Download as a large button at the foot.');
    const open = (id, extra) => (api) => api.openFile(id, null, extra);
    const base = { role: 'member', state: { view: 'list' } };
    state(s, { name: 'A picture, with its info', note: 'Over the Vault panel. Zoom, pan (drag), double click, Fit; Previous and Next walk the Vault\'s list as it was filtered when the window opened; a search or filter changed afterwards does not change them.', cfg: base, window: true, win: open('f01', { info: true }), h: 640 });
    state(s, { name: 'Two windows at once: a picture beside a PDF', note: 'Each has its own toolbar. The PDF was opened last, so it is in front; touching the picture brings it forward. Layout, top right of the canvas, closes them all.', cfg: { role: 'member', state: { view: 'grid' } }, window: true, win: (api) => { api.openFile('f09'); setTimeout(() => api.openFile('f30'), 80); }, h: 640 });
    state(s, { name: 'Four open: the cap', note: 'A fifth file says what to do, in the toast at the foot, and the window in front keeps the focus. Opening a file that is already open brings its window forward.', cfg: base, window: true, win: (api) => { ['f01', 'f09', 'f30', 'f39', 'f18'].forEach((id, i) => setTimeout(() => api.openFile(id), i * 80)); }, h: 640 });
    state(s, { name: 'Picture, zoomed in', cfg: base, window: true, win: (api, stage) => { api.openFile('f09'); const z = stage.windows[0].body.getRootNode().querySelectorAll('.vt-zoombar .sdk-icon-btn'); z[1].click(); z[1].click(); }, h: 640 });
    state(s, { name: 'Audio', note: 'The browser\'s audio element: play, pause, seek, volume and speed are its own. The tune is made in the page.', cfg: base, window: true, win: open('f18'), h: 560 });
    state(s, { name: 'Video', note: 'The browser\'s video element with its controls. A real 5 second clip.', cfg: base, window: true, win: open('f23'), h: 560 });
    state(s, { name: 'Markdown', note: 'Planted markup in the note shows as text and nothing runs; links are http and https only.', cfg: base, window: true, win: open('f39'), h: 640 });
    state(s, { name: 'PDF', note: 'Previous and next page, a page number, zoom out and in, Fit width and search (Q5). The page is drawn here: pdf.js is not on this page. Full screen is the window\'s own. The paper keeps the document\'s own colours in dark too.', cfg: base, window: true, win: open('f30'), h: 640 });
    state(s, { name: 'PDF, with search open', cfg: base, window: true, win: (api, stage) => { api.openFile('f30'); const r = stage.windows[0].body.getRootNode(); const b = r.querySelector('.vt-pdfbar [aria-label="Search in the PDF"]'); if (b) { b.click(); const i = r.querySelector('.vt-pdf-search input'); i.value = 'hotel'; i.dispatchEvent(new Event('input')); } }, h: 640 });
    state(s, { name: 'A PDF the scanner could not judge: download only', note: 'Kept, never opened here: "This PDF can\'t be opened here. Download it." with Download, and no viewer.', cfg: base, window: true, win: open('f32'), h: 560 });
    state(s, { name: 'A video this browser cannot play', note: 'A .mov in HEVC outside Safari. The Vault keeps the file and says so; the server does not transcode.', cfg: base, window: true, win: open('f24'), h: 560 });
    const ph = pair(s);
    state(ph, { name: 'On a phone, 390: a picture with its info', note: 'A full-screen sheet over the canvas, one at a time (opening another file replaces it). Info sits under the picture; Download is the large button at the foot.', w: 390, cfg: base, window: true, win: open('f01', { info: true }), h: 720 });
    state(ph, { name: 'On a phone, 390: a PDF', note: 'The toolbar folds its words into icons; the PDF\'s own bar keeps page and Fit width.', w: 390, cfg: base, window: true, win: open('f30'), h: 720 });
    state(ph, { name: 'On a phone, 360: download only', note: 'The one button is in the file\'s place, so there is no bar at the foot.', w: 360, cfg: base, window: true, win: open('f32'), h: 720 });
    state(s, { name: 'File missing', note: 'The record is there and the bytes are not (a restore without the Vault folder). Remove is the only thing to do, for a person who may remove it (a moderator here).', cfg: { role: 'moderator', state: { view: 'list' } }, window: true, win: open('f33'), h: 560 });
  }
}

export function buildNarrowAndPermissions({ set, state, pair }) {
  // ================= Narrow =================
  {
    const s = set('narrow', 'Narrow: 360 and 480', 'A Vault docked beside the call is 360 to 480px wide, and a phone is the same. The Vault measures its own width: the List loses its who and when columns (they move under the name), the Grid is three across with the picture first, a file opens as a full-screen sheet (set \"File windows\" and below), and the toolbar folds into More before anything is cut.');
    const p = pair(s);
    state(p, { name: 'List, 360', w: 360, cfg: { role: 'member', state: { view: 'list' } }, h: 640 });
    state(p, { name: 'Grid, 360', w: 360, cfg: { role: 'member', state: { view: 'grid' } }, h: 640 });
    state(p, { name: 'Grid, 480', w: 480, cfg: { role: 'member', state: { view: 'grid' } }, h: 640 });
    const p2 = pair(s);
    state(p2, { name: 'Choosing, 360', note: 'The actions fold into More.', w: 360, cfg: { role: 'moderator', state: { view: 'list', selecting: true, sel: ['f02', 'f05'] } }, h: 640 });
    const p3 = pair(s);
    state(p3, { name: 'Add files, 360', w: 360, cfg: { role: 'member', state: { panel: true, queue: [up('Pasta lunch, second.jpg', 3.1, 'picture', 'uploading', { pct: 62 }), up('Trip video.mkv', 800, 'video', 'refused', { msg: TYPE_REFUSAL })] } }, h: 800 });
    state(p3, { name: 'Empty, 360', w: 360, cfg: { role: 'member', empty: true, state: { usedBytes: 0 } }, h: 480 });
  }

  // ================= Permissions =================
  {
    const s = set('perms', 'What a person may do', 'The plan\'s permissions: view, add, download and remove_any (Remove files other people added); share comes with the share links. Owners have all of them. What a person cannot do is not drawn disabled: the button or the menu entry is not there. A guest has none of them and cannot be given any (the server answers 404 to a guest), so a guest never sees a Vault; the read-only guest is drawn only as an option; a guest has none (decided).');
    const can = (role) => { const r = ROLES[role]; const yes = ['view', 'add', 'download', 'remove_any', 'share'].filter((k) => r[k]); const no = ['view', 'add', 'download', 'remove_any', 'share'].filter((k) => !r[k]); return ` Can: ${yes.join(', ') || 'nothing'}.${no.length ? ` Cannot: ${no.join(', ')}.` : ''}`; };
    const menuOn = (api) => heldMenu(api.el, api.app.querySelector('[data-menu="f28"]'), api.fileMenuFor('f28'));
    const p = pair(s);
    state(p, { name: 'Moderator', note: `Everything on anyone's files, and Share.${can('moderator')} The menu is a file Sam added.`, cfg: { role: 'moderator', state: { view: 'list' } }, h: 480, after: menuOn });
    state(p, { name: 'Owner', note: `The same, and Settings in the title bar menu (smaller limits for the space and a person).${can('owner')}`, cfg: { role: 'owner', state: { view: 'list' } }, h: 480, after: (api) => heldMenu(api.el, api.el.querySelector('.mf-titlebar-menu'), api.frame.titlebarMenu()) });
    const p2 = pair(s);
    state(p2, { name: 'Member', note: `The default.${can('member')} The menu is a file Sam added: no Rename, no Share, no Remove.`, cfg: { role: 'member', state: { view: 'list' } }, h: 480, after: menuOn });
    state(p2, { name: 'Member who cannot add', note: `No "+", no drop zone.${can('member-noadd')}`, cfg: { role: 'member-noadd', state: { view: 'list' } }, h: 480, after: menuOn });
    const p3 = pair(s);
    state(p3, { name: 'Member who cannot download', note: `No Download in the menus or the viewer.${can('member-nodownload')}`, cfg: { role: 'member-nodownload', state: { view: 'list' } }, h: 480, after: menuOn });
    state(p3, { name: 'Member with Share turned on', note: `An owner can switch Share on for the member role in Roles: Share appears, with the Shared filter.${can('member-share')}`, cfg: { role: 'member-share', state: { view: 'list' } }, h: 480, after: menuOn });
    const p4 = pair(s);
    state(p4, { name: 'Guest', note: 'A guest has no access (decided, the plan and the security review): the server answers 404, so a guest never learns a file exists. This is all they see.', cfg: { role: 'guest', state: {} }, h: 480 });
    state(p4, { name: 'A guest who may look (option)', note: `Not in the plan: view only, no Select.${can('guest-view')}`, cfg: { role: 'guest-view', state: { view: 'list' } }, h: 480, after: menuOn });
    state(p4, { name: 'A download-only PDF, member who cannot download', note: 'The window has no Download; the words stay.', cfg: { role: 'member-nodownload', state: { view: 'list' } }, window: true, win: (api) => api.openFile('f32'), h: 480 });
  }
}
