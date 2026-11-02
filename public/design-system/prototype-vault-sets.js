// The Prototype's Vault section, the second half (Thomas, 2026-11-02): Add files and its refusals, the viewers, the narrow module, the
// permission views. The first half and the helpers (set, state, pair) are prototype-vault.js's.
import { TYPE_REFUSAL } from './prototype-vault-app.js';
import { MB, GB } from './prototype-vault-data.js';

const up = (name, mb, kind, status, extra = {}) => ({ name, size: Math.round(mb * MB), kind, status, pct: 0, msg: '', ...extra });

export function buildAddAndViewers({ set, state, pair }) {
  // ================= Add files =================
  {
    const s = set('add', 'Add files', 'The "+" in the title bar is Add files. It opens a panel at the top of the module (or a dialog: Q4): a drop zone and Choose files (several at once; on a phone the photo library and camera), the option for pictures, the notice for video, "Everyone in this trip can see what you add.", the room left, and a row for each file with its progress or its refusal. Dropping files on the module shows the drop outline over it.');
    const p = pair(s);
    state(p, { name: 'The panel', note: 'Open, nothing sent yet. The option and the notice are the plan\'s decision 10; its default is Q7.', cfg: { role: 'member', state: { panel: true } }, h: 720 });
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
    state(p3, { name: 'Damaged PDFs: refused or download only (Q8)', note: 'Two rows, the two answers: refused with a plain sentence (the plan today), or kept for download only like a PDF the scanner cannot judge.', cfg: { role: 'member', state: { panel: true, queue: [
      up('Scan of the booking.pdf', 0.9, 'pdf', 'refused', { msg: 'This PDF looks damaged. Save it again and try once more.' }),
      up('Insurance, encrypted.pdf', 3.4, 'pdf', 'done', { pct: 100, msg: "Added · 3.4 MB · Download only: this PDF can't be opened here." }),
    ] } }, h: 800 });
    const p4 = pair(s);
    state(p4, { name: 'No room: the space, the person, the server', note: 'Each over-limit sentence is the plan\'s, with the template\'s word for the Vault (Q11). The drop zone turns off when the space is full.', cfg: { role: 'member', state: { panel: true, usedBytes: 5 * GB, notice: { kind: 'danger', text: "No room left in this trip's Vault (5 GB). Remove some files to add more." }, queue: [
      up('Cooking class, full.mp4', 330, 'video', 'refused', { msg: "No room left in this trip's Vault (5 GB). Remove some files to add more." }),
      up('Dinner toast, again.mp4', 60, 'video', 'refused', { msg: 'You have used your 2 GB in the Vault. Remove some of your files to add more.' }),
      up('Rome walk, long.mp4', 90, 'video', 'refused', { msg: "The server's file storage is full. Ask the admin." }),
    ] } }, h: 800 });
    state(p4, { name: 'Add files as a dialog (Q4, the other way)', note: 'The same panel in the product\'s dialog. A dialog blocks the list behind it; the panel keeps it in view.', cfg: { role: 'member', held: true, state: { panel: true, queue: [up('Pasta lunch, second.jpg', 3.1, 'picture', 'uploading', { pct: 62 })] }, trial: { add: 'dialog' } }, h: 800 });
    state(s, { name: 'Remove where it was taken: on by default (Q7, the other way)', note: 'The same option checked. A picture lets go of its position and the camera\'s notes unless the person keeps them; video is not cleaned, and the notice says so either way.', cfg: { role: 'member', state: { panel: true }, trial: { removeWhere: 'on' } }, h: 720 });
  }

  // ================= Viewers =================
  {
    const s = set('viewers', 'Viewers', 'Inside the module\'s content area, one file at a time: a top row with Back, the name, Previous and Next, Download and Share where allowed, Info and the more button. Pictures zoom and pan and have Full screen (the host gives it to the module); audio and video use the browser\'s own controls (play, pause, seek, volume, speed, full screen); Markdown is read only, in the reading width, through the SDK\'s own safe renderer; a PDF opens in the app\'s own viewer. The Back button, the arrow keys and Escape work.');
    const p = pair(s);
    state(p, { name: 'Picture, with its info', note: 'Zoom, pan (drag), double click, Fit, Full screen; Previous and Next on the picture\'s edges and in the top row. Info is a side panel (Q5).', cfg: { role: 'member', state: { open: 'f01', info: true } }, h: 640 });
    state(p, { name: 'Picture, zoomed in', note: 'The level shows in the zoom bar; Fit puts it back.', cfg: { role: 'member', state: { open: 'f09' } }, h: 640, after: (api) => { const b = api.app.querySelectorAll('.vt-zoombar .sdk-icon-btn'); b[1].click(); b[1].click(); } });
    const p2 = pair(s);
    state(p2, { name: 'Audio', note: 'The browser\'s audio element: play, pause, seek, volume and speed are its own. The tune is made in the page.', cfg: { role: 'member', state: { open: 'f18' } }, h: 560 });
    state(p2, { name: 'Video', note: 'The browser\'s video element with its controls (play, pause, seek, volume, full screen, picture in picture where the browser has it). A real 5 second clip.', cfg: { role: 'member', state: { open: 'f23' } }, h: 560 });
    const p3 = pair(s);
    state(p3, { name: 'Markdown', note: 'Planted markup in the note shows as text and nothing runs; links are http and https only.', cfg: { role: 'member', state: { open: 'f39' } }, h: 640 });
    state(p3, { name: 'PDF, the app\'s own viewer', note: 'Previous and next page, a page number, zoom out and in, Fit width, search (Q6) and Full screen from the host. The page is drawn here: pdf.js is not on this page. The paper keeps the document\'s own colours in dark too.', cfg: { role: 'member', state: { open: 'f30' } }, h: 640 });
    const p4 = pair(s);
    state(p4, { name: 'PDF, with search open', cfg: { role: 'member', state: { open: 'f30' } }, h: 640, after: (api) => { const b = api.app.querySelector('.vt-pdfbar [aria-label="Search in the PDF"]'); if (b) { b.click(); const i = api.app.querySelector('.vt-pdf-search input'); i.value = 'hotel'; i.dispatchEvent(new Event('input')); } } });
    state(p4, { name: 'A PDF the scanner could not judge: download only', note: 'Kept, never opened here: "This PDF can\'t be opened here. Download it." with Download, and nothing else in the stage.', cfg: { role: 'member', state: { open: 'f32' } }, h: 640 });
    const p5 = pair(s);
    state(p5, { name: 'A video this browser cannot play', note: 'A .mov in HEVC outside Safari. The Vault keeps the file and says so; the server does not transcode. A type the Vault refuses never gets here.', cfg: { role: 'member', state: { open: 'f24' } }, h: 560 });
    state(p5, { name: 'File missing', note: 'The record is there and the bytes are not (a restore without the Vault folder). Remove is the only thing to do.', cfg: { role: 'member', state: { open: 'f33' } }, h: 560 });
  }
}

