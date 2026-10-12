'use strict';

// Panel Kropki - czysty JS, bez bibliotek i bez budowania (działa wprost z GitHub Pages).
// Bezpieczeństwo: wszystkie dane z API wstawiamy przez textContent (helper h), nigdy przez innerHTML.
// Moduł może dodać własny widok: panel/modules/<plik>.js -> KropkaPanel.register('<moduł>', { render(container, ctx) })

const API = String(window.KROPKA_CONFIG?.apiUrl || '').replace(/\/$/, '');
const TOKEN_KEY = 'kropka_session';

const state = {
    config: null, // /api/config
    me: null,     // /api/me
    meta: null,   // /api/modules - { categories, modules }
    guilds: null,
    guild: null,  // { id, data, loadedAt }
};

let cleanups = [];
const onLeave = fn => cleanups.push(fn);
const panelModules = new Map(); // nazwa modułu -> { render }

// ---------------------------------------------------------------- helpers

const $ = sel => document.querySelector(sel);

function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
        if (value == null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'style') {
            for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
        } else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
        else if (key in el) el[key] = value;
        else el.setAttribute(key, value);
    }
    for (const child of children.flat(Infinity)) {
        if (child == null || child === false) continue;
        el.append(child instanceof Node ? child : String(child));
    }
    return el;
}

// Logo Discorda (Simple Icons, CC0) jako SVG - bez zewnętrznych plików
const DISCORD_PATH = 'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z';
function discordIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'dc-ico');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', DISCORD_PATH);
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
}

// Linki z danych (np. URL utworu) - tylko http(s)
function safeUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch {
        return null;
    }
}

function extLink(url, ...children) {
    const href = safeUrl(url);
    return href
        ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, ...children)
        : h('span', null, ...children);
}

const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) {
        try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* prywatne okno */ }
    },
};

