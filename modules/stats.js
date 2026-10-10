'use strict';
// Statystyki (moduł "stats"): liczniki w nazwach kanałów - lista, podgląd nazw i tworzenie kanału licznika
(() => {
    const { h, toast, busy, field, card, renderControl, channelSelect, roleSelect, switchInput, clone } = window.KropkaPanel;

    function inMinutes(ms) {
        const min = Math.ceil((ms - Date.now()) / 60_000);
        return min <= 0 ? 'za chwilę' : `za ${min} min`;
    }

    window.KropkaPanel.register('stats', {
        async render(container, ctx) {
            const fieldDef = ctx.meta.settings.find(f => f.key === 'counters');
            let preview = await ctx.api('/preview');
            let draft = clone(ctx.config().counters ?? []);
            let saved = JSON.stringify(draft);
            const dirty = () => JSON.stringify(draft) !== saved;
            const typeLabel = value => preview.types.find(t => t.value === value)?.label ?? value;

            // --- lista liczników (zwykły edytor listy z panelu) + zapis
            const editorBox = h('div');
            const saveBtn = h('button', { class: 'btn btn-primary' }, 'Zapisz liczniki');
            function drawEditor() {
                editorBox.replaceChildren(renderControl(fieldDef, draft, value => {
                    draft = value;
                    saveBtn.disabled = !dirty();
                }, ctx));
                saveBtn.disabled = !dirty();
            }

            // --- podgląd: jak będą wyglądać nazwy i co blokuje zmianę
            const previewBox = h('div', { class: 'stack', style: { gap: '8px' } });
            function drawPreview() {
                if (!preview.counters.length) {
                    previewBox.replaceChildren(h('div', { class: 'empty' }, 'Brak liczników. Dodaj licznik do istniejącego kanału albo utwórz nowy kanał poniżej.'));
                    return;
                }
                previewBox.replaceChildren(...preview.counters.map(c => {
                    let state;
                    if (c.problem) state = h('span', { class: 'pink' }, `⚠ ${c.problem}`);
                    else if (c.channelName === c.expected) state = h('span', { class: 'muted' }, '✓ aktualna');
                    else state = h('span', { class: 'muted' }, `obecnie „${c.channelName}” · zmiana ${c.nextRenameAt ? inMinutes(c.nextRenameAt) : 'za chwilę'}`);
                    return h('div', { class: 'event-line' },
                        h('b', null, `${c.index + 1}. ${typeLabel(c.type)}`),
                        h('span', null, c.expected ?? '-'),
                        state);
                }));
            }

            async function reloadPreview() {
                preview = await ctx.api('/preview');
                drawPreview();
            }

            async function save() {
                const config = await ctx.saveConfig({ counters: draft });
                draft = clone(config.counters ?? []);
                saved = JSON.stringify(draft);
                drawEditor();
                await reloadPreview();
            }
            saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
                await save();
                toast('Zapisano liczniki ✓');
            }));

            // --- nowy kanał licznika
            const typeSelect = h('select', { class: 'input' }, preview.types.map(t => h('option', { value: t.value }, t.label)));
            const nameInput = h('input', { class: 'input', maxLength: 90, value: preview.types[0]?.name ?? '' });
            const roleSel = roleSelect(ctx.roles, null, { none: '— wybierz rolę —' });
            const roleField = field('Rola', roleSel, 'Licznik pokaże, ile osób ma tę rolę.');
            roleField.hidden = true;
            const parentSel = channelSelect(ctx.channels, null, { kinds: ['category'], none: '— bez kategorii —' });
            let round = false;
            typeSelect.addEventListener('change', () => {
                nameInput.value = preview.types.find(t => t.value === typeSelect.value)?.name ?? '';
                roleField.hidden = typeSelect.value !== 'role';
            });

            const createBtn = h('button', { class: 'btn btn-primary' }, 'Utwórz kanał');
            createBtn.addEventListener('click', () => busy(createBtn, async () => {
                if (dirty()) await save(); // najpierw niezapisane zmiany w liście
                const res = await ctx.api('/create', {
                    method: 'POST',
                    body: { type: typeSelect.value, roleId: roleSel.value || null, name: nameInput.value, round, parentId: parentSel.value || null },
                });
                if (!ctx.channels.some(c => c.id === res.channel.id)) ctx.channels.push(res.channel);
                // pusty zapis = świeże ustawienia z bota (lista z nowym licznikiem)
                const config = await ctx.saveConfig({});
                draft = clone(config.counters ?? []);
                saved = JSON.stringify(draft);
                drawEditor();
                await reloadPreview();
                toast(`Utworzono kanał „${res.channel.name}” ✓`);
            }));

            const refreshBtn = h('button', { class: 'btn btn-sm btn-ghost' }, '↻ Odśwież podgląd');
            refreshBtn.addEventListener('click', () => busy(refreshBtn, reloadPreview));

            container.append(
                card('📊', 'Liczniki', 'Nazwa kanału z {count} (wartość) i {role} (nazwa roli). Bot zmienia nazwę najwyżej raz na 10 minut na kanał - taki jest limit Discorda.',
                    editorBox,
                    h('div', { class: 'row end' }, saveBtn)),
                card('👀', 'Podgląd', 'Tak będą wyglądać nazwy kanałów po najbliższej zmianie.',
                    previewBox,
                    h('div', { class: 'row end' }, refreshBtn)),
                card('➕', 'Nowy kanał licznika', 'Bot utworzy kanał głosowy, na który nikt nie może wejść, i od razu doda go do listy.',
                    h('div', { class: 'grid-2' },
                        field('Co liczyć', typeSelect),
                        field('Kategoria', parentSel)),
                    field('Nazwa kanału', nameInput, '{count} = wartość licznika, {role} = nazwa roli.'),
                    roleField,
                    switchInput(false, value => { round = value; }, 'Zaokrąglaj tysiące (1,2 tys.)'),
                    h('div', { class: 'row end' }, createBtn)),
            );
            drawEditor();
            drawPreview();
        },
    });
})();
