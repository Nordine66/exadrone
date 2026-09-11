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
    services: [
      { id: 'toiture', label: 'Nettoyage de toiture', detail: 'Mousses, lichens et algues', priceHT: 2.90 },
      { id: 'solaire', label: 'Nettoyage de panneaux photovoltaïques', detail: 'Toitures et centrales solaires', priceHT: 3.20 },
      { id: 'bardage', label: 'Nettoyage de bardage', detail: 'Métallique, bois, composite', priceHT: 3.40 },
      { id: 'facade', label: 'Nettoyage de façade', detail: 'Enduit, pierre, brique', priceHT: 3.90 },
      { id: 'vitrage', label: 'Nettoyage de vitrages en hauteur', detail: 'Vitres et verrières en hauteur', priceHT: 4.50 }
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

    var subtotal = round2(surface * service.priceHT);
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
      unitPriceHT: service.priceHT,
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

  return {
    config: CONFIG,
    MIN_SURFACE: MIN_SURFACE,
    MAX_SURFACE: MAX_SURFACE,
    getService: getService,
    getCheapestService: getCheapestService,
    parseSurface: parseSurface,
    isValidSurface: isValidSurface,
    calculateQuote: calculateQuote,
    formatCurrency: formatCurrency
  };
});