function formatDuration(seconds) {
    if (!seconds && seconds !== 0) return 'live';
    seconds = Math.max(0, Math.round(seconds));
    const hh = Math.floor(seconds / 3600);
    const mm = Math.floor((seconds % 3600) / 60);
    const ss = String(seconds % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

const initials = name => name.split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function guildIconUrl(g) {
    if (!g.icon) return null;
    const ext = g.icon.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${ext}?size=128`;
}

function guildIcon(g, size = 'md') {
    const url = guildIconUrl(g);
    return url
        ? h('img', { class: `gicon ${size}`, src: url, alt: '' })
        : h('div', { class: `gicon ${size} fallback` }, initials(g.name));
}

function avatarUrl(id, avatar, size = 64) {
    if (avatar) return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=${size}`;
    return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
}

function inviteUrl(guildId) {
    const params = new URLSearchParams({
        client_id: state.config.clientId,
        scope: 'bot applications.commands',
        permissions: state.config.invitePermissions,
    });
    if (guildId) {
        params.set('guild_id', guildId);
        params.set('disable_guild_select', 'true');
    }
    return `https://discord.com/oauth2/authorize?${params}`;
}

function toast(message, type = 'ok') {
    const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
    $('#toasts').append(el);
    setTimeout(() => {
        el.classList.add('out');
        setTimeout(() => el.remove(), 300);
    }, type === 'error' ? 6000 : 3500);
}

// Blokuje przycisk na czas akcji i pokazuje błąd jako toast
async function busy(btn, fn) {
    btn.disabled = true;
    btn.classList.add('loading');
    try {
        return await fn();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
    }
}

function loading() {
    return h('div', { class: 'center-state' }, h('div', { class: 'spinner' }));
}

// ---------------------------------------------------------------- api

async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    const token = storage.get(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
        res = await fetch(API + path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
        });
    } catch {
        throw new Error('Brak połączenia z botem. Czy bot i jego API działają?');
    }
    const data = await res.json().catch(() => ({}));

    if (res.status === 401 && token) {
        storage.set(TOKEN_KEY, null);
        state.me = null;
        setTimeout(route);
    }
    if (!res.ok) {
        const err = new Error(data.error || `Błąd ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

// ---------------------------------------------------------------- kontrolki formularzy

// <label> tylko dla zwykłego pola - przy złożonych kontrolkach (kafelki ról, listy, edytor wiadomości)
// kliknięcie w napis "kliknęłoby" pierwszy przycisk w środku (np. usunięcie pierwszej roli)
function field(label, control, hint) {
    const simple = typeof control?.matches === 'function' && control.matches('input, select, textarea');
    return h(simple ? 'label' : 'div', { class: 'field' },
        h('span', { class: 'field-label' }, label),
        control,
        hint && h('span', { class: 'field-hint' }, hint));
}

const KIND_ICONS = { text: '#', voice: '🔊', category: '📁', forum: '💬' };

function channelSelect(channels, value, { type, kinds, none, placeholder } = {}) {
    kinds = kinds ?? [type ?? 'text'];
    const select = h('select', { class: 'input' });
    if (none) select.append(h('option', { value: '' }, none));
    const groups = new Map();
    for (const c of channels.filter(c => kinds.includes(c.type))) {
        const key = c.type === 'category' ? '' : (c.category ?? '');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    }
    for (const [category, list] of groups) {
        const parent = category ? h('optgroup', { label: category }) : select;
        for (const c of list) {
            parent.append(h('option', { value: c.id },
                `${KIND_ICONS[c.type] ?? '#'} ${c.name}${c.botCanUse ? '' : '  ⚠ bot nie ma dostępu'}`));
        }
        if (category) select.append(parent);
    }
    return pickInitial(select, value, none, placeholder);
}

// Ustawia wartość listy. Bez "brak": pierwsza pozycja albo - z placeholder - widoczne "wybierz",
// żeby wymagane pole bez wartości nie udawało, że coś jest wybrane.
function pickInitial(select, value, none, placeholder) {
    select.value = value ?? '';
    if (select.value === '' && !none) {
        if (placeholder) select.prepend(h('option', { value: '', disabled: true }, placeholder));
        if (select.options.length) select.selectedIndex = 0;
    }
    return select;
}

// Czy zalogowana osoba może rozdawać tę rolę (i bot może ją nadać)
function canAssign(role) {
    const g = state.guild?.data?.guild;
    return role.assignable && (g?.isOwner || role.position < (g?.memberTopRole ?? 0));
}

function roleSelect(roles, value, { none, placeholder, onlyAssignable = false } = {}) {
    const select = h('select', { class: 'input' });
    if (none) select.append(h('option', { value: '' }, none));
    for (const r of roles) {
        if (onlyAssignable && !canAssign(r)) continue;
        const note = r.managed ? '  (integracja)' : r.assignable ? '' : '  ⚠ wyżej niż bot';
        select.append(h('option', { value: r.id, disabled: !onlyAssignable && r.managed }, `@${r.name}${note}`));
    }
    return pickInitial(select, value, none, placeholder);
}

function numberInput(value, min, max, onChange, { step = 1, suffix } = {}) {
    const input = h('input', {
        class: 'input', type: 'number', min, max, step, value,
        oninput: e => {
            const n = Number(e.target.value);
            const okStep = Number.isInteger(step) ? Number.isInteger(n) : true;
            const valid = e.target.value !== '' && okStep && n >= (min ?? -Infinity) && n <= (max ?? Infinity);
            e.target.classList.toggle('invalid', !valid);
            if (valid) onChange(n);
        },
    });
    return suffix ? h('div', { class: 'suffix-input' }, input, h('span', null, suffix)) : input;
}

function colorInput(value, onChange) {
    const text = h('input', { class: 'input', value, maxLength: 7 });
    const picker = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#ff2d87' });
    picker.addEventListener('input', () => {
        text.value = picker.value.toUpperCase();
        onChange(text.value);
    });
    text.addEventListener('input', () => {
        const v = text.value.startsWith('#') ? text.value : `#${text.value}`;
        if (/^#[0-9a-f]{6}$/i.test(v)) picker.value = v;
        onChange(v.toUpperCase());
    });
    return h('div', { class: 'color-input' }, picker, text);
}

function withCounter(input, max) {
    const counter = h('div', { class: 'counter' });
    const update = () => {
        counter.textContent = `${input.value.length} / ${max}`;
        counter.classList.toggle('over', input.value.length > max);
    };
    input.addEventListener('input', update);
    update();
    return h('div', { class: 'stack', style: { gap: '4px' } }, input, counter);
}

function switchInput(checked, onChange, label) {
    const input = h('input', { type: 'checkbox', checked, onchange: e => onChange(e.target.checked) });
    return h('label', { class: 'switch-row' },
        h('span', { class: 'switch' }, input, h('span', { class: 'slider' })),
        label && h('span', { class: 'switch-label' }, label));
}

// ---------------------------------------------------------------- własne listy rozwijane
// Każdy <select class="input"> w panelu (też w modułach) dostaje własny wygląd: przycisk + szklane menu.
// Oryginalny <select> zostaje ukryty w środku - kod dalej czyta .value i słucha 'change',
// więc żaden moduł nie musi o tym wiedzieć.

let openMenu = null; // { menu, close }

function enhanceSelect(select) {
    if (select.multiple || select.parentElement?.classList.contains('dd')) return;
    const valueEl = h('span', { class: 'dd-value' });
    const button = h('button', { type: 'button', class: 'dd-button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' },
        valueEl, h('span', { class: 'dd-arrow', 'aria-hidden': 'true' }));
    const wrap = h('div', { class: `dd${select.classList.contains('chips-add') ? ' dd-inline' : ''}` });
    if (select.style.cssText) wrap.style.cssText = select.style.cssText;
    select.before(wrap);
    wrap.append(button, select);

    const sync = () => {
        const opt = select.options[select.selectedIndex];
        valueEl.textContent = opt?.textContent ?? '';
        wrap.classList.toggle('is-empty', !opt || opt.value === '');
        button.disabled = select.disabled;
        button.title = opt?.textContent ?? '';
    };
    // Wartość ustawiona w kodzie (select.value = ...) też ma się pokazać
    for (const prop of ['value', 'selectedIndex']) {
        const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
        Object.defineProperty(select, prop, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); sync(); } });
    }
    select.addEventListener('change', sync);
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'label'] });
    sync();

    const choose = opt => {
        select.value = opt.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        closeMenu();
        button.focus();
    };

    function open() {
        if (button.disabled) return;
        closeMenu();
        const items = [];
        const list = h('div', { class: 'dd-list', role: 'listbox' });
        const addOption = opt => {
            if (opt.hidden) return;
            const item = h('div', {
                class: `dd-item${opt.selected && opt.value !== '' ? ' selected' : ''}${opt.disabled ? ' disabled' : ''}`,
                role: 'option', 'aria-selected': String(opt.selected), 'aria-disabled': String(opt.disabled),
                onmousedown: e => e.preventDefault(),
                onclick: () => { if (!opt.disabled) choose(opt); },
            }, opt.textContent);
            item.addEventListener('mousemove', () => setActive(items.indexOf(item)));
            item._opt = opt;
            items.push(item);
            list.append(item);
        };
        for (const child of select.children) {
            if (child.tagName === 'OPTGROUP') {
                list.append(h('div', { class: 'dd-group' }, child.label));
                [...child.children].forEach(addOption);
            } else addOption(child);
        }
        let active = -1;
        const usable = () => items.filter(i => !i.hidden && !i._opt.disabled);
        function setActive(i) {
            items[active]?.classList.remove('active');
            active = i;
            const item = items[active];
            if (item) { item.classList.add('active'); item.scrollIntoView({ block: 'nearest' }); }
        }
        const move = dir => {
            const list = usable();
            if (!list.length) return;
            const at = list.indexOf(items[active]);
            setActive(items.indexOf(list[(at + dir + list.length) % list.length] ?? list[0]));
        };

        const search = items.length > 8 ? h('input', { class: 'dd-search', placeholder: 'Szukaj…', 'aria-label': 'Szukaj' }) : null;
        search?.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            for (const item of items) item.hidden = q !== '' && !item.textContent.toLowerCase().includes(q);
            for (const g of list.querySelectorAll('.dd-group')) {
                let next = g.nextElementSibling, any = false;
                while (next && !next.classList.contains('dd-group')) { if (!next.hidden) any = true; next = next.nextElementSibling; }
                g.hidden = !any;
            }
            setActive(items.indexOf(usable()[0]));
        });

        const menu = h('div', { class: 'dd-menu' }, search, list);
        menu.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); const item = items[active]; if (item && !item.hidden && !item._opt.disabled) choose(item._opt); }
            else if (e.key === 'Escape' || e.key === 'Tab') { closeMenu(); button.focus(); }
        });
        document.body.append(menu);

        // Pod przyciskiem, a gdy brak miejsca - nad nim
        const r = button.getBoundingClientRect();
        const below = innerHeight - r.bottom - 12;
        const above = r.top - 12;
        const up = below < 220 && above > below;
        menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 220) - 8))}px`;
        menu.style.width = `${Math.max(r.width, 220)}px`;
        menu.style.maxHeight = `${Math.min(340, up ? above : below)}px`;
        if (up) menu.style.bottom = `${innerHeight - r.top + 6}px`;
        else menu.style.top = `${r.bottom + 6}px`;
        menu.classList.toggle('up', up);

        wrap.classList.add('open');
        button.setAttribute('aria-expanded', 'true');
        openMenu = {
            menu,
            close() {
                menu.remove();
                wrap.classList.remove('open');
                button.setAttribute('aria-expanded', 'false');
            },
        };
        const current = items.find(i => i._opt.selected && !i._opt.disabled);
        setActive(current ? items.indexOf(current) : items.indexOf(usable()[0]));
        (search ?? menu).focus?.();
        if (!search) { menu.tabIndex = -1; menu.focus(); }
    }

    button.addEventListener('click', () => (wrap.classList.contains('open') ? closeMenu() : open()));
    button.addEventListener('keydown', e => {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
    });
}

function closeMenu() {
    openMenu?.close();
    openMenu = null;
}

function initDropdowns() {
    if (typeof MutationObserver === 'undefined' || typeof HTMLSelectElement === 'undefined') return;
    const scan = node => {
        if (node.nodeType !== 1) return;
        if (node.matches('select.input')) enhanceSelect(node);
        node.querySelectorAll('select.input').forEach(enhanceSelect);
    };
    new MutationObserver(muts => { for (const m of muts) m.addedNodes.forEach(scan); }).observe(document.body, { childList: true, subtree: true });
    scan(document.body);
    document.addEventListener('mousedown', e => { if (openMenu && !openMenu.menu.contains(e.target) && !e.target.closest?.('.dd.open')) closeMenu(); });
    // przewinięcie strony (ale nie samego menu) albo zmiana rozmiaru - menu by odjechało, zamykamy
    document.addEventListener('scroll', e => { if (openMenu && !openMenu.menu.contains(e.target)) closeMenu(); }, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('hashchange', closeMenu);
}

// Wybór wielu pozycji: kafelki + lista do dodawania
function chipsPicker({ options, values, onChange, placeholder = '+ Dodaj…', max = 25 }) {
    let current = [...values];
    const box = h('div', { class: 'chips' });
    function draw() {
        const chosen = current.map(v => options.find(o => o.value === v) ?? { value: v, label: `⚠ nie istnieje (${v})` });
        const select = h('select', { class: 'input chips-add', disabled: current.length >= max },
            h('option', { value: '' }, current.length >= max ? `Maks. ${max}` : placeholder),
            options.filter(o => !current.includes(o.value)).map(o => h('option', { value: o.value }, o.label)));
        select.addEventListener('change', () => {
            if (!select.value) return;
            current = [...current, select.value];
            onChange([...current]);
            draw();
        });
        box.replaceChildren(
            ...chosen.map(o => h('span', { class: 'chip', style: o.color ? { '--chip-color': o.color } : null },
                o.label,
                h('button', {
                    type: 'button', title: 'Usuń',
                    onclick: () => { current = current.filter(v => v !== o.value); onChange([...current]); draw(); },
                }, '×'))),
            select);
    }
    draw();
    return box;
}

// Lista słów/fraz - Enter albo przecinek dodaje
function tagsInput(values, onChange, { max = 100, itemMax = 100, placeholder = 'Wpisz i naciśnij Enter' } = {}) {
    let current = [...values];
    const box = h('div', { class: 'chips' });
    const input = h('input', { class: 'input chips-add', placeholder, maxLength: itemMax });
    const add = () => {
        const parts = input.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!parts.length) return;
        current = [...new Set([...current, ...parts])].slice(0, max);
        input.value = '';
        onChange([...current]);
        draw();
        input.focus();
    };
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
        if (e.key === 'Backspace' && !input.value && current.length) {
            current = current.slice(0, -1);
            onChange([...current]);
            draw();
            input.focus();
        }
    });
    input.addEventListener('blur', add);
    function draw() {
        box.replaceChildren(
            ...current.map(t => h('span', { class: 'chip' }, t,
                h('button', { type: 'button', title: 'Usuń', onclick: () => { current = current.filter(x => x !== t); onChange([...current]); draw(); } }, '×'))),
            input);
    }
    draw();
    return box;
}

// Klikalne zmienne ({user} itd.) - wstawiają się w miejsce kursora
function placeholderChips(list, target) {
    if (!list?.length) return null;
    return h('div', { class: 'ph-chips' }, h('span', { class: 'faint' }, 'Zmienne:'),
        list.map(ph => h('button', {
            type: 'button', class: 'ph-chip',
            onclick: () => {
                const start = target.selectionStart ?? target.value.length;
                const end = target.selectionEnd ?? target.value.length;
                target.value = target.value.slice(0, start) + ph + target.value.slice(end);
                target.focus();
                target.setSelectionRange(start + ph.length, start + ph.length);
                target.dispatchEvent(new Event('input'));
            },
        }, ph)));
}

function discordMessage(body) {
    return h('div', { class: 'dc-msg' },
        h('img', { class: 'av', src: avatarUrl(state.config.clientId, state.config.botAvatar), alt: '' }),
        h('div', { class: 'dc-body' },
            h('div', { class: 'dc-author' }, state.config.botName, h('span', { class: 'dc-tag' }, 'BOT'), h('span', { class: 'dc-time' }, 'Dzisiaj')),
            body));
}

// Edytor szablonu wiadomości (treść + opcjonalny embed) z podglądem
function messageEditor(value, onChange, { placeholders } = {}) {
    const msg = clone(value) ?? {};
    msg.content ??= '';
    msg.embed = { enabled: false, title: '', description: '', color: '#FF2D87', footer: '', image: '', thumbnail: '', ...(msg.embed ?? {}) };
    const emit = () => { onChange(clone(msg)); preview(); };

    const content = h('textarea', { class: 'input', rows: 3, value: msg.content, placeholder: 'Treść wiadomości' });
    content.addEventListener('input', () => { msg.content = content.value; emit(); });

    const embedInput = (key, label, props = {}) => {
        const input = h(props.rows ? 'textarea' : 'input', { class: 'input', value: msg.embed[key], ...props });
        input.addEventListener('input', () => { msg.embed[key] = input.value; emit(); });
        return field(label, input);
    };
    const embedFields = h('div', { class: 'stack' },
        embedInput('title', 'Tytuł', { maxLength: 256 }),
        embedInput('description', 'Opis', { rows: 4, maxLength: 4096 }),
        h('div', { class: 'grid-2' },
            field('Kolor', colorInput(msg.embed.color, v => { msg.embed.color = v; emit(); })),
            embedInput('footer', 'Stopka', { maxLength: 2048 })),
        h('div', { class: 'grid-2' },
            embedInput('image', 'Obrazek (URL)', { type: 'url', placeholder: 'https://…' }),
            embedInput('thumbnail', 'Miniaturka (URL)', { type: 'url', placeholder: 'https://… albo {user.avatar}' })));
    embedFields.hidden = !msg.embed.enabled;

    const out = h('div', { class: 'dc-preview-body' });
    function preview() {
        const e = msg.embed;
        const parts = [];
        if (msg.content) parts.push(h('div', { class: 'dc-text' }, msg.content));
        if (e.enabled && (e.title || e.description || e.footer)) {
            parts.push(h('div', { class: 'dc-embed', style: { '--embed-color': /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : '#ff2d87' } },
                e.title && h('div', { class: 'dc-embed-title' }, e.title),
                e.description && h('div', { class: 'dc-embed-desc' }, e.description),
                e.footer && h('div', { class: 'dc-embed-footer' }, e.footer)));
        }
        if (!parts.length) parts.push(h('div', { class: 'dc-text faint' }, '(pusta wiadomość - nic nie zostanie wysłane)'));
        out.replaceChildren(...parts);
    }
    preview();

    return h('div', { class: 'msg-editor' },
        h('div', { class: 'stack' },
            withCounter(content, 2000),
            placeholderChips(placeholders, content),
            switchInput(msg.embed.enabled, v => { msg.embed.enabled = v; embedFields.hidden = !v; emit(); }, 'Dodaj embed'),
            embedFields),
        h('div', { class: 'preview' }, h('div', { class: 'preview-label kicker' }, 'Podgląd'), discordMessage(out)));
}

function defaultOfField(f) {
    if (f.default !== undefined) return clone(f.default);
    switch (f.type) {
        case 'boolean': return false;
        case 'number': return f.min ?? 0;
        case 'color': return '#FF2D87';
        case 'select': return f.options[0]?.value ?? null;
        case 'channel': case 'role': return null;
        case 'channels': case 'roles': case 'tags': case 'list': return [];
        case 'message': return { content: '', embed: { enabled: false, title: '', description: '', color: '#FF2D87', footer: '', image: '', thumbnail: '' } };
        default: return '';
    }
}

// Lista obiektów (np. nagrody za poziomy) - każdy wiersz ma pola z f.item
function listEditor(f, items, onChange, ctx) {
    let current = clone(items) ?? [];
    const box = h('div', { class: 'list-items' });
    const emit = () => onChange(clone(current));
    function draw() {
        box.replaceChildren(
            ...current.map((item, i) => h('div', { class: 'list-item' },
                h('div', { class: 'list-item-fields' }, f.item.map(sub =>
                    field(sub.label ?? sub.key, renderControl(sub, item[sub.key], v => { item[sub.key] = v; emit(); }, ctx), sub.hint))),
                h('div', { class: 'list-item-actions' },
                    h('button', { type: 'button', class: 'btn btn-icon btn-ghost', title: 'W górę', disabled: i === 0, onclick: () => { [current[i - 1], current[i]] = [current[i], current[i - 1]]; emit(); draw(); } }, '↑'),
                    h('button', { type: 'button', class: 'btn btn-icon btn-ghost', title: 'W dół', disabled: i === current.length - 1, onclick: () => { [current[i + 1], current[i]] = [current[i], current[i + 1]]; emit(); draw(); } }, '↓'),
                    h('button', { type: 'button', class: 'btn btn-icon btn-danger', title: 'Usuń', onclick: () => { current.splice(i, 1); emit(); draw(); } }, '✕')))),
            ...(current.length === 0 ? [h('div', { class: 'empty', style: { padding: '14px' } }, 'Brak pozycji.')] : []),
            h('button', {
                type: 'button', class: 'btn btn-sm btn-add', disabled: current.length >= (f.max ?? 25),
                onclick: () => { current.push(Object.fromEntries(f.item.map(sub => [sub.key, defaultOfField(sub)]))); emit(); draw(); },
            }, `+ ${f.addLabel ?? 'Dodaj'}`));
    }
    draw();
    return box;
}

// Kontrolka dla jednego pola z opisu ustawień modułu
function renderControl(f, value, onChange, ctx) {
    const { channels, roles } = ctx;
    switch (f.type) {
        case 'boolean': return switchInput(Boolean(value), onChange);
        case 'number': return numberInput(value, f.min, f.max, onChange, { step: f.step ?? 1, suffix: f.suffix });
        case 'text': case 'emoji': case 'url': {
            const input = h('input', { class: 'input', value: value ?? '', maxLength: f.max ?? (f.type === 'url' ? 2048 : 200), placeholder: f.placeholder ?? '', type: f.type === 'url' ? 'url' : 'text' });
            input.addEventListener('input', () => onChange(input.value));
            return input;
        }
        case 'textarea': {
            const input = h('textarea', { class: 'input', rows: f.rows ?? 4, value: value ?? '', placeholder: f.placeholder ?? '' });
            input.addEventListener('input', () => onChange(input.value));
            return h('div', { class: 'stack', style: { gap: '6px' } }, withCounter(input, f.max ?? 2000), placeholderChips(f.placeholders, input));
        }
        case 'color': return colorInput(value, onChange);
        case 'select': {
            const select = h('select', { class: 'input' }, f.options.map(o => h('option', { value: o.value }, o.label)));
            select.value = value;
            select.addEventListener('change', () => {
                const opt = f.options.find(o => String(o.value) === select.value);
                onChange(opt ? opt.value : select.value);
            });
            return select;
        }
        case 'channel': {
            const select = channelSelect(channels, value, { kinds: f.channelTypes ?? ['text'], none: f.required ? null : (f.noneLabel ?? '— brak —'), placeholder: '— wybierz kanał —' });
            select.addEventListener('change', () => onChange(select.value || null));
            return select;
        }
        case 'channels': {
            const kinds = f.channelTypes ?? ['text'];
            return chipsPicker({
                options: channels.filter(c => kinds.includes(c.type)).map(c => ({ value: c.id, label: `${KIND_ICONS[c.type] ?? '#'} ${c.name}` })),
                values: value ?? [], onChange, max: f.max ?? 25, placeholder: '+ Dodaj kanał…',
            });
        }
        case 'role': {
            const select = roleSelect(roles, value, { none: f.required ? null : (f.noneLabel ?? '— brak —'), placeholder: '— wybierz rolę —', onlyAssignable: Boolean(f.assignable) });
            select.addEventListener('change', () => onChange(select.value || null));
            return select;
        }
        case 'roles':
            return chipsPicker({
                options: roles.filter(r => !f.assignable || canAssign(r)).map(r => ({ value: r.id, label: `@${r.name}`, color: r.color })),
                values: value ?? [], onChange, max: f.max ?? 25, placeholder: '+ Dodaj rolę…',
            });
        case 'tags': return tagsInput(value ?? [], onChange, { max: f.max ?? 100, itemMax: f.itemMax ?? 100, placeholder: f.placeholder });
        case 'message': return messageEditor(value, onChange, { placeholders: f.placeholders });
        case 'list': return listEditor(f, value ?? [], onChange, ctx);
        default: return h('div', { class: 'faint' }, `(nieobsługiwany typ pola: ${f.type})`);
    }
}

function card(icon, title, subtitle, ...body) {
    return h('section', { class: 'card' },
        h('div', { class: 'card-head' },
            h('div', { class: 'ico' }, icon),
            h('div', null, h('h3', null, title), subtitle && h('p', null, subtitle))),
        h('div', { class: 'stack' }, ...body));
}

// Formularz ustawień modułu z paskiem „Zapisz zmiany”. Zwraca element.
function settingsForm(mod, guildId, ctx) {
    const fields = (mod.settings ?? []).filter(f => !f.hidden);
    if (!fields.length) return null;
    let original = clone(ctx.config());
    const draft = clone(original);

    const saveBtn = h('button', { class: 'btn btn-primary' }, 'Zapisz zmiany');
    const undoBtn = h('button', { class: 'btn btn-ghost' }, 'Cofnij');
    const bar = h('div', { class: 'save-bar' }, h('span', null, 'Masz niezapisane zmiany'), undoBtn, saveBtn);
    document.body.append(bar);
    onLeave(() => bar.remove());

    const changed = () => fields.map(f => f.key).filter(k => !same(draft[k], original[k]));
    const wrappers = new Map();
    const visible = f => !f.showIf || (f.showIf.truthy ? Boolean(draft[f.showIf.key]) : same(draft[f.showIf.key], f.showIf.equals));
    const update = () => {
        bar.classList.toggle('show', changed().length > 0);
        for (const f of fields) {
            const wrap = wrappers.get(f.key);
            if (wrap) wrap.hidden = !visible(f);
        }
    };

    const form = h('div', { class: 'stack' });
    function draw() {
        wrappers.clear();
        const groups = new Map();
        for (const f of fields) {
            const group = f.group ?? 'Ustawienia';
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group).push(f);
        }
        const cards = [];
        for (const [group, list] of groups) {
            const rows = [];
            for (let i = 0; i < list.length; i++) {
                const f = list[i];
                const el = field(f.label, renderControl(f, draft[f.key], v => { draft[f.key] = v; update(); }, ctx), f.hint);
                el.classList.add(`ft-${f.type}`);
                wrappers.set(f.key, el);
                // dwa pola "half" obok siebie
                if (f.half && list[i + 1]?.half) {
                    const next = list[++i];
                    const el2 = field(next.label, renderControl(next, draft[next.key], v => { draft[next.key] = v; update(); }, ctx), next.hint);
                    el2.classList.add(`ft-${next.type}`);
                    wrappers.set(next.key, el2);
                    rows.push(h('div', { class: 'grid-2' }, el, el2));
                } else rows.push(el);
            }
            cards.push(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, group)), h('div', { class: 'stack' }, rows)));
        }
        form.replaceChildren(...cards);
        update();
    }

    undoBtn.addEventListener('click', () => {
        for (const k of Object.keys(draft)) draft[k] = clone(original[k]);
        draw();
    });
    saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
        const body = Object.fromEntries(changed().map(k => [k, draft[k]]));
        const config = await ctx.saveConfig(body);
        original = clone(config);
        for (const k of Object.keys(config)) draft[k] = clone(config[k]);
        draw();
        toast('Zapisano ustawienia ✓');
    }));

    draw();
    return form;
}

// ---------------------------------------------------------------- topbar

// Serwer wsparcia bota
const SUPPORT_URL = 'https://discord.gg/jnuM7PcSRx';

function renderTopbar(active) {
    const right = h('div', { class: 'topbar-right' });
    const nav = h('nav', { class: 'nav' });

    if (state.me) {
        nav.append(h('a', { href: '#/', class: active === 'servers' ? 'active' : '' }, 'Serwery'));
        if (state.me.isOwner) nav.append(h('a', { href: '#/bot', class: active === 'bot' ? 'active' : '' }, 'Bot'));
        nav.append(h('a', { href: SUPPORT_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Wsparcie'));

        right.append(
            h('span', { class: 'pill ping', title: 'Opóźnienie bota' }, h('span', { class: 'dot' }), h('span', { class: 'ping-label' }, 'online'), `${state.me.bot.ping} ms`),
            h('span', { class: 'user-chip' },
                h('img', { src: avatarUrl(state.me.user.id, state.me.user.avatar), alt: '' }),
                h('span', null, state.me.user.username)),
            h('button', {
                class: 'btn btn-ghost btn-sm',
                onclick: async () => {
                    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
                    storage.set(TOKEN_KEY, null);
                    Object.assign(state, { me: null, guilds: null, guild: null, meta: null });
                    location.hash = '#/';
                    route();
                },
            }, 'Wyloguj'),
        );
    } else if (state.config) {
        // Na stronie głównej: przewijanie do sekcji (bez zmiany #, którego używa router)
        nav.append(
            h('button', { class: 'active', 'data-section': 'start', onclick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) }, 'Start'),
            h('button', { 'data-section': 'funkcje', onclick: () => document.getElementById('funkcje')?.scrollIntoView({ behavior: 'smooth' }) }, 'Funkcje'),
            h('a', { class: 'nav-hide-sm', href: inviteUrl(), target: '_blank', rel: 'noopener noreferrer' }, 'Dodaj bota'),
            h('a', { href: SUPPORT_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Wsparcie'));
        right.append(h('a', { class: 'login-chip', href: state.config.loginUrl }, discordIcon(), 'Zaloguj'));
    }

    $('#topbar').replaceChildren(
        h('a', { class: 'logo', href: '#/' }, h('span', { class: 'logo-mark' }), 'kropka'),
        nav,
        right,
    );
}

// ---------------------------------------------------------------- landing

// Kreska w menu pod sekcją, którą właśnie widać (Start / Funkcje)
function updateLandingNav() {
    const features = document.getElementById('funkcje');
    if (!features) return;
    const current = features.getBoundingClientRect().top < window.innerHeight * 0.5 ? 'funkcje' : 'start';
    for (const b of document.querySelectorAll('.nav [data-section]')) b.classList.toggle('active', b.dataset.section === current);
}
window.addEventListener('scroll', updateLandingNav, { passive: true });

function renderLanding(main) {
    renderTopbar();
    const invite = { href: inviteUrl(), target: '_blank', rel: 'noopener noreferrer' };
    const features = [
        ['⭐', 'Poziomy i ekonomia', 'XP za aktywność, nagrody w rolach, waluta, sklep, praca i kasyno.'],
        ['🛡️', 'Moderacja', 'Kary, ostrzeżenia z progami, automod, logi i zgłoszenia (tickety).'],
        ['🎵', 'Muzyka', 'YouTube, playlisty i SoundCloud. Kolejka, pętla, głośność - też z panelu.'],
        ['🎉', 'Konkursy i zabawa', 'Giveawaye, ankiety, przypomnienia, gry i obrazki.'],
        ['⚙️', 'Wszystko per serwer', 'Każdy moduł włączasz i ustawiasz osobno dla swojego serwera.'],
    ];

    // Makiety kart panelu wystające zza dolnej krawędzi - zachęta do przewinięcia
    const mockSwitch = on => h('span', { class: `mock-switch ${on ? 'on' : ''}` });
    const teaser = h('div', { class: 'hero-teaser', 'aria-hidden': 'true', onclick: () => document.querySelector('.landing-section')?.scrollIntoView({ behavior: 'smooth' }) },
        h('div', { class: 'mock-card side left' },
            h('div', { class: 'mock-head' }, h('span', { class: 'mock-dot' }), 'Moduły'),
            [['⭐ Poziomy', true], ['🛡️ Automod', true], ['🎵 Muzyka', false], ['🎉 Konkursy', true]].map(([name, on]) =>
                h('div', { class: 'mock-row' }, h('span', null, name), mockSwitch(on)))),
        h('div', { class: 'mock-card main' },
            h('div', { class: 'mock-head' }, h('span', { class: 'mock-dot' }), 'Panel serwera'),
            h('div', { class: 'mock-stats' },
                h('div', null, h('b', null, '1 284'), h('span', null, 'członków')),
                h('div', null, h('b', null, '27'), h('span', null, 'modułów')),
                h('div', null, h('b', null, '42 ms'), h('span', null, 'ping'))),
            h('div', { class: 'mock-bars' }, [38, 62, 45, 80, 56, 92, 70, 84].map(v => h('span', { style: { '--v': `${v}%` } })))),
        h('div', { class: 'mock-card side right' },
            h('div', { class: 'mock-head' }, h('span', { class: 'mock-dot' }), 'Poziomy'),
            h('div', { class: 'mock-level' },
                h('span', { class: 'mock-avatar' }),
                h('div', null, h('b', null, 'Poziom 12'), h('div', { class: 'mock-progress' }, h('span', null)))),
            h('div', { class: 'mock-line' }), h('div', { class: 'mock-line short' })));

    const hero = h('section', { class: 'hero' },
        h('div', { class: 'hero-nebula', 'aria-hidden': 'true' }),
        h('div', { class: 'hero-beams', 'aria-hidden': 'true' }),
        h('div', { class: 'hero-grid', 'aria-hidden': 'true' }),
        h('div', { class: 'hero-ring r1', 'aria-hidden': 'true' }),
        h('div', { class: 'hero-ring r2', 'aria-hidden': 'true' }),
        h('div', { class: 'hero-ring r3', 'aria-hidden': 'true' }),
        h('div', { class: 'hero-inner' },
            h('div', { class: 'hero-eyebrow' }, 'To jest'),
            h('h1', { class: 'hero-title' },
                h('span', { class: 'hero-word' }, 'Kropka'),
                h('span', { class: 'hero-dot', 'aria-hidden': 'true' })),
            h('p', null, 'Bot do wszystkiego: poziomy, ekonomia, moderacja, muzyka i konkursy - a to jego panel. Zaproś go i ustaw wszystko bez wpisywania komend.'),
            h('div', { class: 'hero-actions' },
                h('a', { class: 'btn btn-lg btn-gradient', href: state.config.loginUrl }, discordIcon(), 'Zaloguj przez Discord'),
                h('a', { class: 'btn btn-lg btn-glass', ...invite }, '+ Dodaj bota'))),
        teaser);
    const heroImage = window.KROPKA_CONFIG?.heroImage;
    if (heroImage) hero.style.setProperty('--hero-img', `url(${JSON.stringify(String(heroImage))})`);

    main.replaceChildren(
        hero,
        h('section', { class: 'landing-section' }, h('div', { class: 'wrap offer' },
            h('div', { class: 'offer-card' },
                h('span', { class: 'kicker' }, 'Dla adminów serwerów'),
                h('h2', null, 'Wszystko w jednym ', h('span', { class: 'pink neon' }, 'panelu')),
                h('p', null, 'Logujesz się przez Discorda i widzisz tylko serwery, którymi zarządzasz. Zmiany od razu trafiają do bota.'),
                h('ul', { class: 'checklist' },
                    h('li', null, 'Kilkanaście modułów - każdy włączasz osobno'),
                    h('li', null, 'Formularze zamiast komend, z podglądem wiadomości na żywo'),
                    h('li', null, 'Muzyka z kolejką, pętlą i głośnością - też z przeglądarki'),
                    h('li', null, 'Żadnych tokenów w przeglądarce - sekrety zostają przy bocie'))),
            h('div', { class: 'offer-art' }, h('span', { class: 'offer-dot', role: 'img', 'aria-label': state.config.botName })))),
        h('section', { class: 'landing-section', id: 'funkcje' }, h('div', { class: 'wrap' },
            h('h2', { class: 'section-title' }, 'Funkcje'),
            h('div', { class: 'features' }, features.map(([ico, title, text]) =>
                h('div', { class: 'feature' }, h('div', { class: 'feature-ico' }, ico), h('h3', null, title), h('p', null, text)))),
            h('div', { class: 'cta-band' },
                h('div', { class: 'ico' }, '🚀'),
                h('div', null,
                    h('h3', null, 'Dodaj Kropkę na swój serwer'),
                    h('p', null, 'Jedno kliknięcie, a potem wszystko ustawisz tutaj.')),
                h('div', { class: 'spacer' }),
                h('a', { class: 'btn btn-gradient', ...invite }, '+ Dodaj bota')))),
    );
}

// ---------------------------------------------------------------- lista serwerów

async function renderGuildList(main, refresh = false) {
    renderTopbar('servers');
    main.replaceChildren(loading());
    try {
        if (!state.guilds || refresh) state.guilds = await api(`/api/guilds${refresh ? '?refresh' : ''}`);
    } catch (err) {
        main.replaceChildren(h('div', { class: 'center-state' }, h('div', { class: 'error-box' }, err.message)));
        return;
    }

    const withBot = state.guilds.filter(g => g.botPresent);
    const refreshBtn = h('button', { class: 'btn btn-sm btn-glass', onclick: () => renderGuildList(main, true) }, '↻ Odśwież');

    main.replaceChildren(
        h('div', { class: 'page-hero' },
            h('span', { class: 'kicker' }, `Cześć, ${state.me.user.username}`),
            h('h1', { class: 'section-title' }, 'Twoje serwery'),
            h('p', null, `Serwery, którymi zarządzasz. Bot jest na ${withBot.length} z ${state.guilds.length}.`),
            h('div', { class: 'row' }, refreshBtn)),
        state.guilds.length === 0
            ? h('div', { class: 'card empty' }, h('div', { class: 'big' }, '🫥'),
                'Nie zarządzasz żadnym serwerem (potrzebne uprawnienie „Zarządzanie serwerem”).')
            : h('div', { class: 'guild-grid' }, state.guilds.map(g => h('div', { class: `guild-card ${g.botPresent ? '' : 'inactive'}` },
                h('div', { class: 'guild-card-art' },
                    guildIconUrl(g) && h('img', { class: 'blur', src: guildIconUrl(g), alt: '' }),
                    guildIcon(g, 'lg'),
                    h('span', { class: `ribbon ${g.botPresent ? '' : 'off'}` }, h('span', { class: 'ribbon-dot' }), g.botPresent ? 'Aktywny' : 'Brak bota')),
                h('div', { class: 'guild-card-body' },
                    h('div', { class: 'name', title: g.name }, g.name),
                    h('div', { class: 'sub' }, g.botPresent ? 'Bot jest na serwerze' : 'Dodaj bota, żeby nim zarządzać'),
                    g.botPresent
                        ? h('a', { class: 'btn btn-gradient btn-sm', href: `#/g/${g.id}` }, 'Zarządzaj ▸')
                        : h('a', {
                            class: 'btn btn-sm btn-outline',
                            href: inviteUrl(g.id),
                            target: '_blank',
                            rel: 'noopener noreferrer',
                            onclick: () => setTimeout(() => toast('Po dodaniu bota kliknij „Odśwież”.'), 500),
                        }, '+ Dodaj bota'))))),
    );
}

