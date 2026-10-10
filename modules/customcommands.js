'use strict';
// Własne komendy (moduł "customcommands") - lista komend serwera, edytor i stan rejestracji w Discordzie
(() => {
    const { h, toast, busy, field, card, renderControl, switchInput, clone } = window.KropkaPanel;
    const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

    function defaultOf(f) {
        if (f.default !== undefined) return clone(f.default);
        switch (f.type) {
            case 'boolean': return false;
            case 'number': return f.min ?? 0;
            case 'select': return f.options[0]?.value ?? null;
            case 'channel': case 'role': return null;
            case 'channels': case 'roles': case 'tags': return [];
            case 'message': return { content: '', embed: { enabled: false, title: '', description: '', color: '#FF2D87', footer: '', image: '', thumbnail: '' } };
            default: return '';
        }
    }

    // Formularz z opisu pól: grupy, dwa pola obok siebie (half), pokazywanie warunkowe (showIf)
    function fieldsForm(fields, draft, ctx, onChange) {
        const wrappers = new Map();
        const visible = f => !f.showIf || (f.showIf.truthy ? Boolean(draft[f.showIf.key]) : draft[f.showIf.key] === f.showIf.equals);
        const update = () => fields.forEach(f => { const w = wrappers.get(f.key); if (w) w.hidden = !visible(f); });
        const control = f => {
            const el = field(f.label, renderControl(f, draft[f.key], v => { draft[f.key] = v; update(); onChange?.(f.key); }, ctx), f.hint);
            wrappers.set(f.key, el);
            return el;
        };
        const groups = new Map();
        for (const f of fields) {
            if (!groups.has(f.group ?? '')) groups.set(f.group ?? '', []);
            groups.get(f.group ?? '').push(f);
        }
        const sections = [...groups].map(([group, list]) => {
            const rows = [];
            for (let i = 0; i < list.length; i++) {
                if (list[i].half && list[i + 1]?.half) rows.push(h('div', { class: 'grid-2' }, control(list[i]), control(list[++i])));
                else rows.push(control(list[i]));
            }
            return h('div', { class: 'stack' }, group ? h('h4', { class: 'cat-title' }, group) : null, rows);
        });
        update();
        return h('div', { class: 'stack' }, sections);
    }

    window.KropkaPanel.register('customcommands', {
        async render(container, ctx) {
            let data = await ctx.api('/commands');
            const { fields } = data;
            const reserved = new Set(data.reserved);
            const listBox = h('div', { class: 'list-items' });
            const editorBox = h('div', { class: 'stack' });
            const statusBox = h('div', { class: 'row' });
            const countEl = h('span', { class: 'badge off' });
            const addBtn = h('button', { class: 'btn btn-primary btn-sm', onclick: () => openEditor(null) }, '+ Nowa komenda');
            const timers = [];
            let left = false;
            ctx.onLeave(() => { left = true; timers.forEach(clearTimeout); });

            async function refreshLater() {
                // rejestracja w Discordzie idzie kilka sekund po zapisie - wtedy pokażemy jej wynik
                if (left) return;
                timers.push(setTimeout(async () => {
                    try {
                        data = { ...data, ...await ctx.api('/commands') };
                        drawList();
                        if (data.sync.state === 'pending') refreshLater();
                    } catch { /* pokażemy przy następnym wejściu */ }
                }, 4000));
            }

            async function call(path, opts, message) {
                try {
                    data = { ...data, ...await ctx.api(path, opts) };
                    if (message) toast(message);
                } catch (err) {
                    toast(err.message, 'error');
                }
                drawList();
                if (data.sync.state === 'pending') refreshLater();
            }

            function drawStatus() {
                const s = data.sync;
                const syncBtn = h('button', { class: 'btn btn-sm btn-ghost' }, '↻ Zarejestruj ponownie');
                syncBtn.addEventListener('click', () => busy(syncBtn, async () => {
                    data = { ...data, ...await ctx.api('/sync', { method: 'POST' }) };
                    drawList();
                    toast(data.sync.state === 'error' ? data.sync.error : 'Zarejestrowano komendy ✓', data.sync.state === 'error' ? 'error' : 'ok');
                }));
                const text = s.state === 'pending' ? '⏳ Zapisuję zmiany w Discordzie…'
                    : s.state === 'error' ? `⚠️ ${s.error}`
                        : '✓ Komendy są zarejestrowane na serwerze. Nowe mogą pojawić się w Discordzie po chwili (czasem pomaga Ctrl+R).';
                statusBox.replaceChildren(h('span', { class: s.state === 'error' ? 'pink' : 'muted', style: { flex: '1' } }, text), syncBtn);
            }

            function drawList() {
                drawStatus();
                countEl.textContent = `${data.commands.length} / ${data.max}`;
                addBtn.disabled = data.commands.length >= data.max;
                if (!data.commands.length) {
                    listBox.replaceChildren(h('div', { class: 'empty' }, 'Brak własnych komend. Dodaj pierwszą – np. /regulamin z linkiem do zasad.'));
                    return;
                }
                listBox.replaceChildren(...data.commands.map(cmd => h('div', { class: 'list-item' },
                    h('div', { class: 'stack', style: { flex: '1', gap: '6px', 'min-width': '0' } },
                        h('div', { class: 'row' },
                            h('code', null, `/${cmd.name}${cmd.optionEnabled ? ` ${cmd.optionName}` : ''}`),
                            h('span', { class: `badge ${cmd.enabled && !cmd.conflict ? 'on' : 'off'}` }, cmd.conflict ? 'koliduje' : cmd.enabled ? 'włączona' : 'wyłączona'),
                            cmd.ephemeral ? h('span', { class: 'badge off' }, 'tylko dla wywołującego') : null,
                            h('span', { class: 'faint' }, `użyto ${cmd.uses}×`)),
                        h('div', { class: 'muted' }, cmd.description),
                        cmd.conflict ? h('div', { class: 'pink' }, `⚠️ Bot ma już komendę /${cmd.name} – zmień nazwę, inaczej ta komenda nie zadziała.`) : null),
                    h('div', { class: 'list-item-actions' },
                        switchInput(cmd.enabled, on => call(`/commands/${cmd.id}`, { method: 'PATCH', body: { enabled: on } }, on ? 'Włączono komendę' : 'Wyłączono komendę')),
                        h('button', { class: 'btn btn-icon', title: 'Edytuj', onclick: () => openEditor(cmd) }, '✎'),
                        h('button', {
                            class: 'btn btn-icon btn-danger', title: 'Usuń',
                            onclick: () => { if (confirm(`Usunąć komendę /${cmd.name}?`)) call(`/commands/${cmd.id}`, { method: 'DELETE' }, 'Usunięto komendę'); },
                        }, '✕')))));
            }

            function closeEditor() {
                editorBox.replaceChildren();
            }

            // Szybkie podpowiedzi przy pisaniu (pełne sprawdzenie i tak robi bot przy zapisie)
            function localProblems(draft, editingId) {
                const problems = [];
                const name = String(draft.name ?? '').trim().toLowerCase();
                if (!NAME_RE.test(name)) problems.push('Nazwa: małe litery a-z, cyfry, - i _ (bez spacji i polskich znaków), maks. 32 znaki.');
                else if (reserved.has(name)) problems.push(`/${name} to komenda bota – wybierz inną nazwę.`);
                else if (data.commands.some(c => c.name === name && c.id !== editingId)) problems.push(`Komenda /${name} już istnieje.`);
                if (draft.optionEnabled && !NAME_RE.test(String(draft.optionName ?? '').trim().toLowerCase())) problems.push('Nazwa pola: małe litery a-z, cyfry, - i _.');
                if ((draft.addRoles ?? []).some(id => (draft.removeRoles ?? []).includes(id))) problems.push('Ta sama rola nie może być jednocześnie nadawana i zabierana.');
                return problems;
            }

            function openEditor(cmd) {
                const draft = Object.fromEntries(fields.map(f => [f.key, cmd && cmd[f.key] !== undefined ? clone(cmd[f.key]) : defaultOf(f)]));
                const hints = h('div', { class: 'stack', style: { gap: '4px' } });
                const errorBox = h('div', { class: 'error-box', hidden: true });
                const check = () => hints.replaceChildren(...localProblems(draft, cmd?.id).map(p => h('div', { class: 'pink' }, `⚠️ ${p}`)));
                const saveBtn = h('button', { class: 'btn btn-primary' }, cmd ? 'Zapisz zmiany' : 'Dodaj komendę');
                saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
                    errorBox.hidden = true;
                    const body = { ...draft, name: String(draft.name ?? '').trim().toLowerCase(), optionName: String(draft.optionName ?? '').trim().toLowerCase() };
                    try {
                        data = { ...data, ...await ctx.api(cmd ? `/commands/${cmd.id}` : '/commands', { method: cmd ? 'PUT' : 'POST', body }) };
                    } catch (err) {
                        errorBox.textContent = err.message;
                        errorBox.hidden = false;
                        throw err;
                    }
                    toast(cmd ? 'Zapisano komendę ✓' : 'Dodano komendę ✓');
                    closeEditor();
                    drawList();
                    refreshLater();
                }));
                editorBox.replaceChildren(card('✏️', cmd ? `Edycja /${cmd.name}` : 'Nowa komenda',
                    'Komenda pojawi się na liście „/” tylko na tym serwerze. Zmienna {arg} to tekst wpisany w pole komendy.',
                    fieldsForm(fields, draft, ctx, check),
                    hints,
                    errorBox,
                    h('div', { class: 'row end' }, h('button', { class: 'btn btn-ghost', onclick: closeEditor }, 'Anuluj'), saveBtn)));
                check();
                editorBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            container.append(
                card('⚡', 'Własne komendy', 'Komendy z ukośnikiem tylko dla tego serwera. Nie mogą mieć nazw komend bota.',
                    statusBox,
                    h('div', { class: 'row' }, countEl, h('div', { style: { flex: '1' } }), addBtn),
                    listBox),
                editorBox,
            );
            drawList();
            if (data.sync.state === 'pending') refreshLater();
        },
    });
})();
