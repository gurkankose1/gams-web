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


10. **Gerçek Ekipman Durumu (Downgrade / Bakım) Excel İçe Aktarma & Çoklu Filtreleme (26.10.2026):**
   - **İGA / IST Resmi Bakım Kategorileri:** Equipment Status_v2 (4).xlsx dosyasındaki 25 resmi bakım kategorisi (FLB - LET BAKIM, PBB ARIZA - MEKANİK ÇALIŞMA, PIER İÇİ ÇALIŞMA/GİDEN KATI, FLB TEMİZLİK, PBB PCA ÇALIŞMASI, PBB 2/6 AYLIK BAKIM, PBB YILLIK PERİYODİK BAKIM, SU ÜNİTESİ BAKIM vb.) constants.ts içerisine MAINTENANCE_CATEGORIES olarak eklendi ve MaintenanceModal.tsx içerisindeki açılır menü / otomatik tamamlama listesine bağlandı.
   - **Interaktif Bakım İçe Aktarma Modalı (MaintenanceImportModal.tsx):**
     - Kullanıcı Excel dosyasını yüklediğinde otomatik olarak sayfayı, başlıkları ve satırları tespit eder.
     - **Tarih Filtresi:** Dosyada tespit edilen tüm günleri (örn: 31 Ağustos - 30 Eylül 2026) adetleriyle listeler; kullanıcı tek tıkla dilediği tarihleri seçip kaldırabilir.
     - **Kategori Filtresi:** Dosyadaki 25 kategoriyi adetleriyle listeler; arama kutusu ve tümünü seç/kaldır düğmeleri ile esnek filtreleme sağlar.
     - **Mükerrer (Deduplication) Motoru:** Aynı pozisyon, aynı tarih ve aynı saatteki mükerrer kayıtları (dosyadaki 286 mükerrer satır) ve veritabanında zaten mevcut olan kayıtları otomatik temizler.
   - **Operasyonel Çakışma Kuralı Ayrımı (Operational Conflict Logic):**
     - **Uçuş Planı İçe Aktarımı:** Gerçekleşen uçuş listesi yüklendiğinde veya bakım girildiğinde, fiilen gerçekleşen uçuşlar stantlarından silinmez veya havuza atılmaz; zaman çizelgesinde hem bakım bloğu hem uçuş kartı net şekilde görüntülenir.
     - **Manuel Atama Engeli:** Kullanıcı havuza çekilmiş veya başka bir stanttaki uçağı bakım olan bir stanta (veya MARS ilişkili ana/alt stantlarına) sürükleyip bırakmak istediğinde sürükleme hedefi kırmızıya döner (canDrop: false) ve bırakma anında hasMaintenanceConflict tetiklenerek detaylı uyarı ile manuel yerleştirme engellenir.
     - **AI Planlama Engeli:** AI Allocator (services/ai-allocator.ts), hasMaintenanceConflict ve topoloji kontrolleri sayesinde bakım olan hiçbir stanta uçak planlamaz.

11. **Tescilsiz Uçaklar ve AI Planlama Ayrımı (26.10.2026):**
   - **Otomatik Excel Yüklemesi Kuralı:** Excel dosyasından uçuş listesi yüklendiğinde, tescili olmayan (`!regNo` veya `DUMMY`, `NONE`, `ER`, `TBA`) uçaklar otomatik olarak standa atanmaz (`parkingPosition: null`) ve havuzda bekletilir.
   - **Moldova ve Yabancı Tescil Düzeltmesi:** Önceden `startsWith('ER')` kontrolü yüzünden Moldova tescilli (`ER00011`, `ERSKY`, `ER00005` vb.) gerçek havayolu uçakları yanlışlıkla tescilsiz (ER/) olarak etiketleniyordu. Bu kontrol `isFlightUnregistered` fonksiyonu ile sadece `"ER"`, `"ER/"`, `"DUMMY"`, `"TBA"` gibi gerçek sahte/boş değerleri filtreleyecek şekilde düzeltildi; gerçek tesciller korundu.
   - **AI Planlama Entegrasyonu:** Kullanıcı "AI Planla" butonuna bastığında, havuzda tescilsiz olarak bekleyen uçaklar dahi olsa, eğer Excel dosyasında sisteme tanımlı bir uçak tipi (`aircraftType`) veya tescil bilgisi (`regNo`) varsa, AI algoritması (`services/ai-allocator.ts`) bu uçakları yok saymaz; `isNoAcFlight` filtresinden geçirerek uygun körüklü veya açık pozisyonlara atamasını gerçekleştirir.

