'use strict';
// Poziomy: ranking (top 100), szybka zmiana XP i reset (moduł "levels")
(() => {
    const { h, toast, busy, field, card, avatarUrl } = window.KropkaPanel;

    const fmt = n => Number(n).toLocaleString('pl-PL');
    function plural(n, one, few, many) {
        n = Math.abs(n);
        if (n === 1) return one;
        const d = n % 10;
        const t = n % 100;
        return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
    }
    const pct = m => (m.needed > 0 ? Math.min(100, Math.floor((m.current / m.needed) * 100)) : 0);
    const avatar = m => h('img', { class: 'gicon sm', src: avatarUrl(m.userId, m.avatar, 64), alt: '' });
    const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));

    // Wiersz osoby: [miejsce] awatar, nazwa (+ opis), po prawej dodatkowe elementy
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

    window.KropkaPanel.register('levels', {
        async render(container, ctx) {
            let data = await ctx.api('/leaderboard');
            let selected = null;

            // ---------- podsumowanie ----------
            const statsBox = h('div', { class: 'stats' });
            function drawStats() {
                const best = data.entries[0];
                statsBox.replaceChildren(...[
                    stat('Osoby w rankingu', fmt(data.total)),
                    stat('Łącznie XP', fmt(data.totalXp)),
                    stat('Najwyższy poziom', best ? fmt(best.level) : '—'),
                    data.voiceMinutes > 0 ? stat('Godziny na głosowych', fmt(Math.floor(data.voiceMinutes / 60))) : null,
                ].filter(Boolean));
            }

            // ---------- szybka zmiana XP ----------
            const search = h('input', { class: 'input', placeholder: 'Nick albo ID użytkownika', maxLength: 100 });
            const searchBtn = h('button', { class: 'btn', type: 'submit' }, 'Szukaj');
            const results = h('div', { class: 'list-editor' });
            const chosen = h('div', { class: 'stack' });
            const action = h('select', { class: 'input' },
                h('option', { value: 'add' }, 'Dodaj XP'),
                h('option', { value: 'remove' }, 'Zabierz XP'),
                h('option', { value: 'set' }, 'Ustaw dokładnie'),
                h('option', { value: 'reset' }, 'Wyzeruj tę osobę'));
            const amount = h('input', { class: 'input', type: 'number', min: 0, max: 10000000000, step: 1, value: 100 });
            const amountField = field('Ilość XP', amount);
            const applyBtn = h('button', { class: 'btn btn-primary' }, 'Zapisz');
            action.addEventListener('change', () => { amountField.hidden = action.value === 'reset'; });

            function select(m) {
                selected = m;
                results.replaceChildren();
                drawChosen();
                applyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            function drawChosen() {
                if (!selected) {
                    chosen.replaceChildren(h('div', { class: 'empty', style: { padding: '14px' } }, 'Wyszukaj osobę albo kliknij „Edytuj” w rankingu.'));
                    applyBtn.disabled = true;
                    return;
                }
                applyBtn.disabled = false;
                chosen.replaceChildren(
                    personRow(selected, {
                        sub: `Poziom ${fmt(selected.level)} • ${fmt(selected.xp)} XP${selected.rank ? ` • #${selected.rank} w rankingu` : ''}`,
                        right: [h('button', { class: 'btn btn-ghost btn-sm', title: 'Odznacz', onclick: () => { selected = null; drawChosen(); } }, '✕')],
                    }),
                    h('div', { class: 'progress' }, h('div', { style: { width: `${pct(selected)}%` } })),
                    h('div', { class: 'faint', style: { 'font-size': '12px' } }, `${fmt(selected.current)} / ${fmt(selected.needed)} XP do poziomu ${fmt(selected.level + 1)}`));
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
                                sub: `@${m.username ?? '?'} • poziom ${fmt(m.level)} • ${fmt(m.xp)} XP`,
                                right: [h('button', { class: 'btn btn-sm', type: 'button', onclick: () => select(m) }, 'Wybierz')],
                            }))
                            : [h('div', { class: 'empty', style: { padding: '14px' } }, 'Nikogo nie znaleziono.')]));
                    });
                },
            }, h('div', { style: { flex: '1', 'min-width': '180px' } }, search), searchBtn);

            applyBtn.addEventListener('click', () => busy(applyBtn, async () => {
                if (!selected) return;
                const body = { userId: selected.userId, action: action.value };
                if (action.value !== 'reset') {
                    const n = Number(amount.value);
                    if (!Number.isInteger(n) || n < (action.value === 'set' ? 0 : 1)) throw new Error('Podaj poprawną liczbę XP.');
                    body.amount = n;
                } else if (!confirm(`Wyzerować XP osoby ${selected.name}? Role za poziomy zostaną jej zabrane.`)) {
                    return;
                }
                const res = await ctx.api('/xp', { method: 'POST', body });
                selected = res.member;
                drawChosen();
                toast(`Zapisano – ${selected.name}: poziom ${selected.level}, ${fmt(selected.xp)} XP ✓`);
                data = await ctx.api('/leaderboard');
                drawStats();
                drawList();
            }));

            // ---------- ranking ----------
            const filter = h('input', { class: 'input', placeholder: 'Filtruj po nazwie…' });
            const list = h('div', { class: 'list-editor' });
            function drawList() {
                const q = filter.value.trim().toLowerCase();
                const rows = data.entries.filter(m => !q || `${m.name} ${m.username ?? ''}`.toLowerCase().includes(q));
                list.replaceChildren(...rows.map(m => personRow(m, {
                    num: m.rank,
                    sub: `Poziom ${fmt(m.level)} • ${pct(m)}% do następnego${m.voiceMinutes ? ` • 🎙️ ${fmt(m.voiceMinutes)} min` : ''}`,
                    right: [
                        h('span', { class: 'badge on' }, `${fmt(m.xp)} XP`),
                        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => select(m) }, 'Edytuj'),
                    ],
                })));
                if (!rows.length) {
                    list.append(h('div', { class: 'empty' }, data.entries.length ? 'Nic nie pasuje.' : 'Nikt jeszcze nie zdobył XP.'));
                }
            }
            filter.addEventListener('input', drawList);

            // ---------- dopasowanie ról-nagród wszystkim ----------
            const syncBtn = h('button', { class: 'btn' }, 'Dopasuj role wszystkim');
            const syncInfo = h('div', { class: 'muted' });
            let syncTimer = null;
            ctx.onLeave(() => clearInterval(syncTimer));

            function drawSync(status) {
                syncBtn.disabled = status.running;
                if (status.running) {
                    syncInfo.textContent = `⏳ W toku: ${fmt(status.done)} / ${fmt(status.total)} osób…`;
                } else if (status.finishedAt) {
                    const parts = [`✓ Gotowe: sprawdzono ${fmt(status.done)} ${plural(status.done, 'osobę', 'osoby', 'osób')}, role zmienione u ${fmt(status.changed)}.`];
                    if (status.missing) parts.push(`${fmt(status.missing)} ${plural(status.missing, 'osoby', 'osób', 'osób')} nie ma już na serwerze.`);
                    if (status.error) parts.push(status.error);
                    syncInfo.textContent = parts.join(' ');
                } else {
                    syncInfo.textContent = '';
                }
            }

            function watchSync() {
                clearInterval(syncTimer);
                syncTimer = setInterval(async () => {
                    try {
                        const status = await ctx.api('/rewards/sync');
                        drawSync(status);
                        if (!status.running) clearInterval(syncTimer);
                    } catch {
                        // chwilowy błąd - spróbujemy za chwilę
                    }
                }, 2000);
            }

            syncBtn.addEventListener('click', () => busy(syncBtn, async () => {
                const status = await ctx.api('/rewards/sync', { method: 'POST', body: {} });
                drawSync(status);
                if (status.running) watchSync();
            }));
            if (data.rewardsSync) {
                drawSync(data.rewardsSync);
                if (data.rewardsSync.running) watchSync();
            }

            // ---------- reset wszystkich ----------
            const resetBtn = h('button', { class: 'btn btn-danger' }, 'Wyzeruj XP wszystkich');
            resetBtn.addEventListener('click', () => {
                if (!confirm(`Na pewno wyzerować XP wszystkich (${fmt(data.total)} ${plural(data.total, 'osoba', 'osoby', 'osób')})? Tego nie da się cofnąć.`)) return;
                if (prompt('Wpisz RESET, żeby potwierdzić.') !== 'RESET') {
                    toast('Anulowano – nic się nie zmieniło.');
                    return;
                }
                busy(resetBtn, async () => {
                    const { removed } = await ctx.api('/reset', { method: 'POST', body: { confirm: true } });
                    toast(`Wyzerowano XP ${fmt(removed)} ${plural(removed, 'osoby', 'osób', 'osób')} ✓`);
                    selected = null;
                    data = await ctx.api('/leaderboard');
                    drawStats();
                    drawChosen();
                    drawList();
                });
            });

            drawStats();
            drawChosen();
            drawList();
            container.append(
                statsBox,
                card('⚡', 'Szybka zmiana XP', 'Działa jak /xp. Role za poziomy dopasują się same; ogłoszenie nowego poziomu nie jest wysyłane.',
                    searchForm,
                    results,
                    chosen,
                    h('div', { class: 'grid-2' }, field('Akcja', action), amountField),
                    h('div', { class: 'row end' }, applyBtn)),
                card('🏆', 'Ranking', data.total > data.entries.length ? `Pokazuję 100 najlepszych z ${fmt(data.total)}.` : 'Wszystkie osoby z XP na tym serwerze.',
                    filter,
                    list),
                card('🎭', 'Role za poziomy', 'Nagrody są nadawane przy zmianie poziomu. Po dodaniu lub zmianie nagród w ustawieniach (i zapisaniu) możesz od razu dopasować role wszystkim osobom z XP.',
                    h('div', { class: 'row' }, syncBtn, syncInfo)),
                card('🧨', 'Strefa niebezpieczna', 'Reset usuwa XP wszystkich osób. Role za poziomy zostają (nie są zabierane masowo).',
                    h('div', { class: 'row' }, resetBtn)),
            );
        },
    });
})();