// ---------------------------------------------------------------- serwer

async function loadMeta() {
    if (!state.meta) state.meta = await api('/api/modules');
    return state.meta;
}

async function loadGuild(id, force = false) {
    if (!force && state.guild?.id === id && Date.now() - state.guild.loadedAt < 60_000) return state.guild.data;
    const data = await api(`/api/guilds/${encodeURIComponent(id)}`);
    state.guild = { id, data, loadedAt: Date.now() };
    return data;
}

const moduleOn = (mod, data) => mod.alwaysEnabled || Boolean(data.modules[mod.name]?.enabled);

function sidebar(data, guildId, active) {
    const links = [];
    for (const [catKey, catLabel] of Object.entries(state.meta.categories)) {
        const mods = state.meta.modules.filter(m => m.category === catKey).sort((a, b) => a.label.localeCompare(b.label, 'pl'));
        if (!mods.length) continue;
        links.push(h('div', { class: 'sidebar-cat' }, catLabel));
        for (const m of mods) {
            links.push(h('a', { href: `#/g/${guildId}/m/${m.name}`, class: active === m.name ? 'active' : '' },
                h('span', { class: 'sb-ico' }, m.icon),
                h('span', { class: 'sb-label' }, m.label),
                h('span', { class: `sb-dot ${moduleOn(m, data) ? 'on' : ''}`, 'data-module': m.name, title: moduleOn(m, data) ? 'Włączony' : 'Wyłączony' })));
        }
    }
    return h('aside', { class: 'sidebar' },
        h('div', { class: 'sidebar-head' }, guildIcon(data.guild, 'sm'), h('div', { class: 'name' }, data.guild.name)),
        h('a', { href: `#/g/${guildId}`, class: active === 'overview' ? 'active' : '' }, h('span', { class: 'sb-ico' }, '📊'), h('span', { class: 'sb-label' }, 'Przegląd')),
        links,
        h('div', { class: 'sep' }),
        h('a', { href: '#/' }, h('span', { class: 'sb-ico' }, '←'), h('span', { class: 'sb-label' }, 'Wszystkie serwery')));
}

