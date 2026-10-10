'use strict';
// Weryfikacja: wysyłanie wiadomości z przyciskiem, sprawdzenie ustawień i ostatnie próby (moduł "verification")
(() => {
    const { h, toast, busy, card, extLink, safeUrl } = window.KropkaPanel;

    const RESULTS = {
        ok: ['✅', 'zweryfikowano'],
        captcha: ['❌', 'zła odpowiedź na captchę'],
        young: ['⛔', 'za młode konto'],
        locked: ['⏳', 'blokada po 5 błędach'],
        error: ['⚠️', 'nie udało się nadać ról'],
    };

    function ago(ms) {
        const minutes = Math.round((Date.now() - ms) / 60000);
        if (minutes < 1) return 'przed chwilą';
        if (minutes < 60) return `${minutes} min temu`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `${hours} godz. temu`;
        return new Date(ms).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }

    const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));

    window.KropkaPanel.register('verification', {
        async render(container, ctx) {
            let status = await ctx.api('/status');
            const panelBox = h('div', { class: 'stack' });
            const statsBox = h('div', { class: 'stack' });

            const channelName = id => {
                const c = ctx.channels.find(ch => ch.id === id);
                return c ? `#${c.name}` : 'usunięty kanał';
            };

            function drawPanel() {
                const sendBtn = h('button', { class: 'btn btn-primary' }, status.panel ? '↻ Odśwież wiadomość' : '📤 Wyślij wiadomość');
                sendBtn.addEventListener('click', () => busy(sendBtn, async () => {
                    status = await ctx.api('/panel', { method: 'POST' });
                    toast(status.created ? 'Wysłano wiadomość weryfikacji ✓' : 'Odświeżono wiadomość ✓');
                    drawAll();
                }));
                const checkBtn = h('button', { class: 'btn btn-ghost' }, 'Sprawdź ponownie');
                checkBtn.addEventListener('click', () => busy(checkBtn, async () => {
                    status = await ctx.api('/status');
                    drawAll();
                }));

                panelBox.replaceChildren(
                    h('div', { class: 'row' },
                        status.panel
                            ? [h('span', { class: 'badge on' }, 'wysłana'), h('span', null, `na ${channelName(status.panel.channelId)}`),
                                safeUrl(status.panel.messageUrl) ? extLink(status.panel.messageUrl, 'Otwórz ↗') : null]
                            : [h('span', { class: 'badge off' }, 'niewysłana'), h('span', { class: 'muted' }, 'Wiadomość z przyciskiem nie jest jeszcze nigdzie wysłana.')]),
                    // replaceChildren (inaczej niż h) nie pomija null - stąd tablica
                    ...(status.panel?.otherChannel
                        ? [h('div', { class: 'field-hint' }, '⚠ Wiadomość jest na innym kanale niż w ustawieniach - „Odśwież” wyśle ją na nowy kanał, a starą usunie.')]
                        : []),
                    status.problems.length
                        ? h('div', { class: 'stack', style: { gap: '6px' } }, status.problems.map(p => h('div', { class: 'off-banner' }, `⚠ ${p}`)))
                        : h('div', { class: 'muted' }, '✓ Ustawienia wyglądają dobrze.'),
                    h('div', { class: 'row end' }, checkBtn, sendBtn));
            }

            function drawStats() {
                const { stats, recent } = status;
                statsBox.replaceChildren(
                    h('div', { class: 'stats' },
                        stat('Zweryfikowano (24 h)', stats.verifiedDay),
                        stat('Zweryfikowano (7 dni)', stats.verifiedWeek),
                        stat('Nieudane próby (24 h)', stats.failedDay)),
                    recent.length === 0
                        ? h('div', { class: 'empty' }, 'Nikt jeszcze nie próbował się zweryfikować.')
                        : h('div', { class: 'stack', style: { gap: '6px' } }, recent.map(r => {
                            const [icon, label] = RESULTS[r.result] ?? ['•', r.result];
                            return h('div', { class: 'event-line', style: { 'align-items': 'center' } },
                                safeUrl(r.avatar)
                                    ? h('img', { src: r.avatar, alt: '', style: { width: '22px', height: '22px', 'border-radius': '50%' } })
                                    : null,
                                h('b', null, r.name ?? `ID ${r.userId}`),
                                h('span', null, `${icon} ${label}`),
                                h('span', { class: 'faint' }, ago(r.at)));
                        })));
            }

            function drawAll() {
                drawPanel();
                drawStats();
            }

            container.append(
                card('📨', 'Wiadomość z przyciskiem', 'Tu nowe osoby klikają „Zweryfikuj się”. Zmiany w ustawieniach najpierw zapisz - wysłana wiadomość odświeży się sama.', panelBox),
                card('📊', 'Ostatnie próby', 'Historia z ostatnich 30 dni. Szczegóły na bieżąco trafiają na kanał logów (jeśli jest ustawiony).', statsBox),
            );
            drawAll();
        },
    });
})();
