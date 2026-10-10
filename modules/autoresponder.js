'use strict';
// Auto odpowiedzi (moduł "autoresponder") - lista reguł, edytor i sprawdzanie dopasowania
(() => {
    const { h, toast, busy, field, card, renderControl, switchInput, clone } = window.KropkaPanel;

    // Wartość domyślna pola (jak w ustawieniach modułów)
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
    function fieldsForm(fields, draft, ctx) {
        const wrappers = new Map();
        const visible = f => !f.showIf || (f.showIf.truthy ? Boolean(draft[f.showIf.key]) : draft[f.showIf.key] === f.showIf.equals);
        const update = () => fields.forEach(f => { const w = wrappers.get(f.key); if (w) w.hidden = !visible(f); });
        const control = f => {
            const el = field(f.label, renderControl(f, draft[f.key], v => { draft[f.key] = v; update(); }, ctx), f.hint);
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

    window.KropkaPanel.register('autoresponder', {
        async render(container, ctx) {
            let data = await ctx.api('/rules');
            const { fields } = data;
            const matchLabels = Object.fromEntries(fields.find(f => f.key === 'match').options.map(o => [o.value, o.label]));
            const listBox = h('div', { class: 'list-items' });
            const editorBox = h('div', { class: 'stack' });
            const countEl = h('span', { class: 'badge off' });
            const addBtn = h('button', { class: 'btn btn-primary btn-sm', onclick: () => openEditor(null) }, '+ Nowa reguła');

            function preview(rule) {
                const text = rule.response?.content?.trim();
                if (text) return text.length > 90 ? `${text.slice(0, 90)}…` : text;
                if (rule.response?.embed?.enabled) return '(embed)';
                if (rule.reaction) return `reakcja ${rule.reaction}`;
                return rule.deleteTrigger ? '(tylko usuwa wiadomość)' : '';
            }

            async function call(path, opts, message) {
                try {
                    data = { ...data, ...await ctx.api(path, opts) };
                    if (message) toast(message);
                } catch (err) {
                    toast(err.message, 'error');
                }
                drawList();
            }

            const move = (i, dir) => {
                const ids = data.rules.map(r => r.id);
                [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
                call('/order', { method: 'PUT', body: { ids } });
            };

            function drawList() {
                countEl.textContent = `${data.rules.length} / ${data.max}`;
                addBtn.disabled = data.rules.length >= data.max;
                if (!data.rules.length) {
                    listBox.replaceChildren(h('div', { class: 'empty' }, 'Brak reguł. Dodaj pierwszą – np. odpowiedź na „jak dołączyć?”.'));
                    return;
                }
                listBox.replaceChildren(...data.rules.map((rule, i) => h('div', { class: 'list-item' },
                    h('div', { class: 'stack', style: { flex: '1', gap: '6px', 'min-width': '0' } },
                        h('div', { class: 'row' },
                            h('b', null, rule.name || `Reguła ${i + 1}`),
                            h('span', { class: `badge ${rule.enabled ? 'on' : 'off'}` }, rule.enabled ? 'włączona' : 'wyłączona'),
                            h('span', { class: 'faint' }, `użyto ${rule.uses}×`)),
                        h('div', { class: 'muted' }, `Wiadomość ${matchLabels[rule.match] ?? rule.match}: ${(rule.triggers ?? []).map(t => `„${t}”`).join(', ')}`),
                        h('div', { class: 'faint' }, `↳ ${preview(rule)}`)),
                    h('div', { class: 'list-item-actions' },
                        switchInput(rule.enabled, on => call(`/rules/${rule.id}`, { method: 'PATCH', body: { enabled: on } }, on ? 'Włączono regułę' : 'Wyłączono regułę')),
                        h('button', { class: 'btn btn-icon btn-ghost', title: 'W górę', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
                        h('button', { class: 'btn btn-icon btn-ghost', title: 'W dół', disabled: i === data.rules.length - 1, onclick: () => move(i, 1) }, '↓'),
                        h('button', { class: 'btn btn-icon', title: 'Edytuj', onclick: () => openEditor(rule) }, '✎'),
                        h('button', {
                            class: 'btn btn-icon btn-danger', title: 'Usuń',
                            onclick: () => { if (confirm(`Usunąć regułę „${rule.name || `Reguła ${i + 1}`}”?`)) call(`/rules/${rule.id}`, { method: 'DELETE' }, 'Usunięto regułę'); },
                        }, '✕')))));
            }

            function closeEditor() {
                editorBox.replaceChildren();
            }

            function openEditor(rule) {
                const draft = Object.fromEntries(fields.map(f => [f.key, rule && rule[f.key] !== undefined ? clone(rule[f.key]) : defaultOf(f)]));
                const errorBox = h('div', { class: 'error-box', hidden: true });
                const saveBtn = h('button', { class: 'btn btn-primary' }, rule ? 'Zapisz zmiany' : 'Dodaj regułę');
                saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
                    errorBox.hidden = true;
                    try {
                        data = { ...data, ...await ctx.api(rule ? `/rules/${rule.id}` : '/rules', { method: rule ? 'PUT' : 'POST', body: draft }) };
                    } catch (err) {
                        errorBox.textContent = err.message;
                        errorBox.hidden = false;
                        throw err;
                    }
                    toast(rule ? 'Zapisano regułę ✓' : 'Dodano regułę ✓');
                    closeEditor();
                    drawList();
                }));
                editorBox.replaceChildren(card('✏️', rule ? 'Edycja reguły' : 'Nowa reguła',
                    'Działa pierwsza pasująca reguła z listy. Wiadomości botów są pomijane.',
                    fieldsForm(fields, draft, ctx),
                    errorBox,
                    h('div', { class: 'row end' }, h('button', { class: 'btn btn-ghost', onclick: closeEditor }, 'Anuluj'), saveBtn)));
                editorBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            // ---------- sprawdzanie dopasowania
            const testInput = h('input', { class: 'input', maxLength: 2000, placeholder: 'Wpisz przykładową wiadomość…', style: { flex: '1' } });
            const testResult = h('div', { class: 'muted' });
            const testBtn = h('button', { class: 'btn' }, 'Sprawdź');
            const runTest = () => busy(testBtn, async () => {
                if (!testInput.value.trim()) return;
                const { match } = await ctx.api('/test', { method: 'POST', body: { text: testInput.value } });
                const index = match ? data.rules.findIndex(r => r.id === match.id) : -1;
                testResult.textContent = match
                    ? `✓ Odpowie reguła: ${match.name || `Reguła ${index + 1}`}`
                    : '✗ Żadna włączona reguła nie pasuje do tej wiadomości.';
            });
            testBtn.addEventListener('click', runTest);
            testInput.addEventListener('keydown', e => { if (e.key === 'Enter') runTest(); });

            const listCard = card('💬', 'Reguły', 'Bot sprawdza reguły od góry – odpowiada pierwsza pasująca. Kolejność zmienisz strzałkami. Maks. 30 odpowiedzi na minutę na serwer.',
                h('div', { class: 'row' }, countEl, h('div', { style: { flex: '1' } }), addBtn),
                listBox);
            container.append(
                listCard,
                editorBox,
                card('🧪', 'Sprawdź dopasowanie', 'Pokazuje, która włączona reguła odpowie na wiadomość (bez sprawdzania kanałów, ról i odstępów).',
                    h('div', { class: 'row' }, testInput, testBtn),
                    testResult),
            );
            drawList();
        },
    });
})();
