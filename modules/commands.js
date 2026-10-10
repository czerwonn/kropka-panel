'use strict';
// Włączanie/wyłączanie pojedynczych komend (moduł "commands")
(() => {
    const { h, toast, busy, card, switchInput } = window.KropkaPanel;

    window.KropkaPanel.register('commands', {
        async render(container, ctx) {
            const { commands } = await ctx.api('/list');
            let disabled = new Set(ctx.config().disabledCommands);
            const saveBtn = h('button', { class: 'btn btn-primary' }, 'Zapisz');
            const filter = h('input', { class: 'input', placeholder: 'Szukaj komendy…' });
            const list = h('div', { class: 'stack' });

            function draw() {
                const q = filter.value.trim().toLowerCase();
                const groups = new Map();
                for (const c of commands) {
                    if (q && !c.name.includes(q) && !(c.description ?? '').toLowerCase().includes(q)) continue;
                    const key = c.moduleLabel ?? 'Podstawowe';
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key).push(c);
                }
                list.replaceChildren(...[...groups].map(([label, cmds]) => h('div', { class: 'stack', style: { gap: '6px' } },
                    h('h4', { class: 'cat-title' }, label),
                    cmds.map(c => h('div', { class: 'cmd-row' },
                        h('code', null, `/${c.name}`),
                        h('span', { class: 'muted' }, c.description),
                        switchInput(!disabled.has(c.name), on => {
                            if (on) disabled.delete(c.name);
                            else disabled.add(c.name);
                        }))))));
                if (!groups.size) list.append(h('div', { class: 'empty' }, 'Nic nie pasuje.'));
            }
            filter.addEventListener('input', draw);
            draw();

            saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
                const config = await ctx.saveConfig({ disabledCommands: [...disabled] });
                disabled = new Set(config.disabledCommands);
                toast('Zapisano ✓');
            }));

            container.append(card('⌨️', 'Komendy na tym serwerze', 'Wyłączona komenda odpowie, że jest niedostępna. Komendy z wyłączonych modułów i tak nie działają.',
                filter, list, h('div', { class: 'row end' }, saveBtn)));
        },
    });
})();
