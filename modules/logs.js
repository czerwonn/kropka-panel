'use strict';
// Logi (moduł "logs"): czy bot ma potrzebne uprawnienia, dokąd idą logi i ranking zaproszeń
(() => {
    const { h, card } = window.KropkaPanel;
    const num = n => Number(n).toLocaleString('pl-PL');

    window.KropkaPanel.register('logs', {
        async render(container, ctx) {
            const status = await ctx.api('/status');

            const warnings = [];
            if (!status.permissions.viewAuditLog) {
                warnings.push('Bot nie ma uprawnienia „Wyświetlanie dziennika zdarzeń” - logi nie pokażą, kto wykonał akcję (ban, wyrzucenie, zmiany kanałów), '
                    + 'a zmiany robione przez samego bota (liczniki, auto kanały, zgłoszenia) też trafią do logu serwera.');
            }
            if (!status.permissions.manageGuild) {
                warnings.push('Bot nie ma uprawnienia „Zarządzanie serwerem” - nie widzi zaproszeń, więc nie ustali, kto kogo zaprosił.');
            }

            const categoryRows = status.categories.map(c => {
                const state = !c.channelId ? ['off', 'wyłączone'] : c.botCanSend ? ['on', 'działa'] : ['off', '⚠ brak uprawnień'];
                return h('div', { class: 'cmd-row' },
                    h('code', null, c.label),
                    h('span', { class: 'muted' }, c.channelId ? `# ${c.channelName}` : 'nie wybrano kanału'),
                    h('span', { class: `badge ${state[0]}` }, state[1]));
            });

            const ranking = status.ranking.length
                ? h('ol', { class: 'queue-list' }, status.ranking.map((r, i) => h('li', null,
                    h('span', { class: 'idx' }, i + 1),
                    h('div', { class: 't' },
                        h('span', null, r.name ?? `użytkownik ${r.id}`),
                        h('small', null, `łącznie ${num(r.total)} · wyszło ${num(r.total - r.stayed)}`)),
                    h('span', { class: 'd' }, `${num(r.stayed)} os.`),
                    h('span'))))
                : h('div', { class: 'empty' }, status.tracking ? 'Jeszcze nikt nikogo nie zaprosił (odkąd bot liczy zaproszenia).' : 'Brak danych.');

            container.append(
                card('🛡️', 'Stan logów', 'Kanały ustawiasz wyżej. Logi nie pingują nikogo (poza rolami przy nowych kontach).',
                    warnings.length
                        ? h('div', { class: 'stack', style: { gap: '8px' } }, warnings.map(w => h('div', { class: 'off-banner' }, `⚠ ${w}`)))
                        : h('div', { class: 'muted' }, '✓ Bot ma uprawnienia do dziennika zdarzeń i zaproszeń.'),
                    h('div', { class: 'stack', style: { gap: '6px' } }, categoryRows)),
                card('📨', 'Ranking zaproszeń',
                    status.tracking ? 'Liczą się osoby, które nadal są na serwerze. To samo co /zaproszenia ranking.' : 'Śledzenie zaproszeń teraz nie działa - moduł jest wyłączony albo bot nie ma uprawnienia „Zarządzanie serwerem”.',
                    ranking),
            );
        },
    });
})();
