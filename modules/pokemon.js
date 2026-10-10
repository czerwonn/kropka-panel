'use strict';
// Najbliższe eventy Pokémon GO (moduł "pokemon")
(() => {
    const { h, card } = window.KropkaPanel;

    window.KropkaPanel.register('pokemon', {
        async render(container, ctx) {
            const { events } = await ctx.api('/upcoming');
            container.append(card('📅', 'Najbliższe eventy',
                ctx.isBotOwner ? 'Listę zmieniasz w zakładce Bot → Eventy Pokémon GO.' : 'Listę eventów prowadzi właściciel bota.',
                events.length === 0
                    ? h('div', { class: 'empty' }, 'Brak nadchodzących eventów.')
                    : h('div', { class: 'stack', style: { gap: '8px' } }, events.map(ev => h('div', { class: 'event-line' },
                        h('b', null, ev.date),
                        h('span', { class: 'pink' }, ev.type),
                        h('span', null, `${ev.pokemon} · ${ev.move} · ${ev.time}`)))),
                ctx.isBotOwner ? h('div', { class: 'row' }, h('a', { class: 'btn btn-sm', href: '#/bot/eventy' }, 'Edytuj eventy ▸')) : null));
        },
    });
})();