// Stare adresy zakładek (sprzed modułów)
const LEGACY_TABS = { przeglad: '', ustawienia: '', rola: 'm/selfroles', wiadomosc: 'm/embeds', muzyka: 'm/music' };

async function renderGuild(main, id, section, moduleName) {
    renderTopbar('servers');
    if (!/^\d{5,25}$/.test(id)) return renderGuildList(main);
    if (section && section !== 'm' && LEGACY_TABS[section] !== undefined) {
        location.replace(`#/g/${id}${LEGACY_TABS[section] ? `/${LEGACY_TABS[section]}` : ''}`);
        return;
    }

    if (state.guild?.id !== id) main.replaceChildren(loading());
    let data;
    try {
        await loadMeta();
        data = await loadGuild(id);
    } catch (err) {
        main.replaceChildren(h('div', { class: 'center-state' },
            h('div', { class: 'error-box' }, err.message),
            h('a', { class: 'btn', href: '#/' }, '← Wróć do serwerów')));
        return;
    }

    const mod = section === 'm' ? state.meta.modules.find(m => m.name === moduleName) : null;
    const content = h('div', { class: 'content' });
    main.replaceChildren(h('div', { class: 'guild-layout' }, sidebar(data, id, mod ? mod.name : 'overview'), content));
    // Na telefonie menu jest przewijanym paskiem - pokaż aktywną pozycję
    main.querySelector('.sidebar a.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });

    if (mod) await renderModulePage(content, data, id, mod);
    else renderOverview(content, data, id);
}

function contentHead(kicker, title, subtitle, ...actions) {
    return h('div', { class: 'page-head', style: { 'margin-bottom': '4px' } },
        h('div', { class: 'content-head' },
            kicker && h('span', { class: 'kicker' }, kicker),
            h('h2', { class: 'title-bar' }, title),
            subtitle && h('p', null, subtitle)),
        h('div', { class: 'spacer' }),
        actions);
}

// ---- przegląd

function renderOverview(content, data, id) {
    const { guild, channels, roles } = data;
    const active = state.meta.modules.filter(m => !m.alwaysEnabled && moduleOn(m, data)).length;
    const total = state.meta.modules.filter(m => !m.alwaysEnabled).length;

    content.append(
        contentHead('Przegląd', guild.name, 'Moduły bota na tym serwerze - kliknij, żeby ustawić.'),
        h('div', { class: 'stats' },
            stat('Członkowie', guild.memberCount.toLocaleString('pl-PL')),
            stat('Kanały', channels.filter(c => c.type !== 'category').length),
            stat('Role', roles.length),
            stat('Aktywne moduły', `${active} / ${total}`)),
        ...Object.entries(state.meta.categories).map(([catKey, catLabel]) => {
            const mods = state.meta.modules.filter(m => m.category === catKey).sort((a, b) => a.label.localeCompare(b.label, 'pl'));
            if (!mods.length) return null;
            return h('section', { class: 'stack' },
                h('h3', { class: 'cat-title' }, catLabel),
                h('div', { class: 'mod-grid' }, mods.map(m => h('a', { class: `mod-card ${moduleOn(m, data) ? 'on' : ''}`, href: `#/g/${id}/m/${m.name}` },
                    h('div', { class: 'mod-card-top' },
                        h('span', { class: 'mod-ico' }, m.icon),
                        h('span', { class: `badge ${moduleOn(m, data) ? 'on' : 'off'}` }, m.alwaysEnabled ? 'zawsze' : moduleOn(m, data) ? 'włączony' : 'wyłączony')),
                    h('b', null, m.label),
                    h('span', null, m.description)))));
        }).filter(Boolean),
    );
}

const stat = (label, value, small) =>
    h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: `value ${small ? 'small' : ''}` }, value));

