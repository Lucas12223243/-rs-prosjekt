"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  Upload,
  ShieldCheck,
  ScanSearch,
  X,
  Image as ImageIcon,
  FolderOpen,
  Trash2,
  Search,
  DollarSign,
  Hash,
  Layers,
  ExternalLink,
  Wand2,
  Brain,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

const STORAGE_KEY = "pokegrade_saved_cards_v5";

type CardMatch = {
  id: string;
  name: string;
  number: string;
  setName: string;
  setSeries: string;
  setPrintedTotal?: number;
  setSymbolUrl?: string;
  setLogoUrl?: string;
  rarity?: string;
  imageSmall?: string;
  imageLarge?: string;
  marketPrice?: number | null;
  lowPrice?: number | null;
  highPrice?: number | null;
  tcgplayerUrl?: string;
  score?: number;
};

type VisionGuess = {
  card_name: string;
  card_number: string;
  set_name: string;
  confidence: number;
  notes: string;
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

type SavedCard = {
  id: string;
  createdAt: string;
  uploadedImageUrl: string;
  grade: number;
  band: string;
  metrics: {
    centering: number | null;
    corners: number | null;
    edges: number | null;
    surface: number | null;
  };
  cardName: string;
  enteredName: string;
  enteredNumber: string;
  matchedCardId?: string;
  setName?: string;
  setSeries?: string;
  setPrintedTotal?: number;
  setSymbolUrl?: string;
  rarity?: string;
  marketPrice?: number | null;
  lowPrice?: number | null;
  highPrice?: number | null;
  tcgplayerUrl?: string;
  source: "vision_plus_ai_condition";
};

function getGradeColor(grade: number) {
  if (grade >= 9.5) return "from-emerald-400 to-teal-500";
  if (grade >= 8) return "from-sky-400 to-blue-500";
  if (grade >= 6) return "from-yellow-400 to-orange-500";
  if (grade >= 3) return "from-orange-400 to-red-500";
  return "from-rose-500 to-red-700";
}

function metricToPercentLabel(value: number) {
  return `${Math.round(value)}%`;
}

function formatDate(dateIso: string) {
  const date = new Date(dateIso);
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatPrice(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function fileToCompressedDataUrl(
  file: File,
  maxWidth = 420,
  quality = 0.72
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = objectUrl;
    });

    const scale = Math.min(maxWidth / img.width, 1);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas context unavailable.");
    }

    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function persistSavedCards(cards: SavedCard[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
    return cards;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "QuotaExceededError" ||
        error.name === "NS_ERROR_DOM_QUOTA_REACHED")
    ) {
      const trimmed = [...cards];

      while (trimmed.length > 0) {
        trimmed.pop();
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
          return trimmed;
        } catch {
          // keep trimming
        }
      }
    }

    throw error;
  }
}

function MetricBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-200">{label}</span>
        <span className="font-semibold text-yellow-300">
          {value === null ? "N/A" : metricToPercentLabel(value)}
        </span>
      </div>
      <Progress value={value ?? 0} className="h-2 bg-white/10" />
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  variant = "outline",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "outline";
}) {
  const base =
    "inline-flex h-12 items-center justify-center rounded-2xl px-5 text-sm font-semibold transition";

  const styles =
    variant === "primary"
      ? disabled
        ? "border border-white/10 bg-white/10 text-slate-300 cursor-not-allowed"
        : "bg-gradient-to-r from-yellow-400 to-red-500 text-slate-950 hover:opacity-95"
      : disabled
      ? "border border-white/10 bg-white/5 text-slate-400 cursor-not-allowed"
      : "border border-white/15 bg-white/5 text-white hover:bg-white/10";

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`${base} ${styles}`}
    >
      {children}
    </button>
  );
}