12. **Gemini Derin Düşünce Optimizasyonu & Kişisel API Key Entegrasyonu (26.10.2026):**
    - Kullanıcının Google Pro / AI Studio üzerinden aldığı kişisel API Key'ini (gams_gemini_api_key) tarayıcı yerel belleğinde (localStorage) saklayan ve yöneten services/gemini-api.ts ve components/GeminiSettingsModal.tsx geliştirildi.
    - GitHub Secret Scanning kurallarına tam uyum için kod tabanında hiçbir API Key açıkta bırakılmadı; istemci taraflı güvenli konfigürasyon sağlandı.
    - Google Generative Language API ile doğrudan haberleşen, gemini-3.6-flash, gemini-3.5-flash, gemini-3.8-flash modellerini destekleyen ve canlı ping/gecikme testi sunan ayar paneli kuruldu.
    - Klasik deterministik açgözlü kuralların ötesine geçen; açığa atılmış geniş gövdeleri, MARS kilitlerini ve atıl körük ceplerini tespit edip dispeçer aklıyla çok adımlı takas zincirleri kuran components/GeminiDeepThinkingModal.tsx arayüze entegre edildi.
    - Önerilen tüm takaslar uygulanmadan önce GAMS AMS kuralları, Cat F A2 kısıtı ve bakım takvimi ile otomatik doğrulanır.
    - Vercel production ortamına başarıyla dağıtıldı (https://gams-web-five.vercel.app).

13. **AI Skor Planla ve Otonom AI Derin Planla Ayrımı (26.10.2026):**
    - **AI Skor Planla:** Mevcut deterministik kural/açgözlü motoru (0.2 sn) '⚡ AI Skor Planla' olarak yeniden adlandırıldı. Hızlı temel operasyonel yerleşimi gerçekleştirir.
    - **AI Derin Planla (Otonom Sıfırdan Planlama):** Kullanıcının 'Hibrit istemiyorum, planlamayı komple kendisi sıfırdan yapmalı' talebi doğrultusunda, öneri sunmak yerine seçilen tarih aralığındaki tüm uçuşları sıfırdan otonom olarak stantlara dizen services/gemini-full-planner.ts ve components/GeminiDeepPlanModal.tsx geliştirildi.
    - **Operasyonel Dalga Tabanlı Dağıtım (Wave Scheduling):** 1000+ uçuş 4 saatlik zaman dilimlerine (dalgalara) ayrılarak Gemini LLM motoruna gönderilir; geniş gövdeler, MARS kilitleri ve iç/dış hat kuralları otonom olarak çözülüp doğrudan Gantt zaman çizelgesine yerleştirilir.
    - Canlıya alındı: https://gams-web-five.vercel.app

14. **Operasyonel Kilit (AOG / Cekilme / Split Leg) & Aksam WB Standalone Koruk Kurali (26.10.2026):**
    - **AOG / Cekilme Ucuslarinin Sabitlenmesi (isOperationalLocked):**
      - Gercek hayatta kopruye gelip AOG olan ve aciga cekilen (gelisi koruk, gidisi acik) veya acikta yatip korukten kalkan (gelisi acik, gidisi koruk) ucaklar ile gelis ve gidis park pozisyonu farkli olan ucuslar isOperationalLocked: true olarak isaretlendi.
      - Zaman cizelgesinde bu ucuslarin kartlarina kilit rozeti ve ozel aciklama eklendi.
      - AI Skor Planlama motoru (services/ai-allocator.ts), bu ucuslari onceden topolojiye rezerve eder, asla yerlerini degistirmez, aciga surmez veya takaslarda tahliye etmez. Tum diger ucuslar bu sabit operasyonel ucuslarin etrafinda sekillenir.
    - **Aksam 15:00+ Genis Govde (WB) 8-10h Yati Istisnasi (isEveningWidebodyLongStay):**
      - Aksam 15:00 ve sonrasinda gelen, 7-11 saat (ortalama 8-10 saat) kalan ve gece 00:00 - 04:30 arasi kalkan genis govdeli ucaklar (B77W, B789, A350 vb.) icin kopruye planlama denemesi acildi.
      - **Yalnizca Standalone Kopru Sarti:** Bu ucuslar KESINLIKLE MARS Center stantlarina (altinda L/R dar govde alt stantlari olan stantlar) verilemez; dar govde kapasitesini oldurmemek icin YALNIZCA bagimsiz standalone genis govde stantlarina (Concourse D: D6-D17, Concourse B: B13-B17, Concourse F: F14-F18, Concourse A: A9) planlanir.
      - Pass F (takas ve tahliye) motorunda da korunarak aciga dusurulmeleri engellendi.

15. **MOD H Kargo Engeli, Tow Sonrasi Bosaltma & Undo/Redo/Commit Kontrolleri (26.10.2026):**
    - **MOD H Kargo Kurali:** Mod H (Charter Kargo / Posta) ucuslari isCargoModeFlight filtresine baglandi. Kopruye hicbir sekilde alinmaz, dogrudan Kargo Apronuna (K stantlari) ve aciga yonlendirilir.
    - **Tow / Cekilme Stand Tespiti:** Excel aktariminda Departure Stand ve Arrival Stand basliklari otomatik tanimlandi. Ucus geldigi korukte sadece 60 dakika kalir, ardindan stand aninda bosa cikar ve arkasindan gelen yeni ucus ust uste binmeden hemen o standa planlanabilir.
    - **Geri Al (Undo) / Yinele (Redo) / Iptal (Cancel) / Onayla (Commit) Butonlari:**
      - Zaman cizelgesi ve havuz ustune Undo (Ctrl+Z), Redo (Ctrl+Y), Iptal Et (Reset) ve Onayla (Commit) buton grubu entegre edildi.
      - Kullanici manuel tasarimlari istedigi gibi deneyebilir, yanlis hamleleri aninda geri alabilir veya tek tikla ilk plana sifirlayabilir.
    - **Kademeli & Transaksiyonel Genis Govde Yukseltme Motoru (Standalone + MARS Elevation):**
      - Acikta kalan genis govdeler icin sadece MARS Center stantlari degil, Concourse D (D6-D17), Concourse B (B13-B17) gibi standalone bagimsiz genis govde stantlari da takas taramasina alindi.
      - Eger standalone standda dar govde varsa ve baska bir koruge tasinabiliyorsa, dar govde tahliye edilir ve aciktaki genis govde koruge cekilir. Biri bile tasinamiyorsa tum islem aninda iptal edilir (Rollback).

16. **Otomatik Dayanıklı Tampon Dengeleme Katmanı (Pass G - Buffer Smoothing) (26.10.2026):**
    - **İki Aşamalı Dayanıklı Planlama (Robust Gate Assignment):**
      - Kullanıcı talebi (Seçenek 1) doğrultusunda AI Skor Planlama sonuna otomatik Pass G (Buffer Smoothing) katmanı eklendi.
      - **Körük Koruma Prensibi:** Köprüdeki hiçbir uçak açığa atılamaz (%0 körük oranı kaybı). Sadece köprülü stantlar arasında yanal kaydırma yapılır.
      - **Darboğaz Tespiti:** Ardışık iki uçuş arasında 25 dakikanın altında kalan riskli tamponlar (pushback/gecikme durumunda apronda taksi beklemesi yaratabilecek durumlar) tespit edilir.
      - **Homojen Yayma:** Kritik aralığa sahip uçuş, aynı iskelede en az 30 dakika güvenli tampon sunabilen daha geniş boşluklu bir stanta kaydırılır.
      - **Sonuç:** Apron ve alleyway tıkanıklığı önlenir, yerde uçak bekleme riski ortadan kaldırılır ve tüm stantlar dengeli 30-75 dk tamponlarla çalışır.
