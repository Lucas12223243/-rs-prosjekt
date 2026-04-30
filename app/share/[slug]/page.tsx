"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type SharedCard = {
  id: string;
  created_at: string;
  uploaded_image_url: string;
  grade: number;
  band: string;
  card_name: string;
  set_name: string | null;
  set_series: string | null;
  market_price: number | null;
};

function formatPrice(value?: number | null) {
  if (typeof value !== "number") return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export default function SharedPortfolioPage() {
  const params = useParams();
  const slug = String(params.slug || "");

  const [portfolioName, setPortfolioName] = useState("Portfolio");
  const [cards, setCards] = useState<SharedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const totalValue = cards.reduce((sum, card) => {
    return sum + (card.market_price ?? 0);
  }, 0);

  const avgGrade =
    cards.length > 0
      ? cards.reduce((sum, card) => sum + Number(card.grade ?? 0), 0) /
        cards.length
      : 0;

  useEffect(() => {
    const loadSharedPortfolio = async () => {
      try {
        setLoading(true);

        const { data: portfolio, error: portfolioError } = await supabase
          .from("portfolios")
          .select("*")
          .eq("slug", slug)
          .eq("is_public", true)
          .single();

        if (portfolioError || !portfolio) {
          throw new Error("Public portfolio not found.");
        }

        setPortfolioName(portfolio.name);

        const { data: savedCards, error: cardsError } = await supabase
          .from("saved_cards")
          .select(
            "id, created_at, uploaded_image_url, grade, band, card_name, set_name, set_series, market_price"
          )
          .eq("user_id", portfolio.user_id)
          .order("created_at", { ascending: false });

        if (cardsError) {
          throw cardsError;
        }

        setCards(savedCards ?? []);
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error ? err.message : "Could not load portfolio."
        );
      } finally {
        setLoading(false);
      }
    };

    if (slug) loadSharedPortfolio();
  }, [slug]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        Loading shared portfolio...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center text-white">
        <div>
          <h1 className="text-3xl font-black">Portfolio not found</h1>
          <p className="mt-3 text-slate-300">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#7c2d12_0%,_#581c87_35%,_#020617_75%)] px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm uppercase tracking-[0.3em] text-slate-300">
          PokéGrade Lab
        </p>

        <h1 className="mt-3 text-5xl font-black">{portfolioName}</h1>

        <p className="mt-3 text-slate-300">
          Public collection portfolio · read-only view
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-yellow-300/20 bg-gradient-to-r from-yellow-300 to-yellow-500 px-6 py-5 text-slate-950 shadow-[0_0_30px_rgba(255,215,0,0.4)]">
            <p className="text-xs font-bold uppercase tracking-[0.2em]">
              Total Value
            </p>
            <p className="mt-2 text-3xl font-black">
              {formatPrice(totalValue)}
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              Cards
            </p>
            <p className="mt-2 text-3xl font-black text-white">
              {cards.length}
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              Average Grade
            </p>
            <p className="mt-2 text-3xl font-black text-yellow-300">
              {avgGrade.toFixed(1)}
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <div
              key={card.id}
              className="overflow-hidden rounded-3xl border border-white/10 bg-white/5 text-white shadow-xl backdrop-blur-xl"
            >
              <div className="h-1.5 bg-gradient-to-r from-yellow-300 to-red-500" />

              <div className="p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                  Matched card
                </p>

                <h2 className="mt-2 text-xl font-black">{card.card_name}</h2>

                <div className="mt-4 rounded-2xl bg-slate-950/70 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    Grade
                  </p>
                  <p className="mt-1 text-3xl font-black text-yellow-300">
                    {Number(card.grade ?? 0).toFixed(1)}
                  </p>
                  <p className="text-sm text-slate-300">{card.band}</p>
                </div>

                <div className="mt-4 rounded-3xl bg-slate-950/70 p-3">
                  <img
                    src={card.uploaded_image_url}
                    alt={card.card_name}
                    className="h-72 w-full rounded-2xl object-contain"
                  />
                </div>

                <div className="mt-4 rounded-2xl bg-white/5 p-3">
                  <p className="text-sm text-slate-400">Set</p>
                  <p className="font-bold">{card.set_name ?? "Unknown"}</p>
                  <p className="text-sm text-slate-400">
                    {card.set_series ?? ""}
                  </p>
                </div>

                <div className="mt-3 rounded-2xl bg-white/5 p-3">
                  <p className="text-sm text-slate-400">Market value</p>
                  <p className="font-bold text-yellow-300">
                    {formatPrice(card.market_price)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}