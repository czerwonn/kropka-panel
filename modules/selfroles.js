'use strict';
// Selfrole: panele z przyciskami/listą wyboru, role za reakcje i prosty embed z jedną rolą (moduł "selfroles")
(() => {
    const {
        h, toast, busy, field, card, channelSelect, roleSelect, canAssign, colorInput, withCounter, numberInput,
        messageEditor, discordMessage, safeUrl, extLink, clone,
    } = window.KropkaPanel;

    const BUTTON_COLORS = { primary: '#5865f2', secondary: '#4e5058', success: '#248046', danger: '#da373c' };
    const CUSTOM_EMOJI = /^<(a?):(\w{2,32}):(\d{5,25})>$/;
    const PANEL_KEYS = ['name', 'channelId', 'mode', 'behavior', 'message', 'roles', 'requiredRoleId', 'maxRoles', 'placeholder'];

    window.KropkaPanel.register('selfroles', {
        async render(container, ctx) {
            let data = await ctx.api('/panels');
            const emojis = await ctx.api('/emojis').then(r => r.emojis).catch(() => []);
            const { modes, behaviors, styles } = data.options;
            const optionLabel = (list, value) => list.find(o => o.value === value)?.label ?? value;
            const shortLabel = (list, value) => optionLabel(list, value).split(' - ')[0];

            // ---------- drobne kontrolki ----------
            const roleById = id => ctx.roles.find(r => r.id === id);
            const roleName = id => (roleById(id) ? `@${roleById(id).name}` : '⚠ usunięta rola');
            const channelName = id => {
                const c = ctx.channels.find(ch => ch.id === id);
                return c ? `#${c.name}` : '⚠ usunięty kanał';
            };

            // Jak field(), ale bez <label> - dla list z przyciskami (label "klikałby" w pierwszy przycisk w środku)
            const block = (label, control, hint) => h('div', { class: 'field' },
                h('span', { class: 'field-label' }, label), control, hint && h('span', { class: 'field-hint' }, hint));

            function textInput(value, onChange, { max = 100, placeholder = '' } = {}) {
                const input = h('input', { class: 'input', value: value ?? '', maxLength: max, placeholder });
                input.addEventListener('input', () => onChange(input.value));
                return input;
            }

            function selectInput(options, value, onChange) {
                const select = h('select', { class: 'input' }, options.map(o => h('option', { value: o.value }, o.label)));
                select.value = value;
                select.addEventListener('change', () => onChange(select.value));
                return select;
            }

            // Role do rozdawania: tylko te, które możesz nadać. Rola już zapisana, a dla Ciebie za wysoka,
            // zostaje widoczna (inaczej lista po cichu przeskoczyłaby na inną rolę).
            function giveRoleSelect(value, onChange) {
                const select = h('select', { class: 'input' }, h('option', { value: '' }, '— wybierz rolę —'));
                for (const r of ctx.roles) {
                    const ok = canAssign(r);
                    if (!ok && r.id !== value) continue;
                    select.append(h('option', { value: r.id }, `@${r.name}${ok ? '' : '  ⚠ nie możesz jej rozdawać'}`));
                }
                if (value && !roleById(value)) select.append(h('option', { value }, '⚠ usunięta rola'));
                select.value = value ?? '';
                select.addEventListener('change', () => onChange(select.value || null));
                return select;
            }

            // Wymagana rola - dowolna (też np. rola boostera od integracji)
            function anyRoleSelect(value, onChange) {
                const select = h('select', { class: 'input' }, h('option', { value: '' }, '— każdy może korzystać —'),
                    ctx.roles.map(r => h('option', { value: r.id }, `@${r.name}`)));
                if (value && !roleById(value)) select.append(h('option', { value }, '⚠ usunięta rola'));
                select.value = value ?? '';
                select.addEventListener('change', () => onChange(select.value || null));
                return select;
            }

            const datalistId = `sr-emojis-${ctx.guildId}`;
            const datalist = h('datalist', { id: datalistId }, emojis.map(e => h('option', { value: e.text }, `:${e.name}:`)));

            function emojiView(text, size = 20) {
                const m = CUSTOM_EMOJI.exec(text ?? '');
                if (m) {
                    return h('img', {
                        src: `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? 'gif' : 'png'}?size=48`, alt: `:${m[2]}:`,
                        style: { width: `${size}px`, height: `${size}px`, 'vertical-align': 'middle', 'object-fit': 'contain' },
                    });
                }
                return text ? h('span', null, text) : null;
            }

            function emojiInput(value, onChange) {
                const view = h('span', { style: { 'min-width': '24px', 'text-align': 'center', 'font-size': '18px' } }, emojiView(value));
                const input = h('input', { class: 'input', value: value ?? '', maxLength: 100, placeholder: '🎮 albo emoji serwera' });
                input.setAttribute('list', datalistId);
                input.addEventListener('input', () => {
                    view.replaceChildren(emojiView(input.value.trim()) ?? '');
                    onChange(input.value.trim());
                });
                return h('div', { class: 'row', style: { gap: '8px', 'flex-wrap': 'nowrap' } }, view, input);
            }

            const iconBtn = (title, text, onclick, { disabled = false, danger = false } = {}) =>
                h('button', { type: 'button', class: `btn btn-icon ${danger ? 'btn-danger' : 'btn-ghost'}`, title, disabled, onclick }, text);

            // Podgląd przycisków / listy wyboru pod wiadomością
            function componentsPreview(draft) {
                const roles = draft.roles.filter(r => r.roleId);
                if (!roles.length) return h('div', { class: 'dc-text faint' }, '(dodaj role, żeby zobaczyć przyciski)');
                if (draft.mode === 'select') {
                    return h('div', { style: { 'max-width': '520px', 'margin-top': '6px' } },
                        h('div', {
                            style: {
                                display: 'flex', 'justify-content': 'space-between', padding: '9px 12px', background: '#1e1f22',
                                border: '1px solid #3f4147', 'border-radius': '4px', color: '#949ba4', 'font-size': '14px',
                            },
                        }, h('span', null, draft.placeholder || 'Wybierz role…'), h('span', null, '▾')),
                        h('div', { style: { background: '#2b2d31', 'border-radius': '0 0 4px 4px', padding: '4px 0' } },
                            roles.map(r => h('div', { style: { display: 'flex', gap: '8px', 'align-items': 'center', padding: '6px 12px', color: '#dbdee1', 'font-size': '14px' } },
                                emojiView(r.emoji, 18),
                                h('div', null, h('div', null, r.label || roleName(r.roleId).replace(/^@/, '')),
                                    r.description && h('div', { style: { color: '#949ba4', 'font-size': '12px' } }, r.description))))));
                }
                return h('div', { style: { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', 'margin-top': '6px', 'max-width': '520px' } },
                    roles.map(r => h('span', {
                        class: 'dc-button',
                        style: { 'margin-top': '0', background: BUTTON_COLORS[r.style] ?? BUTTON_COLORS.primary, display: 'inline-flex', gap: '6px', 'align-items': 'center' },
                    }, emojiView(r.emoji, 18), (r.label || !r.emoji) ? (r.label || roleName(r.roleId).replace(/^@/, '')) : null)));
            }

            // ================================================================ panele z rolami
            const panelsBox = h('div', { class: 'stack' });

            const replacePanel = panel => {
                const i = data.panels.findIndex(p => p.id === panel.id);
                if (i >= 0) data.panels[i] = panel;
                else data.panels.push(panel);
            };

            function panelRow(p) {
                const sendBtn = h('button', { class: 'btn btn-sm' }, p.messageUrl ? '↻ Odśwież' : '📤 Wyślij');
                sendBtn.addEventListener('click', () => busy(sendBtn, async () => {
                    const res = await ctx.api(`/panels/${p.id}/send`, { method: 'POST' });
                    replacePanel(res.panel);
                    toast(res.created ? 'Wysłano panel ✓' : 'Odświeżono panel ✓');
                    drawPanels();
                }));
                const delBtn = h('button', { class: 'btn btn-sm btn-danger' }, 'Usuń');
                delBtn.addEventListener('click', () => {
                    if (!confirm(`Usunąć panel „${p.name}”? Wiadomość z przyciskami też zniknie.`)) return;
                    busy(delBtn, async () => {
                        await ctx.api(`/panels/${p.id}`, { method: 'DELETE' });
                        data.panels = data.panels.filter(x => x.id !== p.id);
                        toast('Usunięto panel');
                        drawPanels();
                    });
                });

                const notes = [];
                if (p.missingRoles.length) notes.push(`⚠ ${p.missingRoles.length === 1 ? 'Jedna rola została usunięta' : `${p.missingRoles.length} role zostały usunięte`} z serwera - popraw panel.`);
                if (p.messageUrl && p.sentChannelId !== p.channelId) notes.push('⚠ Zmieniono kanał - kliknij „Odśwież”, żeby przenieść panel.');

                return h('div', { class: 'list-item' },
                    h('div', { class: 'stack', style: { gap: '6px', flex: '1', 'min-width': '0' } },
                        h('div', { class: 'row', style: { gap: '8px' } },
                            h('b', null, `#${p.id} · ${p.name}`),
                            h('span', { class: 'badge off' }, shortLabel(modes, p.mode)),
                            h('span', { class: 'badge off' }, shortLabel(behaviors, p.behavior)),
                            p.messageUrl ? h('span', { class: 'badge on' }, 'wysłany') : h('span', { class: 'badge off' }, 'niewysłany')),
                        h('div', { class: 'muted' },
                            `${channelName(p.channelId)} · `, p.roles.map(r => roleName(r.roleId)).join(', '),
                            p.messageUrl ? [' · ', extLink(p.messageUrl, 'Otwórz ↗')] : null),
                        notes.map(n => h('div', { class: 'field-hint' }, n))),
                    h('div', { class: 'list-item-actions' },
                        h('button', { class: 'btn btn-sm', onclick: () => openPanelEditor(p) }, '✏️ Edytuj'),
                        sendBtn, delBtn));
            }

            function drawPanels() {
                const full = data.panels.length >= data.limits.panels;
                panelsBox.replaceChildren(
                    ...(data.panels.length
                        ? data.panels.map(panelRow)
                        : [h('div', { class: 'empty' }, 'Nie ma jeszcze żadnego panelu. Stwórz pierwszy - np. kolory nicków albo powiadomienia.')]),
                    h('div', { class: 'row' },
                        h('button', { class: 'btn btn-primary', disabled: full, onclick: () => openPanelEditor(null) }, '+ Nowy panel'),
                        full ? h('span', { class: 'faint' }, `Limit: ${data.limits.panels} paneli.`) : null));
            }

            function openPanelEditor(existing) {
                const draft = existing
                    ? clone(Object.fromEntries(PANEL_KEYS.map(k => [k, existing[k]])))
                    : {
                        name: '', channelId: null, mode: 'buttons', behavior: 'toggle', message: clone(data.defaults.message),
                        roles: [], requiredRoleId: null, maxRoles: 0, placeholder: '',
                    };
                let saved = existing;

                const channel = channelSelect(ctx.channels, draft.channelId);
                draft.channelId = channel.value || null;
                channel.addEventListener('change', () => { draft.channelId = channel.value || null; });

                const previewBox = h('div');
                const drawPreview = () => previewBox.replaceChildren(componentsPreview(draft));

                const placeholderField = field('Napis na zamkniętej liście', textInput(draft.placeholder, v => { draft.placeholder = v; drawPreview(); }, { max: 150, placeholder: 'Wybierz role…' }));
                const limitField = field('Limit ról z panelu', numberInput(draft.maxRoles, 0, 25, v => { draft.maxRoles = v; }),
                    'Ile ról z tego panelu może mieć jedna osoba. 0 = bez limitu.');
                const syncVisibility = () => {
                    placeholderField.hidden = draft.mode !== 'select';
                    limitField.hidden = draft.behavior === 'unique';
                };

                const rolesBox = h('div', { class: 'list-items' });
                const moveRole = (i, delta) => {
                    [draft.roles[i + delta], draft.roles[i]] = [draft.roles[i], draft.roles[i + delta]];
                    drawRoles();
                };
                function drawRoles() {
                    const last = draft.roles.length - 1;
                    rolesBox.replaceChildren(
                        ...draft.roles.map((item, i) => h('div', { class: 'list-item' },
                            h('div', { class: 'list-item-fields' },
                                field('Rola', giveRoleSelect(item.roleId, v => { item.roleId = v; drawPreview(); })),
                                field('Napis', textInput(item.label, v => { item.label = v; drawPreview(); }, { max: 80, placeholder: 'domyślnie nazwa roli' })),
                                field('Emoji', emojiInput(item.emoji, v => { item.emoji = v; drawPreview(); })),
                                draft.mode === 'select'
                                    ? field('Opis (opcjonalnie)', textInput(item.description, v => { item.description = v; drawPreview(); }, { max: 100 }))
                                    : field('Kolor przycisku', selectInput(styles, item.style || 'primary', v => { item.style = v; drawPreview(); }))),
                            h('div', { class: 'list-item-actions' },
                                iconBtn('W górę', '↑', () => moveRole(i, -1), { disabled: i === 0 }),
                                iconBtn('W dół', '↓', () => moveRole(i, 1), { disabled: i === last }),
                                iconBtn('Usuń', '✕', () => { draft.roles.splice(i, 1); drawRoles(); }, { danger: true })))),
                        // replaceChildren (inaczej niż h) nie pomija null - stąd tablica
                        ...(draft.roles.length === 0 ? [h('div', { class: 'empty', style: { padding: '14px' } }, 'Brak ról - dodaj pierwszą.')] : []),
                        h('button', {
                            type: 'button', class: 'btn btn-sm', disabled: draft.roles.length >= 25,
                            onclick: () => { draft.roles.push({ roleId: null, label: '', emoji: '', description: '', style: 'primary' }); drawRoles(); },
                        }, '+ Dodaj rolę'));
                    drawPreview();
                }

                const saveBtn = h('button', { class: 'btn' }, 'Zapisz');
                const saveSendBtn = h('button', { class: 'btn btn-primary' }, saved?.messageUrl ? 'Zapisz i odśwież' : 'Zapisz i wyślij');

                async function save(andSend) {
                    const body = { panel: draft };
                    const res = saved
                        ? await ctx.api(`/panels/${saved.id}`, { method: 'PUT', body })
                        : await ctx.api('/panels', { method: 'POST', body });
                    saved = res.panel; // kolejny zapis to już edycja, nawet gdy wysyłanie się nie uda
                    replacePanel(res.panel);
                    if (res.warning) toast(res.warning, 'error');
                    if (andSend && !res.refreshed) {
                        const sent = await ctx.api(`/panels/${saved.id}/send`, { method: 'POST' });
                        replacePanel(sent.panel);
                        toast(sent.created ? 'Zapisano i wysłano panel ✓' : 'Zapisano i odświeżono panel ✓');
                    } else {
                        toast(res.refreshed ? 'Zapisano i odświeżono wiadomość na Discordzie ✓' : 'Zapisano panel ✓');
                    }
                    drawPanels();
                }
                saveBtn.addEventListener('click', () => busy(saveBtn, () => save(false)));
                saveSendBtn.addEventListener('click', () => busy(saveSendBtn, () => save(true)));

                panelsBox.replaceChildren(h('div', { class: 'stack' },
                    h('div', { class: 'grid-2' },
                        field('Nazwa panelu', textInput(draft.name, v => { draft.name = v; }, { max: 100, placeholder: 'np. Kolory nicków' }), 'Widać ją tylko tutaj i w /selfrole.'),
                        field('Kanał', channel)),
                    h('div', { class: 'grid-2' },
                        field('Rodzaj', selectInput(modes, draft.mode, v => { draft.mode = v; syncVisibility(); drawRoles(); })),
                        field('Działanie', selectInput(behaviors, draft.behavior, v => { draft.behavior = v; syncVisibility(); }))),
                    h('div', { class: 'grid-2' },
                        field('Wymagana rola', anyRoleSelect(draft.requiredRoleId, v => { draft.requiredRoleId = v; }), 'Tylko osoby z tą rolą mogą korzystać z panelu.'),
                        limitField),
                    placeholderField,
                    block('Wiadomość nad przyciskami', messageEditor(draft.message, v => { draft.message = v; }, { placeholders: ['{server}', '{server.members}'] })),
                    block('Role w panelu', rolesBox, 'Tylko role, które możesz rozdawać. Bez napisu przycisk pokaże nazwę roli.'),
                    h('div', { class: 'preview' }, h('div', { class: 'preview-label kicker' }, 'Podgląd przycisków'), discordMessage(previewBox)),
                    h('div', { class: 'row end' },
                        h('button', { class: 'btn btn-ghost', onclick: () => drawPanels() }, 'Anuluj'),
                        saveBtn, saveSendBtn)));
                syncVisibility();
                drawRoles();
                panelsBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            // ================================================================ role za reakcje
            const reactionsBox = h('div', { class: 'stack' });

            function reactionRow(r) {
                const delBtn = h('button', { class: 'btn btn-sm btn-danger' }, 'Usuń');
                delBtn.addEventListener('click', () => {
                    if (!confirm('Usunąć role za reakcje z tej wiadomości? Bot zabierze też swoje reakcje.')) return;
                    busy(delBtn, async () => {
                        await ctx.api(`/reactions/${r.id}`, { method: 'DELETE' });
                        data.reactions = data.reactions.filter(x => x.id !== r.id);
                        toast('Usunięto');
                        drawReactions();
                    });
                });
                return h('div', { class: 'list-item' },
                    h('div', { class: 'stack', style: { gap: '6px', flex: '1', 'min-width': '0' } },
                        h('div', { class: 'row', style: { gap: '8px' } },
                            extLink(r.messageUrl, `Wiadomość na ${channelName(r.channelId)} ↗`),
                            h('span', { class: 'badge off' }, shortLabel(behaviors, r.behavior))),
                        h('div', { class: 'row', style: { gap: '12px' } },
                            r.pairs.map(p => h('span', { class: 'muted', style: { display: 'inline-flex', gap: '6px', 'align-items': 'center' } }, emojiView(p.emoji), roleName(p.roleId)))),
                        r.missingRoles.length ? h('div', { class: 'field-hint' }, '⚠ Któraś rola została usunięta z serwera - popraw listę.') : null),
                    h('div', { class: 'list-item-actions' },
                        h('button', { class: 'btn btn-sm', onclick: () => openReactionEditor(r) }, '✏️ Edytuj'),
                        delBtn));
            }

            function drawReactions() {
                const full = data.reactions.length >= data.limits.reactions;
                reactionsBox.replaceChildren(
                    ...(data.reactions.length
                        ? data.reactions.map(reactionRow)
                        : [h('div', { class: 'empty' }, 'Brak wiadomości z rolami za reakcje.')]),
                    h('div', { class: 'row' },
                        h('button', { class: 'btn btn-primary', disabled: full, onclick: () => openReactionEditor(null) }, '+ Dodaj role za reakcje'),
                        full ? h('span', { class: 'faint' }, `Limit: ${data.limits.reactions}.`) : null));
            }

            function openReactionEditor(existing) {
                const draft = existing
                    ? { link: existing.link, behavior: existing.behavior, requiredRoleId: existing.requiredRoleId, maxRoles: existing.maxRoles, pairs: clone(existing.pairs) }
                    : { link: '', behavior: 'toggle', requiredRoleId: null, maxRoles: 0, pairs: [{ emoji: '', roleId: null }] };

                const pairsBox = h('div', { class: 'list-items' });
                function drawPairs() {
                    pairsBox.replaceChildren(
                        ...draft.pairs.map((pair, i) => h('div', { class: 'list-item' },
                            h('div', { class: 'list-item-fields' },
                                field('Emoji', emojiInput(pair.emoji, v => { pair.emoji = v; })),
                                field('Rola', giveRoleSelect(pair.roleId, v => { pair.roleId = v; }))),
                            h('div', { class: 'list-item-actions' }, iconBtn('Usuń', '✕', () => { draft.pairs.splice(i, 1); drawPairs(); }, { danger: true })))),
                        h('button', {
                            type: 'button', class: 'btn btn-sm', disabled: draft.pairs.length >= 20,
                            onclick: () => { draft.pairs.push({ emoji: '', roleId: null }); drawPairs(); },
                        }, '+ Dodaj reakcję'));
                }
                drawPairs();

                const limitField = field('Limit ról', numberInput(draft.maxRoles, 0, 20, v => { draft.maxRoles = v; }), '0 = bez limitu. Nadmiarowa reakcja zostanie zdjęta.');
                const syncVisibility = () => { limitField.hidden = draft.behavior === 'unique'; };

                const saveBtn = h('button', { class: 'btn btn-primary' }, existing ? 'Zapisz' : 'Zapisz i dodaj reakcje');
                saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
                    const body = { reaction: draft };
                    const res = existing
                        ? await ctx.api(`/reactions/${existing.id}`, { method: 'PUT', body })
                        : await ctx.api('/reactions', { method: 'POST', body });
                    const i = data.reactions.findIndex(x => x.id === res.reaction.id);
                    if (i >= 0) data.reactions[i] = res.reaction;
                    else data.reactions.push(res.reaction);
                    for (const w of res.warnings ?? []) toast(w, 'error');
                    toast('Zapisano ✓ Bot dodał reakcje pod wiadomością.');
                    drawReactions();
                }));

                reactionsBox.replaceChildren(h('div', { class: 'stack' },
                    field('Link do wiadomości', textInput(draft.link, v => { draft.link = v.trim(); }, { max: 200, placeholder: 'https://discord.com/channels/…' }),
                        'Na Discordzie: prawy przycisk na wiadomości → „Kopiuj link do wiadomości”. Może to być np. wiadomość wysłana z modułu Wiadomości.'),
                    h('div', { class: 'grid-3' },
                        field('Działanie', selectInput(behaviors, draft.behavior, v => { draft.behavior = v; syncVisibility(); })),
                        field('Wymagana rola', anyRoleSelect(draft.requiredRoleId, v => { draft.requiredRoleId = v; })),
                        limitField),
                    block('Reakcje i role', pairsBox, 'Emoji serwera wybierzesz z podpowiedzi albo wpiszesz jako <:nazwa:id>.'),
                    h('div', { class: 'row end' }, h('button', { class: 'btn btn-ghost', onclick: () => drawReactions() }, 'Anuluj'), saveBtn)));
                syncVisibility();
                reactionsBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            // ================================================================ embed z jedną rolą (jak /customrolaembed)
            function simpleEmbedCard() {
                const settings = ctx.config();
                const form = {
                    channel: channelSelect(ctx.channels, null),
                    role: roleSelect(ctx.roles, null, { onlyAssignable: true }),
                    title: h('input', { class: 'input', placeholder: 'np. Odbierz rangę Pokémon GO', maxLength: 256 }),
                    description: h('textarea', { class: 'input', rows: 5, placeholder: 'Kliknij przycisk poniżej, żeby dostać powiadomienia o eventach.' }),
                    footer: h('input', { class: 'input', placeholder: 'opcjonalnie', maxLength: 2048 }),
                    buttonLabel: h('input', { class: 'input', value: settings.buttonLabel, maxLength: 80 }),
                };
                let color = settings.embedColor;

                const pTitle = h('div', { class: 'dc-embed-title' });
                const pDesc = h('div', { class: 'dc-embed-desc' });
                const pFooter = h('div', { class: 'dc-embed-footer' });
                const pButton = h('span', { class: 'dc-button' });
                const pEmbed = h('div', { class: 'dc-embed' }, pTitle, pDesc, pFooter);

                const refresh = () => {
                    pTitle.textContent = form.title.value || 'Tytuł embeda';
                    pDesc.textContent = form.description.value || 'Treść embeda';
                    pFooter.textContent = form.footer.value;
                    pFooter.hidden = !form.footer.value;
                    pButton.textContent = form.buttonLabel.value || settings.buttonLabel;
                    pEmbed.style.setProperty('--embed-color', /^#[0-9a-f]{6}$/i.test(color) ? color : '#57f287');
                };
                for (const input of [form.title, form.description, form.footer, form.buttonLabel]) input.addEventListener('input', refresh);
                refresh();

                const sendBtn = h('button', { class: 'btn btn-primary btn-lg' }, 'Wyślij embed');
                sendBtn.addEventListener('click', () => busy(sendBtn, async () => {
                    const res = await ctx.api('/send', {
                        method: 'POST',
                        body: {
                            channelId: form.channel.value,
                            roleId: form.role.value,
                            title: form.title.value,
                            description: form.description.value,
                            footer: form.footer.value,
                            color,
                            buttonLabel: form.buttonLabel.value,
                        },
                    });
                    toast('Wysłano embed ✓');
                    if (safeUrl(res.messageUrl)) window.open(res.messageUrl, '_blank', 'noopener,noreferrer');
                }));

                return h('div', { class: 'grid-2', style: { 'align-items': 'start' } },
                    card('✏️', 'Embed z jedną rolą', 'Najprostsza wersja: jeden przycisk, który daje rolę. To samo co /customrolaembed.',
                        h('div', { class: 'grid-2' },
                            field('Kanał', form.channel),
                            field('Rola do odebrania', form.role, 'Tylko role, które możesz rozdawać.')),
                        field('Tytuł', form.title),
                        field('Treść', withCounter(form.description, 4096)),
                        field('Stopka', form.footer),
                        h('div', { class: 'grid-2' },
                            field('Kolor', colorInput(color, v => { color = v; refresh(); })),
                            field('Napis na przycisku', form.buttonLabel)),
                        h('div', { class: 'row end' }, sendBtn)),
                    h('div', { class: 'preview' },
                        h('div', { class: 'preview-label kicker' }, 'Podgląd'),
                        discordMessage(h('div', null, pEmbed, pButton))));
            }

            container.append(
                datalist,
                card('🧩', 'Panele z rolami', 'Wiadomość z przyciskami albo listą wyboru. Działa też po restarcie bota. Zapis odświeża już wysłany panel.', panelsBox),
                card('😀', 'Role za reakcje', 'Reakcja pod wybraną wiadomością daje rolę (zdjęcie reakcji ją zabiera - przy „Przełączaniu”). Bot sam doda reakcje.', reactionsBox),
                simpleEmbedCard(),
            );
            drawPanels();
            drawReactions();
        },
    });
})();
