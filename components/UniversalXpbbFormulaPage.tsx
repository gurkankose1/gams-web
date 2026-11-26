import React from 'react';
import type { CompiledTopology } from '../services/universal-xpbb-topology.ts';
import type { AirportFlightDynamics } from '../services/universal-xpbb-engine.ts';

interface FormulaPageProps {
  topology: CompiledTopology;
  dynamics: AirportFlightDynamics;
  bufferMins: number;
  allowTowing: boolean;
}

export const FormulaPage: React.FC<FormulaPageProps> = ({
  topology,
  dynamics,
  bufferMins,
  allowTowing
}) => {
  return (
    <div className="space-y-6">
      {/* Intro Banner */}
      <section className="rounded-2xl bg-gradient-to-br from-indigo-950/70 via-slate-900 to-cyan-950/60 border border-indigo-700/40 p-6 space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-bold uppercase tracking-wider">
          📐 Universal xPBB™ — Sıfır Veri Fiziksel Formülizasyon
        </div>
        <h2 className="text-xl font-bold text-white">
          Neden Regresyon Katsayısı Yok? — X, Y ve Z Havalimanında Aynı Doğruluk
        </h2>
        <p className="text-sm text-slate-300 leading-relaxed max-w-4xl">
          Klasik regresyon modelleri yalnızca eğitildikleri havalimanının tarihsel verisine bağımlıdır.{' '}
          <strong>Universal xPBB™</strong> ise sıfır geçmiş veri ile çalışır: herhangi bir meydanın fiziki park envanterini
          okur, o günün uçuş listesini <strong>Earliest-Finish-Time (EFT)</strong> aralık paketleme algoritmasıyla birebir
          köprülere yerleştirir ve hem <strong>STA/STD Plan</strong> hem <strong>OTP + Kapalılık Live</strong> tavanlarını
          doğrudan fizikten üretir.
        </p>
      </section>

      {/* 5 Layers Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Layer 1 */}
        <section className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-cyan-300">
            1. Katman — Evrensel Park Envanteri & MARS Grafiği
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Kullanıcının girdiği 6 park sayısı doğrudan fiziki çakışma grafiğine derlenir (şu anki meydan:{' '}
            <strong className="text-white">{topology.physicalStands} fiziki pozisyon</strong> →{' '}
            <strong className="text-cyan-300">{topology.nominalNarrowSlots} nominal C</strong>):
          </p>
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 font-mono text-xs text-slate-200 space-y-1">
            <div>Toplam Pozisyon = MARS_F + MARS_E + Std_F + Std_E + Std_D + Std_C</div>
            <div className="text-cyan-300">Toplam C (Nominal) = 2×(MARS_F + MARS_E) + Std_F + Std_E + Std_D + Std_C</div>
          </div>
          <ul className="text-xs text-slate-400 space-y-1.5 list-disc pl-4">
            <li><strong>MARS Karşılıklı Kilit:</strong> Bir MARS merkezine geniş gövde (<code className="text-slate-200">D/E/F</code>) girdiğinde aynı zaman diliminde hem <code className="text-slate-200">L</code> hem <code className="text-slate-200">R</code> kilitlenir; tam tersi <code className="text-slate-200">L</code> veya <code className="text-slate-200">R</code> doluysa merkez kilitlenir.</li>
            <li><strong>Hat Ayrımı:</strong> İç Hat ayrımı <code className="text-slate-200">0</code> bırakılırsa tüm köprüler <strong>SWING (Karma)</strong> çalışır. Ayrım girilirse Saf İç Hat (<code className="text-slate-200">D/D</code>) yalnızca <code className="text-slate-200">DOM/SWING</code>, Saf Dış Hat (<code className="text-slate-200">I/I</code>) yalnızca <code className="text-slate-200">INT/SWING</code> kullanır.</li>
          </ul>
        </section>

        {/* Layer 2 */}
        <section className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-emerald-300">
            2. Katman — Earliest-Finish-Time (EFT) Aralık Paketleme
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Yöneylem araştırmasının kanıtlı <strong>k-Track Interval Scheduling (EFT)</strong> teoremi uygulanır. Sabit
            4 saat / 7 saat gibi varsayımlar yoktur:
          </p>
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 font-mono text-xs text-slate-200 space-y-1">
            <div>1) Tüm uygun uçuşları bitiş (kalkış) saatine göre artan sırala (endMs ↑)</div>
            <div>2) Her uçuş için çakışmasız en yüksek skorlu köprüyü seç (Tampon: {bufferMins} dk)</div>
            <div className="text-emerald-300">3) Eşit öncelikli köprülerde en geç boşalanı seç (boşluk minimizasyonu)</div>
          </div>
          <ul className="text-xs text-slate-400 space-y-1.5 list-disc pl-4">
            <li><strong>Geniş Gövde Önceliği:</strong> Önce <em>Standalone Geniş Gövde</em> (<code className="text-slate-200">D/E/F</code>), sonra <em>MARS Merkezi</em> (MARS çiftlerini korumak için).</li>
            <li><strong>Dar Gövde Önceliği:</strong> Önce <em>Standalone C</em> → sonra <em>eşi dolu MARS yan kolu (çiftleme)</em> → boş MARS yan kolu → en son Standalone geniş gövde.</li>
          </ul>
        </section>

        {/* Layer 3 */}
        <section className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-300">
            3. Katman — Otomatik Meydan Dinamiği (Adaptif Yatı & Çekme)
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Her havalimanının yer süresi dağılımı farklıdır (düşük maliyetli meydanda medyan 45 dk, kıtalararası hub'da 115 dk).
            Motor sabit eşik kullanmaz; yüklenen uçuş listesinden otomatik öğrenir:
          </p>
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 font-mono text-xs text-slate-200 space-y-1">
            <div>Medyan Dönüş (P50) = {dynamics.medianTurnaroundMins} dk | Ortalama = {dynamics.avgGroundMins} dk | P75 = {dynamics.p75GroundMins} dk</div>
            <div className="text-amber-300">Otomatik Yatı Eşiği = max(180 dk, P80) → Şu an: {dynamics.autoLongStayThresholdMins} dk ({(dynamics.autoLongStayThresholdMins / 60).toFixed(1)} sa)</div>
            <div className="text-sky-300">Otomatik Çekme/Biniş Penceresi = clamp(0.80 × P50, 45..110 dk) → Şu an: {dynamics.autoBoardingWindowMins} dk</div>
          </div>
          <p className="text-xs text-slate-400">
            <strong>Yatı Çekme (Towing)</strong> şu an{' '}
            <strong className={allowTowing ? 'text-emerald-300' : 'text-slate-300'}>{allowTowing ? 'AÇIK' : 'KAPALI'}</strong>:
            Açıkken, meydanın kendi <code className="text-slate-200">P80</code> yatı eşiğini aşan ve tam süreyle sığmayan uçak,
            kalkışından <code className="text-slate-200">{dynamics.autoBoardingWindowMins} dk</code> önce köprüye çekilebiliyorsa köprüye alınır.
            Ayrıca <code className="text-slate-200">&gt;36 sa</code> bakım/hangar kayıtları <code className="text-slate-200">18 sa</code> ile sınırlandırılır.
          </p>
        </section>

        {/* Layer 4 */}
        <section className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-violet-300">
            4. Katman — Çift Çözüm (STA vs OTP + Kapalılık) & MARS Deduplicate
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Aynı gün 3 ayrı fiziksel senaryoda çözülerek her kayıp kaynağı sıfır tahminle doğrudan ayrıştırılır:
          </p>
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 font-mono text-xs text-slate-200 space-y-1.5">
            <div><span className="text-sky-300">xPBB (STA/STD)</span> = EFT(STA → STD, Kapalılıksız)</div>
            <div><span className="text-rose-300">OTP Etkisi</span> = xPBB(STA) − EFT(OnBlock → OffBlock, Kapalılıksız)</div>
            <div><span className="text-amber-300">Kapalılık Kaybı</span> = EFT(Gerçek Saatler) − EFT(Gerçek Saatler + Kapalılık)</div>
            <div><span className="text-violet-300">Canlı Sürtünme</span> = clamp(0.5% + 0.05 × (100 − OTP_Ort%), 0.5%..2.5%)</div>
            <div className="text-white font-bold pt-1 border-t border-slate-800">xPBB-Live = Fiziksel Tavan (Live) − Canlı Sürtünme</div>
          </div>
          <p className="text-xs text-slate-400">
            <strong>MARS Bakım Deduplicate:</strong> Aynı saatte hem MARS merkezi (<code className="text-slate-200">B5</code>) hem kolu (<code className="text-slate-200">B5L/B5R</code>) kapalıysa merkez satırı <code className="text-slate-200">L+R</code> üzerine birleştirilip düşülür; fiziksel kayıp 3 değil en fazla 2 slot sayılır.
          </p>
        </section>
      </div>

      {/* Layer 5: APOC & Hybrid */}
      <section className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-emerald-300">
          5. Katman — Resmi APOC Gerçekleşen Oran & ATA Hibrit Kuralı (xPBB Standardı)
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-1">
            <div className="text-slate-400 text-[10px] uppercase">Payda (Uygun Yolculu)</div>
            <div className="text-white font-bold">ATD = İlgili Gün</div>
            <div className="text-emerald-300">Dep Mod ∈ &#123;C, G, J, O, Y&#125;</div>
            <div className="text-slate-400 text-[11px]">AT76, CRJ9, DH8D vb. hariç</div>
          </div>
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-1">
            <div className="text-slate-400 text-[10px] uppercase">APOC Gerçek PBB (Pay)</div>
            <div className="text-white font-bold">ATD = İlgili Gün (Mod Filtresiz!)</div>
            <div className="text-emerald-300">DepStand ∈ Concourse A–G</div>
            <div className="text-slate-400 text-[11px]">D19 / D20 (Apron 2) hariç</div>
          </div>
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-1">
            <div className="text-slate-400 text-[10px] uppercase">+ Hibrit (ATA) & ΔPBB</div>
            <div className="text-sky-300 font-bold">ATA = İlgili Gün &amp; Geliş Köprü / Gidiş Açık</div>
            <div className="text-teal-300">Toplam % = (APOC Pay + Hibrit) / Payda</div>
            <div className="text-violet-300">ΔPBB = Toplam % − xPBB-Live</div>
          </div>
        </div>
      </section>
    </div>
  );
};
