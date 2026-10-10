'use strict';
// Statystyki aktywności (moduł "activity") - wykres dzień po dniu i ranking, bez bibliotek
(() => {
    const { h, toast, busy, card } = window.KropkaPanel;

    const fmtNum = n => Number(n).toLocaleString('pl-PL');
    const fmtVoice = minutes => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`);
    const METRICS = {
        messages: { label: '💬 Wiadomości', value: r => r.messages, format: fmtNum },
        voice: { label: '🎙️ Głos', value: r => r.voiceMinutes, format: fmtVoice },
        users: { label: '👥 Aktywne osoby', value: r => r.activeUsers, format: fmtNum },
    };

    // "2026-10-11" -> "nd. 11.10"
    function dayLabel(iso) {
        const [y, m, d] = iso.split('-').map(Number);
        const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('pl-PL', { weekday: 'short', timeZone: 'UTC' });
        return `${weekday} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
    }

    // Poziome słupki: etykieta | pasek (szerokość w %) | wartość
    function bars(rows, value, format, label) {
        const max = Math.max(1, ...rows.map(value));
        return h('div', { class: 'stack', style: { gap: '5px' } }, rows.map(r => h('div', {
            style: { display: 'grid', 'grid-template-columns': '96px minmax(0, 1fr) 96px', gap: '10px', 'align-items': 'center' },
            title: `${label(r)}: ${format(value(r))}`,
        },
        h('span', { class: 'faint', style: { 'font-size': '12px', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' } }, label(r)),
        h('div', { class: 'progress', style: { margin: '0', height: '10px' } }, h('div', { style: { width: `${(value(r) / max) * 100}%` } })),
        h('span', { class: 'muted', style: { 'font-size': '13px', 'text-align': 'right', 'font-family': 'var(--mono)' } }, format(value(r))))));
    }

    function segmented(options, current, onPick) {
        const buttons = options.map(([key, text]) => h('button', {
            type: 'button',
            class: key === current ? 'active' : '',
            onclick: e => {
                for (const b of buttons) b.classList.toggle('active', b === e.currentTarget);
                onPick(key);
            },
        }, text));
        return h('div', { class: 'segmented' }, buttons);
    }

    function avatar(url) {
        return url
            ? h('img', { src: url, alt: '', style: { width: '26px', height: '26px', 'border-radius': '50%', 'vertical-align': 'middle', 'margin-right': '8px' } })
            : null;
    }

    window.KropkaPanel.register('activity', {
        async render(container, ctx) {
            let days = 30;
            let metric = 'messages';
            let data = await ctx.api(`/overview?days=${days}`);

            const statsBox = h('div', { class: 'stats' });
            const chartBox = h('div');
            const topBox = h('div');
            const voiceBox = h('div');
            const channelsBox = h('div');
            const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));

            function people(list, { voiceFirst = false } = {}) {
                if (!list.length) return h('div', { class: 'empty' }, 'Brak danych w tym okresie.');
                return h('ol', { class: 'queue-list' }, list.map((u, i) => h('li', null,
                    h('span', { class: 'idx' }, ['🥇', '🥈', '🥉'][i] ?? i + 1),
                    h('div', { class: 't' },
                        h('span', null, avatar(u.avatar), u.name),
                        h('small', null, u.left ? 'nie ma już na serwerze' : voiceFirst ? `${fmtNum(u.messages)} wiadomości` : `${fmtVoice(u.voiceMinutes)} na kanałach głosowych`)),
                    h('span', { class: 'd' }, voiceFirst ? fmtVoice(u.voiceMinutes) : `${fmtNum(u.messages)} wiad.`),
                    h('span'))));
            }

            function draw() {
                const t = data.totals;
                const activeDays = data.series.filter(d => d.messages > 0).length || 1;
                statsBox.replaceChildren(
                    stat(`Wiadomości (${data.days} dni)`, fmtNum(t.messages)),
                    stat('Czas na głosowych', fmtVoice(t.voiceMinutes)),
                    stat('Aktywne osoby', fmtNum(t.activeUsers)),
                    stat('Średnio dziennie', fmtNum(Math.round(t.messages / activeDays))),
                    stat('Teraz na głosowych', fmtNum(data.inVoice)));

                const m = METRICS[metric];
                // najnowszy dzień na górze
                const rows = [...data.series].reverse();
                chartBox.replaceChildren(rows.some(r => m.value(r) > 0)
                    ? bars(rows, m.value, m.format, r => dayLabel(r.day))
                    : h('div', { class: 'empty' }, h('div', { class: 'big' }, '📭'), 'Brak danych - statystyki zbierają się od włączenia modułu.'));
                topBox.replaceChildren(people(data.top));
                voiceBox.replaceChildren(people(data.topVoice, { voiceFirst: true }));
                channelsBox.replaceChildren(data.channels.length
                    ? bars(data.channels, c => c.messages, fmtNum, c => (c.name ? `#${c.name}` : 'usunięty kanał'))
                    : h('div', { class: 'empty' }, 'Brak danych.'));
            }

            async function reload() {
                data = await ctx.api(`/overview?days=${days}`);
                draw();
            }

            const resetBtn = h('button', { class: 'btn btn-danger btn-sm' }, 'Wyczyść statystyki');
            resetBtn.addEventListener('click', () => {
                if (!confirm('Na pewno usunąć wszystkie statystyki aktywności tego serwera? Tego nie da się cofnąć.')) return;
                busy(resetBtn, async () => {
                    await ctx.api('/stats', { method: 'DELETE' });
                    toast('Statystyki wyczyszczone');
                    await reload();
                });
            });

            container.append(
                statsBox,
                card('📊', 'Dzień po dniu', 'Dzisiaj na górze. Najedź na słupek, żeby zobaczyć dokładną wartość.',
                    h('div', { class: 'row' },
                        segmented(Object.entries(METRICS).map(([k, v]) => [k, v.label]), metric, key => { metric = key; draw(); }),
                        h('div', { style: { flex: '1' } }),
                        segmented([[7, '7 dni'], [30, '30 dni'], [90, '90 dni']], days, key => {
                            days = key;
                            reload().catch(err => toast(err.message, 'error'));
                        })),
                    chartBox),
                h('div', { class: 'grid-2', style: { 'align-items': 'start' } },
                    card('🏆', 'Najaktywniejsi', 'Najwięcej wiadomości w wybranym okresie.', topBox),
                    card('🎙️', 'Najwięcej na głosowych', 'Bez kanału AFK i (domyślnie) bez ogłuszonych.', voiceBox)),
                card('💬', 'Najpopularniejsze kanały', 'Wiadomości w wątkach liczą się do kanału nadrzędnego.', channelsBox),
                card('🧹', 'Dane', 'Statystyki komendy /aktywnosc i tej strony.', h('div', { class: 'row' }, resetBtn)),
            );
            draw();

            const timer = setInterval(() => {
                if (!document.hidden) reload().catch(() => {});
            }, 120_000);
            ctx.onLeave(() => clearInterval(timer));
        },
    });
})();
