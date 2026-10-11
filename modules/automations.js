'use strict';
// Automatyzacje (moduł "automations") - lista reguł „kiedy → jeśli → zrób to” i edytor
(() => {
    const { h, toast, busy, field, card, renderControl, switchInput, clone } = window.KropkaPanel;
    const MAX_BODY = 60_000; // API przyjmuje maks. 64 KB na zapytanie

    const ACTION_GROUPS = [
        ['Wiadomości', ['send_message', 'reply', 'dm']],
        ['Role', ['add_roles', 'remove_roles', 'toggle_roles']],
        ['Ekonomia i poziomy', ['add_money', 'remove_money', 'add_xp', 'remove_xp']],
        ['Moderacja', ['warn', 'mute', 'kick']],
        ['Wiadomość, która uruchomiła automatyzację', ['add_reaction', 'delete_message', 'start_thread']],
        ['Inne', ['wait']],
    ];

    const message = content => ({ content, embed: { enabled: false, title: '', description: '', color: '#FF2D87', footer: '', image: '', thumbnail: '' } });
    const PRESETS = [
        { label: 'Pusta automatyzacja', trigger: 'messageCreate', build: () => ({ actions: [] }) },
        {
            label: 'Rola za reakcję', trigger: 'reactionAdd',
            build: () => ({
                name: 'Rola za reakcję', trigger: 'reactionAdd',
                conditions: [{ type: 'message_is', ids: [] }, { type: 'emoji_is', emojis: ['✅'] }],
                actions: [{ type: 'add_roles', roles: [] }],
            }),
        },
        {
            label: 'Odpowiedź na pytanie', trigger: 'messageCreate',
            build: () => ({
                name: 'Odpowiedź na pytanie', trigger: 'messageCreate', cooldown: 30,
                conditions: [{ type: 'text_contains', values: ['jak dołączyć'] }],
                actions: [{ type: 'reply', message: message('Hej {user}! Wszystko znajdziesz na kanale z zasadami 🙂') }],
            }),
        },
        {
            label: 'Nagroda za awans', trigger: 'levelUp',
            build: () => ({
                name: 'Nagroda za awans', trigger: 'levelUp',
                conditions: [{ type: 'level_min', level: 10 }],
                actions: [{ type: 'add_roles', roles: [] }, { type: 'send_message', channelId: null, message: message('🎉 {user} ma już poziom {level}!') }],
            }),
        },
        {
            label: 'Wiadomość prywatna po dołączeniu', trigger: 'memberJoin',
            build: () => ({
                name: 'Powitanie w DM', trigger: 'memberJoin',
                actions: [{ type: 'wait', seconds: 60 }, { type: 'dm', message: message('Cześć {user.name}! Miło Cię widzieć na {server} 👋') }],
            }),
        },
    ];

    function plural(n, one, few, many) {
        n = Math.abs(n);
        if (n === 1) return one;
        const d = n % 10;
        const t = n % 100;
        return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
    }

    function defaultOf(f) {
        if (f.default !== undefined) return clone(f.default);
        switch (f.type) {
            case 'boolean': return false;
            case 'number': return f.min ?? 0;
            case 'select': return f.options[0]?.value ?? null;
            case 'channel': case 'role': return null;
            case 'channels': case 'roles': case 'tags': return [];
            case 'message': return message('');
            default: return '';
        }
    }

    const dateTime = ts => new Date(ts).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });

    window.KropkaPanel.register('automations', {
        async render(container, ctx) {
            let data = await ctx.api('');
            const { spec, limits } = data;
            const listBox = h('div', { class: 'list-items' });
            const editorBox = h('div', { class: 'stack' });
            const countEl = h('span', { class: 'badge off' });
            const specsOf = kind => (kind === 'condition' ? spec.conditions : spec.actions);
            const triggerLabel = key => spec.triggers[key]?.label ?? key;

            // Czy wyzwalacz/akcja ma potrzebny moduł (np. poziomy, ekonomia, weryfikacja)
            const moduleOf = name => (name ? data.modules[name] ?? null : null);
            const available = s => !moduleOf(s?.service ?? s?.module) || moduleOf(s.service ?? s.module).available;

            function withDefaults(kind, item) {
                const s = specsOf(kind)[item.type];
                const out = { type: item.type };
                for (const f of s?.fields ?? []) out[f.key] = item[f.key] !== undefined ? clone(item[f.key]) : defaultOf(f);
                return out;
            }

            async function call(path, opts, msg) {
                try {
                    data = { ...data, ...await ctx.api(path, opts) };
                    if (msg) toast(msg);
                } catch (err) {
                    toast(err.message, 'error');
                }
                drawList();
            }

            const move = (i, dir) => {
                const ids = data.automations.map(a => a.id);
                [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
                call('/order', { method: 'PUT', body: { ids } });
            };

            // ---------- lista
            const presetSelect = h('select', { class: 'input', style: { width: 'auto' } },
                PRESETS.map((p, i) => h('option', { value: i, disabled: !available(spec.triggers[p.trigger]) }, p.label)));
            const addBtn = h('button', { class: 'btn btn-primary btn-sm' }, '+ Nowa automatyzacja');
            addBtn.addEventListener('click', () => openEditor(null, PRESETS[Number(presetSelect.value)].build()));

            function drawList() {
                countEl.textContent = `${data.automations.length} / ${limits.max}`;
                addBtn.disabled = data.automations.length >= limits.max;
                if (!data.automations.length) {
                    listBox.replaceChildren(h('div', { class: 'empty' }, 'Brak automatyzacji. Wybierz szablon i kliknij „Nowa automatyzacja”.'));
                    return;
                }
                listBox.replaceChildren(...data.automations.map((a, i) => {
                    const conditions = a.conditions?.length ?? 0;
                    const actions = a.actions ?? [];
                    return h('div', { class: 'list-item' },
                        h('div', { class: 'stack', style: { flex: '1', gap: '6px', 'min-width': '0' } },
                            h('div', { class: 'row' },
                                h('b', null, a.name || `Automatyzacja ${i + 1}`),
                                h('span', { class: `badge ${a.enabled ? 'on' : 'off'}` }, a.enabled ? 'włączona' : 'wyłączona'),
                                h('span', { class: 'faint' }, a.runs ? `uruchomiona ${a.runs}× · ostatnio ${dateTime(a.lastRunAt)}` : 'jeszcze nie uruchomiona')),
                            h('div', { class: 'muted' },
                                `Kiedy: ${triggerLabel(a.trigger)} · ${conditions ? `${conditions} ${plural(conditions, 'warunek', 'warunki', 'warunków')}` : 'bez warunków'}`),
                            h('div', { class: 'faint' }, `Zrób: ${actions.map(x => spec.actions[x.type]?.label ?? x.type).join(' → ')}`),
                            a.problem ? h('div', { class: 'pink' }, `⚠️ ${a.problem.text} (${dateTime(a.problem.at)})`) : null),
                        h('div', { class: 'list-item-actions' },
                            switchInput(a.enabled, on => call(`/automations/${a.id}`, { method: 'PATCH', body: { enabled: on } }, on ? 'Włączono automatyzację' : 'Wyłączono automatyzację')),
                            h('button', { class: 'btn btn-icon btn-ghost', title: 'W górę', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
                            h('button', { class: 'btn btn-icon btn-ghost', title: 'W dół', disabled: i === data.automations.length - 1, onclick: () => move(i, 1) }, '↓'),
                            h('button', { class: 'btn btn-icon', title: 'Edytuj', onclick: () => openEditor(a) }, '✎'),
                            h('button', {
                                class: 'btn btn-icon btn-danger', title: 'Usuń',
                                onclick: () => { if (confirm(`Usunąć automatyzację „${a.name}”?`)) call(`/automations/${a.id}`, { method: 'DELETE' }, 'Usunięto automatyzację'); },
                            }, '✕')));
                }));
            }

            // ---------- edytor
            function closeEditor() {
                editorBox.replaceChildren();
            }

            function openEditor(auto, preset = {}) {
                const base = auto ? clone(auto) : preset;
                const draft = {
                    ...Object.fromEntries(spec.fields.map(f => [f.key, base[f.key] !== undefined ? clone(base[f.key]) : defaultOf(f)])),
                    conditions: (base.conditions ?? []).map(c => withDefaults('condition', c)),
                    actions: (base.actions ?? []).map(a => withDefaults('action', a)),
                };
                const condBox = h('div', { class: 'list-items' });
                const actionBox = h('div', { class: 'list-items' });

                // Lista rodzajów: tylko pasujące do wyzwalacza (+ obecny, nawet jeśli nie pasuje)
                function typeSelect(kind, current) {
                    const specs = specsOf(kind);
                    const usable = key => specs[key].triggers.includes(draft.trigger) || key === current;
                    const option = key => {
                        const s = specs[key];
                        const mod = moduleOf(s.service);
                        const note = mod && !mod.available ? ' (brak modułu w bocie)' : mod && !mod.enabled ? ` (moduł ${mod.label} wyłączony)` : '';
                        return h('option', { value: key, disabled: !available(s) && key !== current }, `${s.label}${note}`);
                    };
                    const select = h('select', { class: 'input' });
                    if (kind === 'action') {
                        for (const [group, keys] of ACTION_GROUPS) {
                            const options = keys.filter(k => specs[k] && usable(k)).map(option);
                            if (options.length) select.append(h('optgroup', { label: group }, options));
                        }
                        const grouped = new Set(ACTION_GROUPS.flatMap(([, keys]) => keys));
                        Object.keys(specs).filter(k => !grouped.has(k) && usable(k)).forEach(k => select.append(option(k)));
                    } else {
                        Object.keys(specs).filter(usable).forEach(k => select.append(option(k)));
                    }
                    select.value = current;
                    return select;
                }

                function itemEditor(kind, list, index, redraw) {
                    const item = list[index];
                    const s = specsOf(kind)[item.type];
                    const fits = s?.triggers.includes(draft.trigger);
                    const select = typeSelect(kind, item.type);
                    select.addEventListener('change', () => {
                        list[index] = withDefaults(kind, { type: select.value });
                        redraw();
                    });
                    const vars = spec.triggers[draft.trigger]?.vars ?? [];
                    const hasChannel = vars.includes('{channel}');
                    const controls = (s?.fields ?? []).map(f => {
                        let def = f.type === 'message' ? { ...f, placeholders: vars } : f;
                        // np. dołączenie na serwer nie dzieje się na żadnym kanale
                        if (f.type === 'channel' && !hasChannel) def = { ...f, noneLabel: '— wybierz kanał —', hint: 'Przy tym wyzwalaczu trzeba wybrać kanał.' };
                        const el = field(f.label, renderControl(def, item[f.key], v => { item[f.key] = v; }, ctx), def.hint);
                        el.classList.add(`ft-${f.type}`);
                        return el;
                    });
                    const moveBtn = (dir, label) => h('button', {
                        type: 'button', class: 'btn btn-icon btn-ghost', title: dir < 0 ? 'W górę' : 'W dół',
                        disabled: index + dir < 0 || index + dir >= list.length,
                        onclick: () => { [list[index], list[index + dir]] = [list[index + dir], list[index]]; redraw(); },
                    }, label);
                    // rodzaj na całą szerokość, pod nim pola w siatce
                    return h('div', { class: 'list-item' },
                        h('div', { class: 'stack', style: { flex: '1', 'min-width': '0', gap: '12px' } },
                            field(`${kind === 'condition' ? 'Warunek' : 'Akcja'} ${index + 1}`, select,
                                fits ? null : '⚠️ Nie działa z wybranym wyzwalaczem – zmień albo usuń.'),
                            controls.length ? h('div', { class: 'list-item-fields' }, controls) : null),
                        h('div', { class: 'list-item-actions' },
                            moveBtn(-1, '↑'), moveBtn(1, '↓'),
                            h('button', { type: 'button', class: 'btn btn-icon btn-danger', title: 'Usuń', onclick: () => { list.splice(index, 1); redraw(); } }, '✕')));
                }

                function addButton(kind, list, max, redraw, label) {
                    return h('button', {
                        type: 'button', class: 'btn btn-sm btn-add', disabled: list.length >= max,
                        onclick: () => {
                            const specs = specsOf(kind);
                            const first = Object.keys(specs).find(k => specs[k].triggers.includes(draft.trigger) && available(specs[k]));
                            if (!first) return;
                            list.push(withDefaults(kind, { type: first }));
                            redraw();
                        },
                    }, label);
                }

                // (replaceChildren zamienia null na tekst "null", więc puste pozycje odfiltrowujemy)
                function drawItems() {
                    condBox.replaceChildren(...[
                        ...draft.conditions.map((_, i) => itemEditor('condition', draft.conditions, i, drawItems)),
                        draft.conditions.length ? null : h('div', { class: 'faint' }, 'Bez warunków – automatyzacja zadziała przy każdym takim zdarzeniu.'),
                        addButton('condition', draft.conditions, limits.conditions, drawItems, '+ Dodaj warunek'),
                    ].filter(Boolean));
                    actionBox.replaceChildren(...[
                        ...draft.actions.map((_, i) => itemEditor('action', draft.actions, i, drawItems)),
                        draft.actions.length ? null : h('div', { class: 'faint' }, 'Dodaj co najmniej jedną akcję.'),
                        addButton('action', draft.actions, limits.actions, drawItems, '+ Dodaj akcję'),
                    ].filter(Boolean));
                }

                // Pola główne: nazwa i wyzwalacz na górze, odstęp i włączenie na dole
                const control = f => {
                    const input = renderControl(f, draft[f.key], v => {
                        draft[f.key] = v;
                        if (f.key === 'trigger') drawItems();
                    }, ctx);
                    return field(f.label, input, f.hint);
                };
                const byKey = Object.fromEntries(spec.fields.map(f => [f.key, f]));
                // wyzwalacze modułów, których nie ma w tym bocie (np. weryfikacja), nie mają sensu
                byKey.trigger = {
                    ...byKey.trigger,
                    options: byKey.trigger.options.filter(o => available(spec.triggers[o.value]) || o.value === draft.trigger),
                };
                const errorBox = h('div', { class: 'error-box', hidden: true });
                const saveBtn = h('button', { class: 'btn btn-primary' }, auto ? 'Zapisz zmiany' : 'Dodaj automatyzację');
                saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
                    errorBox.hidden = true;
                    try {
                        if (JSON.stringify(draft).length > MAX_BODY) throw new Error('Za dużo tekstu w tej automatyzacji – skróć wiadomości.');
                        data = { ...data, ...await ctx.api(auto ? `/automations/${auto.id}` : '/automations', { method: auto ? 'PUT' : 'POST', body: draft }) };
                    } catch (err) {
                        errorBox.textContent = err.message;
                        errorBox.hidden = false;
                        throw err;
                    }
                    toast(auto ? 'Zapisano automatyzację ✓' : 'Dodano automatyzację ✓');
                    closeEditor();
                    drawList();
                }));

                editorBox.replaceChildren(card('✏️', auto ? `Edycja: ${auto.name}` : 'Nowa automatyzacja',
                    'Kiedy coś się stanie → jeśli wszystkie warunki pasują → bot wykonuje akcje po kolei.',
                    h('div', { class: 'grid-2' }, control(byKey.name), control(byKey.trigger)),
                    h('h4', { class: 'cat-title' }, 'Jeśli (wszystkie warunki muszą pasować)'),
                    condBox,
                    h('h4', { class: 'cat-title' }, 'Zrób to (po kolei)'),
                    actionBox,
                    h('h4', { class: 'cat-title' }, 'Ograniczenia'),
                    h('div', { class: 'grid-2' }, control(byKey.cooldown), control(byKey.cooldownScope)),
                    control(byKey.enabled),
                    errorBox,
                    h('div', { class: 'row end' }, h('button', { class: 'btn btn-ghost', onclick: closeEditor }, 'Anuluj'), saveBtn)));
                drawItems();
                editorBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            const offModules = Object.values(data.modules).filter(m => m.available && !m.enabled).map(m => m.label);
            container.append(
                card('🤖', 'Automatyzacje',
                    `Boty nie uruchamiają automatyzacji, a jedna automatyzacja może wywołać najwyżej jedną kolejną (np. „dodaj XP” → awans). Limit: ${limits.actionsPerMinute} akcji na minutę na serwer.`,
                    offModules.length ? h('div', { class: 'faint' }, `Wyłączone moduły (ich akcje będą pomijane): ${offModules.join(', ')}.`) : null,
                    h('div', { class: 'row' }, countEl, h('div', { style: { flex: '1' } }), presetSelect, addBtn),
                    listBox),
                editorBox,
            );
            drawList();
        },
    });
})();
