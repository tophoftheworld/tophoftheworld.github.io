import React, { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Copy, Settings2, ChevronDown, ChevronRight } from "lucide-react";

// Helpers
const peso = (n:number) => `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
const roundTo = (n:number, step:number) => Math.round(n / step) * step;

export default function MatchaPricingCalculator() {
  // ===== 1) BASE SETTINGS (hideable) =====
  const [showBase, setShowBase] = useState<boolean>(false);

  // Portion grams
  const [gHotUsucha, setGHotUsucha] = useState<number>(2);
  const [gIcedUsucha, setGIcedUsucha] = useState<number>(2);
  const [gIcedLatteClassic, setGIcedLatteClassic] = useState<number>(4);
  const [gIcedLatteCold, setGIcedLatteCold] = useState<number>(4);

  // Overheads
  const [ohHotUsucha, setOhHotUsucha] = useState<number>(90);
  const [ohIcedUsucha, setOhIcedUsucha] = useState<number>(90);
  const [ohIcedLatteClassic, setOhIcedLatteClassic] = useState<number>(150);
  const [ohIcedLatteCold, setOhIcedLatteCold] = useState<number>(150);

  // Rounding
  const [rounding, setRounding] = useState<string>("5");

  // ===== 2) PER-MATCHA INPUT =====
  const [packPrice, setPackPrice] = useState<number>(3000);
  const [packSizeG, setPackSizeG] = useState<number>(100);
  const [manualCostPerGEnabled, setManualCostPerGEnabled] = useState<boolean>(false);
  const [manualCostPerG, setManualCostPerG] = useState<number>(0);

  const autoCostPerG = useMemo(() => (packSizeG > 0 ? packPrice / packSizeG : 0), [packPrice, packSizeG]);
  const costPerG = manualCostPerGEnabled ? manualCostPerG : autoCostPerG;

  // Rows to compute
  const rows = [
    { key: "hot-usucha", label: "Hot Usucha", grams: gHotUsucha, overhead: ohHotUsucha },
    { key: "iced-usucha", label: "Iced Usucha", grams: gIcedUsucha, overhead: ohIcedUsucha },
    { key: "iced-latte-classic", label: "Iced Latte • Classic", grams: gIcedLatteClassic, overhead: ohIcedLatteClassic },
    { key: "iced-latte-cold", label: "Iced Latte • Cold-whisked", grams: gIcedLatteCold, overhead: ohIcedLatteCold },
  ];

  const computed = rows.map(r => {
    const matchaCost = r.grams * (isFinite(costPerG) ? costPerG : 0);
    const srpExact = r.overhead + matchaCost;
    const step = rounding === "none" ? 1 : Number(rounding);
    const srpRounded = rounding === "none" ? Math.round(srpExact) : roundTo(srpExact, step);
    return { ...r, matchaCost, srpExact, srpRounded };
  });

  const copy = async (text:string) => { try { await navigator.clipboard.writeText(text); } catch {} };

  return (
    <div className="min-h-screen bg-white text-gray-900 p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Matcha Pricing Calculator</h1>
          <Button variant="outline" className="gap-2" onClick={()=>setShowBase(s=>!s)}>
            <Settings2 className="w-4 h-4" /> Base settings {showBase ? <ChevronDown className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}
          </Button>
        </div>

        {/* BASE SETTINGS (collapsible) */}
        {showBase && (
          <Card>
            <CardContent className="p-4 space-y-6">
              {/* Portions */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="col-span-2 md:col-span-4"><div className="font-medium">Portions (g)</div></div>
                <div>
                  <Label>Hot Usucha</Label>
                  <Input type="number" value={gHotUsucha} onChange={e=>setGHotUsucha(Number(e.target.value))} min={0} step={0.1} />
                </div>
                <div>
                  <Label>Iced Usucha</Label>
                  <Input type="number" value={gIcedUsucha} onChange={e=>setGIcedUsucha(Number(e.target.value))} min={0} step={0.1} />
                </div>
                <div>
                  <Label>Iced Latte • Classic</Label>
                  <Input type="number" value={gIcedLatteClassic} onChange={e=>setGIcedLatteClassic(Number(e.target.value))} min={0} step={0.1} />
                </div>
                <div>
                  <Label>Iced Latte • Cold-whisked</Label>
                  <Input type="number" value={gIcedLatteCold} onChange={e=>setGIcedLatteCold(Number(e.target.value))} min={0} step={0.1} />
                </div>
              </div>

              {/* Overheads */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="col-span-2 md:col-span-4"><div className="font-medium">Overheads (₱)</div></div>
                <div>
                  <Label>Hot Usucha</Label>
                  <Input type="number" value={ohHotUsucha} onChange={e=>setOhHotUsucha(Number(e.target.value))} min={0} />
                </div>
                <div>
                  <Label>Iced Usucha</Label>
                  <Input type="number" value={ohIcedUsucha} onChange={e=>setOhIcedUsucha(Number(e.target.value))} min={0} />
                </div>
                <div>
                  <Label>Iced Latte • Classic</Label>
                  <Input type="number" value={ohIcedLatteClassic} onChange={e=>setOhIcedLatteClassic(Number(e.target.value))} min={0} />
                </div>
                <div>
                  <Label>Iced Latte • Cold-whisked</Label>
                  <Input type="number" value={ohIcedLatteCold} onChange={e=>setOhIcedLatteCold(Number(e.target.value))} min={0} />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <Label>Rounding</Label>
                  <Select value={rounding} onValueChange={setRounding}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose rounding" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No rounding</SelectItem>
                      <SelectItem value="1">Nearest 1</SelectItem>
                      <SelectItem value="5">Nearest 5</SelectItem>
                      <SelectItem value="10">Nearest 10</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* PER-MATCHA INPUT (fast) */}
        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
            <div className="md:col-span-2">
              <Label>Pack price (₱)</Label>
              <Input type="number" value={packPrice} onChange={e=>setPackPrice(Number(e.target.value))} min={0} disabled={manualCostPerGEnabled} />
            </div>
            <div className="md:col-span-1">
              <Label>Pack size (g)</Label>
              <Input type="number" value={packSizeG} onChange={e=>setPackSizeG(Number(e.target.value))} min={1} disabled={manualCostPerGEnabled} />
            </div>
            <div className="md:col-span-2">
              <Label>Cost per gram (auto)</Label>
              <div className="h-10 px-3 flex items-center rounded-md border bg-muted/30">
                {isFinite(autoCostPerG) ? `₱${autoCostPerG.toFixed(2)}` : "—"}
              </div>
            </div>
            <div className="md:col-span-1">
              <Label>Manual cost/g</Label>
              <Input type="number" value={manualCostPerG} onChange={e=>setManualCostPerG(Number(e.target.value))} min={0} disabled={!manualCostPerGEnabled} />
              <div className="mt-1 text-[11px] flex items-center gap-2">
                <input id="toggle-manual" type="checkbox" checked={manualCostPerGEnabled} onChange={e=>setManualCostPerGEnabled(e.target.checked)} />
                <label htmlFor="toggle-manual">Edit cost/g directly</label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* PRICING GUIDE */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-4">
              {computed.map(r => (
                <div key={r.key} className="rounded-2xl border p-4 text-center">
                  <div className="text-sm text-gray-500">{r.label}</div>
                  <div className="mt-1 text-xs text-gray-500">{r.grams}g × {isFinite(costPerG) ? `₱${costPerG.toFixed(2)}` : "—"} + {peso(r.overhead)}</div>
                  <div className="mt-1 text-xs text-gray-500">Matcha cost: <span className="font-medium">{peso(r.matchaCost)}</span></div>
                  <div className="mt-2 text-3xl font-semibold">{peso(r.srpRounded)}</div>
                  <div className="text-[11px] text-gray-500">Exact {peso(r.srpExact)}</div>
                  <div className="mt-3 flex justify-center gap-2">
                    <Button variant="outline" className="gap-1" onClick={()=>copy(`${Math.round(r.srpRounded)}`)}>
                      <Copy className="w-4 h-4" /> Copy
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-gray-500">SRP = overhead + (grams × cost per gram). Adjust overheads and portions in Base settings. Hide them when you're set.</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
