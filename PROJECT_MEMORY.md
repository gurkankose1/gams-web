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
5. **GitHub & Canlı Dağıtım:**
   - Commit başarıyla GitHub'a gönderildi (`node single_commit_push.js`).
   - Vercel üzerinde canlıya alındı (`vercel --prod --yes`).
