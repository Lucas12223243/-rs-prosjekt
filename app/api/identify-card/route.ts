import { NextRequest, NextResponse } from "next/server";

type VisionGuess = {
  card_name: string;
  card_number: string;
  set_name: string;
  confidence: number;
  notes: string;
  language: string;
  original_name: string;
  romanized_name: string;
  english_equivalent_name: string;
  is_japanese_like: boolean;
};

type ConditionAssessment = {
  centering: number | null;
  corners: number | null;
  edges: number | null;
  surface: number | null;
  grade: number;
  band: string;
  notes: string[];
};

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeLooseText(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[-–—_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCollectorNumber(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9/]/g, "");
}

function collectorNumberVariants(value: string) {
  const raw = normalizeCollectorNumber(value);
  if (!raw) return [];

  const out = new Set<string>();
  out.add(raw);

  const noSlash = raw.split("/")[0];
  if (noSlash) {
    out.add(noSlash);
    out.add(noSlash.replace(/^0+/, "") || "0");
  }

  return [...out].filter(Boolean);
}

function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function similarityScore(a: string, b: string) {
  const aa = normalizeText(a);
  const bb = normalizeText(b);
  if (!aa || !bb) return 0;
  const dist = levenshtein(aa, bb);
  return 1 - dist / Math.max(aa.length, bb.length, 1);
}

function looseContains(a: string, b: string) {
  const aa = normalizeLooseText(a);
  const bb = normalizeLooseText(b);
  if (!aa || !bb) return false;
  return aa.includes(bb) || bb.includes(aa);
}

function getMarketPrice(card: any): number | null {
  const prices = card?.tcgplayer?.prices;
  if (!prices || typeof prices !== "object") return null;

  const candidates = Object.values(prices)
    .flatMap((entry: any) => [entry?.market, entry?.mid, entry?.low])
    .map((value) => safeNumber(value))
    .filter((value): value is number => value !== null);

  return candidates[0] ?? null;
}

function normalizeCard(card: any, score: number) {
  return {
    id: card.id,
    name: card.name,
    number: card.number,
    setName: card.set?.name ?? "Unknown set",
    setSeries: card.set?.series ?? "",
    setPrintedTotal: card.set?.printedTotal,
    setSymbolUrl: card.set?.images?.symbol,
    setLogoUrl: card.set?.images?.logo,
    rarity: card.rarity,
    imageSmall: card.images?.small,
    imageLarge: card.images?.large,
    marketPrice: getMarketPrice(card),
    lowPrice:
      safeNumber(card?.tcgplayer?.prices?.normal?.low) ??
      safeNumber(card?.tcgplayer?.prices?.holofoil?.low) ??
      safeNumber(card?.tcgplayer?.prices?.reverseHolofoil?.low),
    highPrice:
      safeNumber(card?.tcgplayer?.prices?.normal?.high) ??
      safeNumber(card?.tcgplayer?.prices?.holofoil?.high) ??
      safeNumber(card?.tcgplayer?.prices?.reverseHolofoil?.high),
    tcgplayerUrl: card?.tcgplayer?.url,
    score,
  };
}