// ---- strona modułu

const loadedScripts = new Map();
function loadPanelScript(file) {
    if (!/^[\w-]+\.js$/.test(file)) return Promise.reject(new Error('Zła nazwa pliku modułu.'));
    if (!loadedScripts.has(file)) {
        loadedScripts.set(file, new Promise((resolve, reject) => {
            const s = h('script', { src: `modules/${file}` });
            s.onload = resolve;
            s.onerror = () => {
                loadedScripts.delete(file);
                reject(new Error(`Nie udało się wczytać modules/${file}`));
            };
            document.head.append(s);
        }));
    }
    return loadedScripts.get(file);
}

function moduleCtx(mod, data, guildId) {
    return {
        guildId,
        guild: data.guild,
        channels: data.channels,
        roles: data.roles,
        meta: mod,
        isBotOwner: Boolean(state.me?.isOwner),
        config: () => state.guild.data.modules[mod.name],
        // trasy modułu: /api/guilds/:id/m/<moduł><path>
        api: (path = '', opts) => api(`/api/guilds/${guildId}/m/${mod.name}${path}`, opts),
        coreApi: api,
        onLeave,
        refresh: () => route(),
        async saveConfig(changes) {
            const res = await api(`/api/guilds/${guildId}/modules/${mod.name}`, { method: 'PUT', body: changes });
            state.guild.data.modules[mod.name] = res.config;
            return res.config;
        },
    };
}