export function buildNarrowAndPermissions({ set, state, pair }) {
  // ================= Narrow =================
  {
    const s = set('narrow', 'Narrow: 360 and 480', 'A Vault docked beside the call is 360 to 480px wide, and a phone is the same. The Vault measures its own width: the List loses its who and when columns (they move under the name), the Grid is three across with the picture first, the viewer\'s top row keeps Back, the name, Previous, Next, a Download icon and More (Share moves into More), Info is a sheet, and the toolbar folds into More before anything is cut. No phone-specific layout is drawn.');
    const p = pair(s);
    state(p, { name: 'List, 360', w: 360, cfg: { role: 'member', state: { view: 'list' } }, h: 640 });
    state(p, { name: 'Grid, 360', w: 360, cfg: { role: 'member', state: { view: 'grid' } }, h: 640 });
    state(p, { name: 'Grid, 480', w: 480, cfg: { role: 'member', state: { view: 'grid' } }, h: 640 });
    const p2 = pair(s);
    state(p2, { name: 'Picture with info, 360', w: 360, cfg: { role: 'member', state: { open: 'f01', info: true } }, h: 640 });
    state(p2, { name: 'PDF, 360', w: 360, cfg: { role: 'member', state: { open: 'f30' } }, h: 640 });
    state(p2, { name: 'Choosing, 360', note: 'The actions fold into More.', w: 360, cfg: { role: 'moderator', state: { view: 'list', selecting: true, sel: ['f02', 'f05'] } }, h: 640 });
    const p3 = pair(s);
    state(p3, { name: 'Add files, 360', w: 360, cfg: { role: 'member', state: { panel: true, queue: [up('Pasta lunch, second.jpg', 3.1, 'picture', 'uploading', { pct: 62 }), up('Trip video.mkv', 800, 'video', 'refused', { msg: TYPE_REFUSAL })] } }, h: 800 });
    state(p3, { name: 'Empty, 360', w: 360, cfg: { role: 'member', empty: true, state: { usedBytes: 0 } }, h: 480 });
  }

  // ================= Permissions =================
  {
    const s = set('perms', 'What a person may do', 'The plan\'s permissions: view, add, download and remove_any (Remove files other people added); share comes with the share links. Owners have all of them. What a person cannot do is not drawn disabled: the button or the menu entry is not there. A guest has none of them and cannot be given any (the server answers 404 to a guest), so a guest never sees a Vault; the read-only guest is drawn only as an option (Q9).');
    const p = pair(s);
    state(p, { name: 'Moderator', note: 'Add, Select, Share, Remove on anything.', cfg: { role: 'moderator', state: { view: 'list' } } });
    state(p, { name: 'Owner', note: 'The same, and Settings (smaller limits for the space and a person).', cfg: { role: 'owner', state: { view: 'list' } } });
    const p2 = pair(s);
    state(p2, { name: 'Member who cannot add', note: 'No "+", no drop zone. Everything else as a member.', cfg: { role: 'member-noadd', state: { view: 'list' } } });
    state(p2, { name: 'Member who cannot download', note: 'No Download in the menus or the viewer, and none on a PDF kept for download only.', cfg: { role: 'member-nodownload', state: { view: 'list' } } });
    const p3 = pair(s);
    state(p3, { name: 'Member with Share turned on', note: 'An owner can switch Share on for the member role in Roles: Share appears, and the Shared filter.', cfg: { role: 'member-share', state: { view: 'list' } } });
    state(p3, { name: 'Guest', note: 'The plan: a guest has no access, so this is all they see. "You can\'t see the files in this trip."', cfg: { role: 'guest', state: {} }, h: 480 });
    const p4 = pair(s);
    state(p4, { name: 'A guest who may look (option, Q9)', note: 'Not in the plan: view only, no add, no download, no share, no Select.', cfg: { role: 'guest-view', state: { view: 'list' } } });
    state(p4, { name: 'A download-only PDF, member who cannot download', cfg: { role: 'member-nodownload', state: { open: 'f32' } }, h: 480 });
  }
}
