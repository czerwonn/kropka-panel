'use strict';
// Kreator wiadomości (moduł "embeds"): treść + do 3 embedów + przyciski z linkami, podgląd na żywo,
// wysyłanie jako bot, edycja wiadomości bota z linku i szablony zapisane na serwerze.
(() => {
    const { h, toast, busy, field, card, channelSelect, colorInput, withCounter, switchInput, discordMessage, extLink, safeUrl, clone } = window.KropkaPanel;

    const LIMITS = { content: 2000, embeds: 3, title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256, total: 6000, buttons: 5 };
    // Panel może wyświetlać obrazki tylko z tego hosta (CSP) - inne pokazujemy jako zaślepkę
    const PREVIEW_HOSTS = ['cdn.discordapp.com'];

    const str = v => (typeof v === 'string' ? v : '');
    const emptyEmbed = color => ({
        author: { name: '', iconUrl: '', url: '' }, title: '', url: '', description: '', color: color ?? '',
        fields: [], image: '', thumbnail: '', footer: { text: '', iconUrl: '' }, timestamp: false,
    });

    // Dane z localStorage/szablonu/linku -> pełny, bezpieczny stan kreatora
    function normalize(raw) {
        const s = raw && typeof raw === 'object' ? raw : {};
        return {
            content: str(s.content),
            embeds: (Array.isArray(s.embeds) ? s.embeds : []).slice(0, LIMITS.embeds).map(e => {
                const x = e && typeof e === 'object' ? e : {};
                return {
                    author: { name: str(x.author?.name), iconUrl: str(x.author?.iconUrl), url: str(x.author?.url) },
                    title: str(x.title), url: str(x.url), description: str(x.description), color: str(x.color),
                    fields: (Array.isArray(x.fields) ? x.fields : []).slice(0, LIMITS.fields)
                        .map(f => ({ name: str(f?.name), value: str(f?.value), inline: f?.inline === true })),
                    image: str(x.image), thumbnail: str(x.thumbnail),
                    footer: { text: str(x.footer?.text), iconUrl: str(x.footer?.iconUrl) },
                    timestamp: x.timestamp === true,
                };
            }),
            buttons: (Array.isArray(s.buttons) ? s.buttons : []).slice(0, LIMITS.buttons)
                .map(b => ({ label: str(b?.label), url: str(b?.url), emoji: str(b?.emoji) })),
        };
    }

    const embedChars = e => e.title.trim().length + e.description.trim().length + e.footer.text.trim().length + e.author.name.trim().length
        + e.fields.reduce((sum, f) => sum + f.name.trim().length + f.value.trim().length, 0);
    const isEmpty = s => !s.content.trim() && s.embeds.every(e => embedChars(e) === 0 && !e.image && !e.thumbnail) && s.buttons.length === 0;

    const storage = {
        get(key) { try { return localStorage.getItem(key); } catch { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); } catch { /* prywatne okno */ } },
    };

    function previewable(url) {
        try {
            const u = new URL(url);
            return u.protocol === 'https:' && PREVIEW_HOSTS.includes(u.hostname);
        } catch {
            return false;
        }
    }

    // Obrazek w podglądzie albo zaślepka (np. dla i.imgur.com - na Discordzie i tak się pokaże)
    function imageView(url, style, big = false) {
        if (previewable(url)) return h('img', { src: url, alt: '', style });
        let host = '';
        try { host = new URL(url).hostname; } catch { /* zły adres */ }
        return h('div', {
            title: url,
            style: {
                ...style, display: 'grid', 'place-items': 'center', background: '#1e1f22', color: '#949ba4',
                'font-size': big ? '13px' : '11px', 'text-align': 'center', overflow: 'hidden', ...(big ? { height: '120px', padding: '8px' } : {}),
            },
        }, big ? `🖼 Obrazek z ${host || 'linku'} - w panelu bez podglądu, na Discordzie się pokaże` : '🖼');
    }

    window.KropkaPanel.register('embeds', {
        async render(container, ctx) {
            const draftKey = `kropka_embed_draft_${ctx.guildId}`;
            const defaultColor = () => ctx.config().defaultColor || '#FF2D87';
            let state;
            try {
                state = normalize(JSON.parse(storage.get(draftKey) ?? 'null'));
            } catch {
                state = null;
            }
            if (!state || (isEmpty(state) && state.embeds.length === 0)) state = normalize({ embeds: [emptyEmbed(defaultColor())] });

            let templates = [];
            try {
                templates = (await ctx.api('/templates')).templates;
            } catch (err) {
                toast(err.message, 'error');
            }

            // ---------- zapis szkicu i podgląd ----------
            let persistTimer = null;
            const persist = () => {
                clearTimeout(persistTimer);
                persistTimer = setTimeout(() => storage.set(draftKey, JSON.stringify(state)), 400);
            };
            ctx.onLeave(() => {
                clearTimeout(persistTimer);
                storage.set(draftKey, JSON.stringify(state));
            });

            const previewBody = h('div', { class: 'dc-preview-body' });
            const totalCounter = h('div', { class: 'counter' });

            function fieldsGrid(fields) {
                // Discord: do 3 pól "w linii" obok siebie, zwykłe pole zajmuje cały wiersz
                return h('div', { style: { display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', gap: '8px 16px', 'margin-top': '8px' } },
                    fields.map(f => h('div', { style: { 'grid-column': f.inline ? 'auto' : '1 / -1', 'min-width': '0' } },
                        h('div', { style: { 'font-size': '14px', 'font-weight': '600', color: '#f2f3f5', 'margin-bottom': '2px', 'overflow-wrap': 'anywhere' } }, f.name || '​'),
                        h('div', { class: 'dc-embed-desc' }, f.value || '​'))));
            }

            function embedPreview(e) {
                const color = /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : '#202225';
                const empty = embedChars(e) === 0 && !e.image && !e.thumbnail;
                const time = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
                const main = h('div', { style: { 'min-width': '0', flex: '1' } },
                    e.author.name ? h('div', { style: { display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '14px', 'font-weight': '600', color: '#f2f3f5', 'margin-bottom': '6px' } },
                        e.author.iconUrl ? imageView(e.author.iconUrl, { width: '24px', height: '24px', 'border-radius': '50%', 'flex-shrink': '0' }) : null,
                        h('span', { style: e.author.url ? { 'text-decoration': 'underline' } : null }, e.author.name)) : null,
                    e.title ? h('div', { class: 'dc-embed-title', style: e.url ? { color: '#00a8fc' } : null }, e.title) : null,
                    e.description ? h('div', { class: 'dc-embed-desc' }, e.description) : null,
                    e.fields.length ? fieldsGrid(e.fields) : null,
                    empty ? h('div', { class: 'dc-embed-desc faint' }, '(pusty embed - wpisz tytuł albo opis)') : null);
                return h('div', { class: 'dc-embed', style: { '--embed-color': color } },
                    h('div', { style: { display: 'flex', gap: '16px', 'align-items': 'flex-start' } },
                        main,
                        e.thumbnail ? imageView(e.thumbnail, { width: '80px', height: '80px', 'object-fit': 'cover', 'border-radius': '4px', 'flex-shrink': '0' }) : null),
                    e.image ? h('div', { style: { 'margin-top': '12px' } },
                        imageView(e.image, { width: '100%', 'max-height': '300px', 'object-fit': 'cover', 'border-radius': '4px' }, true)) : null,
                    (e.footer.text || e.timestamp) ? h('div', { class: 'dc-embed-footer', style: { display: 'flex', 'align-items': 'center', gap: '8px' } },
                        e.footer.iconUrl && e.footer.text ? imageView(e.footer.iconUrl, { width: '20px', height: '20px', 'border-radius': '50%', 'flex-shrink': '0' }) : null,
                        h('span', null, [e.footer.text, e.timestamp ? `Dzisiaj o ${time}` : ''].filter(Boolean).join(' • '))) : null);
            }

            function renderPreview() {
                const parts = [];
                if (state.content) parts.push(h('div', { class: 'dc-text' }, state.content));
                for (const e of state.embeds) parts.push(embedPreview(e));
                if (state.buttons.length) {
                    parts.push(h('div', { style: { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', 'margin-top': '8px' } },
                        state.buttons.map(b => h('span', {
                            class: 'dc-button', style: { 'margin-top': '0', background: '#4e5058', display: 'inline-flex', gap: '6px', 'align-items': 'center' },
                        }, b.emoji || null, b.label || (b.emoji ? null : 'Przycisk'), h('span', { style: { opacity: '0.7' } }, '↗')))));
                }
                if (!parts.length) parts.push(h('div', { class: 'dc-text faint' }, '(pusta wiadomość)'));
                previewBody.replaceChildren(...parts);

                const total = state.embeds.reduce((sum, e) => sum + embedChars(e), 0);
                totalCounter.textContent = `Znaki we wszystkich embedach: ${total} / ${LIMITS.total}`;
                totalCounter.classList.toggle('over', total > LIMITS.total);
            }

            const changed = () => {
                renderPreview();
                persist();
            };

            // ---------- kontrolki ----------
            function input(obj, key, { max, placeholder = '', type = 'text', rows } = {}) {
                const el = h(rows ? 'textarea' : 'input', {
                    class: 'input', value: obj[key] ?? '', maxLength: max, placeholder, rows, type: rows ? null : type,
                });
                el.addEventListener('input', () => {
                    obj[key] = el.value;
                    changed();
                });
                return el;
            }

            const iconBtn = (title, text, onclick, { disabled = false, danger = false } = {}) =>
                h('button', { type: 'button', class: `btn btn-icon ${danger ? 'btn-danger' : 'btn-ghost'}`, title, disabled, onclick }, text);

            const section = (title, open, ...body) => h('details', { open },
                h('summary', { class: 'field-label', style: { cursor: 'pointer', padding: '4px 0' } }, title),
                h('div', { class: 'stack', style: { 'margin-top': '10px' } }, ...body));

            function move(list, i, delta) {
                const j = i + delta;
                if (j < 0 || j >= list.length) return;
                [list[i], list[j]] = [list[j], list[i]];
                drawEditor();
                changed();
            }

            // ---------- edytor ----------
            const contentInput = h('textarea', { class: 'input', rows: 4, placeholder: 'Zwykły tekst nad embedami (opcjonalnie)…' });
            contentInput.addEventListener('input', () => {
                state.content = contentInput.value;
                changed();
            });
            const contentCard = card('💬', 'Treść wiadomości', '@everyone i role zadziałają tylko, jeśli Ty możesz ich użyć na wybranym kanale.',
                withCounter(contentInput, LIMITS.content));

            const embedsBox = h('div', { class: 'stack' });
            const buttonsBox = h('div', { class: 'list-items' });

            function fieldsEditor(e) {
                const box = h('div', { class: 'list-items' });
                box.append(
                    ...e.fields.map((f, j) => h('div', { class: 'list-item' },
                        h('div', { class: 'list-item-fields' },
                            field('Nazwa', input(f, 'name', { max: LIMITS.fieldName })),
                            field('Wartość', withCounter(input(f, 'value', { max: LIMITS.fieldValue, rows: 2 }), LIMITS.fieldValue)),
                            field('W linii', switchInput(f.inline, v => { f.inline = v; changed(); }, 'obok innych'))),
                        h('div', { class: 'list-item-actions' },
                            iconBtn('W górę', '↑', () => move(e.fields, j, -1), { disabled: j === 0 }),
                            iconBtn('W dół', '↓', () => move(e.fields, j, 1), { disabled: j === e.fields.length - 1 }),
                            iconBtn('Usuń pole', '✕', () => { e.fields.splice(j, 1); drawEditor(); changed(); }, { danger: true })))),
                    h('button', {
                        type: 'button', class: 'btn btn-sm', disabled: e.fields.length >= LIMITS.fields,
                        onclick: () => { e.fields.push({ name: '', value: '', inline: false }); drawEditor(); changed(); },
                    }, `+ Dodaj pole (${e.fields.length}/${LIMITS.fields})`));
                return box;
            }

            function embedEditor(e, i) {
                const colorBox = colorInput(e.color || '', v => {
                    e.color = /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : '';
                    changed();
                });
                return card('🧾', `Embed ${i + 1}`, null,
                    h('div', { class: 'row end' },
                        iconBtn('W górę', '↑', () => move(state.embeds, i, -1), { disabled: i === 0 }),
                        iconBtn('W dół', '↓', () => move(state.embeds, i, 1), { disabled: i === state.embeds.length - 1 }),
                        iconBtn('Usuń embed', '✕', () => {
                            if (embedChars(e) > 0 && !confirm(`Usunąć embed ${i + 1}?`)) return;
                            state.embeds.splice(i, 1);
                            drawEditor();
                            changed();
                        }, { danger: true })),
                    h('div', { class: 'grid-2' },
                        field('Tytuł', input(e, 'title', { max: LIMITS.title })),
                        field('Link tytułu', input(e, 'url', { type: 'url', placeholder: 'https://…' }))),
                    field('Opis', withCounter(input(e, 'description', { max: LIMITS.description, rows: 6, placeholder: 'Działa formatowanie Discorda: **pogrubienie**, *kursywa*, [link](https://…)' }), LIMITS.description)),
                    h('div', { class: 'grid-2' },
                        field('Kolor paska', colorBox, 'Wyczyść pole = bez koloru.'),
                        field('Data wysłania w stopce', switchInput(e.timestamp, v => { e.timestamp = v; changed(); }, 'pokaż'))),
                    section('Autor', Boolean(e.author.name),
                        h('div', { class: 'grid-3' },
                            field('Nazwa autora', input(e.author, 'name', { max: LIMITS.author })),
                            field('Ikona (URL)', input(e.author, 'iconUrl', { type: 'url', placeholder: 'https://…' })),
                            field('Link autora', input(e.author, 'url', { type: 'url', placeholder: 'https://…' })))),
                    section(`Pola (${e.fields.length})`, e.fields.length > 0, fieldsEditor(e)),
                    section('Obrazki', Boolean(e.image || e.thumbnail),
                        h('div', { class: 'grid-2' },
                            field('Duży obrazek (URL)', input(e, 'image', { type: 'url', placeholder: 'https://…' })),
                            field('Miniaturka (URL)', input(e, 'thumbnail', { type: 'url', placeholder: 'https://…' })))),
                    section('Stopka', Boolean(e.footer.text),
                        h('div', { class: 'grid-2' },
                            field('Tekst stopki', input(e.footer, 'text', { max: LIMITS.footer })),
                            field('Ikona stopki (URL)', input(e.footer, 'iconUrl', { type: 'url', placeholder: 'https://…' })))));
            }

            function drawButtons() {
                buttonsBox.replaceChildren(
                    ...state.buttons.map((b, i) => h('div', { class: 'list-item' },
                        h('div', { class: 'list-item-fields' },
                            field('Napis', input(b, 'label', { max: 80 })),
                            field('Link', input(b, 'url', { type: 'url', placeholder: 'https://…' })),
                            field('Emoji (opcjonalnie)', input(b, 'emoji', { max: 100, placeholder: '🔗 albo <:nazwa:id>' }))),
                        h('div', { class: 'list-item-actions' },
                            iconBtn('W górę', '↑', () => move(state.buttons, i, -1), { disabled: i === 0 }),
                            iconBtn('W dół', '↓', () => move(state.buttons, i, 1), { disabled: i === state.buttons.length - 1 }),
                            iconBtn('Usuń przycisk', '✕', () => { state.buttons.splice(i, 1); drawEditor(); changed(); }, { danger: true })))),
                    // replaceChildren (inaczej niż h) nie pomija null - stąd tablica
                    ...(state.buttons.length === 0 ? [h('div', { class: 'faint' }, 'Brak przycisków.')] : []),
                    h('button', {
                        type: 'button', class: 'btn btn-sm', disabled: state.buttons.length >= LIMITS.buttons,
                        onclick: () => { state.buttons.push({ label: '', url: '', emoji: '' }); drawEditor(); changed(); },
                    }, `+ Dodaj przycisk (${state.buttons.length}/${LIMITS.buttons})`));
            }

            function drawEditor() {
                contentInput.value = state.content;
                contentInput.dispatchEvent(new Event('input')); // licznik znaków
                embedsBox.replaceChildren(
                    ...state.embeds.map(embedEditor),
                    h('div', { class: 'row' },
                        h('button', {
                            type: 'button', class: 'btn', disabled: state.embeds.length >= LIMITS.embeds,
                            onclick: () => { state.embeds.push(emptyEmbed(defaultColor())); drawEditor(); changed(); },
                        }, `+ Dodaj embed (${state.embeds.length}/${LIMITS.embeds})`),
                        h('div', { style: { flex: '1' } }),
                        totalCounter));
                drawButtons();
            }

            function replaceState(next) {
                state = normalize(next);
                drawEditor();
                changed();
            }

            // ---------- szablony ----------
            const templateSelect = h('select', { class: 'input' });
            const templateName = h('input', { class: 'input', maxLength: 60, placeholder: 'np. Regulamin, Ogłoszenie…' });
            function drawTemplates(selectedId) {
                templateSelect.replaceChildren(
                    h('option', { value: '' }, templates.length ? '— wybierz szablon —' : '— brak zapisanych szablonów —'),
                    ...templates.map(t => h('option', { value: String(t.id) }, t.name)));
                templateSelect.value = selectedId ? String(selectedId) : '';
            }
            drawTemplates();

            const loadTplBtn = h('button', { class: 'btn' }, 'Wczytaj');
            loadTplBtn.addEventListener('click', () => {
                if (!templateSelect.value) return toast('Najpierw wybierz szablon.', 'error');
                busy(loadTplBtn, async () => {
                    const { template } = await ctx.api(`/templates/${templateSelect.value}`);
                    if (!isEmpty(state) && !confirm(`Wczytać szablon „${template.name}”? Obecna zawartość kreatora zostanie zastąpiona.`)) return;
                    replaceState(template.message);
                    templateName.value = template.name;
                    toast(`Wczytano szablon „${template.name}” ✓`);
                });
            });
            const deleteTplBtn = h('button', { class: 'btn btn-danger' }, 'Usuń');
            deleteTplBtn.addEventListener('click', () => {
                const t = templates.find(x => String(x.id) === templateSelect.value);
                if (!t) return toast('Najpierw wybierz szablon.', 'error');
                if (!confirm(`Usunąć szablon „${t.name}”?`)) return;
                busy(deleteTplBtn, async () => {
                    templates = (await ctx.api(`/templates/${t.id}`, { method: 'DELETE' })).templates;
                    drawTemplates();
                    toast('Usunięto szablon');
                });
            });
            const saveTplBtn = h('button', { class: 'btn btn-primary' }, 'Zapisz jako szablon');
            saveTplBtn.addEventListener('click', () => busy(saveTplBtn, async () => {
                const name = templateName.value.trim();
                if (!name) throw new Error('Wpisz nazwę szablonu.');
                const exists = templates.find(t => t.name.toLowerCase() === name.toLowerCase());
                if (exists && !confirm(`Szablon „${exists.name}” już jest - nadpisać go?`)) return;
                const res = await ctx.api('/templates', { method: 'POST', body: { name, message: state } });
                templates = res.templates;
                drawTemplates(res.template.id);
                toast(`Zapisano szablon „${res.template.name}” ✓`);
            }));

            // ---------- wysyłanie i edycja ----------
            const channel = channelSelect(ctx.channels, null);
            const linkInput = h('input', { class: 'input', type: 'url', placeholder: 'https://discord.com/channels/…' });
            const result = h('div', { class: 'muted' });
            const showResult = (label, url) => result.replaceChildren(safeUrl(url) ? extLink(url, label) : label);

            const sendBtn = h('button', { class: 'btn btn-primary btn-lg' }, 'Wyślij jako nową');
            sendBtn.addEventListener('click', () => busy(sendBtn, async () => {
                const res = await ctx.api('/send', { method: 'POST', body: { channelId: channel.value, message: state } });
                linkInput.value = res.messageUrl; // od razu można ją poprawić
                showResult('Wysłano - otwórz wiadomość ↗', res.messageUrl);
                toast('Wysłano ✓');
            }));

            const loadLinkBtn = h('button', { class: 'btn' }, 'Wczytaj z linku');
            loadLinkBtn.addEventListener('click', () => busy(loadLinkBtn, async () => {
                const res = await ctx.api('/load', { method: 'POST', body: { link: linkInput.value } });
                if (!isEmpty(state) && !confirm('Wczytać tę wiadomość? Obecna zawartość kreatora zostanie zastąpiona.')) return;
                replaceState(res.message);
                if (res.note) toast(res.note, res.editable ? 'ok' : 'error');
                else toast('Wczytano wiadomość ✓');
            }));

            const editBtn = h('button', { class: 'btn btn-primary' }, 'Zapisz zmiany w wiadomości');
            editBtn.addEventListener('click', () => busy(editBtn, async () => {
                if (!confirm('Podmienić treść tej wiadomości na Discordzie na zawartość kreatora?')) return;
                const res = await ctx.api('/edit', { method: 'POST', body: { link: linkInput.value, message: state } });
                showResult('Zapisano zmiany - otwórz wiadomość ↗', res.messageUrl);
                toast('Zapisano zmiany ✓');
                if (res.note) toast(res.note);
            }));

            const clearBtn = h('button', { class: 'btn btn-ghost' }, 'Wyczyść kreator');
            clearBtn.addEventListener('click', () => {
                if (!confirm('Wyczyścić kreator? Niezapisana zawartość zniknie.')) return;
                replaceState({ embeds: [emptyEmbed(defaultColor())] });
                linkInput.value = '';
                result.replaceChildren();
            });

            container.append(
                card('📚', 'Szablony', 'Zapisane na serwerze - widzi je każdy z dostępem do panelu. Wyślesz je też komendą /embed szablon:….',
                    h('div', { class: 'grid-2' },
                        field('Zapisane szablony', h('div', { class: 'row', style: { 'flex-wrap': 'nowrap' } }, templateSelect, loadTplBtn, deleteTplBtn)),
                        field('Nazwa szablonu', h('div', { class: 'row', style: { 'flex-wrap': 'nowrap' } }, templateName, saveTplBtn)))),
                h('div', { class: 'grid-2', style: { 'align-items': 'start' } },
                    h('div', { class: 'stack' },
                        contentCard,
                        embedsBox,
                        card('🔗', 'Przyciski z linkami', 'Do 5 przycisków pod wiadomością, które otwierają strony.', buttonsBox),
                        card('📤', 'Wyślij albo edytuj', 'Bot wyśle wiadomość na wybrany kanał albo podmieni treść swojej wiadomości z linku.',
                            field('Kanał', channel),
                            h('div', { class: 'row end' }, sendBtn),
                            field('Link do wiadomości', linkInput, 'Wczytaj dowolną wiadomość jako wzór albo edytuj wiadomość wysłaną przez bota. Na Discordzie: prawy przycisk → „Kopiuj link do wiadomości”.'),
                            h('div', { class: 'row end' }, loadLinkBtn, editBtn),
                            result,
                            h('div', { class: 'row' }, clearBtn))),
                    h('div', { class: 'preview', style: { position: 'sticky', top: '84px' } },
                        h('div', { class: 'preview-label kicker' }, 'Podgląd'),
                        discordMessage(previewBody))),
            );
            drawEditor();
            renderPreview();
        },
    });
})();
