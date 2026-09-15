// ==UserScript==
// @name         Berlinovo Apartment Helper
// @namespace    hamo.berlinovo
// @version      2.3.1
// @description  Berlinovo apartment helper with working links, applied markers, settings and scrollable details.
// @author       HAMO
// @match        https://www.berlinovo.de/en/apartments/search*
// @run-at       document-idle
// @license MIT
// @grant        none
// @noframes
// ==/UserScript==

(() => {
    'use strict';

    /* ============================================================
       CONFIG
       ============================================================ */

    const ROOT_SELECTOR = '.main-col';

    const KEY_MARKS = 'hamo_berlinovo_marks_v22';
    const KEY_SETTINGS = 'hamo_berlinovo_settings_v22';
    const KEY_CACHE = 'hamo_berlinovo_cache_v22';

    const CACHE_TTL = 30 * 60 * 1000;
    const MAX_CONCURRENT = 4;

    const DEFAULT_SETTINGS = {
        rent: true,
        cleaningFee: true,
        area: true,
        rooms: true,
        occupancy: false,
        address: true,
        description: false,
        services: false,
        distances: false
    };

    const SETTINGS = [
        ['rent', 'Monthly rent'],
        ['cleaningFee', 'Cleaning fee'],
        ['area', 'Area'],
        ['rooms', 'Rooms'],
        ['occupancy', 'Maximum occupancy'],
        ['address', 'Address'],
        ['description', 'Description'],
        ['services', 'Services'],
        ['distances', 'Distances']
    ];

    /* ============================================================
       STATE
       ============================================================ */

    let marks = loadJSON(KEY_MARKS, {});
    let settings = {
        ...DEFAULT_SETTINGS,
        ...loadJSON(KEY_SETTINGS, {})
    };

    let cache = loadJSON(KEY_CACHE, {});

    let hideApplied = false;
    let scanning = false;
    let scanTimer = null;

    const processed = new Set();

    /* ============================================================
       STORAGE
       ============================================================ */

    function loadJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    }

    function saveJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.error('[Berlinovo Helper] Storage error:', error);
        }
    }

    /* ============================================================
       HELPERS
       ============================================================ */

    function esc(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function clean(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function absolute(url) {
        try {
            return new URL(url, location.href).href.split('#')[0];
        } catch {
            return String(url || '');
        }
    }

    function getLines(text) {
        return String(text || '')
            .split('\n')
            .map(clean)
            .filter(Boolean);
    }

    function matchFirst(text, patterns) {
        for (const pattern of patterns) {
            const match = String(text || '').match(pattern);

            if (match?.[1]) {
                return clean(match[1]);
            }
        }

        return '';
    }

    function getSection(lines, starts, ends) {
        const startNames = starts.map(x => x.toLowerCase());
        const endNames = ends.map(x => x.toLowerCase());

        const start = lines.findIndex(line =>
            startNames.includes(line.toLowerCase())
        );

        if (start === -1) {
            return [];
        }

        const output = [];

        for (let i = start + 1; i < lines.length; i++) {
            if (endNames.includes(lines[i].toLowerCase())) {
                break;
            }

            output.push(lines[i]);
        }

        return output;
    }

    function getRoot() {
        return document.querySelector(ROOT_SELECTOR);
    }

    function getCardFromAnchor(anchor) {
        const root = getRoot();

        if (!anchor || !root) {
            return null;
        }

        let card =
            anchor.closest('article, li, .views-row');

        if (!card) {
            card = anchor.parentElement;
        }

        let candidate = card;

        for (let i = 0; i < 8; i++) {
            if (!candidate || candidate === root) {
                break;
            }

            const links =
                candidate.querySelectorAll(
                    'a[href*="/apartments/"]'
                );

            if (links.length === 1) {
                card = candidate;
                break;
            }

            candidate = candidate.parentElement;
        }

        return card || null;
    }

    /* ============================================================
       DETAIL PAGE PARSER
       ============================================================ */

    function parseDetail(html, url) {
        const doc = new DOMParser().parseFromString(
            html,
            'text/html'
        );

        doc.querySelectorAll(
            'script,style,noscript,svg,iframe,header,footer'
        ).forEach(el => el.remove());

        const raw = doc.body?.innerText || '';
        const text = clean(raw);
        const lines = getLines(raw);

        const title =
            clean(doc.querySelector('h1')?.textContent) ||
            clean(doc.title) ||
            'Berlinovo Apartment';

        const availability = matchFirst(text, [
            /(?:Availability|Verfügbarkeit)\s+([^\n]+?)(?=\s+(?:Mietanfrage|Rental request|Objektinformationen|Property information)|$)/i
        ]);

        const rent = matchFirst(text, [
            /(?:Inklusivmiete mtl\. ab|Monthly inclusive rent from|Inclusive rent(?: from)?)\s*([0-9.,]+\s*€)/i,
            /(?:Monthly inclusive rent from|Inclusive rent)\s*([€]?\s*[0-9.,]+)/i
        ]);

        const cleaningFee = matchFirst(text, [
            /(?:zzgl\. Endreinigung \(einmalig\)|plus final cleaning \(one-time\)|final cleaning \(one-time\))\s*([0-9.,]+\s*€)/i,
            /(?:Endreinigung|final cleaning)[^0-9]{0,30}([0-9.,]+\s*€)/i
        ]);

        const area = matchFirst(text, [
            /(?:Wohnfläche ab|Living space from|Wohnfläche|Living space)\s*([0-9.,]+\s*m²)/i
        ]);

        const rooms = matchFirst(text, [
            /(\d+(?:[,.]\d+)?)\-Zimmer-Apartment/i,
            /(\d+(?:[,.]\d+)?)\s*[- ]room apartment/i
        ]);

        const occupancy = matchFirst(text, [
            /(?:max\. Belegung|Maximum occupancy|Max occupancy)\s*(?:von\s*)?(\d+\s*(?:Person|Personen|people)?)/i
        ]);

        /* ---------------- Address ---------------- */

        const objectInfo = getSection(
            lines,
            [
                'Objektinformationen',
                'Property information'
            ],
            [
                'Reinigungsservice',
                'Cleaning Service',
                'Services',
                'Entfernungen',
                'Distances'
            ]
        );

        let address = '';

        for (let i = 0; i < objectInfo.length; i++) {
            if (/\b\d{5}\b/.test(objectInfo[i])) {
                address = objectInfo
                    .slice(
                        Math.max(0, i - 1),
                        Math.min(objectInfo.length, i + 2)
                    )
                    .join(', ');

                break;
            }
        }

        /* ---------------- Description ---------------- */

        const description = getSection(
            lines,
            ['Drucken', 'Print'],
            ['Lageinformationen', 'Location information']
        ).join(' ');

        /* ---------------- Services ---------------- */

        const services = getSection(
            lines,
            ['Services'],
            ['Entfernungen', 'Distances']
        ).filter(x => !/^divider$/i.test(x));

        /* ---------------- Distances ---------------- */

        const distances = getSection(
            lines,
            ['Entfernungen', 'Distances'],
            [
                'Kontakt',
                'Contact',
                'Apartments in Lichtenberg',
                'Apartments in Mitte',
                'Apartments in Neukölln',
                'Apartments in Steglitz-Zehlendorf'
            ]
        ).filter(x => !/^divider$/i.test(x));

        /* ---------------- Rental Inquiry ---------------- */

        let rentalInquiry = '';

        const inquiry = [
            ...doc.querySelectorAll('a[href]')
        ].find(anchor => {
            const anchorText =
                clean(anchor.textContent || '').toLowerCase();

            const href =
                anchor.getAttribute('href') || '';

            return (
                anchorText.includes('mietanfrage') ||
                anchorText.includes('rental inquiry') ||
                anchorText.includes('rental request') ||
                href.includes('app.wohnungshelden.de')
            );
        });

        if (inquiry) {
            try {
                rentalInquiry =
                    new URL(
                        inquiry.getAttribute('href'),
                        url
                    ).href;
            } catch {
                rentalInquiry = inquiry.href || '';
            }
        }

        return {
            url,
            title,
            availability,
            rent,
            cleaningFee,
            area,
            rooms,
            occupancy,
            address,
            description,
            services,
            distances,
            rentalInquiry
        };
    }

    /* ============================================================
       CACHE
       ============================================================ */

    function getCached(url) {
        const item = cache[url];

        if (!item) {
            return null;
        }

        if (
            Date.now() - item.timestamp >
            CACHE_TTL
        ) {
            delete cache[url];
            saveJSON(KEY_CACHE, cache);
            return null;
        }

        return item.data;
    }

    async function fetchDetail(url) {
        const cached = getCached(url);

        if (cached) {
            return cached;
        }

        const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const html = await response.text();

        const data = parseDetail(
            html,
            url
        );

        cache[url] = {
            timestamp: Date.now(),
            data
        };

        saveJSON(KEY_CACHE, cache);

        return data;
    }

    /* ============================================================
       FIND APARTMENTS
       ============================================================ */

    function findItems() {
        const root = getRoot();

        if (!root) {
            return [];
        }

        const anchors =
            root.querySelectorAll(
                'a[href*="/apartments/"]'
            );

        const seen = new Set();
        const items = [];

        for (const anchor of anchors) {
            const url = absolute(anchor.href);

            try {
                const parsed = new URL(url);

                if (
                    parsed.pathname.includes(
                        '/apartments/search'
                    )
                ) {
                    continue;
                }

                if (
                    !/^\/(?:en|de)\/apartments\/[^/]+/i.test(
                        parsed.pathname
                    )
                ) {
                    continue;
                }

                if (seen.has(url)) {
                    continue;
                }

                seen.add(url);

                const card =
                    getCardFromAnchor(anchor);

                if (!card) {
                    continue;
                }

                items.push({
                    url,
                    anchor,
                    card
                });
            } catch {
                // Ignore invalid URLs.
            }
        }

        return items;
    }

    /* ============================================================
       RENDER
       ============================================================ */

    function stat(label, value) {
        if (!value) {
            return '';
        }

        return `
            <div class="bo-stat">
                <span>${esc(label)}</span>
                <b>${esc(value)}</b>
            </div>
        `;
    }

    function render(item, data) {
        const {
            card,
            url
        } = item;

        let panel =
            card.querySelector(':scope > .bo-panel');

        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'bo-panel';
            card.appendChild(panel);
        }

        const marked = Boolean(marks[url]);

        const stats = [
            settings.rent
                ? stat('Monthly rent', data.rent)
                : '',

            settings.cleaningFee
                ? stat('Cleaning fee', data.cleaningFee)
                : '',

            settings.area
                ? stat('Area', data.area)
                : '',

            settings.rooms
                ? stat('Rooms', data.rooms)
                : '',

            settings.occupancy
                ? stat(
                    'Max occupancy',
                    data.occupancy
                )
                : '',

            settings.address
                ? stat('Address', data.address)
                : ''
        ].join('');

        const description =
            settings.description &&
            data.description
                ? `
                    <section>
                        <strong>Description</strong>
                        <p>${esc(data.description)}</p>
                    </section>
                `
                : '';

        const services =
            settings.services &&
            data.services.length
                ? `
                    <section>
                        <strong>Services</strong>
                        <ul>
                            ${data.services.map(
                                x =>
                                    `<li>${esc(x)}</li>`
                            ).join('')}
                        </ul>
                    </section>
                `
                : '';

        const distances =
            settings.distances &&
            data.distances.length
                ? `
                    <section>
                        <strong>Distances</strong>
                        <ul>
                            ${data.distances.map(
                                x =>
                                    `<li>${esc(x)}</li>`
                            ).join('')}
                        </ul>
                    </section>
                `
                : '';

        panel.innerHTML = `
            ${
                marked
                    ? `
                        <div class="bo-marked">
                            ✓ Already marked as applied
                        </div>
                    `
                    : ''
            }

            <div class="bo-scroll">

                <div class="bo-head">
                    <strong>
                        ${esc(data.title)}
                    </strong>

                    ${
                        data.availability
                            ? `
                                <span class="bo-status">
                                    ${esc(data.availability)}
                                </span>
                            `
                            : ''
                    }
                </div>

                ${
                    stats
                        ? `
                            <div class="bo-grid">
                                ${stats}
                            </div>
                        `
                        : ''
                }

                ${description}
                ${services}
                ${distances}

            </div>

            <div class="bo-actions">

                <button
                    type="button"
                    class="bo-open"
                    data-bo-action="open"
                    data-bo-url="${esc(url)}"
                >
                    Open apartment
                </button>

                ${
                    data.rentalInquiry
                        ? `
                            <button
                                type="button"
                                class="bo-rental"
                                data-bo-action="rental"
                                data-bo-url="${esc(data.rentalInquiry)}"
                            >
                                Rental inquiry
                            </button>
                        `
                        : ''
                }

                <button
                    type="button"
                    class="bo-apply ${marked ? 'active' : ''}"
                    data-bo-action="apply"
                    data-bo-url="${esc(url)}"
                >
                    ${marked ? '✓ Applied' : 'Mark as Applied'}
                </button>

            </div>
        `;

        updateVisibility(item);
    }

    function renderLoading(item) {
        let panel =
            item.card.querySelector(
                ':scope > .bo-panel'
            );

        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'bo-panel';
            item.card.appendChild(panel);
        }

        panel.innerHTML = `
            <div class="bo-loading">
                Loading apartment details…
            </div>
        `;

        updateVisibility(item);
    }

    function renderError(item) {
        let panel =
            item.card.querySelector(
                ':scope > .bo-panel'
            );

        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'bo-panel';
            item.card.appendChild(panel);
        }

        panel.innerHTML = `
            <div class="bo-error">
                Could not load details.
                <br><br>
                <button
                    type="button"
                    class="bo-open"
                    data-bo-action="open"
                    data-bo-url="${esc(item.url)}"
                >
                    Open apartment
                </button>
            </div>
        `;

        updateVisibility(item);
    }

    function updateVisibility(item) {
        item.card.classList.toggle(
            'bo-hidden-applied',
            hideApplied &&
            Boolean(marks[item.url])
        );
    }

    /* ============================================================
       PROCESS
       ============================================================ */

    async function processItem(item) {
        if (processed.has(item.url)) {
            return;
        }

        processed.add(item.url);

        renderLoading(item);

        try {
            const data =
                await fetchDetail(item.url);

            render(item, data);
        } catch (error) {
            console.error(
                '[Berlinovo Helper]',
                item.url,
                error
            );

            renderError(item);
        }
    }

    async function scan() {
        if (scanning) {
            return;
        }

        const items = findItems();

        updateToolbar();

        if (!items.length) {
            return;
        }

        scanning = true;

        try {
            let index = 0;

            async function worker() {
                while (index < items.length) {
                    const item = items[index++];
                    await processItem(item);
                }
            }

            await Promise.all(
                Array.from(
                    {
                        length: Math.min(
                            MAX_CONCURRENT,
                            items.length
                        )
                    },
                    worker
                )
            );
        } finally {
            scanning = false;
            updateToolbar();
        }
    }

    function scheduleScan(delay = 300) {
        clearTimeout(scanTimer);

        scanTimer = setTimeout(
            scan,
            delay
        );
    }

    /* ============================================================
       SETTINGS
       ============================================================ */

    function buildSettings() {
        if (
            document.getElementById(
                'bo-overlay'
            )
        ) {
            return;
        }

        const overlay =
            document.createElement('div');

        overlay.id = 'bo-overlay';

        overlay.innerHTML = `
            <div id="bo-modal">

                <div class="bo-modal-head">

                    <strong>
                        Berlinovo Helper Settings
                    </strong>

                    <button
                        type="button"
                        id="bo-close"
                    >
                        ×
                    </button>

                </div>

                <div class="bo-group-title">
                    Information to show
                </div>

                ${SETTINGS.map(
                    ([key, label]) => `
                        <label class="bo-setting">

                            <span>
                                ${esc(label)}
                            </span>

                            <input
                                type="checkbox"
                                data-setting="${esc(key)}"
                                ${settings[key] ? 'checked' : ''}
                            >

                        </label>
                    `
                ).join('')}

                <div class="bo-presets">

                    <button
                        type="button"
                        id="bo-show-all"
                    >
                        Show all
                    </button>

                    <button
                        type="button"
                        id="bo-compact"
                    >
                        Compact
                    </button>

                </div>

            </div>
        `;

        document.body.appendChild(overlay);
    }

    function syncSettings() {
        document
            .querySelectorAll(
                '#bo-overlay input[data-setting]'
            )
            .forEach(input => {
                input.checked = Boolean(
                    settings[
                        input.dataset.setting
                    ]
                );
            });
    }

    function rerenderVisible() {
        for (const item of findItems()) {
            const data =
                getCached(item.url);

            if (data) {
                render(item, data);
            }
        }

        updateToolbar();
    }

    /* ============================================================
       TOOLBAR
       ============================================================ */

    function buildToolbar() {
        if (
            document.getElementById(
                'bo-toolbar'
            )
        ) {
            return;
        }

        const toolbar =
            document.createElement('div');

        toolbar.id = 'bo-toolbar';

        toolbar.innerHTML = `
            <button
                type="button"
                id="bo-settings"
            >
                ⚙ Settings
            </button>

            <button
                type="button"
                id="bo-hide"
            >
                Hide applied
            </button>

            <button
                type="button"
                id="bo-refresh"
            >
                Refresh details
            </button>

            <button
                type="button"
                id="bo-clear"
            >
                Clear marks
            </button>

            <span id="bo-count"></span>
        `;

        document.body.appendChild(toolbar);
    }

    function updateToolbar() {
        const count =
            document.getElementById(
                'bo-count'
            );

        if (!count) {
            return;
        }

        count.textContent =
            `${findItems().length} apartments • ${Object.keys(marks).length} applied`;
    }

    /* ============================================================
       DELEGATED CLICK HANDLER
       IMPORTANT:
       This is the main fix for non-working buttons.
       ============================================================ */

    function openExternal(url) {
        if (!url) {
            return;
        }

        const absoluteUrl =
            absolute(url);

        const newWindow =
            window.open(
                absoluteUrl,
                '_blank'
            );

        /*
         * Some browsers/extensions block window.open().
         * Fallback to normal navigation.
         */
        if (!newWindow) {
            location.href = absoluteUrl;
        }
    }

    function handleApply(url) {
        if (!url) {
            return;
        }

        if (marks[url]) {
            delete marks[url];
        } else {
            marks[url] = {
                timestamp: Date.now()
            };
        }

        saveJSON(
            KEY_MARKS,
            marks
        );

        const items = findItems();

        for (const item of items) {
            if (item.url === url) {
                const data =
                    getCached(url);

                if (data) {
                    render(
                        item,
                        data
                    );
                } else {
                    updateVisibility(item);
                }
            }
        }

        updateToolbar();
    }

    function installDelegatedHandlers() {
        /*
         * Capture phase is intentional.
         * Berlinovo has its own card click/navigation handlers.
         * Capturing at document level lets this script intercept
         * our controls BEFORE Berlinovo handles the click.
         */

        document.addEventListener(
            'click',
            event => {
                const target =
                    event.target instanceof Element
                        ? event.target
                        : null;

                if (!target) {
                    return;
                }

                /* ---------------- Our custom buttons ---------------- */

                const actionButton =
                    target.closest(
                        '[data-bo-action]'
                    );

                if (actionButton) {
                    const action =
                        actionButton.dataset.boAction;

                    const url =
                        actionButton.dataset.boUrl;

                    /*
                     * Stop Berlinovo's own card click behavior.
                     */
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();

                    if (action === 'open') {
                        openExternal(url);
                        return;
                    }

                    if (action === 'rental') {
                        openExternal(url);
                        return;
                    }

                    if (action === 'apply') {
                        handleApply(url);
                        return;
                    }
                }

                /* ---------------- Toolbar ---------------- */

                if (
                    target.closest(
                        '#bo-settings'
                    )
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();

                    const overlay =
                        document.getElementById(
                            'bo-overlay'
                        );

                    if (overlay) {
                        overlay.classList.add(
                            'open'
                        );
                    }

                    return;
                }

                if (
                    target.closest(
                        '#bo-hide'
                    )
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();

                    hideApplied =
                        !hideApplied;

                    const button =
                        document.getElementById(
                            'bo-hide'
                        );

                    if (button) {
                        button.textContent =
                            hideApplied
                                ? 'Show applied'
                                : 'Hide applied';

                        button.classList.toggle(
                            'active',
                            hideApplied
                        );
                    }

                    for (const item of findItems()) {
                        updateVisibility(item);
                    }

                    return;
                }

                if (
                    target.closest(
                        '#bo-refresh'
                    )
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();

                    cache = {};

                    saveJSON(
                        KEY_CACHE,
                        cache
                    );

                    processed.clear();

                    document
                        .querySelectorAll(
                            '.bo-panel'
                        )
                        .forEach(panel =>
                            panel.remove()
                        );

                    scheduleScan(0);

                    return;
                }

                if (
                    target.closest(
                        '#bo-clear'
                    )
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();

                    if (
                        !confirm(
                            'Clear all Applied markers?'
                        )
                    ) {
                        return;
                    }

                    marks = {};

                    saveJSON(
                        KEY_MARKS,
                        marks
                    );

                    rerenderVisible();
                    updateToolbar();

                    return;
                }

                /* ---------------- Settings modal ---------------- */

                if (
                    target.closest(
                        '#bo-close'
                    )
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();

                    const overlay =
                        document.getElementById(
                            'bo-overlay'
                        );

                    if (overlay) {
                        overlay.classList.remove(
                            'open'
                        );
                    }

                    return;
                }

                if (
                    target.closest(
                        '#bo-show-all'
                    )
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();

                    for (const [key] of SETTINGS) {
                        settings[key] = true;
                    }

                    saveJSON(
                        KEY_SETTINGS,
                        settings
                    );

                    syncSettings();
                    rerenderVisible();

                    return;
                }

                if (
                    target.closest(
                        '#bo-compact'
                    )
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();

                    settings = {
                        rent: true,
                        cleaningFee: false,
                        area: true,
                        rooms: true,
                        occupancy: false,
                        address: false,
                        description: false,
                        services: false,
                        distances: false
                    };

                    saveJSON(
                        KEY_SETTINGS,
                        settings
                    );

                    syncSettings();
                    rerenderVisible();

                    return;
                }

                /* ---------------- Overlay background ---------------- */

                const overlay =
                    document.getElementById(
                        'bo-overlay'
                    );

                if (
                    overlay &&
                    event.target === overlay
                ) {
                    overlay.classList.remove(
                        'open'
                    );
                }
            },
            true
        );

        /* ---------------- Settings change ---------------- */

        document.addEventListener(
            'change',
            event => {
                const target =
                    event.target instanceof HTMLInputElement
                        ? event.target
                        : null;

                if (
                    !target ||
                    !target.matches(
                        '#bo-overlay input[data-setting]'
                    )
                ) {
                    return;
                }

                event.stopPropagation();
                event.stopImmediatePropagation();

                const key =
                    target.dataset.setting;

                if (!(key in settings)) {
                    return;
                }

                settings[key] =
                    target.checked;

                saveJSON(
                    KEY_SETTINGS,
                    settings
                );

                rerenderVisible();
            },
            true
        );

        /* ---------------- ESC ---------------- */

        document.addEventListener(
            'keydown',
            event => {
                if (
                    event.key !== 'Escape'
                ) {
                    return;
                }

                const overlay =
                    document.getElementById(
                        'bo-overlay'
                    );

                if (overlay) {
                    overlay.classList.remove(
                        'open'
                    );
                }
            },
            true
        );
    }

    /* ============================================================
       CSS
       ============================================================ */

    function addStyles() {
        if (
            document.getElementById(
                'bo-style'
            )
        ) {
            return;
        }

        const style =
            document.createElement('style');

        style.id = 'bo-style';

        style.textContent = `
            .bo-panel {
                position: relative !important;
                z-index: 100 !important;
                width: 100% !important;
                box-sizing: border-box !important;
                margin: 10px 0 !important;
                padding: 12px !important;
                border: 1px solid #d8d8d8 !important;
                border-radius: 10px !important;
                background: #fff !important;
                box-shadow: 0 2px 10px rgba(0,0,0,.06) !important;
                font-family: Arial, sans-serif !important;
                font-size: 13px !important;
                line-height: 1.4 !important;
                pointer-events: auto !important;
            }

            .bo-scroll {
                max-height: 320px;
                overflow-y: auto;
                overflow-x: hidden;
                padding-right: 7px;
            }

            .bo-head {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 10px;
            }

            .bo-head strong {
                font-size: 15px;
            }

            .bo-status {
                padding: 4px 8px;
                white-space: nowrap;
                border-radius: 999px;
                background: #e7f7ed;
                color: #137333;
                font-size: 11px;
                font-weight: 700;
            }

            .bo-grid {
                display: grid;
                grid-template-columns:
                    repeat(
                        auto-fit,
                        minmax(130px, 1fr)
                    );
                gap: 6px;
                margin-bottom: 8px;
            }

            .bo-stat {
                padding: 8px;
                border-radius: 7px;
                background: #f5f6f7;
            }

            .bo-stat span {
                display: block;
                color: #666;
                font-size: 10px;
                text-transform: uppercase;
            }

            .bo-stat b {
                display: block;
                font-size: 13px;
            }

            .bo-scroll section {
                margin-top: 10px;
            }

            .bo-scroll section > strong {
                display: block;
                margin-bottom: 4px;
            }

            .bo-scroll p {
                margin: 0;
            }

            .bo-scroll ul {
                margin: 0;
                padding-left: 18px;
            }

            .bo-marked {
                margin-bottom: 8px;
                padding: 6px 8px;
                border-radius: 6px;
                background: #e7f7ed;
                color: #137333;
                font-size: 11px;
                font-weight: 700;
            }

            .bo-actions {
                position: relative;
                z-index: 1000;
                display: flex;
                flex-wrap: wrap;
                gap: 7px;
                margin-top: 10px;
                pointer-events: auto !important;
            }

            .bo-actions button {
                position: relative;
                z-index: 1001;
                border: 1px solid #ccc !important;
                border-radius: 7px !important;
                padding: 8px 11px !important;
                background: #fff !important;
                color: #222 !important;
                cursor: pointer !important;
                font: 600 12px Arial, sans-serif !important;
                pointer-events: auto !important;
                user-select: none !important;
            }

            .bo-open {
                background: #111 !important;
                color: #fff !important;
                border-color: #111 !important;
            }

            .bo-rental {
                background: #0b57d0 !important;
                color: #fff !important;
                border-color: #0b57d0 !important;
            }

            .bo-rental:hover {
                background: #0846a8 !important;
            }

            .bo-apply.active {
                background: #198754 !important;
                color: #fff !important;
                border-color: #198754 !important;
            }

            .bo-loading {
                color: #777;
            }

            .bo-error {
                color: #b42318;
            }

            .bo-hidden-applied {
                opacity: .35 !important;
                filter: grayscale(.5);
            }

            /* ---------------- Toolbar ---------------- */

            #bo-toolbar {
                position: fixed;
                top: 12px;
                right: 12px;
                z-index: 2147483646;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 6px;
                padding: 8px;
                background: rgba(255,255,255,.97);
                border: 1px solid #ccc;
                border-radius: 10px;
                box-shadow: 0 4px 20px rgba(0,0,0,.15);
            }

            #bo-toolbar button {
                border: 1px solid #ccc;
                border-radius: 7px;
                padding: 7px 10px;
                background: #fff;
                color: #222;
                cursor: pointer;
                font: 600 12px Arial, sans-serif;
            }

            #bo-toolbar button.active {
                background: #111;
                color: #fff;
            }

            #bo-count {
                color: #666;
                white-space: nowrap;
                font-size: 11px;
            }

            /* ---------------- Settings ---------------- */

            #bo-overlay {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: none;
                align-items: center;
                justify-content: center;
                background: rgba(0,0,0,.45);
            }

            #bo-overlay.open {
                display: flex;
            }

            #bo-modal {
                width: min(450px, calc(100vw - 28px));
                max-height: calc(100vh - 30px);
                overflow: auto;
                padding: 18px;
                border-radius: 14px;
                background: #fff;
                box-shadow: 0 20px 60px rgba(0,0,0,.3);
                font: 13px Arial, sans-serif;
            }

            .bo-modal-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 15px;
            }

            .bo-modal-head strong {
                font-size: 18px;
            }

            #bo-close {
                width: 30px;
                height: 30px;
                border: 0;
                border-radius: 50%;
                background: #eee;
                cursor: pointer;
                font-size: 18px;
            }

            .bo-group-title {
                margin-top: 15px;
                padding-top: 12px;
                border-top: 1px solid #eee;
                color: #777;
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
            }

            .bo-setting {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 0;
                cursor: pointer;
            }

            .bo-setting input {
                width: 18px;
                height: 18px;
                cursor: pointer;
            }

            .bo-presets {
                display: flex;
                gap: 7px;
                margin-top: 15px;
                padding-top: 13px;
                border-top: 1px solid #eee;
            }

            .bo-presets button {
                border: 1px solid #ccc;
                border-radius: 7px;
                padding: 7px 10px;
                background: #fff;
                cursor: pointer;
            }

            @media (max-width: 700px) {
                #bo-toolbar {
                    left: 10px;
                    right: 10px;
                    top: 10px;
                }

                .bo-scroll {
                    max-height: 280px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    /* ============================================================
       INIT
       ============================================================ */

    function init() {
        addStyles();
        buildSettings();
        buildToolbar();

        /*
         * Install this BEFORE scanning.
         */
        installDelegatedHandlers();

        scheduleScan(0);

        /*
         * Berlinovo dynamically updates the search results,
         * so rescan when the DOM changes.
         */
        const observer =
            new MutationObserver(() => {
                scheduleScan(500);
            });

        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );
    }

    init();

})();
