'use strict';
// Auto kanały (moduł "autochannels"): kanały tymczasowe, które teraz istnieją
(() => {
    const { h, busy, card } = window.KropkaPanel;

    function ago(ms) {
        const min = Math.max(0, Math.round((Date.now() - ms) / 60_000));
        if (min < 1) return 'przed chwilą';
        if (min < 60) return `${min} min temu`;
        return `${Math.floor(min / 60)} h ${min % 60} min temu`;
    }

    window.KropkaPanel.register('autochannels', {
        async render(container, ctx) {
            let data = await ctx.api('/active');
            const listBox = h('div', { class: 'stack' });

            function draw() {
                if (!data.channels.length) {
                    listBox.replaceChildren(h('div', { class: 'empty' }, 'Teraz nie ma żadnych kanałów tymczasowych.'));
                    return;
                }
                listBox.replaceChildren(h('ol', { class: 'queue-list' }, data.channels.map((c, i) => h('li', null,
                    h('span', { class: 'idx' }, i + 1),
                    h('div', { class: 't' },
                        h('span', null, `🔊 ${c.name ?? '(kanał usunięty)'}`),
                        h('small', null, [
                            `właściciel: ${c.owner.name ?? c.owner.id}`,
                            c.creatorName ? `z „${c.creatorName}”` : null,
                            c.locked ? '🔒 zablokowany' : null,
                            c.hidden ? '🙈 ukryty' : null,
                            `utworzony ${ago(c.createdAt)}`,
                        ].filter(Boolean).join(' · '))),
                    h('span', { class: 'd' }, `${c.members}${c.userLimit ? `/${c.userLimit}` : ''} os.`),
                    h('span')))));
            }

            const refreshBtn = h('button', { class: 'btn btn-sm btn-ghost' }, '↻ Odśwież');
            refreshBtn.addEventListener('click', () => busy(refreshBtn, async () => {
                data = await ctx.api('/active');
                draw();
            }));
            const poller = setInterval(async () => {
                if (document.hidden) return;
                try {
                    data = await ctx.api('/active');
                    draw();
                } catch { /* spróbujemy za chwilę */ }
            }, 30_000);
            ctx.onLeave(() => clearInterval(poller));

            container.append(card('🔊', 'Kanały tymczasowe teraz', 'Pusty kanał znika sam po kilku sekundach. Właściciel steruje nim przyciskami na czacie kanału albo komendą /kanal.',
                listBox, h('div', { class: 'row end' }, refreshBtn)));
            draw();
        },
    });
})();
