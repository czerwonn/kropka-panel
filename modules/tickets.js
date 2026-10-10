'use strict';
// Zgłoszenia (moduł "tickets"): lista otwartych zgłoszeń i wysyłanie panelu do otwierania zgłoszeń
(() => {
    const { h, toast, busy, field, card, channelSelect, discordMessage } = window.KropkaPanel;

    function ago(ms) {
        const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
        if (s < 60) return 'przed chwilą';
        if (s < 3600) return `${Math.floor(s / 60)} min temu`;
        if (s < 86400) return `${Math.floor(s / 3600)} h temu`;
        return `${Math.floor(s / 86400)} d temu`;
    }

    const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, String(value)));
    const who = p => (p ? (p.name ?? `użytkownik ${p.id}`) : 'nikt');

    window.KropkaPanel.register('tickets', {
        async render(container, ctx) {
            let data = await ctx.api('/tickets');
            const statsBox = h('div', { class: 'stats' });
            const listBox = h('div', { class: 'stack' });

            async function reload() {
                data = await ctx.api('/tickets');
                draw();
            }

            async function close(ticket, btn) {
                const reason = prompt(`Zamknąć zgłoszenie #${ticket.number}? Powód (opcjonalnie):`, '');
                if (reason === null) return;
                await busy(btn, async () => {
                    await ctx.api(`/close/${ticket.number}`, { method: 'POST', body: { reason } });
                    toast(`Zamknięto zgłoszenie #${ticket.number} ✓`);
                    await reload();
                });
            }

            function draw() {
                const open = data.open.filter(t => t.status === 'open');
                statsBox.replaceChildren(
                    stat('Otwarte', open.length),
                    stat('Przejęte', open.filter(t => t.claimedBy).length),
                    stat('Wszystkie (od startu)', data.total));
                if (!data.open.length) {
                    listBox.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🎉'), 'Brak otwartych zgłoszeń.'));
                    return;
                }
                listBox.replaceChildren(h('ol', { class: 'queue-list' }, data.open.map(t => {
                    const closeBtn = h('button', { class: 'btn btn-danger btn-sm', disabled: t.status !== 'open' }, t.status === 'open' ? 'Zamknij' : 'Zamyka się…');
                    closeBtn.addEventListener('click', () => close(t, closeBtn));
                    return h('li', null,
                        h('span', { class: 'idx' }, `#${t.number}`),
                        h('div', { class: 't' },
                            h('span', null, `${t.channelName ? `# ${t.channelName}` : '(kanał usunięty)'} · ${t.category}`),
                            h('small', null, `Autor: ${who(t.user)} · przejęte: ${who(t.claimedBy)} · otwarte ${ago(t.openedAt)}`)),
                        h('span', { class: 'd', title: 'Ostatnia aktywność' }, ago(t.lastActivity)),
                        closeBtn);
                })));
            }

            // Odświeżanie listy co 30 s (gdy karta jest widoczna)
            const poller = setInterval(() => {
                if (!document.hidden) reload().catch(() => { /* spróbujemy za chwilę */ });
            }, 30_000);
            ctx.onLeave(() => clearInterval(poller));

            // --- wysyłanie panelu
            const cfg = ctx.config();
            const categories = (cfg.categories ?? []).filter(c => c.name);
            const channel = channelSelect(ctx.channels, null);
            const sendBtn = h('button', { class: 'btn btn-primary' }, 'Wyślij panel');
            sendBtn.addEventListener('click', () => busy(sendBtn, async () => {
                await ctx.api('/panel', { method: 'POST', body: { channelId: channel.value } });
                toast('Wysłano panel zgłoszeń ✓');
            }));

            const preview = h('div', null,
                h('div', { class: 'dc-embed', style: { '--embed-color': /^#[0-9a-f]{6}$/i.test(cfg.panelColor ?? '') ? cfg.panelColor : '#ff2d87' } },
                    h('div', { class: 'dc-embed-title' }, cfg.panelTitle || '🎫 Zgłoszenia'),
                    h('div', { class: 'dc-embed-desc' }, [cfg.panelDescription, ...categories.map(c => `${c.emoji || '•'} ${c.name}${c.description ? ` - ${c.description}` : ''}`)]
                        .filter(Boolean).join('\n'))),
                categories.length > 5
                    ? h('span', { class: 'dc-button' }, `▾ Wybierz rodzaj zgłoszenia (${categories.length})`)
                    : categories.map(c => h('span', { class: 'dc-button', style: { 'margin-right': '6px' } }, `${c.emoji ? `${c.emoji} ` : ''}${c.name}`)));

            const refreshBtn = h('button', { class: 'btn btn-sm btn-ghost' }, '↻ Odśwież');
            refreshBtn.addEventListener('click', () => busy(refreshBtn, reload));

            container.append(
                statsBox,
                card('🎫', 'Otwarte zgłoszenia', 'Zamknięcie stąd działa jak przycisk „Zamknij”: zapis rozmowy trafia na kanał zapisów, a kanał znika.',
                    listBox, h('div', { class: 'row end' }, refreshBtn)),
                h('div', { class: 'grid-2', style: { 'align-items': 'start' } },
                    card('📨', 'Wyślij panel zgłoszeń', categories.length
                        ? 'Wiadomość z przyciskami (albo listą, gdy kategorii jest więcej niż 5). To samo co /ticket panel.'
                        : 'Najpierw dodaj i zapisz kategorię zgłoszeń w ustawieniach wyżej.',
                    field('Kanał', channel),
                    h('div', { class: 'row end' }, sendBtn)),
                    h('div', { class: 'preview' }, h('div', { class: 'preview-label kicker' }, 'Podgląd (zapisane ustawienia)'), discordMessage(preview))),
            );
            draw();
        },
    });
})();