async function searchPokemonCards(query: string) {
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(
    query
  )}&pageSize=80&orderBy=set.releaseDate`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Pokémon card lookup failed.");
  }

  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

function scoreCandidate(card: any, guess: VisionGuess) {
  let score = 0;

  const guessedNumberVariants = collectorNumberVariants(guess.card_number);
  const actualNumber = normalizeCollectorNumber(String(card.number || ""));
  const actualName = String(card.name || "");
  const actualSet = String(card.set?.name || "");

  const candidateNames = [
    guess.card_name,
    guess.original_name,
    guess.romanized_name,
    guess.english_equivalent_name,
  ].filter(Boolean);

  let bestNameScore = 0;
  for (const name of candidateNames) {
    bestNameScore = Math.max(bestNameScore, similarityScore(actualName, name));

    if (looseContains(actualName, name)) {
      bestNameScore = Math.max(bestNameScore, 0.92);
    }
  }

  const nameWeight = guess.is_japanese_like ? 55 : 70;
  score += bestNameScore * nameWeight;

  if (guessedNumberVariants.length > 0) {
    if (guessedNumberVariants.includes(actualNumber)) {
      score += 42;
    } else if (
      guessedNumberVariants.some(
        (v) =>
          actualNumber.startsWith(v) ||
          v.startsWith(actualNumber) ||
          actualNumber.replace(/^0+/, "") === v.replace(/^0+/, "")
      )
    ) {
      score += 26;
    }
  }

  if (guess.set_name) {
    const setScore = similarityScore(actualSet, guess.set_name);
    score += setScore * (guess.is_japanese_like ? 6 : 18);
  }

  if (guess.is_japanese_like) {
    const lowerName = normalizeLooseText(actualName);
    const lowerSet = normalizeLooseText(actualSet);

    if (
      lowerName.includes("promo") ||
      lowerSet.includes("promo") ||
      lowerSet.includes("svp") ||
      lowerSet.includes("swsh") ||
      lowerSet.includes("smp")
    ) {
      score -= 14;
    }
  }

  return score;
}

async function callOpenAI<T>(
  input: unknown,
  schema: object,
  schemaName: string
): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          schema,
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vision request failed: ${text}`);
  }

  const json = await response.json();
  const outputText =
    json?.output_text ??
    json?.output?.[0]?.content?.find((c: any) => c?.type === "output_text")
      ?.text ??
    "";

  if (!outputText) {
    throw new Error("No model output returned.");
  }

  return JSON.parse(outputText) as T;
}

async function getVisionGuess(imageDataUrl: string): Promise<VisionGuess> {
  return callOpenAI<VisionGuess>(
    [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Identify this Pokémon card from the image. " +
              "Return strict JSON only with keys: " +
              "card_name, card_number, set_name, confidence, notes, language, original_name, romanized_name, english_equivalent_name, is_japanese_like. " +
              "Rules: " +
              "- card_name should be the best searchable card name in Latin script when possible. " +
              "- original_name should preserve the visible original-language name if non-English. " +
              "- romanized_name should romanize Japanese if applicable. " +
              "- english_equivalent_name should be the English card name if known. " +
              "- language should be like English, Japanese, Korean, etc. " +
              "- is_japanese_like should be true when the card is Japanese or appears from the Japanese card line. " +
              "- Use empty strings when uncertain. confidence must be 0 to 1.",
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: "high",
          },
        ],
      },
    ],
    {
      type: "object",
      additionalProperties: false,
      properties: {
        card_name: { type: "string" },
        card_number: { type: "string" },
        set_name: { type: "string" },
        confidence: { type: "number" },
        notes: { type: "string" },
        language: { type: "string" },
        original_name: { type: "string" },
        romanized_name: { type: "string" },
        english_equivalent_name: { type: "string" },
        is_japanese_like: { type: "boolean" },
      },
      required: [
        "card_name",
        "card_number",
        "set_name",
        "confidence",
        "notes",
        "language",
        "original_name",
        "romanized_name",
        "english_equivalent_name",
        "is_japanese_like",
      ],
    },
    "pokemon_card_guess"
  );
}

