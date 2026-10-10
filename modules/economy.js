'use strict';
// Ekonomia: pieniądze w obiegu, ranking, zmiana salda, magazyn sklepu i historia (moduł "economy").
// Przedmioty sklepu edytuje się w formularzu ustawień powyżej (lista „Przedmioty w sklepie”).
(() => {
    const { h, toast, busy, field, card, avatarUrl } = window.KropkaPanel;

    function plural(n, one, few, many) {
        n = Math.abs(n);
        if (n === 1) return one;
        const d = n % 10;
        const t = n % 100;
        return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
    }
    const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
    const avatar = m => h('img', { class: 'gicon sm', src: avatarUrl(m.userId, m.avatar, 64), alt: '' });
    const when = ms => new Date(ms).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });

    function personRow(m, { num, sub, right = [] } = {}) {
        return h('div', { class: 'list-row' },
            num != null && h('span', { class: 'num' }, num),
            avatar(m),
            h('div', { style: { flex: '1', 'min-width': '0' } },
                h('div', { style: { 'font-weight': '600', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' } },
                    m.name ?? m.userId, m.inGuild === false ? h('span', { class: 'faint' }, ' (poza serwerem)') : null),
                sub && h('div', { class: 'faint', style: { 'font-size': '12px' } }, sub)),
            ...right);
    }

    window.KropkaPanel.register('economy', {
        async render(container, ctx) {
            let data = await ctx.api('/overview');
            let selected = null;

            // Kwota z symbolem waluty jak na Discordzie (własne emoji <:nazwa:id> pokazujemy jako :nazwa:)
            function money(n) {
                const c = data.currency;
                const symbol = String(c.symbol ?? '').trim().replace(/^<a?:(\w+):\d+>$/, ':$1:');
                const value = Number(n).toLocaleString('pl-PL');
                if (!symbol) return c.name ? `${value} ${c.name}` : value;
                return c.position === 'before' ? `${symbol} ${value}` : `${value} ${symbol}`;
            }
            const signed = n => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : money(0));

            async function reload() {
                data = await ctx.api('/overview');
                drawStats();
                drawTop();
                drawItems();
                drawLog();
            }

            // ---------- podsumowanie ----------
            const statsBox = h('div', { class: 'stats' });
            function drawStats() {
                const t = data.totals;
                statsBox.replaceChildren(
                    stat('W obiegu', money(t.total)),
                    stat('W portfelach', money(t.wallet)),
                    stat('W bankach', money(t.bank)),
                    stat('Konta', t.accounts.toLocaleString('pl-PL')),
                );
            }

            // ---------- zmiana salda ----------
            const search = h('input', { class: 'input', placeholder: 'Nick albo ID użytkownika', maxLength: 100 });
            const searchBtn = h('button', { class: 'btn', type: 'submit' }, 'Szukaj');
            const results = h('div', { class: 'list-editor' });
            const chosen = h('div', { class: 'stack' });
            const action = h('select', { class: 'input' },
                h('option', { value: 'add' }, 'Dodaj'),
                h('option', { value: 'remove' }, 'Zabierz (najwyżej tyle, ile ma)'),
                h('option', { value: 'set' }, 'Ustaw dokładnie'),
                h('option', { value: 'reset' }, 'Wyzeruj całe konto'));
            const place = h('select', { class: 'input' },
                h('option', { value: 'wallet' }, '👛 Portfel'),
                h('option', { value: 'bank' }, '🏦 Bank'));
            const amount = h('input', { class: 'input', type: 'number', min: 0, max: 1000000000000, step: 1, value: 1000 });
            const placeField = field('Gdzie', place);
            const amountField = field('Kwota', amount);
            const applyBtn = h('button', { class: 'btn btn-primary' }, 'Zapisz');
            action.addEventListener('change', () => {
                placeField.hidden = amountField.hidden = action.value === 'reset';
            });

            function select(m) {
                selected = m;
                results.replaceChildren();
                drawChosen();
                applyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            function drawChosen() {
                applyBtn.disabled = !selected;
                chosen.replaceChildren(selected
                    ? personRow(selected, {
                        sub: `Portfel ${money(selected.wallet)} • Bank ${money(selected.bank)}${selected.rank ? ` • #${selected.rank} w rankingu` : ''}`,
                        right: [h('button', { class: 'btn btn-ghost btn-sm', title: 'Odznacz', onclick: () => { selected = null; drawChosen(); } }, '✕')],
                    })
                    : h('div', { class: 'empty', style: { padding: '14px' } }, 'Wyszukaj osobę albo kliknij „Edytuj” w rankingu.'));
            }

            const searchForm = h('form', {
                class: 'row',
                onsubmit: e => {
                    e.preventDefault();
                    const q = search.value.trim();
                    if (!q) return;
                    busy(searchBtn, async () => {
                        const { members } = await ctx.api(`/members?q=${encodeURIComponent(q)}`);
                        results.replaceChildren(...(members.length
                            ? members.map(m => personRow(m, {
                                sub: `@${m.username ?? '?'} • razem ${money(m.total)}`,
                                right: [h('button', { class: 'btn btn-sm', type: 'button', onclick: () => select(m) }, 'Wybierz')],
                            }))
                            : [h('div', { class: 'empty', style: { padding: '14px' } }, 'Nikogo nie znaleziono.')]));
                    });
                },
            }, h('div', { style: { flex: '1', 'min-width': '180px' } }, search), searchBtn);

            applyBtn.addEventListener('click', () => busy(applyBtn, async () => {
                if (!selected) return;
                const body = { userId: selected.userId, action: action.value, place: place.value };
                if (action.value === 'reset') {
                    if (!confirm(`Wyzerować konto osoby ${selected.name}? Zniknie portfel, bank, przedmioty i cooldowny.`)) return;
                } else {
                    const n = Number(amount.value);
                    if (!Number.isInteger(n) || n < (action.value === 'set' ? 0 : 1)) throw new Error('Podaj poprawną kwotę (liczba całkowita).');
                    body.amount = n;
                }
                const res = await ctx.api('/money', { method: 'POST', body });
                selected = res.member;
                drawChosen();
                toast(`Zapisano – ${selected.name}: portfel ${money(selected.wallet)}, bank ${money(selected.bank)} ✓`);
                await reload();
            }));

            // ---------- ranking ----------
            const filter = h('input', { class: 'input', placeholder: 'Filtruj po nazwie…' });
            const topList = h('div', { class: 'list-editor' });
            function drawTop() {
                const q = filter.value.trim().toLowerCase();
                const rows = data.top.filter(m => !q || `${m.name} ${m.username ?? ''}`.toLowerCase().includes(q));
                topList.replaceChildren(...rows.map(m => personRow(m, {
                    num: m.rank,
                    sub: `Portfel ${money(m.wallet)} • Bank ${money(m.bank)}`,
                    right: [
                        h('span', { class: 'badge on' }, money(m.total)),
                        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => select(m) }, 'Edytuj'),
                    ],
                })));
                if (!rows.length) topList.append(h('div', { class: 'empty' }, data.top.length ? 'Nic nie pasuje.' : 'Nikt jeszcze nie ma pieniędzy.'));
            }
            filter.addEventListener('input', drawTop);

            // ---------- magazyn sklepu ----------
            const itemsBox = h('div', { class: 'list-editor' });
            function drawItems() {
                if (!data.items.length) {
                    itemsBox.replaceChildren(h('div', { class: 'empty' }, 'Sklep jest pusty – dodaj przedmioty w ustawieniach powyżej (karta „Sklep”).'));
                    return;
                }
                itemsBox.replaceChildren(...data.items.map(item => {
                    const limited = item.stock >= 0;
                    const restock = limited && h('button', {
                        class: 'btn btn-sm',
                        title: 'Zeruje licznik sprzedanych sztuk – w magazynie znów jest tyle, ile ustawiono',
                        onclick: e => busy(e.currentTarget, async () => {
                            await ctx.api('/restock', { method: 'POST', body: { key: item.key } });
                            toast(`Uzupełniono magazyn: ${item.name} ✓`);
                            await reload();
                        }),
                    }, 'Uzupełnij');
                    return h('div', { class: 'list-row' },
                        h('span', { class: 'num' }, item.emoji && !item.emoji.startsWith('<') ? item.emoji : '•'),
                        h('div', { style: { flex: '1', 'min-width': '0' } },
                            h('div', { style: { 'font-weight': '600' } }, item.name),
                            h('div', { class: 'faint', style: { 'font-size': '12px' } },
                                `Cena ${money(item.price)} • sprzedano ${item.sold.toLocaleString('pl-PL')} szt.`)),
                        limited
                            ? h('span', { class: `badge ${item.left > 0 ? 'on' : 'off'}` }, item.left > 0 ? `zostało ${item.left.toLocaleString('pl-PL')}` : 'wyprzedane')
                            : h('span', { class: 'badge off' }, 'bez limitu'),
                        restock);
                }));
            }

            // ---------- historia ----------
            const logBox = h('div', { class: 'list-editor' });
            function drawLog() {
                if (!data.log.length) {
                    logBox.replaceChildren(h('div', { class: 'empty' }, 'Brak transakcji z ostatnich 30 dni.'));
                    return;
                }
                logBox.replaceChildren(...data.log.map(entry => {
                    const parts = [];
                    if (entry.wallet) parts.push(`👛 ${signed(entry.wallet)}`);
                    if (entry.bank) parts.push(`🏦 ${signed(entry.bank)}`);
                    const net = entry.wallet + entry.bank;
                    return h('div', { class: 'list-row' },
                        h('div', { style: { flex: '1', 'min-width': '0' } },
                            h('div', null, h('b', null, entry.name), h('span', { class: 'muted' }, ` – ${entry.reason}`)),
                            h('div', { class: 'faint', style: { 'font-size': '12px' } }, when(entry.at))),
                        parts.length ? h('span', { class: `badge ${net >= 0 ? 'on' : 'off'}` }, parts.join('  ')) : null);
                }));
            }

            // ---------- reset ----------
            const resetBtn = h('button', { class: 'btn btn-danger' }, 'Wyzeruj ekonomię serwera');
            resetBtn.addEventListener('click', () => {
                const n = data.totals.accounts;
                if (!confirm(`Na pewno wyzerować ekonomię? Zniknie ${n.toLocaleString('pl-PL')} ${plural(n, 'konto', 'konta', 'kont')}, wszystkie przedmioty, cooldowny i stan magazynu.`)) return;
                if (prompt('Wpisz RESET, żeby potwierdzić.') !== 'RESET') {
                    toast('Anulowano – nic się nie zmieniło.');
                    return;
                }
                busy(resetBtn, async () => {
                    const { removed } = await ctx.api('/reset', { method: 'POST', body: { confirm: true } });
                    toast(`Wyzerowano ${removed.toLocaleString('pl-PL')} ${plural(removed, 'konto', 'konta', 'kont')} ✓`);
                    selected = null;
                    drawChosen();
                    await reload();
                });
            });

            drawStats();
            drawChosen();
            drawTop();
            drawItems();
            drawLog();
            container.append(
                statsBox,
                card('💸', 'Zmień saldo', 'Działa jak /eko. Każda zmiana trafia do historii poniżej.',
                    searchForm,
                    results,
                    chosen,
                    h('div', { class: 'grid-3' }, field('Akcja', action), placeField, amountField),
                    h('div', { class: 'row end' }, applyBtn)),
                card('🏆', 'Najbogatsi', data.top.length >= 100 ? 'Pokazuję 100 najbogatszych (portfel + bank).' : 'Portfel + bank.',
                    filter,
                    topList),
                card('📦', 'Magazyn sklepu', 'Sprzedane sztuki i stan magazynu. „Uzupełnij” zeruje licznik sprzedanych sztuk przedmiotu.',
                    itemsBox),
                card('🧾', 'Ostatnie transakcje', 'Ostatnie 40 zmian sald (historia z 30 dni).',
                    logBox),
                card('🧨', 'Strefa niebezpieczna', 'Reset usuwa konta, przedmioty, cooldowny i stan magazynu wszystkich osób.',
                    h('div', { class: 'row' }, resetBtn)),
            );
        },
    });
})();
