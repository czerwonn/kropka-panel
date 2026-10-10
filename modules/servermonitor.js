'use strict';
// Monitor serwerów Minecraft (moduł "servermonitor")
(() => {
    const { h, toast, busy, field, card, channelSelect } = window.KropkaPanel;

    function relative(ms) {
        if (!ms) return '—';
        const diff = Math.round((ms - Date.now()) / 60000);
        const abs = Math.abs(diff);
        if (abs < 1) return diff < 0 ? 'przed chwilą' : 'za chwilę';
        const text = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} dni`;
        return diff < 0 ? `${text} temu` : `za ${text}`;
    }

    window.KropkaPanel.register('servermonitor', {
        async render(container, ctx) {
            let data = await ctx.api('/servers');
            const listBox = h('div', { class: 'stack' });
            const editorBox = h('div', { class: 'stack' });

            async function reload() {
                data = await ctx.api('/servers');
                draw();
            }

            function openEditor(server) {
                const name = h('input', { class: 'input', maxLength: 60, value: server.name ?? '', placeholder: server.address });
                const channel = channelSelect(ctx.channels, server.channelId, { kinds: ['text'] });
                const saveBtn = h('button', { class: 'btn btn-primary' }, 'Zapisz');
                saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
                    await ctx.api(`/servers/${server.id}`, { method: 'PUT', body: { name: name.value, channelId: channel.value } });
                    toast('Zapisano ✓');
                    editorBox.replaceChildren();
                    await reload();
                }));
                editorBox.replaceChildren(card('✏️', `Edycja: ${server.name || server.address}`, 'Po zmianie kanału stara wiadomość ze statusem zostanie usunięta.',
                    h('div', { class: 'grid-2' }, field('Nazwa (opcjonalnie)', name), field('Kanał ze statusem', channel)),
                    h('div', { class: 'row end' },
                        h('button', { class: 'btn btn-ghost', onclick: () => editorBox.replaceChildren() }, 'Anuluj'),
                        saveBtn)));
            }

            function serverItem(server) {
                const st = server.status;
                const online = st?.online;
                const edition = data.editions[server.edition]?.label ?? server.edition;
                const details = [
                    `${edition} · ${server.address}`,
                    `→ #${server.channelName ?? 'usunięty kanał'}`,
                    server.lastCheck ? `sprawdzono ${relative(server.lastCheck)}` : 'czeka na pierwsze sprawdzenie',
                ].join(' · ');

                const refreshBtn = h('button', { class: 'btn btn-sm', title: 'Sprawdź teraz' }, '🔄');
                refreshBtn.addEventListener('click', () => busy(refreshBtn, async () => {
                    await ctx.api(`/servers/${server.id}/refresh`, { method: 'POST', body: {} });
                    toast('Odświeżono ✓');
                    await reload();
                }));
                const deleteBtn = h('button', { class: 'btn btn-sm btn-danger', title: 'Usuń' }, '✕');
                deleteBtn.addEventListener('click', () => {
                    if (!confirm(`Przestać monitorować ${server.name || server.address}? Wiadomość ze statusem zostanie usunięta.`)) return;
                    busy(deleteBtn, async () => {
                        await ctx.api(`/servers/${server.id}`, { method: 'DELETE' });
                        toast('Usunięto');
                        await reload();
                    });
                });

                return h('li', null,
                    h('span', { class: 'idx', title: online ? 'Online' : 'Offline' }, st ? (online ? '🟢' : '🔴') : '⚪'),
                    h('div', { class: 't' },
                        h('span', null, server.name || server.address),
                        h('small', null, details),
                        online && st.motd ? h('small', null, st.motd.split('\n')[0]) : null,
                        server.lastError ? h('small', { style: { color: 'var(--danger)' } }, `⚠ ${server.lastError}`) : null),
                    h('span', { class: 'd' }, online ? `👥 ${st.playersOnline}/${st.playersMax}${st.version ? ` · ${st.version}` : ''}` : st ? 'offline' : '—'),
                    h('div', { class: 'row' },
                        refreshBtn,
                        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openEditor(server) }, 'Edytuj'),
                        deleteBtn));
            }

            function draw() {
                listBox.replaceChildren(data.servers.length
                    ? h('ol', { class: 'queue-list' }, data.servers.map(serverItem))
                    : h('div', { class: 'empty' }, h('div', { class: 'big' }, '🖥️'), 'Nie monitorujesz jeszcze żadnego serwera - dodaj pierwszy poniżej.'));
                addBtn.disabled = data.servers.length >= data.limit;
            }

            // ---- dodawanie
            let edition = 'java';
            const address = h('input', { class: 'input', maxLength: 100, placeholder: 'np. mc.serwer.pl albo 51.75.12.34:25565' });
            const name = h('input', { class: 'input', maxLength: 60, placeholder: 'np. Nasz serwer survival' });
            const channel = channelSelect(ctx.channels, null, { kinds: ['text'] });
            const portHint = h('span', null);
            const setHint = () => { portHint.textContent = `Domyślny port ${data.editions[edition].label}: ${data.editions[edition].port}. Adresy prywatne (192.168.x.x itp.) nie działają.`; };
            const editionButtons = Object.entries(data.editions).map(([key, e]) => h('button', {
                type: 'button',
                class: key === edition ? 'active' : '',
                onclick: ev => {
                    edition = key;
                    for (const b of editionButtons) b.classList.toggle('active', b === ev.currentTarget);
                    setHint();
                },
            }, e.label));
            setHint();
            const addBtn = h('button', { class: 'btn btn-primary' }, 'Dodaj serwer');
            addBtn.addEventListener('click', () => {
                if (!address.value.trim()) {
                    toast('Wpisz adres serwera.', 'error');
                    return;
                }
                busy(addBtn, async () => {
                    const res = await ctx.api('/servers', { method: 'POST', body: { address: address.value, name: name.value, edition, channelId: channel.value } });
                    const added = res.server;
                    if (added.lastError) toast(`Dodano, ale: ${added.lastError}`, 'error');
                    else if (!added.hasMessage) toast('Dodano - status pojawi się na kanale po włączeniu modułu.');
                    else toast('Dodano - status jest już na kanale ✓');
                    address.value = '';
                    name.value = '';
                    await reload();
                });
            });

            container.append(
                card('🖥️', 'Monitorowane serwery', 'Wiadomość ze statusem odświeża się sama. Jeśli ktoś ją usunie, bot wyśle nową.', listBox),
                editorBox,
                card('➕', 'Dodaj serwer Minecraft', `Maks. ${data.limit} serwerów.`,
                    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Edycja'), h('div', { class: 'segmented' }, editionButtons)),
                    h('div', { class: 'grid-2' },
                        field('Adres serwera', address, portHint),
                        field('Nazwa (opcjonalnie)', name)),
                    field('Kanał ze statusem', channel),
                    h('div', { class: 'row end' }, addBtn)),
            );
            draw();

            const timer = setInterval(() => {
                if (!document.hidden && !editorBox.childElementCount) reload().catch(() => {});
            }, 60_000);
            ctx.onLeave(() => clearInterval(timer));
        },
    });
})();
