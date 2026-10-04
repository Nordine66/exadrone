/* Single source of truth for Exadrone quote pricing — used by both the
   front-end (script.js, loaded as a plain <script>, exposes window.ExadronePricing)
   and the serverless API (api/quote.js, require()'d as a CommonJS module).
   UMD wrapper because the site has no bundler/module system on either side. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ExadronePricing = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  var CONFIG = {
    currency: 'EUR',
    vatRate: 0.20,
    minimumOrderHT: 390,
    quoteValidityDays: 30,
    // Rates benchmarked against the French drone-cleaning market (2026):
    // toiture 5-14€/m², bardage 6-14€/m², façade 5-15€/m²,
    // vitrage 7-20€/m² (nacelle) / 7-9€/m² (drone entrants). Priced just
    // above the market's cut-rate players (e.g. ~5€/m² outfits) so Exadrone
    // reads as competitive without racing to the bottom.
    services: [
      { id: 'toiture', label: 'Nettoyage de toiture', detail: 'Mousses, lichens et algues', priceHT: 6.90 },
      // Solar is priced by volume (market 2026: 8-12€/m² small residential,
      // 5-6€/m² for 30-50 kWc, 0.4-7€/m² for large sites / robots): priceHT is
      // the rate under the first tier, then each tier applies to the whole
      // surface from its threshold.
      { id: 'solaire', label: 'Nettoyage de panneaux photovoltaïques', detail: 'Toitures et centrales solaires', priceHT: 4.90,
        tiers: [{ from: 500, priceHT: 2.50 }, { from: 2000, priceHT: 0.99 }] },
      { id: 'bardage', label: 'Nettoyage de bardage', detail: 'Métallique, bois, composite', priceHT: 7.50 },
      { id: 'facade', label: 'Nettoyage de façade', detail: 'Enduit, pierre, brique', priceHT: 7.90 },
      { id: 'vitrage', label: 'Nettoyage de vitrages en hauteur', detail: 'Vitres et verrières en hauteur', priceHT: 8.90 }
    ]
  };

  var MIN_SURFACE = 1;
  var MAX_SURFACE = 100000;

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function getService(serviceId) {
    return CONFIG.services.find(function (s) { return s.id === serviceId; }) || null;
  }

  // Lowest rate a service can reach (its largest volume tier)
  function fromPriceHT(service) {
    return (service.tiers || []).reduce(function (min, t) { return Math.min(min, t.priceHT); }, service.priceHT);
  }

  // Rate and amount of one line. Volume tiers apply to the whole surface, and
  // a surface is never billed more than the smallest surface of a higher tier
  // (otherwise 1 999 m² would cost more than 2 000 m²): in that case the rate
  // is lowered to stay at or just under that amount.
  function linePrice(service, surface) {
    var unit = service.priceHT;
    var tiers = service.tiers || [];
    for (var i = 0; i < tiers.length; i++) if (surface >= tiers[i].from) unit = tiers[i].priceHT;
    var cap = Infinity;
    for (var j = 0; j < tiers.length; j++) {
      if (tiers[j].from > surface) cap = Math.min(cap, round2(tiers[j].from * tiers[j].priceHT));
    }
    var capped = surface * unit > cap;
    if (capped) unit = Math.floor(cap / surface * 100) / 100;
    return { unitPriceHT: unit, subtotal: round2(surface * unit), capped: capped };
  }

  // "4,90 € (< 500 m²) · 2,50 € (dès 500 m²) · 0,99 € (dès 2 000 m²)"
  function describeTiers(service) {
    var fmt = function (n) { return n.toFixed(2).replace('.', ',') + ' €'; };
    var num = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
    var tiers = service.tiers || [];
    if (!tiers.length) return fmt(service.priceHT);
    return [fmt(service.priceHT) + ' (< ' + num(tiers[0].from) + ' m²)']
      .concat(tiers.map(function (t) { return fmt(t.priceHT) + ' (dès ' + num(t.from) + ' m²)'; }))
      .join(' · ');
  }

  function getCheapestService() {
    return CONFIG.services.reduce(function (min, s) {
      return s.priceHT < min.priceHT ? s : min;
    }, CONFIG.services[0]);
  }

  // Accepts "1 234,5", "1234.5", "1234", strips spaces (incl. non-breaking),
  // swaps a comma decimal separator for a dot.
  function parseSurface(input) {
    if (input === null || input === undefined) return null;
    var cleaned = String(input).trim().replace(/[\s  ]/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    var value = parseFloat(cleaned);
    if (!isFinite(value)) return null;
    return value;
  }

  function isValidSurface(value) {
    return typeof value === 'number' && isFinite(value) && value >= MIN_SURFACE && value <= MAX_SURFACE;
  }

  function calculateQuote(serviceId, rawSurface) {
    var service = getService(serviceId);
    if (!service) return { ok: false, error: 'service' };

    var surface = typeof rawSurface === 'number' ? rawSurface : parseSurface(rawSurface);
    if (surface === null || !isValidSurface(surface)) return { ok: false, error: 'surface' };

    var line = linePrice(service, surface);
    var subtotal = line.subtotal;
    var totalHT = Math.max(subtotal, CONFIG.minimumOrderHT);
    var minimumApplied = totalHT > subtotal;
    totalHT = round2(totalHT);
    var vat = round2(totalHT * CONFIG.vatRate);
    var totalTTC = round2(totalHT + vat);

    return {
      ok: true,
      serviceId: service.id,
      serviceLabel: service.label,
      surface: surface,
      unitPriceHT: line.unitPriceHT,
      subtotal: subtotal,
      totalHT: totalHT,
      vat: vat,
      totalTTC: totalTTC,
      minimumApplied: minimumApplied
    };
  }

  function formatCurrency(amount) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: CONFIG.currency }).format(amount);
  }

  // Multi-line devis — several prestations (façade, toiture, ...) billed
  // on one document instead of one devis per service. The per-line prices
  // are plain surface × rate, same as calculateQuote(); only the minimum
  // order applies once, to the combined subtotal, since it's one job for
  // one client rather than N separate minimum-billed interventions.
  function calculateMultiQuote(items) {
    if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'items' };

    var seen = {};
    var lines = [];
    var subtotalHT = 0;
    for (var i = 0; i < items.length; i++) {
      var raw = items[i] || {};
      var service = getService(raw.serviceId);
      if (!service) return { ok: false, error: 'service', index: i };
      if (seen[service.id]) return { ok: false, error: 'duplicate', index: i };
      seen[service.id] = true;

      var surface = typeof raw.surface === 'number' ? raw.surface : parseSurface(raw.surface);
      if (surface === null || !isValidSurface(surface)) return { ok: false, error: 'surface', index: i };

      var line = linePrice(service, surface);
      subtotalHT += line.subtotal;
      lines.push({
        serviceId: service.id,
        serviceLabel: service.label,
        serviceDetail: service.detail,
        surface: surface,
        unitPriceHT: line.unitPriceHT,
        subtotal: line.subtotal
      });
    }

    subtotalHT = round2(subtotalHT);
    var totalHT = Math.max(subtotalHT, CONFIG.minimumOrderHT);
    var minimumApplied = totalHT > subtotalHT;
    totalHT = round2(totalHT);
    var vat = round2(totalHT * CONFIG.vatRate);
    var totalTTC = round2(totalHT + vat);

    return {
      ok: true,
      items: lines,
      subtotalHT: subtotalHT,
      totalHT: totalHT,
      vat: vat,
      totalTTC: totalTTC,
      minimumApplied: minimumApplied
    };
  }

  return {
    config: CONFIG,
    MIN_SURFACE: MIN_SURFACE,
    MAX_SURFACE: MAX_SURFACE,
    getService: getService,
    getCheapestService: getCheapestService,
    fromPriceHT: fromPriceHT,
    linePrice: linePrice,
    describeTiers: describeTiers,
    parseSurface: parseSurface,
    isValidSurface: isValidSurface,
    calculateQuote: calculateQuote,
    calculateMultiQuote: calculateMultiQuote,
    formatCurrency: formatCurrency
  };
});
