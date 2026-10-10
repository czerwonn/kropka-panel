'use strict';
// Historia kar (moduł "moderation"): liczniki, filtry, strony, zmiana powodu i usuwanie spraw
(() => {
    const { h, toast, busy, field, card } = window.KropkaPanel;

    const TYPES = {
        warn: ['⚠️', 'Ostrzeżenie'],
        mute: ['🔇', 'Wyciszenie'],
        unmute: ['🔊', 'Odciszenie'],
        kick: ['👢', 'Wyrzucenie'],
        ban: ['🔨', 'Ban'],
        tempban: ['⏳', 'Tymczasowy ban'],
        unban: ['✅', 'Odbanowanie'],
    };
    const STATUS = {
        active: ['on', 'aktywna'],
        expired: ['off', 'wygasła'],
        revoked: ['off', 'cofnięta'],
        done: ['off', 'wykonana'],
    };
    const STATS = [
        ['Wszystkie sprawy', null],
        ['Ostrzeżenia', ['warn']],
        ['Wyciszenia', ['mute']],
        ['Wyrzucenia', ['kick']],
        ['Bany', ['ban', 'tempban']],
    ];
    const STILL_WORKS = ['ban', 'tempban', 'mute'];

    const dateTime = ms => new Date(ms).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
    const plural = (n, one, few, many) => {
        const d = n % 10;
        const t = n % 100;
        if (n === 1) return one;
        return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
    };

    window.KropkaPanel.register('moderation', {
        async render(container, ctx) {
            const filters = { user: '', type: '' };
            let data = null;

            const statsBox = h('div', { class: 'stats' });
            const listBox = h('div', { class: 'stack' });
            const userInput = h('input', { class: 'input', placeholder: 'ID albo fragment nazwy', maxLength: 40 });
            const typeSelect = h('select', { class: 'input' },
                h('option', { value: '' }, 'Wszystkie rodzaje'),
                Object.entries(TYPES).map(([value, [emoji, label]]) => h('option', { value }, `${emoji} ${label}`)));
            const searchBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Szukaj');
            const clearBtn = h('button', {
                class: 'btn btn-ghost', type: 'button',
                onclick: () => {
                    userInput.value = '';
                    typeSelect.value = '';
                    Object.assign(filters, { user: '', type: '' });
                    busy(clearBtn, () => load(1));
                },
            }, 'Wyczyść');

            async function load(page = data?.page ?? 1) {
                const params = new URLSearchParams({ page: String(page) });
                if (filters.user) params.set('user', filters.user);
                if (filters.type) params.set('type', filters.type);
                data = await ctx.api(`/cases?${params}`);
                // np. usunięto ostatnią sprawę na ostatniej stronie - cofamy się na istniejącą stronę
                if (!data.cases.length && data.total > 0 && page > data.pages) return load(data.pages);
                draw();
            }

            function drawStats(counts) {
                statsBox.replaceChildren(...STATS.map(([label, types]) => {
                    const value = types
                        ? types.reduce((sum, t) => sum + (counts[t] ?? 0), 0)
                        : Object.values(counts).reduce((sum, n) => sum + n, 0);
                    return h('div', { class: 'stat' },
                        h('div', { class: 'label' }, label),
                        h('div', { class: 'value' }, value.toLocaleString('pl-PL')));
                }));
            }

            function caseRow(c) {
                const [emoji, label] = TYPES[c.type] ?? ['•', c.type];
                const [badge, status] = STATUS[c.status] ?? ['off', c.status];
                const details = [
                    `Moderator: ${c.moderatorName}`,
                    dateTime(c.createdAt),
                    c.type === 'warn' ? `${c.points} pkt` : null,
                    c.duration ? `czas: ${c.duration}` : null,
                    c.expiresAt ? `${c.type === 'warn' ? 'wygasa' : 'koniec'}: ${dateTime(c.expiresAt)}` : null,
                    c.editedAt ? 'powód edytowany' : null,
                ].filter(Boolean).join(' · ');

                const li = h('li', null,
                    h('span', { class: 'idx', title: `Sprawa #${c.number}` }, c.number),
                    h('div', { class: 't' },
                        h('span', { title: `ID użytkownika: ${c.userId}` }, `${emoji} ${label} · ${c.userName}`),
                        h('small', null, c.reason ? `Powód: ${c.reason}` : 'Bez powodu'),
                        h('small', null, details)),
                    h('span', { class: `badge ${badge}` }, status),
                    h('div', { class: 'row' },
                        h('button', { class: 'btn btn-ghost btn-sm', title: 'Zmień powód', onclick: () => editRow(li, c) }, '✎'),
                        h('button', { class: 'btn btn-ghost btn-sm', title: 'Usuń z historii', onclick: e => remove(e.currentTarget, c) }, '✕')));
                return li;
            }

            function editRow(li, c) {
                const input = h('input', { class: 'input', value: c.reason ?? '', maxLength: 500, placeholder: 'Nowy powód' });
                const save = h('button', { class: 'btn btn-primary btn-sm' }, 'Zapisz');
                const cancel = h('button', { class: 'btn btn-ghost btn-sm', onclick: () => li.replaceWith(caseRow(c)) }, 'Anuluj');
                save.addEventListener('click', () => busy(save, async () => {
                    if (!input.value.trim()) throw new Error('Wpisz powód.');
                    const res = await ctx.api(`/cases/${c.number}`, { method: 'PATCH', body: { reason: input.value } });
                    Object.assign(c, res.case);
                    li.replaceWith(caseRow(c));
                    toast(`Zmieniono powód sprawy #${c.number} ✓`);
                }));
                input.addEventListener('keydown', e => {
                    if (e.key === 'Enter') save.click();
                    if (e.key === 'Escape') cancel.click();
                });
                li.replaceChildren(
                    h('span', { class: 'idx' }, c.number),
                    h('div', { class: 't' }, input),
                    h('span'),
                    h('div', { class: 'row' }, save, cancel));
                input.focus();
            }

            async function remove(btn, c) {
                const label = TYPES[c.type]?.[1] ?? c.type;
                const note = c.status === 'active' && STILL_WORKS.includes(c.type)
                    ? '\n\nTo usuwa tylko wpis z historii – sama kara dalej działa (cofniesz ją komendą /unban albo /unmute).'
                    : '';
                if (!confirm(`Usunąć sprawę #${c.number} (${label}, ${c.userName}) z historii? Tego nie da się cofnąć.${note}`)) return;
                await busy(btn, async () => {
                    await ctx.api(`/cases/${c.number}`, { method: 'DELETE' });
                    toast(`Usunięto sprawę #${c.number}`);
                    await load();
                });
            }

            function draw() {
                drawStats(data.counts ?? {});
                if (!data.cases.length) {
                    const filtered = filters.user || filters.type;
                    listBox.replaceChildren(h('div', { class: 'empty' },
                        h('div', { class: 'big' }, filtered ? '🔎' : '🕊️'),
                        filtered ? 'Brak kar pasujących do filtrów.' : 'Na tym serwerze nie ma jeszcze żadnych kar.'));
                    return;
                }
                const prev = h('button', {
                    class: 'btn btn-sm', disabled: data.page <= 1,
                    onclick: e => busy(e.currentTarget, () => load(data.page - 1)),
                }, '← Nowsze');
                const next = h('button', {
                    class: 'btn btn-sm', disabled: data.page >= data.pages,
                    onclick: e => busy(e.currentTarget, () => load(data.page + 1)),
                }, 'Starsze →');
                listBox.replaceChildren(
                    h('ol', { class: 'queue-list' }, data.cases.map(caseRow)),
                    h('div', { class: 'row' },
                        prev,
                        h('span', { class: 'muted' }, `Strona ${data.page} z ${data.pages} · ${data.total} ${plural(data.total, 'sprawa', 'sprawy', 'spraw')}`),
                        next));
            }

            const form = h('form', {
                class: 'grid-3',
                onsubmit: e => {
                    e.preventDefault();
                    filters.user = userInput.value.trim();
                    filters.type = typeSelect.value;
                    busy(searchBtn, () => load(1));
                },
            },
            field('Użytkownik', userInput),
            field('Rodzaj kary', typeSelect),
            h('div', { class: 'row', style: { 'align-self': 'end' } }, searchBtn, clearBtn));

            container.append(card('📋', 'Historia kar',
                'Każda kara ma numer sprawy (ten sam co w /kary info). Usunięcie sprawy nie cofa bana ani wyciszenia.',
                statsBox, form, listBox));

            try {
                await load(1);
            } catch (err) {
                listBox.replaceChildren(h('div', { class: 'error-box' }, err.message));
            }
        },
    });
})();
