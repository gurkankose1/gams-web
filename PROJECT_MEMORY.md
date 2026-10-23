# GAMS - Havalimanı Stand & Gate / Yedek Planlama Sistemi

## 1. Proje ve Depo Bilgileri
- **Dizin:** `C:\GAMS`
- **Uygulama Adı:** GAMS - Web Application (`gams-web`)
- **Teknoloji Yığını:** Vite, React 18, TypeScript, Firebase, SheetJS (`xlsx`), React DnD
- **GitHub Deposu:** `gurkankose1/gams-web`
- **GitHub Push Yöntemi:** `node single_commit_push.js` (Token ve API entegrasyonu script içinde hazır yapılandırılmıştır)
- **Vercel Dağıtımı:** `.vercel/project.json` bağlıdır (`prj_BuXodg3lWxPM3LndGGveLFHgDopa`).
  - Canlıya alma komutu: `cmd /c "vercel --prod --yes"`

## 2. Temel Mimari ve Dosyalar
- `App.tsx`: Ana UI, simülasyon ve görselleştirme kontrolleri
- `services/ai-allocator.ts`: Stand ve Gate yerleşim motoru, köprü/açık optimizasyonları, Concourse yük dengelemesi
- `components/`: UI bileşenleri (Stand matrisi, uçuş kartları, zaman çizelgesi vb.)
- `constants.ts` & `types.ts`: Havalimanı kuralları, stand tipleri, uçak gövde tipleri (Widebody, Narrowbody)
- `firebase.ts` & `.env.local`: Kimlik doğrulama ve veritabanı bağlantısı

## 3. En Son Yapılan Değişiklikler ve Durum
1. **AI Allocator Güncellemesi:**
   - Concourse yük dengelemesi (load balancing)
   - C/E concourse narrowbody önceliklendirmesi
   - Widebody köprü yükseltme swap (açıktaki geniş gövdeyi köprüye çekme mantığı) tamamlandı.
2. **Kritik Kural & Sınıflandırma Düzeltmeleri (18.10.2026):**
   - **D1, D2, D3, D4, D5 Stand Kısıtlaması:** Concourse D'deki D1-D5 stantları kesin olarak sadece Dar Gövde (Cat C) olarak tanımlandı. Geniş gövdeli uçakların bu pozisyonlara atanması engellendi; dar gövdeli uçuşların öncelikli olarak bu stantlara yerleşmesi sağlandı.
   - **A380 (A388 / 388) & Code F Geniş Gövde Düzeltmesi:** Sistemde ICAO `A388` ve IATA `388` kodlarının `WIDE_BODY_AIRCRAFT` ve `CAT_F_HEAVY_STANDS` listesinde eksik olması nedeniyle A380'in dar gövde gibi algılanması ve körükten dışlanması düzeltildi. A2 körük standı A388 için yetkilendirildi; UI ve gelir hesaplamasında `acCategory === 'D' | 'E' | 'F'` desteği eklendi.
3. **Operasyonel Esneklik & Optimizasyon Güncellemesi (18.10.2026 - Gece):**
   - **Karma Uçuşlar (Dış-İç / İç-Dış):** Katı Concourse G zorunluluğu kaldırıldı. Saf Dış (Dış-Dış) A-F, Saf İç (İç-İç) G körüğüne giderken, karma uçuşlar (Houston->İzmir, Toronto->Antalya vb.) hem Dış (A-F) hem İç (G) körüklerine serbestçe atanabilir hale getirildi.
   - **Gündüz 3.5 Saat Barajı Kaldırıldı:** Boş köprü varken 4-5 saatlik uçakların zorla açığa atılması engellendi. Kısa dönüşler yine önceliklidir ancak köprüde boşluk varsa uzun kalışlı uçaklar da köprüyü doldurur.
   - **Senkronize MARS Eşleme (Synchronized Pairing):** MARS L ve R pozisyonlarına benzer kalkış saatlerine sahip dar gövdeler eşleştirilerek, iki uçağın aynı anda kalkması ve arkasından gelen Geniş Gövdeye (B77W, B789, A350) Center pozisyonunun blok halinde açılması sağlandı.
4. **Açık Pozisyonlarda AMS Uçak Tipi - Stand Eşleşmeleri Kuralı (18.10.2026 - Gece):**
   - **Resmi AMS Stand İzinleri Entegrasyonu (`stand_allocation_permission.pdf`):** Sistemdeki tüm açık ve körük pozisyonları, İstanbul Havalimanı (IST/IGA) resmi AMS kurallarına göre bağlandı.
   - **APRON 1 (100 - 132 & 149):** 100-132 ve 149 pozisyonlarının resmi AMS kurallarına göre **yalnızca Dar Gövde (Cat C)** olduğu doğrulandı ve geniş gövdelerin bu pozisyonlara girişi tamamen engellendi. APRON 1'de yalnızca 133-148 arası MARS Center pozisyonlarının geniş gövde alabildiği sisteme işlendi.
   - **APRON 2 (200 - 214):** 200-214 pozisyonları yalnızca Dar Gövde; 215-226 ve D19-D20 geniş gövde olarak kilitlendi.
   - **APRON 3 (300 - 312):** 300-312 pozisyonları dar gövde; 313-315 geniş gövde olarak kilitlendi.
   - **APRON 6 & APRON 7 (601-604, 701-704):** Kesin olarak yalnızca Dar Gövde pozisyonları olarak sınırlandırıldı.
   - `buildStandTopology`, `canFitOnStand`, `Pass C` ve `Safety Net` seviyesinde hiçbir istisna bırakılmadan resmi AMS izin kuralları uygulandı.