async function renderModulePage(content, data, guildId, mod) {
    const ctx = moduleCtx(mod, data, guildId);
    const config = ctx.config();

    const offBanner = h('div', { class: 'off-banner' }, h('span', { class: 'banner-ico', 'aria-hidden': 'true' }, '⛔'),
        'Moduł jest wyłączony na tym serwerze - ustawienia możesz zmieniać, ale bot ich nie używa, dopóki go nie włączysz.');
    offBanner.hidden = mod.alwaysEnabled || config.enabled;

    const toggle = mod.alwaysEnabled ? null : switchInput(Boolean(config.enabled), async on => {
        try {
            await ctx.saveConfig({ enabled: on });
            offBanner.hidden = on;
            const dot = document.querySelector(`.sb-dot[data-module="${mod.name}"]`);
            dot?.classList.toggle('on', on);
            toast(on ? `Włączono moduł ${mod.label} ✓` : `Wyłączono moduł ${mod.label}`);
        } catch (err) {
            toast(err.message, 'error');
            route();
        }
    }, config.enabled ? 'Włączony' : 'Wyłączony');
    // podpis przełącznika nadąża za stanem
    toggle?.querySelector('input').addEventListener('change', e => {
        toggle.querySelector('.switch-label').textContent = e.target.checked ? 'Włączony' : 'Wyłączony';
    });

    content.append(
        h('div', { class: 'module-head' },
            h('div', { class: 'module-ico' }, mod.icon),
            h('div', { class: 'content-head' },
                h('span', { class: 'kicker' }, state.meta.categories[mod.category]),
                h('h2', { class: 'title-bar' }, mod.label),
                h('p', null, mod.description),
                mod.commands.length ? h('p', { class: 'cmd-list' }, 'Komendy: ', mod.commands.map(c => h('code', null, `/${c}`))) : null),
            h('div', { class: 'spacer' }),
            toggle),
        offBanner,
    );

    const form = settingsForm(mod, guildId, ctx);
    if (form) content.append(form);

    if (mod.panel) {
        const custom = h('div', { class: 'stack module-custom' }, loading());
        content.append(custom);
        try {
            await loadPanelScript(mod.panel);
            const def = panelModules.get(mod.name);
            custom.replaceChildren();
            if (def?.render) await def.render(custom, ctx);
        } catch (err) {
            custom.replaceChildren(h('div', { class: 'error-box' }, err.message));
        }
    }
}

