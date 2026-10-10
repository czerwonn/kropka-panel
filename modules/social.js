'use strict';
// Powiadomienia o nowych filmach z YouTube i postach z Reddita (moduł "social")
(() => {
    const { h, toast, busy, field, card, channelSelect, roleSelect, switchInput, placeholderChips, withCounter, discordMessage, extLink } = window.KropkaPanel;

    const TYPES = {
        youtube: {
            icon: '📺', label: 'YouTube', sourceLabel: 'Kanał YouTube',
            placeholder: '@nazwa, link do kanału albo ID (UC…)',
            hint: 'Najprościej wkleić link do kanału, np. https://www.youtube.com/@nazwa.',
            sample: { title: 'Mój nowy film!', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', author: 'Nazwa kanału', subreddit: '' },
        },
        reddit: {
            icon: '🟠', label: 'Reddit', sourceLabel: 'Subreddit',
            placeholder: 'np. Polska albo r/Polska',
            hint: 'Ogłaszane są nowe posty (bez NSFW).',
            sample: { title: 'Ciekawy post na Reddicie', url: 'https://www.reddit.com/r/Polska/', author: 'ktos123', subreddit: 'Polska' },
        },
    };

    // "5 min temu", "za 3 min"
    function relative(ms) {
        if (!ms) return '—';
        const diff = Math.round((ms - Date.now()) / 60000);
        const abs = Math.abs(diff);
        const text = abs < 1 ? 'chwila' : abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} dni`;
        if (text === 'chwila') return diff < 0 ? 'przed chwilą' : 'za chwilę';
        return diff < 0 ? `${text} temu` : `za ${text}`;
    }

    function fillSample(template, type, roleName) {
        const s = TYPES[type].sample;
        const vars = { title: s.title, url: s.url, author: s.author, channel: s.author, subreddit: s.subreddit, role: roleName ? `@${roleName}` : '' };
        let text = String(template || '').replace(/\{(\w+)\}/g, (all, key) => (vars[key] != null ? vars[key] : all)).trim();
        if (!text.includes(s.url)) text += `\n${s.url}`;
        if (roleName && !String(template).includes('{role}')) text = `@${roleName} ${text}`;
        return text;
    }

    // Formularz kanału/roli/treści - wspólny dla dodawania i edycji
    function targetForm(ctx, data, initial) {
        const state = { type: initial.type, template: initial.template };
        const channel = channelSelect(ctx.channels, initial.channelId, { kinds: ['text'] });
        const role = roleSelect(ctx.roles, initial.roleId, { none: '— bez oznaczania roli —' });
        const template = h('textarea', { class: 'input', rows: 4, maxLength: 1000, value: initial.template });
        const preview = h('div', { class: 'dc-text' });
        const shorts = { value: initial.includeShorts !== false };
        const shortsSwitch = switchInput(shorts.value, v => { shorts.value = v; }, 'Ogłaszaj też Shorts');
        const shortsRow = h('div', null, shortsSwitch);

        const roleName = () => ctx.roles.find(r => r.id === role.value)?.name ?? null;
        const refresh = () => {
            preview.textContent = fillSample(template.value, state.type, roleName());
            shortsRow.hidden = state.type !== 'youtube';
        };
        template.addEventListener('input', refresh);
        role.addEventListener('change', refresh);
        refresh();

        return {
            state,
            refresh,
            setType(type) {
                // domyślna treść podąża za rodzajem, dopóki ktoś jej nie zmienił
                if (template.value === data.defaults[state.type]) template.value = data.defaults[type];
                state.type = type;
                refresh();
            },
            values: () => ({ channelId: channel.value, roleId: role.value || null, template: template.value, includeShorts: shorts.value }),
            element: h('div', { class: 'stack' },
                h('div', { class: 'grid-2' },
                    field('Kanał na Discordzie', channel),
                    field('Rola do oznaczenia', role, 'Opcjonalnie - np. rola „Powiadomienia”.')),
                field('Treść wiadomości', h('div', { class: 'stack', style: { gap: '6px' } },
                    withCounter(template, 1000),
                    placeholderChips(data.placeholders, template)),
                'Link {url} jest potrzebny - Discord pokaże pod nim podgląd filmu/posta.'),
                shortsRow,
                h('div', { class: 'preview' }, h('div', { class: 'preview-label kicker' }, 'Podgląd'), discordMessage(preview))),
        };
    }

    window.KropkaPanel.register('social', {
        async render(container, ctx) {
            let data = await ctx.api('/feeds');
            const listBox = h('div', { class: 'stack' });
            const editorBox = h('div', { class: 'stack' });
            const statsBox = h('div', { class: 'stats' });

            const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
            const showWarnings = res => (res.warnings ?? []).forEach(w => toast(w, 'error'));

            async function reload() {
                data = await ctx.api('/feeds');
                draw();
            }

            function openEditor(feed) {
                const form = targetForm(ctx, data, feed);
                const saveBtn = h('button', { class: 'btn btn-primary' }, 'Zapisz');
                saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
                    const res = await ctx.api(`/feeds/${feed.id}`, { method: 'PUT', body: form.values() });
                    showWarnings(res);
                    toast('Zapisano ✓');
                    editorBox.replaceChildren();
                    await reload();
                }));
                editorBox.replaceChildren(card('✏️', `Edycja: ${feed.title ?? feed.source}`, `${TYPES[feed.type].label} · ${feed.source}`,
                    form.element,
                    h('div', { class: 'row end' },
                        h('button', { class: 'btn btn-ghost', onclick: () => editorBox.replaceChildren() }, 'Anuluj'),
                        saveBtn)));
                editorBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            function feedItem(feed) {
                const type = TYPES[feed.type] ?? { icon: '🔔', label: feed.type };
                const roleName = feed.roleId ? ctx.roles.find(r => r.id === feed.roleId)?.name : null;
                const details = [
                    `→ #${feed.channelName ?? 'usunięty kanał'}`,
                    roleName ? `@${roleName}` : null,
                    feed.type === 'youtube' && !feed.includeShorts ? 'bez Shorts' : null,
                    feed.lastCheck ? `sprawdzono ${relative(feed.lastCheck)}` : 'czeka na pierwsze sprawdzenie',
                    feed.lastPost ? `ostatni wpis ${relative(feed.lastPost)}` : null,
                ].filter(Boolean).join(' · ');

                const testBtn = h('button', { class: 'btn btn-sm', title: 'Wyślij najnowszy wpis jako test' }, 'Test');
                testBtn.addEventListener('click', () => busy(testBtn, async () => {
                    await ctx.api(`/feeds/${feed.id}/test`, { method: 'POST', body: {} });
                    toast(`Wysłano test na #${feed.channelName ?? 'kanał'} ✓`);
                }));
                const deleteBtn = h('button', { class: 'btn btn-sm btn-danger', title: 'Usuń' }, '✕');
                deleteBtn.addEventListener('click', () => {
                    if (!confirm(`Usunąć powiadomienia z „${feed.title ?? feed.source}”?`)) return;
                    busy(deleteBtn, async () => {
                        await ctx.api(`/feeds/${feed.id}`, { method: 'DELETE' });
                        toast('Usunięto');
                        await reload();
                    });
                });

                return h('li', null,
                    h('span', { class: 'idx', title: type.label }, type.icon),
                    h('div', { class: 't' },
                        extLink(feed.url, feed.title ?? feed.source),
                        h('small', null, details),
                        feed.lastError ? h('small', { style: { color: 'var(--danger)' } }, `⚠ ${feed.lastError}`) : null),
                    h('span', { class: `badge ${feed.lastError ? 'off' : 'on'}` }, feed.lastError ? 'problem' : 'działa'),
                    h('div', { class: 'row' },
                        testBtn,
                        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openEditor(feed) }, 'Edytuj'),
                        deleteBtn));
            }

            function draw() {
                const count = type => data.feeds.filter(f => f.type === type).length;
                statsBox.replaceChildren(
                    stat('Powiadomienia', `${data.feeds.length} / ${data.limit}`),
                    stat('YouTube', count('youtube')),
                    stat('Reddit', count('reddit')));
                listBox.replaceChildren(data.feeds.length
                    ? h('ol', { class: 'queue-list' }, data.feeds.map(feedItem))
                    : h('div', { class: 'empty' }, h('div', { class: 'big' }, '🔔'), 'Nie ma jeszcze żadnych powiadomień - dodaj pierwsze poniżej.'));
                addBtn.disabled = data.feeds.length >= data.limit;
            }

            // ---- dodawanie
            let addType = 'youtube';
            const source = h('input', { class: 'input', maxLength: 200, placeholder: TYPES.youtube.placeholder });
            const sourceField = field(TYPES.youtube.sourceLabel, source, TYPES.youtube.hint);
            const form = targetForm(ctx, data, { type: 'youtube', template: data.defaults.youtube, channelId: null, roleId: null, includeShorts: true });
            const typeButtons = Object.entries(TYPES).map(([key, t]) => h('button', {
                type: 'button',
                class: key === addType ? 'active' : '',
                onclick: e => {
                    addType = key;
                    for (const b of typeButtons) b.classList.toggle('active', b === e.currentTarget);
                    source.placeholder = t.placeholder;
                    sourceField.querySelector('.field-label').textContent = t.sourceLabel;
                    sourceField.querySelector('.field-hint').textContent = t.hint;
                    form.setType(key);
                },
            }, `${t.icon} ${t.label}`));
            const addBtn = h('button', { class: 'btn btn-primary' }, 'Dodaj');
            addBtn.addEventListener('click', () => {
                if (!source.value.trim()) {
                    toast('Wpisz kanał albo subreddit.', 'error');
                    return;
                }
                busy(addBtn, async () => {
                    const res = await ctx.api('/feeds', { method: 'POST', body: { type: addType, source: source.value, ...form.values() } });
                    showWarnings(res);
                    toast(`Dodano: ${res.feed.title ?? res.feed.source} ✓`);
                    source.value = '';
                    await reload();
                });
            });

            container.append(
                statsBox,
                card('🔔', 'Twoje powiadomienia',
                    `Nowe wpisy sprawdzamy co ok. ${data.intervalMinutes.youtube} min (YouTube) i ${data.intervalMinutes.reddit} min (Reddit). Po dodaniu ogłaszane są tylko nowe wpisy.`,
                    listBox),
                editorBox,
                card('➕', 'Dodaj powiadomienie', `Maks. ${data.limit} na serwer.`,
                    // bez <label> (field) - kliknięcie w podpis wciskałoby pierwszy przycisk
                    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Skąd'), h('div', { class: 'segmented' }, typeButtons)),
                    sourceField,
                    form.element,
                    h('div', { class: 'row end' }, addBtn)),
            );
            draw();

            // Odświeżanie stanu (ostatnie sprawdzenie, błędy) co minutę
            const timer = setInterval(() => {
                if (!document.hidden && !editorBox.childElementCount) reload().catch(() => {});
            }, 60_000);
            ctx.onLeave(() => clearInterval(timer));
        },
    });
})();