export default function PokemonCardGraderSite() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPreview, setSelectedPreview] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("No file chosen");
  const [isFindingLikelyCard, setIsFindingLikelyCard] = useState(false);
  const [isPiScanning, setIsPiScanning] = useState(false);
  const [visionGuess, setVisionGuess] = useState<VisionGuess | null>(null);
  const [condition, setCondition] = useState<ConditionAssessment | null>(null);
  const [candidateCards, setCandidateCards] = useState<CardMatch[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [activeTab, setActiveTab] = useState<"scanner" | "collection">(
    "scanner"
  );
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [cardNameInput, setCardNameInput] = useState("");
  const [cardNumberInput, setCardNumberInput] = useState("");
  const [matchedCard, setMatchedCard] = useState<CardMatch | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
const [previewTick, setPreviewTick] = useState(Date.now());


  useEffect(() => {
    try {
      const persisted = persistSavedCards(savedCards);
      if (persisted.length !== savedCards.length) {
        setSavedCards(persisted);
      }
    } catch (error) {
      console.error(error);
    }
  }, [savedCards]);

  useEffect(() => {
    return () => {
      if (selectedPreview.startsWith("blob:")) {
        URL.revokeObjectURL(selectedPreview);
      }
    };
  }, [selectedPreview]);

 useEffect(() => {
  let mounted = true;

  const loadSession = async () => {
    const { data, error } = await supabase.auth.getSession();

    if (!mounted) return;

    if (error) {
      console.error(error);
    }

    setUser(data.session?.user ?? null);
    setAuthLoading(false);
  };

  useEffect(() => {
  const interval = setInterval(() => {
    setPreviewTick(Date.now());
  }, 1000);

  return () => clearInterval(interval);
}, []);

  loadSession();

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    setUser(session?.user ?? null);
    setAuthLoading(false);
  });

  return () => {
    mounted = false;
    subscription.unsubscribe();
  };
}, []);

useEffect(() => {
  const loadSavedCards = async () => {
    if (!user) {
      setSavedCards([]);
      return;
    }

    const { data, error } = await supabase
      .from("saved_cards")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setError("Could not load saved cards.");
      return;
    }

    const mappedCards: SavedCard[] = (data ?? []).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      uploadedImageUrl: row.uploaded_image_url,
      grade: Number(row.grade ?? 0),
      band: row.band ?? "Unknown",
      metrics: {
        centering: row.centering,
        corners: row.corners,
        edges: row.edges,
        surface: row.surface,
      },
      cardName: row.card_name ?? "Unknown card",
      enteredName: row.entered_name ?? "",
      enteredNumber: row.entered_number ?? "",
      matchedCardId: row.matched_card_id ?? undefined,
      setName: row.set_name ?? undefined,
      setSeries: row.set_series ?? undefined,
      setPrintedTotal: row.set_printed_total ?? undefined,
      setSymbolUrl: row.set_symbol_url ?? undefined,
      rarity: row.rarity ?? undefined,
      marketPrice: row.market_price,
      lowPrice: row.low_price,
      highPrice: row.high_price,
      tcgplayerUrl: row.tcgplayer_url ?? undefined,
      source: "vision_plus_ai_condition",
    }));

    setSavedCards(mappedCards);
  };

  loadSavedCards();
}, [user]);

  const handleGoogleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      console.error(error);
      setError(error.message);
    }
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error(error);
      setError(error.message);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    setLookupError("");
    setMatchedCard(null);
    setVisionGuess(null);
    setCondition(null);
    setCandidateCards([]);
    setShowModal(false);
    setCardNameInput("");
    setCardNumberInput("");
    setSelectedFileName(file.name);

    if (selectedPreview.startsWith("blob:")) {
      URL.revokeObjectURL(selectedPreview);
    }

    setSelectedFile(file);
    setSelectedPreview(URL.createObjectURL(file));
  };