// ---------------------------------------------------------------- bot (właściciel)

async function renderBot(main, tab) {
    renderTopbar('bot');
    await loadMeta().catch(() => null);
    const hasPokemon = state.meta?.modules.some(m => m.name === 'pokemon');
    // Statusy zmienia się tylko komendą /status (właściciel), nie przez panel
    const tabs = [hasPokemon && ['eventy', '📅', 'Eventy Pokémon GO']].filter(Boolean);
    if (!tabs.some(([k]) => k === tab)) tab = 'eventy';
    const content = h('div', { class: 'content' }, loading());

    main.replaceChildren(h('div', { class: 'guild-layout' },
        h('aside', { class: 'sidebar' },
            h('div', { class: 'sidebar-head' },
                h('img', { class: 'gicon sm', src: avatarUrl(state.config.clientId, state.config.botAvatar), alt: '' }),
                h('div', { class: 'name' }, state.config.botName)),
            tabs.map(([key, ico, label]) => h('a', { href: `#/bot/${key}`, class: key === tab ? 'active' : '' }, h('span', { class: 'sb-ico' }, ico), h('span', { class: 'sb-label' }, label)))),
        content));

    try {
        if (hasPokemon) await renderEvents(content);
        else content.replaceChildren(h('div', { class: 'empty' }, 'Nie ma tu nic do ustawienia.'));
    } catch (err) {
        content.replaceChildren(h('div', { class: 'error-box' }, err.message));
    }
}

