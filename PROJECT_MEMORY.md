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
2. **GitHub & Canlı Dağıtım:**
   - Commit başarıyla GitHub'a gönderildi (`node single_commit_push.js`).
   - Vercel üzerinde canlıya alındı (`vercel --prod --yes`).
3. **Bekleyen Son İşlem:**
   - Kullanıcı `C:\Users\gurka\Downloads\GAMS_Stand_Gate_Raporu_2026-10-18 (2).xlsx` çıktısını göndererek algoritmanın çıktısını incelemeyi ve daha iyisi yapılıp yapılamayacağını analiz etmeyi istedi.
