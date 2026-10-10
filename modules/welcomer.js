'use strict';
// Karta powitalna z podglądem na żywo i wysyłanie testów (moduł "welcomer")
(() => {
    const { h, toast, busy, field, card, renderControl, placeholderChips, extLink, clone } = window.KropkaPanel;

    const SHARED = ['cardAccent', 'cardBackground', 'cardBackgroundUrl', 'cardOverlay'];
    const KIND_KEYS = {
        join: { enabled: 'cardEnabled', title: 'cardTitle', subtitle: 'cardSubtitle', bottom: 'cardBottom' },
        leave: { enabled: 'leaveCardEnabled', title: 'leaveCardTitle', subtitle: 'leaveCardSubtitle', bottom: 'leaveCardBottom' },
    };
    const CARD_KEYS = [...SHARED, ...Object.values(KIND_KEYS.join), ...Object.values(KIND_KEYS.leave)];
    const CARD_VARS = ['{user.name}', '{user.username}', '{server}', '{server.members}'];
    const ALLOWED_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net', 'i.imgur.com'];

    const pick = config => Object.fromEntries(CARD_KEYS.map(k => [k, clone(config[k])]));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    function hostWarning(url) {
        if (!url) return null;
        try {
            const u = new URL(url);
            if (u.protocol === 'https:' && ALLOWED_HOSTS.includes(u.hostname)) return null;
        } catch { /* zły adres - sprawdzi go też bot */ }
        return '⚠ Ten adres nie zadziała - tło musi być z cdn.discordapp.com, media.discordapp.net albo i.imgur.com.';
    }

    window.KropkaPanel.register('welcomer', {
        render(container, ctx) {
            const defs = new Map(ctx.meta.settings.map(f => [f.key, f]));
            let saved = pick(ctx.config());
            let draft = clone(saved);
            let kind = 'join';

            // ---------- podgląd ----------
            // bez display w stylu - inaczej atrybut hidden by nie działał
            const img = h('img', { alt: 'Podgląd karty', hidden: true, style: { width: '100%', 'vertical-align': 'top', 'border-radius': '6px', transition: 'opacity 0.2s' } });
            const placeholder = h('div', { class: 'empty' }, 'Ładuję podgląd…');
            const warningsBox = h('div', { class: 'stack', style: { gap: '4px' } });
            let timer = null;
            let inFlight = false;
            let again = false;

            async function refreshPreview() {
                if (inFlight) { again = true; return; }
                inFlight = true;
                img.style.setProperty('opacity', '0.55');
                try {
                    const res = await ctx.api('/preview', { method: 'POST', body: { kind, card: draft } });
                    img.src = res.image;
                    img.hidden = false;
                    placeholder.hidden = true;
                    warningsBox.replaceChildren(...(res.warnings ?? []).map(w => h('div', { class: 'field-hint' }, `⚠ ${w}`)));
                } catch (err) {
                    warningsBox.replaceChildren(h('div', { class: 'field-hint' }, `⚠ ${err.message}`));
                } finally {
                    img.style.setProperty('opacity', '1');
                    inFlight = false;
                    if (again) { again = false; refreshPreview(); }
                }
            }
            const schedule = () => {
                clearTimeout(timer);
                timer = setTimeout(refreshPreview, 900);
            };
            ctx.onLeave(() => clearTimeout(timer));

            // ---------- formularz ----------
            const saveBtn = h('button', { class: 'btn btn-primary' }, 'Zapisz kartę');
            const undoBtn = h('button', { class: 'btn btn-ghost' }, 'Cofnij');
            const dirty = () => !same(draft, saved);
            const updateButtons = () => {
                saveBtn.disabled = !dirty();
                undoBtn.hidden = !dirty();
            };

            const onChange = key => value => {
                draft[key] = value;
                updateButtons();
                if (key === 'cardBackgroundUrl') bgHint.textContent = hostWarning(value) ?? '';
                schedule();
            };
            const control = key => renderControl(defs.get(key), draft[key], onChange(key), ctx);
            // pole tekstowe z klikalnymi zmiennymi
            const textWithVars = (key, hint) => {
                const input = control(key);
                return field(defs.get(key).label, h('div', { class: 'stack', style: { gap: '6px' } }, input, placeholderChips(CARD_VARS, input)), hint);
            };

            const bgHint = h('span', { class: 'field-hint' }, hostWarning(draft.cardBackgroundUrl) ?? '');
            const kindBox = h('div', { class: 'stack' });
            const segButtons = {};
            const segmented = h('div', { class: 'segmented' },
                Object.entries({ join: 'Powitanie', leave: 'Pożegnanie' }).map(([k, label]) => {
                    segButtons[k] = h('button', { type: 'button', onclick: () => setKind(k) }, label);
                    return segButtons[k];
                }));

            function drawKindFields() {
                const keys = KIND_KEYS[kind];
                kindBox.replaceChildren(
                    field(kind === 'join' ? 'Dołączaj kartę do powitania' : 'Dołączaj kartę do pożegnania', control(keys.enabled),
                        kind === 'join' ? 'Kanał i treść powitania ustawiasz wyżej.' : 'Kanał i treść pożegnania ustawiasz wyżej.'),
                    textWithVars(keys.title),
                    textWithVars(keys.subtitle),
                    textWithVars(keys.bottom));
            }

            function setKind(k) {
                kind = k;
                for (const [key, btn] of Object.entries(segButtons)) btn.className = key === kind ? 'active' : '';
                drawKindFields();
                clearTimeout(timer);
                refreshPreview();
            }

            function drawAll() {
                form.replaceChildren(
                    segmented,
                    kindBox,
                    h('div', { class: 'grid-2' },
                        field(defs.get('cardAccent').label, control('cardAccent')),
                        field(defs.get('cardBackground').label, control('cardBackground'))),
                    field(defs.get('cardBackgroundUrl').label, control('cardBackgroundUrl'),
                        'Opcjonalnie. Tylko https z cdn.discordapp.com, media.discordapp.net albo i.imgur.com - np. wyślij obrazek na Discordzie i skopiuj jego link.'),
                    bgHint,
                    field(defs.get('cardOverlay').label, control('cardOverlay'), 'Przy obrazku tła: im więcej, tym czytelniejszy tekst.'));
                setKind(kind);
                updateButtons();
            }

            const form = h('div', { class: 'stack' });

            saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
                const changes = Object.fromEntries(CARD_KEYS.filter(k => !same(draft[k], saved[k])).map(k => [k, draft[k]]));
                const config = await ctx.saveConfig(changes);
                saved = pick(config);
                draft = clone(saved);
                drawAll();
                toast('Zapisano kartę ✓');
            }).then(updateButtons)); // busy() na końcu odblokowuje przycisk - przywracamy stan "nic do zapisania"
            undoBtn.addEventListener('click', () => {
                draft = clone(saved);
                bgHint.textContent = hostWarning(draft.cardBackgroundUrl) ?? '';
                drawAll();
            });

            // ---------- testy ----------
            const testResult = h('div', { class: 'muted' });
            const testBtn = (testKind, label) => {
                const btn = h('button', { class: 'btn' }, label);
                btn.addEventListener('click', () => busy(btn, async () => {
                    if (dirty() && testKind !== 'dm') toast('Karta ma niezapisane zmiany - test użyje zapisanych ustawień.', 'error');
                    const res = await ctx.api('/test', { method: 'POST', body: { kind: testKind } });
                    for (const w of res.warnings ?? []) toast(w, 'error');
                    toast(testKind === 'dm' ? 'Wysłano wiadomość prywatną ✓' : 'Wysłano test ✓');
                    testResult.replaceChildren(res.messageUrl ? extLink(res.messageUrl, 'Zobacz wysłaną wiadomość ↗') : 'Sprawdź swoje wiadomości prywatne.');
                }));
                return btn;
            };

            container.append(
                card('🖼️', 'Karta powitalna', 'Obrazek z awatarem dołączany do wiadomości. Gdy wiadomość ma embed bez obrazka, karta trafia do embeda.',
                    h('div', { class: 'grid-2', style: { 'align-items': 'start' } },
                        form,
                        h('div', { class: 'preview' },
                            h('div', { class: 'preview-label kicker' }, 'Podgląd (z Twoim awatarem)'),
                            placeholder, img,
                            h('div', { style: { 'margin-top': '10px' } }, warningsBox))),
                    h('div', { class: 'row end' }, undoBtn, saveBtn)),
                card('🧪', 'Wyślij test', 'Bot wyśle zapisane powitanie/pożegnanie tak, jakby to Ty dołączył(a) - na kanał z ustawień.',
                    h('div', { class: 'row' }, testBtn('join', '👋 Test powitania'), testBtn('leave', '🚪 Test pożegnania'), testBtn('dm', '✉️ Test wiadomości prywatnej')),
                    testResult),
            );
            drawAll();
        },
    });
})();
