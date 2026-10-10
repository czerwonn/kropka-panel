'use strict';
// Ranking reputacji i zerowanie punktów (moduł "reputation") - zasady i nagrody są w formularzu powyżej
(() => {
    const { h, toast, busy, card } = window.KropkaPanel;
    const fmt = n => Number(n).toLocaleString('pl-PL');
    const AVATAR_STYLE = { width: '26px', height: '26px', 'border-radius': '50%', 'vertical-align': 'middle', 'margin-right': '8px' };

    window.KropkaPanel.register('reputation', {
        async render(container, ctx) {
            let data = await ctx.api('/ranking');
            const listBox = h('div');

            async function reload() {
                data = await ctx.api('/ranking');
                draw();
            }

            function draw() {
                if (!data.rows.length) {
                    listBox.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'big' }, '👍'), 'Nikt jeszcze nie ma punktów. Członkowie dają je komendą /rep daj.'));
                    return;
                }
                listBox.replaceChildren(h('ol', { class: 'queue-list' }, data.rows.map((u, i) => {
                    const resetBtn = h('button', { class: 'btn btn-sm btn-ghost', title: 'Wyzeruj punkty tej osoby' }, 'Wyzeruj');
                    resetBtn.addEventListener('click', () => {
                        if (!confirm(`Wyzerować reputację osoby ${u.name}? Zniknie też historia jej punktów.`)) return;
                        busy(resetBtn, async () => {
                            await ctx.api(`/users/${u.userId}`, { method: 'DELETE' });
                            toast(`Wyzerowano punkty: ${u.name}`);
                            await reload();
                        });
                    });
                    return h('li', null,
                        h('span', { class: 'idx' }, ['🥇', '🥈', '🥉'][i] ?? i + 1),
                        h('div', { class: 't' },
                            h('span', null,
                                u.avatar ? h('img', { src: u.avatar, alt: '', style: AVATAR_STYLE }) : null,
                                u.name),
                            h('small', null, `👍 ${fmt(u.plus)} · 👎 ${fmt(u.minus)}${u.left ? ' · nie ma już na serwerze' : ''}`)),
                        h('span', { class: 'd' }, `${fmt(u.score)} pkt`),
                        resetBtn);
                })));
            }

            container.append(card('🏆', 'Ranking reputacji',
                data.count > data.rows.length ? `Pokazuję 50 najlepszych z ${fmt(data.count)} osób.` : 'Wszyscy, którzy mają punkty.',
                listBox));
            draw();
        },
    });
})();