const saveCardToCollection = async (
  finalCondition: ConditionAssessment,
  foundCard: CardMatch | null
) => {
  if (!user) {
    setError("Sign in with Google before saving.");
    return;
  }

  if (!selectedFile && !selectedPreview) return;

  const persistentImageUrl = selectedFile
    ? await fileToCompressedDataUrl(selectedFile)
    : selectedPreview;

  const entry: SavedCard = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    uploadedImageUrl: persistentImageUrl,
    grade: finalCondition.grade,
    band: finalCondition.band,
    metrics: {
      centering: finalCondition.centering,
      corners: finalCondition.corners,
      edges: finalCondition.edges,
      surface: finalCondition.surface,
    },
    cardName: foundCard?.name ?? (cardNameInput.trim() || "Unknown card"),
    enteredName: cardNameInput.trim(),
    enteredNumber: cardNumberInput.trim(),
    matchedCardId: foundCard?.id,
    setName: foundCard?.setName,
    setSeries: foundCard?.setSeries,
    setPrintedTotal: foundCard?.setPrintedTotal,
    setSymbolUrl: foundCard?.setSymbolUrl,
    rarity: foundCard?.rarity,
    marketPrice: foundCard?.marketPrice ?? null,
    lowPrice: foundCard?.lowPrice ?? null,
    highPrice: foundCard?.highPrice ?? null,
    tcgplayerUrl: foundCard?.tcgplayerUrl,
    source: "vision_plus_ai_condition",
  };

  const { error } = await supabase.from("saved_cards").insert({
    id: entry.id,
    user_id: user.id,
    created_at: entry.createdAt,
    uploaded_image_url: entry.uploadedImageUrl,
    grade: entry.grade,
    band: entry.band,
    centering: entry.metrics.centering,
    corners: entry.metrics.corners,
    edges: entry.metrics.edges,
    surface: entry.metrics.surface,
    card_name: entry.cardName,
    entered_name: entry.enteredName,
    entered_number: entry.enteredNumber,
    matched_card_id: entry.matchedCardId,
    set_name: entry.setName,
    set_series: entry.setSeries,
    set_printed_total: entry.setPrintedTotal,
    set_symbol_url: entry.setSymbolUrl,
    rarity: entry.rarity,
    market_price: entry.marketPrice,
    low_price: entry.lowPrice,
    high_price: entry.highPrice,
    tcgplayer_url: entry.tcgplayerUrl,
    source: entry.source,
  });

  if (error) {
    console.error(error);
    throw error;
  }

  setSavedCards((current) => [entry, ...current]);
};

  const handleScanWithCamera = async () => {
    try {
      setIsPiScanning(true);
      setIsFindingLikelyCard(true);
      setError("");
      setLookupError("");
      setMatchedCard(null);
      setVisionGuess(null);
      setCondition(null);
      setCandidateCards([]);
      setShowModal(false);
      setCardNameInput("");
      setCardNumberInput("");

     fetch("http://10.13.37.204:5000/scan", {
        method: "POST",
      });

  const response = await fetch("https://ensure-barn-molecule.ngrok-free.dev/scan", {
  method: "POST",
  headers: {
    "ngrok-skip-browser-warning": "true",
  },
});

const payload = await response.json();

if (!response.ok) {
  throw new Error(payload?.error || "Camera scan failed.");
}

      const imageDataUrl = payload.imageDataUrl;
      const result = payload.result;

      if (selectedPreview.startsWith("blob:")) {
        URL.revokeObjectURL(selectedPreview);
      }

      setSelectedFile(null);
      setSelectedPreview(imageDataUrl);
      setSelectedFileName("Raspberry Pi camera scan");

      const guess = result?.guess as VisionGuess | null;
      const candidates = Array.isArray(result?.candidates)
        ? (result.candidates as CardMatch[])
        : [];
      const newCondition = result?.condition as ConditionAssessment | null;

      setVisionGuess(guess);
      setCondition(newCondition);
      setCandidateCards(candidates);

      if (guess?.card_name) setCardNameInput(guess.card_name);
      if (guess?.card_number) setCardNumberInput(guess.card_number);

      if (candidates[0]) {
        setMatchedCard(candidates[0]);
      }

      if (!guess?.card_name && candidates.length === 0) {
        setLookupError(
          "Could not identify the card confidently from the camera photo."
        );
      }
    } catch (err) {
      console.error(err);
      setLookupError(
        err instanceof Error
          ? err.message
          : "Could not scan from Raspberry Pi."
      );
    } finally {
      setIsPiScanning(false);
      setIsFindingLikelyCard(false);
    }
  };

  const handleFindLikelyCard = async () => {
    if (!selectedFile) {
      setError("Upload a card photo first.");
      return;
    }

    try {
      setIsFindingLikelyCard(true);
      setError("");
      setLookupError("");
      setVisionGuess(null);
      setCondition(null);
      setCandidateCards([]);
      setMatchedCard(null);

      const imageDataUrl = await fileToDataUrl(selectedFile);

const response = await fetch("https://late-melons-smile.loca.lt/scan", {
  method: "POST",
});

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Card identification failed.");
      }

      const guess = payload?.guess as VisionGuess | null;
      const candidates = Array.isArray(payload?.candidates)
        ? (payload.candidates as CardMatch[])
        : [];
      const newCondition = payload?.condition as ConditionAssessment | null;

      setVisionGuess(guess);
      setCondition(newCondition);
      setCandidateCards(candidates);

      if (guess?.card_name) setCardNameInput(guess.card_name);
      if (guess?.card_number) setCardNumberInput(guess.card_number);

      if (candidates[0]) {
        setMatchedCard(candidates[0]);
      }

      if (!guess?.card_name && candidates.length === 0) {
        setLookupError(
          "Could not identify the card confidently from the photo."
        );
      }
    } catch (err) {
      console.error(err);
      setLookupError(
        err instanceof Error
          ? err.message
          : "Could not identify the card from the image."
      );
    } finally {
      setIsFindingLikelyCard(false);
    }
  };

  const handleEstimateAndSave = async () => {
    if (!selectedFile && !selectedPreview) {
      setError("Upload or scan a card photo first.");
      return;
    }

    if (!user) {
      setError("Sign in with Google before saving.");
      return;
    }

    if (!condition) {
      setError("Click Find Card + Grade first so the AI can estimate the grade.");
      return;
    }

    try {
      setError("");
      await saveCardToCollection(condition, matchedCard);
      setShowModal(true);
    } catch (error) {
      console.error(error);
      setError("Could not save this scan locally. Try clearing older saved cards.");
    }
  };

 const handleDeleteCard = async (id: string) => {
  if (!user) return;

  const { error } = await supabase
    .from("saved_cards")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error(error);
    setError("Could not delete card.");
    return;
  }

  setSavedCards((current) => current.filter((card) => card.id !== id));
};

  const handleClearCollection = async () => {
  if (!user) return;

  const { error } = await supabase
    .from("saved_cards")
    .delete()
    .eq("user_id", user.id);

  if (error) {
    console.error(error);
    setError("Could not clear collection.");
    return;
  }

  setSavedCards([]);
};

  const gradeColor = getGradeColor(condition?.grade ?? 7);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e3a8a_0%,_#0f172a_45%,_#020617_100%)] text-white">
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:32px_32px]" />

      <main className="relative mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-slate-300">
              PokéGrade Lab
            </p>
            <h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">
              Vision Scanner + Collection Portfolio
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-2xl border border-white/10 bg-white/5 p-1">
              <button
                onClick={() => setActiveTab("scanner")}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  activeTab === "scanner"
                    ? "bg-yellow-400 text-slate-950"
                    : "text-white hover:bg-white/10"
                }`}
              >
                Scanner
              </button>

              <button
                onClick={() => setActiveTab("collection")}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  activeTab === "collection"
                    ? "bg-yellow-400 text-slate-950"
                    : "text-white hover:bg-white/10"
                }`}
              >
                My Collection
              </button>
            </div>

            {authLoading ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
                Loading...
              </div>
            ) : user ? (
              <>
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
                  {user.email}
                </div>
                <ActionButton variant="outline" onClick={handleSignOut}>
                  Sign out
                </ActionButton>
              </>
            ) : (
              <ActionButton variant="primary" onClick={handleGoogleSignIn}>
                Sign in with Google
              </ActionButton>
            )}
          </div>
        </div>

        {activeTab === "scanner" ? (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]"
          >
            <Card className="overflow-hidden border-white/10 bg-white/10 text-white shadow-2xl backdrop-blur-xl">
              <CardContent className="p-0">
                <div className="relative overflow-hidden rounded-2xl border-b border-white/10 bg-gradient-to-r from-yellow-300 via-yellow-400 to-red-500 p-8 text-slate-900">
                  <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/30 blur-3xl" />
                  <div className="absolute -bottom-16 left-24 h-40 w-40 rounded-full bg-sky-300/40 blur-3xl" />

                  <Badge className="mb-4 rounded-full border-0 bg-slate-950/85 px-3 py-1 text-yellow-300">
                    Vision-powered Card Finder + AI Condition Estimate
                  </Badge>

                  <div className="max-w-2xl space-y-4">
                    <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                      PokéGrade Lab
                    </h2>
                    <p className="max-w-xl text-base font-medium text-slate-900 sm:text-lg">
                      Upload a card photo, scan from your Raspberry Pi camera, let AI
                      identify the card, estimate the visible condition, then save it to
                      your collection.
                    </p>
                  </div>
                </div>

                <div className="grid gap-6 p-6 md:grid-cols-[1fr_0.95fr]">
                  <div className="space-y-4">
                    <div className="rounded-3xl border border-dashed border-yellow-300/50 bg-slate-950/40 p-5">
                      <div className="mb-4 flex items-center gap-3">
                        <div className="rounded-2xl bg-yellow-400/15 p-3 text-yellow-300">
                          <Upload className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-white">
                            Upload, scan, and identify a card
                          </h2>
                          <p className="text-sm text-slate-300">
                            Best results: one full card, straight angle, low glare.
                          </p>
                        </div>
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleFileChange}
                        className="hidden"
                      />