5. **OCC AI Co-Pilot ve Gelir Hesaplama Güncellemesi (18.10.2026):**
   - **Maktu KOİ Gelir Modeli:** Kullanıcı talimatı doğrultusunda gelir hesaplayıcı (`services/revenue-calculator.ts`) sadece 5 maktu DHMİ hizmetini (PBB, GPU, PCA, Su, VDGS) hesaplayacak şekilde sınırlandı. Konma, Konaklama ve Yolcu Servis ücretleri sıfırlandı.
   - **OCC AI Co-Pilot Motoru (`services/ai-copilot.ts` & `AiCopilotModal.tsx`):**
     - Doğrudan Boşluk Doldurma (`DIRECT_GAP_FILL`), Dar/Geniş Konsolidasyonu (`NARROW_CONSOLIDATION`) ve İç Hat Tahliye Takası (`DOMESTIC_LIBERATION_SWAP`) eklendi.
     - **İç Hat Tahliye Takası (Concourse G Liberation):** Karma uçuşlar (D-I / I-D) Concourse G yerine Concourse A-F dış hat iskelelerine yönlendirilerek, Concourse G'nin 10 MARS körüğü açıkta bekleyen Saf İç Hat (D-D) uçuşları için rezerve edildi.
     - **OCC Kapasite Teşhis Analizi:** Co-Pilot modali içine "Kapasite Teşhisi" sekmesi eklenerek, kalan uçakların neden açıkta kaldığı (487 uçak > 4 saat kalış / Sıfır-tow kuralı, Concourse G doygunluğu, Kargo, Genel Havacılık, Turboprop uyumsuzluğu) şeffafça modellendi.
6. **Bakım / Downgrade Blokajı Entegrasyonu (19.10.2026):**
   - AI Allocator ve OCC AI Co-pilot motorlarına `hasMaintenanceConflict` kuralı entegre edildi.
   - Bakım girildiğinde çakışan uçuşların anında havuza çekilmesi sağlandı.
7. **Manuel Sürükle-Bırak (Drag-and-Drop) Performans & Donma Düzeltmesi (20.10.2026):**
   - **Sorun:** 250 stand ve 1.500 uçuş varken bir uçak sürüklendiğinde React DnD `collect` içinde tüm 250 stand için `canDrop` ve AMS kurallarını (1.5 milyon dizi taraması) her mousemove anında çalıştırıyor, tüm stantları ve `FlightCard`ları re-render ediyordu. Uçak bırakıldığında ise Firebase'in `onValue` yankısı 1.500 uçuşu gereksiz yere baştan JSON-parse edip çift render yaratıyordu.
   - **Çözüm:**
     - `TimelineLane`'in `useDrop.collect` fonksiyonunda `canDrop` hesabı sadece fare o standın üzerindeyken (`isOver ? monitor.canDrop() : false`) çalışacak şekilde izole edildi. 249 pasif standın CPU harcaması sıfırlandı.
     - `TimelineLane`, `FlightCard`, `FlightPool`, `TimelineHeader`, `ConcourseOccupancyBar` bileşenleri `React.memo` ile sarıldı.
     - `MARS Conflict Shadow Overlay` hesaplaması 1.500 uçuşluk `.filter()` yerine `flightsByParkingPosition` üzerinden O(1) harita erişimine dönüştürüldü.
     - `App.tsx` içine `isLocalUpdateRef` eklenerek yerel sürükle-bırak sonrasında Firebase'den dönen kendi güncellememizin gereksiz `JSON.parse` ve çift render yapması engellendi.
8. **Fırsat Maliyetli Körük Optimizasyonu & En Uzunu Açığa İt Takası (23.10.2026):**
   - **Sorun:** AI algoritması varış saatine göre greedy çalıştığı için körüklerde 8-25 saat yatan uçaklar (örneğin B16'da 25 saat yatan TK1361) stantları gün boyu rezerve ediyor, bu esnada açığa 40-50 dakikalık hızlı dönüşlü onlarca yolcu uçağı sürülüyordu. Ayrıca A2R'ye dar gövde konulduğu için A380 (Emirates EK124) açık pozisyona düşüyordu.
   - **Çözüm:**
     - **Yüksek Frekans Önceliği (High-Turnover First):** 60-150 dakikalık hızlı dönüşler körüklere İLK olarak örülür. Gündüz 3.5h ve genel 5h üzeri uzun yatışlar körüklerden tehir edilir (`Pass B.3`).
     - **Stand A2 (Cat F / A380) Koruması:** Stand A2L ve A2R pozisyonlarına A380 slot penceresinde (±45 dk) dar gövde girişi kilitlendi.
     - **1-to-N Eviction Swap (En Uzunu Açığa İt):** Pass F içine `EVICTION_SWAP` eklendi. Körükte 3 saatten uzun yatan bir uçak açığa alındığında onun bıraktığı pencereye $\ge 2$ adet kısa dönüşlü açık uçak sığıyorsa, uzun uçak açığa tahliye edilir ve yerine 2-7 adet kısa turnaround körüğe çekilir.
     - **Otomatik Gate-Stand Eşitlemesi:** Stant atandıktan sonra Gate iskelesi Stand iskelesi ile otomatik senkronize edilerek %68.6'lık kapı uyumsuzluğu sıfırlandı.
9. **GitHub & Canlı Dağıtım:**
   - Dağıtım: `single_commit_push.js` scripti içinde `execSync('npx vercel --scope kraften-ambalaj --prod --yes')` ile otomatik olarak Vercel production ortamına (`https://gams-web-five.vercel.app`) aktarılmaktadır.

