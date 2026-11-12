// The landing after the guest door (/guest): the spaces open to this visitor, what they can't do, and Leave. Everything comes from
// GET /api/guest-door and is drawn as text. No guest session goes to the agreement and name page (the server redirects).
import { loadBranding, api } from '/brand.js';
import { word } from '/words.js';

const $ = (id) => document.getElementById(id);
loadBranding();

function draw(answer) {
  $('guest-hello').textContent = `You are in as ${answer.guest.name} (${word('guest')}).`;
  const list = $('guest-unavailable');
  list.textContent = '';
  for (const text of answer.unavailable || []) {
    const li = document.createElement('li');
    li.textContent = text;
    list.append(li);
  }
  const box = $('guest-spaces');
  box.textContent = '';
  if (!answer.spaces.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = answer.none;
    box.append(p);
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'guest-space-list';
  for (const space of answer.spaces) {
    const li = document.createElement('li');
    const row = document.createElement('a');
    row.className = 'guest-space';
    row.href = `/guest/${encodeURIComponent(space.id)}`;
    if (space.hasImage) {
      const img = document.createElement('img');
      img.src = `/img/space/${encodeURIComponent(space.id)}`;
      img.alt = '';
      img.width = 32;
      img.height = 32;
      row.append(img);
    }
    const name = document.createElement('span');
    name.textContent = space.name;
    row.append(name);
    const go = document.createElement('i');
    go.className = 'fa-solid fa-chevron-right guest-space-go';
    go.setAttribute('aria-hidden', 'true');
    row.append(go);
    li.append(row);
    ul.append(li);
  }
  box.append(ul);
}

api('GET', '/api/guest-door').then(draw, (err) => {
  if (err.status === 401) { location.href = '/agree?next=%2Fguest'; return; }
  $('guest-error').textContent = err.message;
  $('guest-error').hidden = false;
});
$('guest-leave').addEventListener('click', async () => {
  try { await api('DELETE', '/api/guest-door'); } catch { /* the cookie is cleared by the answer, or it is already gone */ }
  location.href = '/login';
});