async function getConditionAssessment(
  imageDataUrl: string,
  guess: VisionGuess
): Promise<ConditionAssessment> {
  const result = await callOpenAI<ConditionAssessment>(
    [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Estimate the visible condition of this trading card from the photo only. ` +
              `This is not professional grading, only a photo-based visual estimate. ` +
              `Likely card guess: ${guess.card_name || "unknown"} / ${guess.card_number || "unknown"} / ${guess.set_name || "unknown set"}. ` +
              `Return strict JSON with keys: centering, corners, edges, surface, grade, band, notes. ` +
              `Rules: ` +
              `- centering, corners, edges, surface should be 0 to 100, or null when not judgeable. ` +
              `- grade should be 1.0 to 10.0 and should reflect visible damage seriously. ` +
              `- A heavily creased, torn, stained, bent, water-damaged, burned, missing-piece, or structurally damaged card should be near grade 1.0 to 2.0. ` +
              `- A moderately worn raw card can fall in the 3 to 6 range. ` +
              `- A clean high-quality scan, stock product image, or visually pristine card with no visible damage should usually be 9.5 to 10.0. ` +
              `- If the image appears to be an official product image or very clean scan with perfect presentation, score corners and edges high unless visible flaws clearly exist. ` +
              `- Do not be overly conservative on clean scan-like images. ` +
              `- band should be one of: Gem Mint-ish, Mint-ish, Near Mint, Excellent, Good, Played, Poor. ` +
              `- notes should be short factual observations based only on what is visible.`,
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: "high",
          },
        ],
      },
    ],
    {
      type: "object",
      additionalProperties: false,
      properties: {
        centering: { anyOf: [{ type: "number" }, { type: "null" }] },
        corners: { anyOf: [{ type: "number" }, { type: "null" }] },
        edges: { anyOf: [{ type: "number" }, { type: "null" }] },
        surface: { anyOf: [{ type: "number" }, { type: "null" }] },
        grade: { type: "number" },
        band: { type: "string" },
        notes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "centering",
        "corners",
        "edges",
        "surface",
        "grade",
        "band",
        "notes",
      ],
    },
    "pokemon_card_condition"
  );

  return {
    centering:
      typeof result.centering === "number"
        ? Math.max(0, Math.min(100, Math.round(result.centering)))
        : null,
    corners:
      typeof result.corners === "number"
        ? Math.max(0, Math.min(100, Math.round(result.corners)))
        : null,
    edges:
      typeof result.edges === "number"
        ? Math.max(0, Math.min(100, Math.round(result.edges)))
        : null,
    surface:
      typeof result.surface === "number"
        ? Math.max(0, Math.min(100, Math.round(result.surface)))
        : null,
    grade: Math.max(1, Math.min(10, Math.round(result.grade * 10) / 10)),
    band: String(result.band || "Unknown"),
    notes: Array.isArray(result.notes) ? result.notes.map(String) : [],
  };
}

function buildQueries(guess: VisionGuess) {
  const queries = new Set<string>();
  const names = [
    guess.card_name,
    guess.original_name,
    guess.romanized_name,
    guess.english_equivalent_name,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  const numbers = collectorNumberVariants(guess.card_number);
  const setName = String(guess.set_name || "").trim();

  for (const name of names) {
    if (numbers[0]) {
      queries.add(`name:"${name}" number:"${numbers[0]}"`);
    }
    if (setName) {
      queries.add(`name:"${name}" set.name:"${setName}"`);
    }
    queries.add(`name:"${name}"`);
  }

  for (const num of numbers) {
    queries.add(`number:"${num}"`);
  }

  if (guess.is_japanese_like) {
    for (const name of names) {
      for (const num of numbers) {
        queries.add(`name:"${name}" number:"${num}"`);
      }
    }
  }

  return [...queries].filter(Boolean).slice(0, 12);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const imageDataUrl = String(body?.imageDataUrl || "");

    if (!imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Missing valid imageDataUrl." },
        { status: 400 }
      );
    }

    const guess = await getVisionGuess(imageDataUrl);

    let candidates: any[] = [];

    if (guess.card_name || guess.romanized_name || guess.english_equivalent_name) {
      const queries = buildQueries(guess);
      const seen = new Map<string, any>();

      for (const query of queries) {
        try {
          const cards = await searchPokemonCards(query);
          for (const card of cards) {
            seen.set(card.id, card);
          }
        } catch {
          // ignore partial lookup failures
        }
      }

      const ranked = [...seen.values()]
        .map((card) => normalizeCard(card, scoreCandidate(card, guess)))
        .sort((a, b) => b.score - a.score);

      const best = ranked[0];

      if (!best) {
        candidates = [];
      } else {
        const minScore = guess.is_japanese_like ? 62 : 52;
        candidates = ranked.filter((c) => c.score >= minScore).slice(0, 5);

        if (candidates.length === 0) {
          candidates = [];
        }
      }
    }

    const condition = await getConditionAssessment(imageDataUrl, guess);

    return NextResponse.json({
      guess,
      candidates,
      condition,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}