{/* LIVE PREVIEW */}
<h2 className="text-sm text-slate-300 mb-2 mt-4">
  Live Camera Preview
</h2>

<img
src="https://ensure-barn-molecule.ngrok-free.dev/stream.mjpg"
  alt="Live camera preview"
  className="w-full rounded-xl mb-3"
/>


                      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="inline-flex h-11 items-center justify-center rounded-full bg-yellow-400 px-5 text-sm font-semibold text-slate-950 transition hover:bg-yellow-300"
                          >
                            Choose File
                          </button>
                          <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                            {selectedFileName}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-slate-200">
                            Card name
                          </label>
                          <div className="flex h-11 items-center rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white">
                            <Search className="mr-2 h-4 w-4 text-slate-400" />
                            <span className="truncate">
                              {cardNameInput || "Auto-filled from best match"}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-slate-200">
                            Card number
                          </label>
                          <div className="flex h-11 items-center rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white">
                            <Hash className="mr-2 h-4 w-4 text-slate-400" />
                            <span className="truncate">
                              {cardNumberInput || "Auto-filled from best match"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-3">
                        <ActionButton
                          variant="primary"
                          onClick={handleScanWithCamera}
                          disabled={isPiScanning || isFindingLikelyCard}
                        >
                          <Camera className="mr-2 h-4 w-4" />
                          {isPiScanning ? "Scanning..." : "Scan with Camera"}
                        </ActionButton>

                        <ActionButton
                          variant="outline"
                          onClick={handleFindLikelyCard}
                          disabled={isFindingLikelyCard || !selectedFile}
                        >
                          <Wand2 className="mr-2 h-4 w-4" />
                          {isFindingLikelyCard && !isPiScanning
                            ? "Finding card + grading..."
                            : "Find Card + Grade"}
                        </ActionButton>

                        <ActionButton
                          variant="primary"
                          onClick={handleEstimateAndSave}
                          disabled={!condition || !selectedPreview || !user}
                        >
                          <ScanSearch className="mr-2 h-4 w-4" />
                          Save Result
                        </ActionButton>

                        <ActionButton
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          Choose Another Photo
                        </ActionButton>
                      </div>

                      {!user ? (
                        <p className="mt-2 text-sm text-sky-200">
                          Sign in with Google to save scans to your account.
                        </p>
                      ) : null}

                      {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
                      {lookupError ? (
                        <p className="mt-2 text-sm text-yellow-200">{lookupError}</p>
                      ) : null}
                    </div>

                    {visionGuess ? (
                      <Card className="border-white/10 bg-slate-950/60 text-white shadow-xl">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-xl text-white">
                            <Brain className="h-5 w-5 text-yellow-300" />
                            Vision guess
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-slate-200">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                              <p className="text-slate-400">Name</p>
                              <p className="font-bold text-white">
                                {visionGuess.card_name || "Unknown"}
                              </p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                              <p className="text-slate-400">Collector number</p>
                              <p className="font-bold text-white">
                                {visionGuess.card_number || "Unknown"}
                              </p>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <p className="text-slate-400">Set guess</p>
                            <p className="font-bold text-white">
                              {visionGuess.set_name || "Unknown"}
                            </p>
                          </div>

                          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <p className="text-slate-400">Confidence</p>
                            <p className="font-bold text-yellow-300">
                              {Math.round((visionGuess.confidence || 0) * 100)}%
                            </p>
                            <p className="mt-2 text-slate-300">{visionGuess.notes}</p>
                          </div>
                        </CardContent>
                      </Card>
                    ) : null}

                    {candidateCards.length > 0 ? (
                      <Card className="border-white/10 bg-slate-950/60 text-white shadow-xl">
                        <CardHeader>
                          <CardTitle className="text-xl text-white">Likely matches</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {candidateCards.map((card, index) => {
                            const isSelected = matchedCard?.id === card.id;

                            return (
                              <button
                                key={card.id}
                                type="button"
                                onClick={() => setMatchedCard(card)}
                                className={`flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition ${
                                  isSelected
                                    ? "border-yellow-300/40 bg-yellow-300/10"
                                    : "border-white/10 bg-white/5 hover:bg-white/10"
                                }`}
                              >
                                {card.imageSmall ? (
                                  <img
                                    src={card.imageSmall}
                                    alt={card.name}
                                    className="h-24 w-16 rounded-lg object-cover"
                                  />
                                ) : null}

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="font-bold text-white">{card.name}</p>
                                    {isSelected ? (
                                      <CheckCircle2 className="h-4 w-4 text-yellow-300" />
                                    ) : null}
                                  </div>
                                  <p className="text-sm text-slate-300">
                                    #{card.number} · {card.setName}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-400">
                                    Match score {Math.round(card.score ?? 0)}
                                    {index === 0 ? " · best" : ""}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </CardContent>
                      </Card>
                    ) : null}
                  </div>

                  <div className="rounded-[28px] border border-white/10 bg-slate-950/50 p-5 text-white shadow-inner">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm uppercase tracking-[0.25em] text-slate-400">
                          Preview
                        </p>
                        <h3 className="text-xl font-bold text-white">Card photo</h3>
                      </div>
                      <div className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">
                        Vision + AI condition estimate
                      </div>
                    </div>

                    <div className="flex min-h-[420px] items-center justify-center rounded-[24px] border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 p-4">
                      {selectedPreview ? (
                        <img
                          src={selectedPreview}
                          alt="Uploaded Pokémon card"
                          className="max-h-[390px] rounded-2xl object-contain shadow-2xl"
                        />
                      ) : (
                        <div className="space-y-3 text-center text-slate-400">
                          <div className="mx-auto w-fit rounded-3xl bg-white/5 p-5">
                            <ImageIcon className="h-10 w-10" />
                          </div>
                          <p className="font-medium">
                            Your uploaded or camera-scanned card preview will appear here.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="border-white/10 bg-white/10 text-white shadow-xl backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-2xl text-white">
                    <ShieldCheck className="h-6 w-6 text-yellow-300" />
                    How this version works
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-slate-200">
                  <p>
                    This version identifies cards from an uploaded image or a Raspberry Pi
                    camera scan, shows likely matches, uses AI to estimate visible
                    condition, and saves the result locally.
                  </p>
                  <div className="rounded-2xl border border-yellow-300/20 bg-yellow-300/10 p-4 text-yellow-100">
                    Best flow: upload card or scan with camera → Find Card + Grade if uploaded
                    → review result → Save Result.
                  </div>
                </CardContent>
              </Card>

              {matchedCard ? (
                <Card className="border-white/10 bg-slate-950/60 text-white shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-xl text-white">Best match</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start gap-4 rounded-3xl border border-white/10 bg-white/5 p-4">
                      {matchedCard.imageSmall ? (
                        <img
                          src={matchedCard.imageSmall}
                          alt={matchedCard.name}
                          className="h-28 w-20 rounded-xl object-cover"
                        />
                      ) : null}

                      <div className="min-w-0 flex-1">
                        <h3 className="text-xl font-bold text-white">{matchedCard.name}</h3>
                        <p className="mt-1 text-sm text-slate-300">#{matchedCard.number}</p>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge className="rounded-full border-0 bg-white/10 px-3 py-1 text-white">
                            {matchedCard.setName}
                          </Badge>
                          {matchedCard.rarity ? (
                            <Badge className="rounded-full border-0 bg-white/10 px-3 py-1 text-white">
                              {matchedCard.rarity}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-sm text-slate-400">Set</p>
                        <p className="mt-1 font-bold text-white">{matchedCard.setName}</p>
                        <p className="mt-1 text-sm text-slate-400">{matchedCard.setSeries}</p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-sm text-slate-400">Market value</p>
                        <p className="mt-1 font-bold text-yellow-300">
                          {formatPrice(matchedCard.marketPrice)}
                        </p>
                        <p className="mt-1 text-sm text-slate-400">
                          Low {formatPrice(matchedCard.lowPrice)} · High{" "}
                          {formatPrice(matchedCard.highPrice)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-white/10 bg-slate-950/60 text-white shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-xl text-white">Best match</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-slate-300">
                    Upload a card and click Find Card + Grade, or use Scan with Camera.
                  </CardContent>
                </Card>
              )}
            </div>
          </motion.section>
        ) : (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
                  Collection Portfolio
                </p>
                <h2 className="mt-2 text-3xl font-black text-white">Saved scans</h2>
              </div>

              <div className="flex items-center gap-3">
                <Badge className="rounded-full border-0 bg-white/10 px-4 py-2 text-slate-100">
                  {savedCards.length} saved
                </Badge>
                <ActionButton variant="outline" onClick={handleClearCollection}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear all
                </ActionButton>
              </div>
            </div>

            {savedCards.length === 0 ? (
              <Card className="border-white/10 bg-white/10 text-white backdrop-blur-xl">
                <CardContent className="flex min-h-[280px] flex-col items-center justify-center gap-4 text-center text-slate-300">
                  <FolderOpen className="h-12 w-12 text-yellow-300" />
                  <div>
                    <h3 className="text-xl font-bold text-white">No saved scans yet</h3>
                    <p className="mt-2 max-w-lg">
                      Upload or scan a card, find the likely match, grade it, and save it.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {savedCards.map((card) => (
                  <Card
                    key={card.id}
                    className="overflow-hidden border-white/10 bg-white/10 text-white shadow-xl backdrop-blur-xl"
                  >
                    <div className={`h-1.5 bg-gradient-to-r ${getGradeColor(card.grade)}`} />

                    <CardContent className="p-4">
                      <div className="mb-4 flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <Search className="h-4 w-4 text-yellow-300" />
                            <p className="text-sm uppercase tracking-[0.22em] text-slate-400">
                              Matched card
                            </p>
                          </div>
                          <h3 className="mt-2 text-xl font-bold text-white">
                            {card.cardName}
                          </h3>
                          <p className="mt-1 text-sm text-slate-400">
                            {formatDate(card.createdAt)}
                          </p>
                        </div>

                        <button
                          onClick={() => handleDeleteCard(card.id)}
                          className="rounded-full bg-white/5 p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
                          aria-label={`Delete ${card.cardName}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                            Grade
                          </p>
                          <p className="mt-1 text-3xl font-black text-yellow-300">
                            {card.grade.toFixed(1)}
                          </p>
                        </div>
                        <Badge className="rounded-full border-0 bg-white/10 px-3 py-1 text-white">
                          {card.band}
                        </Badge>
                      </div>

                      <div className="mb-4 overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 p-3">
                        <img
                          src={card.uploadedImageUrl}
                          alt={card.cardName}
                          className="h-72 w-full rounded-2xl object-contain"
                        />
                      </div>

                      <div className="mb-4 grid gap-3 text-sm">
                        <div className="rounded-2xl bg-white/5 p-3">
                          <div className="flex items-center gap-2 text-slate-400">
                            <Layers className="h-4 w-4" />
                            <span>Set</span>
                          </div>
                          <p className="mt-1 font-bold text-white">
                            {card.setName ?? "Not matched"}
                          </p>
                          {card.setSeries ? (
                            <p className="mt-1 text-slate-400">{card.setSeries}</p>
                          ) : null}
                        </div>

                        <div className="rounded-2xl bg-white/5 p-3">
                          <div className="flex items-center gap-2 text-slate-400">
                            <DollarSign className="h-4 w-4" />
                            <span>Market value</span>
                          </div>
                          <p className="mt-1 font-bold text-yellow-300">
                            {formatPrice(card.marketPrice)}
                          </p>
                          <p className="mt-1 text-slate-400">
                            Low {formatPrice(card.lowPrice)} · High{" "}
                            {formatPrice(card.highPrice)}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-2xl bg-white/5 p-3">
                          <p className="text-slate-400">Centering</p>
                          <p className="mt-1 font-bold text-white">
                            {card.metrics.centering === null
                              ? "N/A"
                              : `${card.metrics.centering}%`}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-white/5 p-3">
                          <p className="text-slate-400">Surface</p>
                          <p className="mt-1 font-bold text-white">
                            {card.metrics.surface === null
                              ? "N/A"
                              : `${card.metrics.surface}%`}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-white/5 p-3">
                          <p className="text-slate-400">Edges</p>
                          <p className="mt-1 font-bold text-white">
                            {card.metrics.edges === null
                              ? "N/A"
                              : `${card.metrics.edges}%`}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-white/5 p-3">
                          <p className="text-slate-400">Corners</p>
                          <p className="mt-1 font-bold text-white">
                            {card.metrics.corners === null
                              ? "N/A"
                              : `${card.metrics.corners}%`}
                          </p>
                        </div>
                      </div>

                      {card.tcgplayerUrl ? (
                        <a
                          href={card.tcgplayerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-yellow-300/15 bg-yellow-300/10 px-3 py-2 text-xs text-yellow-100 transition hover:bg-yellow-300/15"
                        >
                          View price page
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <div className="mt-4 rounded-2xl border border-yellow-300/15 bg-yellow-300/10 px-3 py-2 text-xs text-yellow-100">
                          Price page not available for this saved card.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </motion.section>
        )}
      </main>

      <AnimatePresence>
        {showModal && condition ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: "spring", stiffness: 180, damping: 18 }}
              className="relative grid w-full max-w-5xl gap-5 overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(145deg,rgba(15,23,42,0.98),rgba(30,41,59,0.98))] p-5 text-white shadow-2xl lg:grid-cols-[0.92fr_1.08fr]"
            >
              <button
                onClick={() => setShowModal(false)}
                className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
                aria-label="Close result"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="rounded-[28px] border border-white/10 bg-black/30 p-4">
                <div className={`mb-4 rounded-[24px] bg-gradient-to-br ${gradeColor} p-[2px]`}>
                  <div className="rounded-[22px] bg-slate-950/95 p-4">
                    <img
                      src={selectedPreview}
                      alt="Analyzed card"
                      className="mx-auto max-h-[520px] rounded-2xl object-contain shadow-2xl"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-5 rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.28em] text-slate-400">
                      Estimated Grade
                    </p>

                    <div className="mt-2 flex items-center gap-3">
                      <span className="text-6xl font-black text-yellow-300">
                        {condition.grade.toFixed(1)}
                      </span>
                      <Badge className="rounded-full border-0 bg-white/10 px-3 py-1 text-white">
                        {condition.band}
                      </Badge>
                    </div>

                    <p className="mt-4 text-sm text-slate-300">
                      Card:{" "}
                      <span className="font-semibold text-yellow-300">
                        {matchedCard?.name ?? visionGuess?.card_name ?? "Unknown"}
                      </span>
                    </p>

                    <p className="mt-2 text-sm text-slate-300">
                      Number:{" "}
                      <span className="font-semibold text-yellow-300">
                        {matchedCard?.number ?? visionGuess?.card_number ?? "Unknown"}
                      </span>
                    </p>

                    <p className="mt-2 text-sm text-emerald-300">
                      Saved to collection portfolio automatically.
                    </p>
                  </div>

                  <div className="rounded-3xl border border-yellow-300/20 bg-yellow-300/10 px-4 py-3 text-sm text-yellow-100">
                    AI visual estimate only
                  </div>
                </div>

                {matchedCard ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                      <p className="text-sm text-slate-400">Matched set</p>
                      <div className="mt-2 flex items-center gap-3">
                        {matchedCard.setSymbolUrl ? (
                          <img
                            src={matchedCard.setSymbolUrl}
                            alt={matchedCard.setName}
                            className="h-8 w-8 object-contain"
                          />
                        ) : null}
                        <div>
                          <p className="font-bold text-white">{matchedCard.setName}</p>
                          <p className="text-sm text-slate-400">{matchedCard.setSeries}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                      <p className="text-sm text-slate-400">Market price</p>
                      <p className="mt-2 text-2xl font-black text-yellow-300">
                        {formatPrice(matchedCard.marketPrice)}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        Low {formatPrice(matchedCard.lowPrice)} · High{" "}
                        {formatPrice(matchedCard.highPrice)}
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <MetricBar label="Centering" value={condition.centering} />
                  <MetricBar label="Corners" value={condition.corners} />
                  <MetricBar label="Edges" value={condition.edges} />
                  <MetricBar label="Surface" value={condition.surface} />
                </div>

                <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="mb-3 text-sm font-semibold text-slate-200">
                    What the AI noticed
                  </p>
                  <ul className="space-y-2 text-sm text-slate-300">
                    {condition.notes.map((item) => (
                      <li key={item} className="rounded-2xl bg-white/5 px-3 py-2">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}