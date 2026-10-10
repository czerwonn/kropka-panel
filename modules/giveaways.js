'use strict';
// Konkursy (moduł "giveaways") - nowy konkurs, trwające i zakończone
(() => {
    const { h, toast, busy, field, card, channelSelect, roleSelect, numberInput, extLink } = window.KropkaPanel;

    function plural(n, one, few, many) {
        n = Math.abs(n);
        if (n === 1) return one;
        const d = n % 10;
        const t = n % 100;
        return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
    }

    // 93784000 -> "1 d 2 h"
    function timeLeft(ms) {
        let s = Math.round(ms / 1000);
        if (s <= 0) return 'chwilę';
        if (s < 60) return `${s} s`;
        const parts = [];
        for (const [unit, size] of [['d', 86400], ['h', 3600], ['min', 60]]) {
            if (s >= size) {
                parts.push(`${Math.floor(s / size)} ${unit}`);
                s %= size;
            }
            if (parts.length === 2) break;
        }
        return parts.join(' ');
    }

    const dateTime = ts => new Date(ts).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
    const names = list => list.map(w => w.name ?? w.id).join(', ');
    const entriesText = n => `${n} ${plural(n, 'uczestnik', 'uczestników', 'uczestników')}`;

    window.KropkaPanel.register('giveaways', {
        async render(container, ctx) {
            let data = await ctx.api('');
            const roleName = id => ctx.roles.find(r => r.id === id)?.name ?? 'usunięta rola';

            // ---------- nowy konkurs
            const form = {
                channel: channelSelect(ctx.channels, null),
                prize: h('input', { class: 'input', maxLength: 200, placeholder: 'np. Nitro na miesiąc' }),
                duration: h('input', { class: 'input', maxLength: 20, value: '1d', placeholder: 'np. 30m, 2h, 1d12h' }),
                role: roleSelect(ctx.roles, null, { none: '— bez wymaganej roli —' }),
            };
            const values = { winners: 1, level: 0, money: 0 };
            const winnersInput = numberInput(1, 1, data.limits.maxWinners, v => { values.winners = v; });
            const levelInput = numberInput(0, 0, 1000, v => { values.level = v; });
            const moneyInput = numberInput(0, 0, data.limits.maxMoney, v => { values.money = v; });
            levelInput.disabled = !data.levels;
            moneyInput.disabled = !data.economy;

            const createBtn = h('button', { class: 'btn btn-primary' }, '🎉 Rozpocznij konkurs');
            createBtn.addEventListener('click', () => busy(createBtn, async () => {
                data = await ctx.api('', {
                    method: 'POST',
                    body: {
                        channelId: form.channel.value,
                        prize: form.prize.value,
                        duration: form.duration.value,
                        winners: values.winners,
                        requiredRoleId: form.role.value || null,
                        requiredLevel: data.levels ? values.level : 0,
                        money: data.economy ? values.money : 0,
                    },
                });
                form.prize.value = '';
                toast('Konkurs wystartował ✓');
                draw();
            }));

            const createCard = card('🎉', 'Nowy konkurs', 'To samo co /konkurs start. Wymagania z ustawień (wiek konta, staż) i dodatkowe losy dochodzą automatycznie.',
                h('div', { class: 'grid-2' },
                    field('Kanał', form.channel),
                    field('Czas trwania', form.duration, 'Od 10 s do 60 dni, np. 30m, 2h, 1d12h.')),
                field('Nagroda', form.prize),
                h('div', { class: 'grid-2' },
                    field('Liczba zwycięzców', winnersInput),
                    field('Wymagana rola', form.role)),
                h('div', { class: 'grid-2' },
                    field('Wymagany poziom', levelInput, data.levels ? '0 = bez wymagań.' : 'Włącz moduł Poziomy, żeby wymagać poziomu.'),
                    field('Nagroda w walucie (dla każdego)', moneyInput, data.economy ? '0 = bez nagrody. Wypłacana automatycznie.' : 'Włącz moduł Ekonomia, żeby dawać nagrody w walucie.')),
                h('div', { class: 'row end' }, createBtn));

            // ---------- listy
            const activeBox = h('div', { class: 'list-items' });
            const endedBox = h('div', { class: 'list-items' });
            const activeTitle = h('span');
            const activeCard = card('⏳', 'Trwające konkursy', 'Kończą się same o czasie – także po restarcie bota.', activeBox);
            activeCard.querySelector('h3').replaceChildren(activeTitle);
            const endedCard = card('🏁', 'Zakończone', 'Ostatnie 20 konkursów. Ponowne losowanie pomija dotychczasowych zwycięzców.', endedBox);

            async function action(btn, path, opts, message) {
                await busy(btn, async () => {
                    data = await ctx.api(path, opts);
                    if (message) toast(message);
                    draw();
                });
            }

            function openLink(g) {
                if (!g.messageUrl) return null;
                const link = extLink(g.messageUrl, 'Otwórz ↗');
                link.className = 'btn btn-sm btn-ghost';
                return link;
            }

            function requirements(g) {
                const parts = [];
                if (g.requiredRoleId) parts.push(`rola @${roleName(g.requiredRoleId)}`);
                if (g.requiredLevel > 0) parts.push(`poziom ${g.requiredLevel}+`);
                if (g.moneyText) parts.push(`nagroda ${g.moneyText}`);
                return parts.length ? ` · ${parts.join(' · ')}` : '';
            }

            function activeRow(g) {
                const endBtn = h('button', { class: 'btn btn-sm' }, 'Zakończ teraz');
                endBtn.addEventListener('click', () => {
                    if (confirm(`Zakończyć konkurs „${g.prize}” i wylosować zwycięzców?`)) action(endBtn, `/${g.id}/end`, { method: 'POST' }, 'Konkurs zakończony ✓');
                });
                const delBtn = h('button', { class: 'btn btn-sm btn-danger' }, 'Usuń');
                delBtn.addEventListener('click', () => {
                    if (confirm(`Usunąć konkurs „${g.prize}” razem z wiadomością? Nikt nie wygra.`)) action(delBtn, `/${g.id}`, { method: 'DELETE' }, 'Usunięto konkurs');
                });
                return h('div', { class: 'list-item' },
                    h('div', { class: 'stack', style: { flex: '1', gap: '4px', 'min-width': '0' } },
                        h('b', null, `#${g.id} · ${g.prize}`),
                        h('div', { class: 'muted' }, `#${g.channelName ?? 'usunięty kanał'} · koniec za ${timeLeft(g.endsAt - Date.now())} (${dateTime(g.endsAt)})`),
                        h('div', { class: 'faint' }, `${entriesText(g.entries)} · zwycięzców: ${g.winnerCount}${requirements(g)}`)),
                    h('div', { class: 'list-item-actions' }, openLink(g), endBtn, delBtn));
            }

            function endedRow(g) {
                const rerollBtn = h('button', { class: 'btn btn-sm' }, '🔁 Losuj ponownie');
                rerollBtn.addEventListener('click', () => {
                    const answer = prompt(`Ilu nowych zwycięzców wylosować w konkursie „${g.prize}”?`, '1');
                    if (answer === null) return;
                    const count = Number(answer);
                    if (!Number.isInteger(count) || count < 1 || count > data.limits.maxReroll) {
                        toast(`Podaj liczbę od 1 do ${data.limits.maxReroll}.`, 'error');
                        return;
                    }
                    action(rerollBtn, `/${g.id}/reroll`, { method: 'POST', body: { count } }, 'Wylosowano ponownie ✓');
                });
                const delBtn = h('button', { class: 'btn btn-sm btn-danger' }, 'Usuń');
                delBtn.addEventListener('click', () => {
                    if (confirm(`Usunąć konkurs „${g.prize}” z listy i jego wiadomość?`)) action(delBtn, `/${g.id}`, { method: 'DELETE' }, 'Usunięto konkurs');
                });
                return h('div', { class: 'list-item' },
                    h('div', { class: 'stack', style: { flex: '1', gap: '4px', 'min-width': '0' } },
                        h('b', null, `#${g.id} · ${g.prize}`),
                        h('div', { class: 'muted' }, `Zakończony ${dateTime(g.endedAt ?? g.endsAt)} · ${entriesText(g.entries)}`),
                        h('div', null, g.winners.length ? `🏆 ${names(g.winners)}` : 'Brak zwycięzców'),
                        g.rerolls.length ? h('div', { class: 'faint' }, `Ponowne losowanie: ${names(g.rerolls)}`) : null),
                    h('div', { class: 'list-item-actions' }, openLink(g), rerollBtn, delBtn));
            }

            function draw() {
                activeTitle.textContent = `Trwające konkursy (${data.active.length}/${data.limits.maxActive})`;
                activeBox.replaceChildren(...(data.active.length
                    ? data.active.map(activeRow)
                    : [h('div', { class: 'empty' }, 'Nie trwa żaden konkurs. Utwórz pierwszy powyżej albo komendą /konkurs start.')]));
                endedBox.replaceChildren(...(data.ended.length
                    ? data.ended.map(endedRow)
                    : [h('div', { class: 'empty' }, 'Jeszcze żaden konkurs się nie zakończył.')]));
            }

            // Odświeżanie co 30 s (licznik uczestników, konkursy kończące się same)
            const poller = setInterval(async () => {
                if (document.hidden || createCard.contains(document.activeElement)) return;
                try {
                    data = await ctx.api('');
                    draw();
                } catch { /* chwilowy błąd - spróbujemy za 30 s */ }
            }, 30_000);
            ctx.onLeave(() => clearInterval(poller));

            container.append(createCard, activeCard, endedCard);
            draw();
        },
    });
})();