async function renderEvents(content) {
    const { events } = await api('/api/bot/m/pokemon/events');
    let list = events.map(e => ({ ...e }));
    const table = h('div', { class: 'events-table' });
    const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD

    function draw() {
        const cell = (ev, key, props = {}) =>
            h('input', { class: 'input', value: ev[key] ?? '', oninput: e => { ev[key] = e.target.value; }, ...props });
        table.replaceChildren(
            h('div', { class: 'event-row event-head' }, h('span', null, 'Typ'), h('span', null, 'Data'), h('span', null, 'Pokémon'), h('span', null, 'Atak'), h('span', null, 'Godziny'), h('span')),
            ...list.map((ev, i) => h('div', { class: `event-row ${ev.date && ev.date < today ? 'past' : ''}` },
                cell(ev, 'type', { placeholder: 'Community Day' }),
                cell(ev, 'date', { type: 'date' }),
                cell(ev, 'pokemon', { placeholder: 'Pokémon' }),
                cell(ev, 'move', { placeholder: 'Specjalny atak' }),
                cell(ev, 'time', { placeholder: '14:00-17:00' }),
                h('button', { class: 'btn btn-icon btn-danger', title: 'Usuń', onclick: () => { list.splice(i, 1); draw(); } }, '✕'))),
        );
        if (list.length === 0) table.append(h('div', { class: 'empty' }, 'Brak eventów.'));
    }
    draw();

    const saveBtn = h('button', { class: 'btn btn-primary' }, 'Zapisz');
    saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
        const res = await api('/api/bot/m/pokemon/events', { method: 'PUT', body: { events: list } });
        list = res.events.sort((a, b) => a.date.localeCompare(b.date));
        draw();
        toast('Zapisano eventy ✓');
    }));

    content.replaceChildren(
        contentHead(state.config.botName, 'Eventy Pokémon GO', 'Wspólna lista dla wszystkich serwerów - ogłoszenia idą na kanały z ustawień modułu Pokémon GO.'),
        card('📅', 'Lista eventów', 'To samo co /events, /eventsadd i /eventsremove. Wyszarzone już minęły.',
            table,
            h('div', { class: 'row' },
                h('button', { class: 'btn btn-add', onclick: () => { list.push({ type: 'Community Day', date: '', pokemon: '', move: '', time: '14:00-17:00' }); draw(); } }, '+ Dodaj event'),
                h('div', { style: { flex: '1' } }),
                saveBtn)),
    );
}

// ---------------------------------------------------------------- router

function route() {
    cleanups.forEach(fn => fn());
    cleanups = [];
    window.scrollTo(0, 0);

    const main = $('#app');
    const [section, id, sub, name] = location.hash.replace(/^#\/?/, '').split('/');

    // Strona główna idzie na całą szerokość ekranu, reszta w środkowej kolumnie
    main.className = state.me ? 'container' : 'landing';
    if (!state.me) return renderLanding(main);
    if (section === 'g' && id) return renderGuild(main, id, sub, name);
    if (section === 'bot' && state.me.isOwner) return renderBot(main, id);
    return renderGuildList(main);
}

function renderFatal(message) {
    renderTopbar();
    $('#app').className = 'container';
    $('#app').replaceChildren(h('div', { class: 'center-state' }, h('div', { class: 'error-box' },
        h('h3', null, 'Nie mogę połączyć się z botem'),
        h('p', null, message),
        h('p', { class: 'muted' }, 'Adres API: ', h('code', null, API || '(brak - ustaw apiUrl w config.js)')),
        h('button', { class: 'btn', onclick: () => location.reload() }, 'Spróbuj ponownie'))));
}

async function boot() {
    initDropdowns();
    document.body.prepend(h('div', { class: 'page-fx', 'aria-hidden': 'true' },
        h('div', { class: 'hero-nebula' }), h('div', { class: 'hero-beams' }), h('div', { class: 'hero-grid' })));
    // GitHub Pages nie wysyła nagłówka przeciw ramkom - panel nie działa osadzony w cudzej stronie (clickjacking)
    if (window.top !== window.self) {
        document.body.replaceChildren(h('p', { style: { padding: '20px' } }, 'Panel Kropki otwórz bezpośrednio: ', h('a', { href: location.href, target: '_top', rel: 'noopener' }, location.host)));
        return;
    }
    // Powrót z logowania przez Discord: #login=<jednorazowy kod> albo #login_error=<powód>
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has('login') || params.has('login_error')) {
        history.replaceState(null, '', location.pathname + location.search);
        if (params.has('login')) {
            try {
                const { token } = await api('/api/auth/exchange', { method: 'POST', body: { code: params.get('login') } });
                storage.set(TOKEN_KEY, token);
            } catch (err) {
                toast(err.message, 'error');
            }
        } else {
            toast(params.get('login_error') === 'cancelled' ? 'Anulowano logowanie.' : 'Logowanie nie powiodło się, spróbuj jeszcze raz.', 'error');
        }
    }

    try {
        state.config = await api('/api/config');
    } catch (err) {
        return renderFatal(err.message);
    }
    if (storage.get(TOKEN_KEY)) {
        try {
            state.me = await api('/api/me');
        } catch { /* sesja wygasła - pokażemy stronę logowania */ }
    }

    window.addEventListener('hashchange', route);
    route();
}

// API dla skryptów modułów (panel/modules/*.js)
window.KropkaPanel = {
    register(name, def) { panelModules.set(name, def); },
    h, api, toast, busy, loading, field, card, contentHead,
    channelSelect, roleSelect, canAssign, numberInput, colorInput, withCounter, switchInput,
    chipsPicker, tagsInput, placeholderChips, messageEditor, discordMessage, renderControl,
    extLink, safeUrl, formatDuration, avatarUrl, clone,
    get state() { return state; },
};

boot();
