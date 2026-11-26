import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { Flight, MaintenanceBlock } from '../types.ts';
import {
  DEFAULT_IGA_INVENTORY,
  GENERIC_PRESETS,
  UniversalStandInventory,
  compileTopologyFromInventory
} from '../services/universal-xpbb-topology.ts';
import {
  RawFlight,
  StandOutageBlock,
  parseIhkFile,
  parseEquipmentOutages,
  runUniversalXpbbSimulation,
  computeAirportFlightDynamics,
  convertGamsFlightsToUniversal,
  convertGamsOutagesToUniversal
} from '../services/universal-xpbb-engine.ts';
import { FormulaPage as UniversalXpbbFormulaPage } from './UniversalXpbbFormulaPage.tsx';

interface UniversalXpbbModalProps {
  isOpen: boolean;
  onClose: () => void;
  gamsFlights: Flight[];
  gamsMaintenanceBlocks: MaintenanceBlock[];
}

export const UniversalXpbbModal: React.FC<UniversalXpbbModalProps> = ({
  isOpen,
  onClose,
  gamsFlights,
  gamsMaintenanceBlocks
}) => {
  const [activeTab, setActiveTab] = useState<'sim' | 'formula'>('sim');
  const [inventory, setInventory] = useState<UniversalStandInventory>(DEFAULT_IGA_INVENTORY);
  const [bufferMins, setBufferMins] = useState<number>(0);
  const [frictionMode, setFrictionMode] = useState<'AUTO' | 'FIXED'>('AUTO');
  const [fixedFriction, setFixedFriction] = useState<number>(1.5);
  const [allowTowing, setAllowTowing] = useState<boolean>(true);
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');

  // Optional custom uploaded files (if empty, automatically uses GAMS Gantt flights & outages!)
  const [uploadedFlights, setUploadedFlights] = useState<RawFlight[] | null>(null);
  const [uploadedOutages, setUploadedOutages] = useState<StandOutageBlock[] | null>(null);
  const [loadedIhkFiles, setLoadedIhkFiles] = useState<string[]>([]);
  const [loadedOutageFiles, setLoadedOutageFiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const ihkInputRef = useRef<HTMLInputElement>(null);
  const outageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const gamsConvertedFlights = useMemo(
    () => (isOpen && !uploadedFlights ? convertGamsFlightsToUniversal(gamsFlights) : []),
    [isOpen, uploadedFlights, gamsFlights]
  );

  const gamsConvertedOutages = useMemo(
    () => (isOpen && !uploadedOutages ? convertGamsOutagesToUniversal(gamsMaintenanceBlocks) : []),
    [isOpen, uploadedOutages, gamsMaintenanceBlocks]
  );

  const activeFlights = uploadedFlights ?? gamsConvertedFlights;
  const activeOutages = uploadedOutages ?? gamsConvertedOutages;

  const topology = useMemo(() => compileTopologyFromInventory(inventory), [inventory]);
  const dynamics = useMemo(() => computeAirportFlightDynamics(activeFlights), [activeFlights]);

  const allDailyResults = useMemo(() => {
    if (!isOpen || activeFlights.length === 0) return [];
    return runUniversalXpbbSimulation(
      activeFlights,
      activeOutages,
      topology,
      bufferMins,
      frictionMode === 'AUTO' ? null : fixedFriction,
      allowTowing
    );
  }, [isOpen, activeFlights, activeOutages, topology, bufferMins, frictionMode, fixedFriction, allowTowing]);

  const dailyResults = useMemo(() => {
    return allDailyResults.filter(r => {
      if (startDateFilter && r.date < startDateFilter) return false;
      if (endDateFilter && r.date > endDateFilter) return false;
      return true;
    });
  }, [allDailyResults, startDateFilter, endDateFilter]);

  const summary = useMemo(() => {
    if (dailyResults.length === 0) return null;
    const n = dailyResults.length;
    const avg = (fn: (r: typeof dailyResults[0]) => number) =>
      Math.round((dailyResults.reduce((s, r) => s + fn(r), 0) / n) * 10) / 10;
    return {
      days: n,
      totElg: dailyResults.reduce((s, r) => s + r.eligibleFlights, 0),
      avgApoc: avg(r => r.apocPbb),
      avgHybridBonus: avg(r => r.hybridBonus),
      avgTotal: avg(r => r.totalServicePbb),
      avgSta: avg(r => r.xpbbSta),
      avgLiveCeiling: avg(r => r.xpbbLiveCeiling),
      avgOtpImpact: avg(r => r.otpImpactPct),
      avgClosureLoss: avg(r => r.closureLossPct),
      avgFriction: avg(r => r.frictionPct),
      avgLive: avg(r => r.xpbbLive),
      avgDeltaTotal: avg(r => r.deltaVsTotal),
      avgDeltaApoc: avg(r => r.deltaVsApoc),
      totSolveMs: Math.round(dailyResults.reduce((s, r) => s + r.solveMs, 0))
    };
  }, [dailyResults]);

  if (!isOpen) return null;

  const updateInv = (field: keyof UniversalStandInventory, rawVal: string) => {
    const n = Math.max(0, Math.min(200, parseInt(rawVal || '0', 10) || 0));
    setInventory(prev => ({ ...prev, name: 'Özel Havalimanı', [field]: n }));
  };

  const handleIhkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const combined: RawFlight[] = [];
      const names: string[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const buf = await f.arrayBuffer();
        const parsed = parseIhkFile(buf, f.name);
        for (let k = 0; k < parsed.length; k++) combined.push(parsed[k]);
        names.push(f.name);
      }
      setUploadedFlights(combined);
      setLoadedIhkFiles(names);
      setStartDateFilter('');
      setEndDateFilter('');
    } catch (err: any) {
      setErrorMsg(`IHK dosyası okunamadı: ${err?.message || String(err)}`);
    } finally {
      setIsLoading(false);
      if (ihkInputRef.current) ihkInputRef.current.value = '';
    }
  };

  const handleOutageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const mergedMap = new Map<string, StandOutageBlock>();
      const ingest = (list: StandOutageBlock[]) => {
        for (const b of list) {
          mergedMap.set(`${b.stand}|${b.dateStr}|${b.startMs}|${b.endMs}`, b);
        }
      };
      if (uploadedOutages) ingest(uploadedOutages);
      const names: string[] = [...loadedOutageFiles];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const buf = await f.arrayBuffer();
        ingest(parseEquipmentOutages(buf));
        if (!names.includes(f.name)) names.push(f.name);
      }
      setUploadedOutages(Array.from(mergedMap.values()));
      setLoadedOutageFiles(names);
    } catch (err: any) {
      setErrorMsg(`Kapalılık dosyası okunamadı: ${err?.message || String(err)}`);
    } finally {
      setIsLoading(false);
      if (outageInputRef.current) outageInputRef.current.value = '';
    }
  };

  const invInputCls =
    'w-full bg-slate-950 border border-slate-700 focus:border-cyan-400 rounded-lg px-2 py-1.5 text-center font-mono text-sm font-bold text-white outline-none';

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-sm flex flex-col overflow-hidden text-slate-100">
      {/* Top Modal Header */}
      <div className="border-b border-slate-800 bg-slate-950 px-5 py-3 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-500 via-indigo-500 to-violet-600 flex items-center justify-center text-base shadow">
            🌍
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">Universal xPBB™ — Evrensel Fizik Motoru</h2>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                Sıfır Veri • EFT
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {uploadedFlights
                ? `Harici Dosya: ${loadedIhkFiles.join(', ')}`
                : `GAMS Gantt Verisi Otomatik Bağlı (${gamsFlights.length} uçuş, ${gamsMaintenanceBlocks.length} bakım bloğu)`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-900 border border-slate-800 p-0.5">
            <button
              onClick={() => setActiveTab('sim')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                activeTab === 'sim' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🌍 Simülasyon
            </button>
            <button
              onClick={() => setActiveTab('formula')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                activeTab === 'formula' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📐 Formülizasyon
            </button>
          </div>

          <input ref={ihkInputRef} type="file" accept=".xlsx,.xls,.csv" multiple onChange={handleIhkUpload} className="hidden" />
          <button
            onClick={() => ihkInputRef.current?.click()}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
          >
            📤 {isLoading ? 'Yükleniyor...' : 'Başka IHK Yükle'}
          </button>

          <input ref={outageInputRef} type="file" accept=".xlsx,.xls" multiple onChange={handleOutageUpload} className="hidden" />
          <button
            onClick={() => outageInputRef.current?.click()}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
          >
            🚧 Kapalılık Ekle ({activeOutages.length})
          </button>

          {(uploadedFlights || uploadedOutages) && (
            <button
              onClick={() => { setUploadedFlights(null); setUploadedOutages(null); setLoadedIhkFiles([]); setLoadedOutageFiles([]); }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-700 text-xs font-semibold"
              title="Yüklü GAMS Gantt verisine geri dön"
            >
              ↺ Gantt'a Dön
            </button>
          )}

          <button
            onClick={onClose}
            className="ml-1 px-3 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 text-rose-200 border border-rose-800/60 text-xs font-bold transition"
          >
            ✕ Kapat
          </button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-7xl mx-auto space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-700/50 text-rose-200 text-xs">{errorMsg}</div>
          )}

          {activeTab === 'formula' ? (
            <UniversalXpbbFormulaPage
              topology={topology}
              dynamics={dynamics}
              bufferMins={bufferMins}
              allowTowing={allowTowing}
            />
          ) : (
            <>
              {/* Inventory & Controls */}
              <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 rounded-2xl bg-slate-900/80 border border-slate-800 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                      🏢 Havalimanı Köprülü Park Envanteri (Düzenlenebilir)
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {GENERIC_PRESETS.map(p => (
                        <button
                          key={p.name}
                          onClick={() => setInventory(p)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition border ${
                            inventory.name === p.name
                              ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                              : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {p.name.split('(')[0].trim()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-amber-300 mb-1 text-center">MARS F (×2 C)</label>
                      <input type="number" min={0} max={200} value={inventory.marsF} onChange={e => updateInv('marsF', e.target.value)} className={invInputCls} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-amber-300 mb-1 text-center">MARS E (×2 C)</label>
                      <input type="number" min={0} max={200} value={inventory.marsE} onChange={e => updateInv('marsE', e.target.value)} className={invInputCls} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-indigo-300 mb-1 text-center">Standalone F</label>
                      <input type="number" min={0} max={200} value={inventory.standaloneF} onChange={e => updateInv('standaloneF', e.target.value)} className={invInputCls} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-indigo-300 mb-1 text-center">Standalone E</label>
                      <input type="number" min={0} max={200} value={inventory.standaloneE} onChange={e => updateInv('standaloneE', e.target.value)} className={invInputCls} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-indigo-300 mb-1 text-center">Standalone D</label>
                      <input type="number" min={0} max={200} value={inventory.standaloneD} onChange={e => updateInv('standaloneD', e.target.value)} className={invInputCls} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-sky-300 mb-1 text-center">Standalone C</label>
                      <input type="number" min={0} max={200} value={inventory.standaloneC} onChange={e => updateInv('standaloneC', e.target.value)} className={invInputCls} />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="text-slate-400">İç Hat Ayrımı (0 = Karma):</span>
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-sky-300">
                        MARS E:
                        <input type="number" min={0} max={inventory.marsE} value={inventory.domMarsE} onChange={e => updateInv('domMarsE', e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-center font-mono text-xs text-sky-200 outline-none" />
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-sky-300">
                        Kod C:
                        <input type="number" min={0} max={inventory.standaloneC} value={inventory.domStandaloneC} onChange={e => updateInv('domStandaloneC', e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-center font-mono text-xs text-sky-200 outline-none" />
                      </span>
                    </div>

                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
                        Pozisyon: <strong className="text-white">{topology.physicalStands}</strong>
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-cyan-950/60 border border-cyan-700/50 text-cyan-200">
                        Toplam C: <strong className="text-cyan-100">{topology.nominalNarrowSlots}</strong>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 space-y-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-violet-300">🎛️ Çözücü Parametreleri</div>
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-300">Stand Tamponu (Buffer)</span>
                      <span className="font-mono font-bold text-cyan-300">{bufferMins} dk</span>
                    </div>
                    <input type="range" min={0} max={45} step={5} value={bufferMins} onChange={e => setBufferMins(Number(e.target.value))} className="w-full accent-cyan-400" />
                  </div>

                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                    <div>
                      <div className="text-slate-300 font-medium">Yatı Çekme (Towing)</div>
                      <div className="text-[10px] text-slate-400">
                        Oto P80: <strong className="text-amber-300 font-mono">{dynamics.autoLongStayThresholdMins} dk</strong> • Biniş: <strong className="text-sky-300 font-mono">{dynamics.autoBoardingWindowMins} dk</strong>
                      </div>
                    </div>
                    <button
                      onClick={() => setAllowTowing(v => !v)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                        allowTowing ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-950 text-slate-400 border-slate-700'
                      }`}
                    >
                      {allowTowing ? 'Açık' : 'Kapalı'}
                    </button>
                  </div>

                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300">Canlı Sürtünme</span>
                      <div className="flex rounded-lg overflow-hidden border border-slate-700 text-[10px] font-bold">
                        <button onClick={() => setFrictionMode('AUTO')} className={`px-2 py-0.5 ${frictionMode === 'AUTO' ? 'bg-violet-600 text-white' : 'bg-slate-950 text-slate-400'}`}>Oto (OTP)</button>
                        <button onClick={() => setFrictionMode('FIXED')} className={`px-2 py-0.5 ${frictionMode === 'FIXED' ? 'bg-violet-600 text-white' : 'bg-slate-950 text-slate-400'}`}>Sabit</button>
                      </div>
                    </div>
                    {frictionMode === 'FIXED' && (
                      <div className="flex items-center gap-2">
                        <input type="range" min={0} max={3} step={0.1} value={fixedFriction} onChange={e => setFixedFriction(Number(e.target.value))} className="flex-1 accent-violet-400" />
                        <span className="font-mono text-xs font-bold text-violet-300 w-12 text-right">-%{fixedFriction.toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {!summary ? (
                <div className="rounded-2xl border-2 border-dashed border-slate-800 bg-slate-900/40 p-10 text-center space-y-3">
                  <div className="text-3xl">✈️</div>
                  <p className="text-sm text-slate-300">Henüz uçuş verisi yok. Gantt'a Excel yükleyin veya yukarıdaki <strong>Başka IHK Yükle</strong> butonundan dosya seçin.</p>
                </div>
              ) : (
                <>
                  {/* Date Filter Strip */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 rounded-xl bg-slate-900/70 border border-slate-800 text-xs">
                    <span className="text-emerald-400 font-semibold">
                      ✅ {summary.days} gün • {summary.totElg.toLocaleString('tr-TR')} uygun yolculu uçuş • ⏱️ {summary.totSolveMs} ms
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">Tarih:</span>
                      <input type="date" value={startDateFilter} onChange={e => setStartDateFilter(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-slate-200" />
                      <span className="text-slate-500">–</span>
                      <input type="date" value={endDateFilter} onChange={e => setEndDateFilter(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-slate-200" />
                      {(startDateFilter || endDateFilter) && (
                        <button onClick={() => { setStartDateFilter(''); setEndDateFilter(''); }} className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px]">Tümü</button>
                      )}
                    </div>
                  </div>

                  {/* 6 KPI Cards */}
                  <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-3.5">
                      <div className="text-[11px] text-slate-400">APOC Gerçek PBB</div>
                      <div className="text-2xl font-bold text-emerald-400 font-mono mt-1">%{summary.avgApoc.toFixed(1)}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Mod-filtresiz A–G</div>
                    </div>
                    <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-3.5">
                      <div className="text-[11px] text-slate-400">Toplam Hizmet</div>
                      <div className="text-2xl font-bold text-teal-300 font-mono mt-1">%{summary.avgTotal.toFixed(1)}</div>
                      <div className="text-[10px] text-sky-400 mt-0.5">+%{summary.avgHybridBonus.toFixed(1)} ATA Hibrit</div>
                    </div>
                    <div className="rounded-2xl bg-sky-950/50 border border-sky-700/40 p-3.5">
                      <div className="text-[11px] text-sky-300 font-semibold">xPBB (STA Plan)</div>
                      <div className="text-2xl font-bold text-sky-200 font-mono mt-1">%{summary.avgSta.toFixed(1)}</div>
                      <div className="text-[10px] text-sky-400/80 mt-0.5">Rötarsız & Bakımsız</div>
                    </div>
                    <div className="rounded-2xl bg-cyan-950/50 border border-cyan-700/40 p-3.5">
                      <div className="text-[11px] text-cyan-300 font-semibold">OTP + Kap. Tavanı</div>
                      <div className="text-2xl font-bold text-cyan-200 font-mono mt-1">%{summary.avgLiveCeiling.toFixed(1)}</div>
                      <div className="text-[10px] text-cyan-400/80 mt-0.5">Kap.: -%{summary.avgClosureLoss.toFixed(1)}</div>
                    </div>
                    <div className="rounded-2xl bg-violet-950/50 border border-violet-700/40 p-3.5">
                      <div className="text-[11px] text-violet-300 font-semibold">xPBB-Live</div>
                      <div className="text-2xl font-bold text-violet-200 font-mono mt-1">%{summary.avgLive.toFixed(1)}</div>
                      <div className="text-[10px] text-violet-400/80 mt-0.5">Sürtünme: -%{summary.avgFriction.toFixed(1)}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-3.5">
                      <div className="text-[11px] text-slate-400">ΔPBB (Toplam−Live)</div>
                      <div className={`text-2xl font-bold font-mono mt-1 ${summary.avgDeltaTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {summary.avgDeltaTotal >= 0 ? '+' : ''}{summary.avgDeltaTotal.toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">APOC: {summary.avgDeltaApoc >= 0 ? '+' : ''}{summary.avgDeltaApoc.toFixed(1)}%</div>
                    </div>
                  </section>

                  {/* Daily Matrix Table */}
                  <section className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                            <th className="py-2.5 px-3">Tarih</th>
                            <th className="py-2.5 px-3 text-right">Yolculu / Uygun</th>
                            <th className="py-2.5 px-3 text-right text-emerald-400">APOC %</th>
                            <th className="py-2.5 px-3 text-right text-sky-300">+ Hibrit</th>
                            <th className="py-2.5 px-3 text-right text-teal-300">Toplam %</th>
                            <th className="py-2.5 px-3 text-right text-sky-300">xPBB (STA)</th>
                            <th className="py-2.5 px-3 text-right">OTP Etkisi</th>
                            <th className="py-2.5 px-3 text-right text-amber-300">Kapalılık</th>
                            <th className="py-2.5 px-3 text-right text-violet-300">xPBB-Live</th>
                            <th className="py-2.5 px-3 text-right">ΔPBB</th>
                            <th className="py-2.5 px-3">Kök Neden</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70 font-mono">
                          {dailyResults.map(r => (
                            <tr key={r.date} className="hover:bg-slate-800/40">
                              <td className="py-2 px-3 font-semibold text-white whitespace-nowrap">{r.date}</td>
                              <td className="py-2 px-3 text-right text-slate-300">{r.paxFlights} / <strong className="text-white">{r.eligibleFlights}</strong></td>
                              <td className="py-2 px-3 text-right text-emerald-400 font-bold">%{r.apocPbb.toFixed(1)}</td>
                              <td className="py-2 px-3 text-right text-sky-300">+{r.hybridBonus.toFixed(1)}% <span className="text-slate-500">({r.hybridCount})</span></td>
                              <td className="py-2 px-3 text-right text-teal-300 font-bold">%{r.totalServicePbb.toFixed(1)}</td>
                              <td className="py-2 px-3 text-right text-sky-300 font-bold">%{r.xpbbSta.toFixed(1)}</td>
                              <td className={`py-2 px-3 text-right ${r.otpImpactPct > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                                {r.otpImpactPct > 0 ? `-${r.otpImpactPct.toFixed(1)}%` : `+${Math.abs(r.otpImpactPct).toFixed(1)}%`}
                              </td>
                              <td className="py-2 px-3 text-right text-amber-300">
                                {r.closureLossPct > 0 ? `-%${r.closureLossPct.toFixed(1)}` : '—'}
                                {r.closureHours > 0 && <span className="text-slate-500 text-[10px] ml-1">({r.closureHours}sa)</span>}
                              </td>
                              <td className="py-2 px-3 text-right text-violet-300 font-bold">%{r.xpbbLive.toFixed(1)}</td>
                              <td className="py-2 px-3 text-right">
                                <span className={`px-1.5 py-0.5 rounded font-bold ${
                                  r.deltaVsTotal >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                                }`}>
                                  {r.deltaVsTotal >= 0 ? '+' : ''}{r.deltaVsTotal.toFixed(1)}%
                                </span>
                              </td>
                              <td className="py-2 px-3 font-sans text-[11px] text-slate-300">
                                <div className="flex flex-wrap gap-1">
                                  {r.unplaced.domFull > 0 && <span className="px-1.5 py-0.5 rounded bg-sky-950/80 text-sky-300">İç Hat: {r.unplaced.domFull}</span>}
                                  {r.unplaced.wideFull > 0 && <span className="px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300">Geniş/MARS: {r.unplaced.wideFull}</span>}
                                  {r.unplaced.capacityFull > 0 && <span className="px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-300">Kapasite: {r.unplaced.capacityFull}</span>}
                                  {r.unplaced.closureLoss > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300">Kapalılık: {r.unplaced.closureLoss}</span>}
                                  {r.unplaced.domFull + r.unplaced.wideFull + r.unplaced.capacityFull + r.unplaced.closureLoss === 0 && (
                                    <span className="text-emerald-400">Tamamı Sığdı</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
