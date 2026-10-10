'use strict';
// Odtwarzacz muzyki w panelu (moduł "music")
(() => {
    const { h, toast, busy, field, card, channelSelect, extLink, formatDuration } = window.KropkaPanel;
    const LOOP_MODES = [['off', 'Bez pętli'], ['utwor', '🔂 Utwór'], ['kolejka', '🔁 Kolejka']];

    window.KropkaPanel.register('music', {
        async render(container, ctx) {
            const voiceChannels = ctx.channels.filter(c => c.type === 'voice');
            let music = await ctx.api('');
            const playerBox = h('div', { class: 'stack' });

            const query = h('input', { class: 'input', placeholder: 'Nazwa utworu albo link (YouTube, playlista, SoundCloud…)' });
            const vc = channelSelect(ctx.channels, music.channelId, { type: 'voice' });
            const addBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Dodaj');
            const addForm = h('form', {
                class: 'stack',
                onsubmit: e => {
                    e.preventDefault();
                    if (!query.value.trim()) return;
                    busy(addBtn, async () => {
                        music = await ctx.api('/play', { method: 'POST', body: { query: query.value, channelId: vc.value } });
                        query.value = '';
                        toast('Dodano do kolejki ✓');
                        draw();
                    });
                },
            },
            h('div', { class: 'grid-2' }, field('Utwór', query), field('Kanał głosowy', vc)),
            h('div', { class: 'row end' }, addBtn));

            async function action(name, body = {}) {
                try {
                    music = await ctx.api(`/${name}`, { method: 'POST', body });
                    draw();
                } catch (err) {
                    toast(err.message, 'error');
                }
            }

            let position = 0;
            let progressFill = null;
            let elapsedEl = null;

            function draw() {
                position = music.position ?? 0;
                progressFill = elapsedEl = null;
                if (music.channelId) vc.value = music.channelId;

                if (!music.active || !music.current) {
                    playerBox.replaceChildren(h('section', { class: 'card empty' },
                        h('div', { class: 'big' }, '🎧'),
                        music.active ? 'Kolejka się skończyła - dodaj coś poniżej.' : 'Nic teraz nie gra. Dodaj utwór poniżej, a bot wejdzie na wybrany kanał.'));
                    return;
                }

                const { current } = music;
                progressFill = h('div');
                elapsedEl = h('span');
                const channelName = voiceChannels.find(c => c.id === music.channelId)?.name ?? 'kanał głosowy';
                const volumeValue = h('span', null, `${music.volume}%`);
                const volume = h('input', {
                    type: 'range', min: 1, max: 100, value: music.volume,
                    oninput: e => { volumeValue.textContent = `${e.target.value}%`; },
                    onchange: e => action('volume', { volume: Number(e.target.value) }),
                });

                playerBox.replaceChildren(
                    h('section', { class: 'card' },
                        h('div', { class: 'player' },
                            h('div', { class: `disc ${music.paused ? 'paused' : ''}` }),
                            h('div', { style: { 'min-width': '0' } },
                                h('div', { class: 'now-label' }, music.paused ? '⏸ Zapauzowane' : `▶ Teraz gra · 🔊 ${channelName}`),
                                h('div', { class: 'now-title' }, extLink(current.url, current.title)),
                                h('div', { class: 'now-meta' }, `Dodane przez ${current.requestedBy ?? '?'}`),
                                h('div', { class: 'progress' }, progressFill),
                                h('div', { class: 'times' }, elapsedEl, h('span', null, formatDuration(current.duration))))),
                        h('div', { class: 'controls' },
                            h('button', { class: 'btn btn-icon', title: music.paused ? 'Wznów' : 'Pauza', onclick: () => action(music.paused ? 'resume' : 'pause') }, music.paused ? '▶' : '⏸'),
                            h('button', { class: 'btn btn-icon', title: 'Pomiń', onclick: () => action('skip') }, '⏭'),
                            h('button', { class: 'btn btn-icon', title: 'Przetasuj', onclick: () => action('shuffle') }, '🔀'),
                            h('div', { class: 'segmented' }, LOOP_MODES.map(([mode, label]) =>
                                h('button', { class: music.loop === mode ? 'active' : '', onclick: () => action('loop', { mode }) }, label))),
                            h('div', { class: 'volume' }, '🔊', volume, volumeValue),
                            h('button', {
                                class: 'btn btn-danger btn-sm',
                                onclick: () => { if (confirm('Zatrzymać muzykę i wyczyścić kolejkę?')) action('stop'); },
                            }, '⏹ Stop'))),
                    h('section', { class: 'card' },
                        h('div', { class: 'card-head' },
                            h('div', { class: 'ico' }, '📃'),
                            h('div', null, h('h3', null, `Kolejka (${music.total})`), music.total > music.tracks.length && h('p', null, `Pokazuję pierwsze ${music.tracks.length}.`))),
                        music.tracks.length === 0
                            ? h('div', { class: 'empty' }, 'Pusto - po tym utworze bot skończy grać.')
                            : h('ol', { class: 'queue-list' }, music.tracks.map((t, i) => h('li', null,
                                h('span', { class: 'idx' }, i + 1),
                                h('div', { class: 't' }, extLink(t.url, t.title), h('small', null, t.requestedBy ?? '')),
                                h('span', { class: 'd' }, formatDuration(t.duration)),
                                h('button', { class: 'btn btn-ghost btn-sm', title: 'Usuń z kolejki', onclick: () => action('remove', { index: i }) }, '✕'))))),
                );
                tick();
            }

            function tick() {
                if (!progressFill || !music.current) return;
                const elapsed = position / 1000;
                elapsedEl.textContent = formatDuration(elapsed);
                const pct = music.current.duration ? Math.min(100, (elapsed / music.current.duration) * 100) : 100;
                progressFill.style.setProperty('width', `${pct}%`);
            }

            const ticker = setInterval(() => {
                if (music.active && music.current && !music.paused) {
                    position += 1000;
                    tick();
                }
            }, 1000);
            // Odświeżanie stanu z bota co 5 s (pomijane, gdy ktoś właśnie przesuwa suwak)
            const poller = setInterval(async () => {
                if (document.hidden || playerBox.contains(document.activeElement)) return;
                try {
                    music = await ctx.api('');
                    draw();
                } catch { /* chwilowy błąd - spróbujemy za 5 s */ }
            }, 5000);
            ctx.onLeave(() => { clearInterval(ticker); clearInterval(poller); });

            container.append(
                playerBox,
                card('➕', 'Dodaj do kolejki', voiceChannels.length ? null : 'Na serwerze nie ma kanałów głosowych.', addForm),
            );
            draw();
        },
    });
})();
