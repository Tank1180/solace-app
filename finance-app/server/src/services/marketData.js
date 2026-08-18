import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

function normalizeMode(mode) {
  return mode === 'realtime' ? 'realtime' : 'close';
}

function resolveQuotePrice(quote, mode) {
  if (mode === 'realtime') {
    return quote.regularMarketPrice ?? quote.postMarketPrice ?? quote.preMarketPrice ?? null;
  }

  return quote.regularMarketPreviousClose ?? quote.regularMarketPrice ?? null;
}

function toIsoTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function getMarketQuotes(symbols, mode = 'close') {
  const normalizedMode = normalizeMode(mode);
  const uniqueSymbols = [...new Set(symbols.map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean))];
  const quotes = new Map();
  const failures = [];

  const results = await Promise.allSettled(uniqueSymbols.map(async (symbol) => {
    try {
      const quote = await yahooFinance.quote(symbol);
      const marketPrice = resolveQuotePrice(quote, normalizedMode);
      return {
        symbol,
        marketPrice: marketPrice == null ? null : Number(marketPrice),
        marketChange: quote.regularMarketChange == null ? null : Number(quote.regularMarketChange),
        marketChangePercent: quote.regularMarketChangePercent == null ? null : Number(quote.regularMarketChangePercent),
        marketTime: toIsoTime(quote.regularMarketTime),
        currency: quote.currency || 'USD',
        sourceName: quote.quoteSourceName || 'Yahoo Finance',
      };
    } catch (err) {
      err.symbol = symbol;
      throw err;
    }
  }));

  for (const result of results) {
    if (result.status === 'fulfilled') {
      quotes.set(result.value.symbol, result.value);
      continue;
    }
    failures.push({
      symbol: result.reason?.symbol || null,
      error: result.reason?.message || 'Failed to fetch market quote',
    });
  }

  return { quotes, failures, mode: normalizedMode };
}
